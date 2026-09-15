// #2013 retest — register actual same-chain Edge writers and the named SQL
// authority functions. A read must never inherit a later unrelated insert.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

function directInsertStatements(source: string): string[] {
  const statements: string[] = [];
  const owner = '.from("agent_messages")';
  let cursor = 0;
  while (true) {
    const ownerAt = source.indexOf(owner, cursor);
    if (ownerAt < 0) return statements;
    const statementEnd = source.indexOf(";", ownerAt);
    const insertAt = source.indexOf(".insert(", ownerAt + owner.length);
    if (insertAt >= 0 && (statementEnd < 0 || insertAt < statementEnd)) {
      statements.push(source.slice(ownerAt, statementEnd < 0 ? source.length : statementEnd));
    }
    cursor = ownerAt + owner.length;
  }
}

function sqlFunction(source: string, name: string, next: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = source.indexOf(`CREATE OR REPLACE FUNCTION public.${next}`, start);
  assert(start >= 0 && end > start, `${name} function window must be present`);
  return source.slice(start, end);
}

Deno.test("#2013 tester retest: direct writers and #3429 RPC writers each carry one scoped provenance path", async () => {
  const chat = await Deno.readTextFile("supabase/functions/agent-chat/index.ts");
  const confirm = await Deno.readTextFile("supabase/functions/agent-confirm-action/index.ts");
  const turnMigration = await Deno.readTextFile(
    "supabase/migrations/20270708003429_issue_3429_ari_chat_context.sql",
  );

  // [TEST-MOD-APPROVED #3429] The old four chat direct inserts are superseded
  // by service-only claim/commit/tool RPCs. Retained invariant: every real
  // writer has exactly one provenance field and an explicit tenant scope.
  const direct = {
    "agent-chat": directInsertStatements(chat),
    "agent-confirm-action": directInsertStatements(confirm),
  };
  assertEquals(Object.fromEntries(Object.entries(direct).map(([name, rows]) => [name, rows.length])), {
    "agent-chat": 1,
    "agent-confirm-action": 1,
  });
  for (const [name, rows] of Object.entries(direct)) {
    for (const row of rows) {
      assertEquals(row.match(/\bprompt_version\s*:/g)?.length ?? 0, 1, `${name} direct writer has one provenance field`);
      assert(/\bprompt_version\s*:\s*TENANT_CONTEXT_VERSION\b/.test(row), `${name} direct writer has tenant provenance`);
      assert(/\buser_id\s*:/.test(row) && /\bconversation_id\s*:/.test(row), `${name} direct writer has explicit scope`);
    }
  }

  const functions = [
    ["claim_agent_chat_turn", "commit_agent_chat_assistant_turn"],
    ["commit_agent_chat_assistant_turn", "append_agent_chat_tool_result"],
    ["append_agent_chat_tool_result", "queue_agent_attachment_cleanup"],
  ] as const;
  for (const [name, next] of functions) {
    const window = sqlFunction(turnMigration, name, next);
    assert(window.includes("INSERT INTO public.agent_messages"), `${name} registers its real message writer`);
    assert(window.includes("p_prompt_version"), `${name} carries supplied provenance exactly once`);
    assertEquals(window.match(/INSERT INTO public\.agent_messages/g)?.length ?? 0, 1, `${name} has one message writer`);
    assert(window.includes("p_user_id") && window.includes("p_conversation_id"), `${name} requires explicit tenant scope`);
    assert(window.includes("TO service_role"), `${name} is service-only`);
  }
});

Deno.test("#2013 tester retest: a read cannot be paired with a later unrelated insert", () => {
  const readThenLaterInsert = [
    'client.from("agent_messages").select("id");',
    'client.from("other_table").insert({ prompt_version: TENANT_CONTEXT_VERSION });',
  ].join("\n");
  assertEquals(directInsertStatements(readThenLaterInsert), []);
});
