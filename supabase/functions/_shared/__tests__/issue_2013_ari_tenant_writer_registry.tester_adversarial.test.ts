// #2013 retest — every agent_messages writer must carry authenticated
// tenant provenance. This scans every insert object rather than checking that
// each file contains the trusted token somewhere.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

function findInsertBodies(source: string): string[] {
  const bodies: string[] = [];
  const owner = '.from("agent_messages")';
  let cursor = 0;
  while (true) {
    const ownerAt = source.indexOf(owner, cursor);
    if (ownerAt < 0) break;
    const insertAt = source.indexOf(".insert(", ownerAt + owner.length);
    const nextOwner = source.indexOf(owner, ownerAt + owner.length);
    if (insertAt < 0 || (nextOwner >= 0 && nextOwner < insertAt)) {
      cursor = ownerAt + owner.length;
      continue;
    }
    const objectAt = source.indexOf("{", insertAt + ".insert(".length);
    assert(
      objectAt >= 0,
      "agent_messages insert must receive an object literal",
    );

    let depth = 0;
    let quote: "'" | '"' | "`" | null = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    let end = -1;
    for (let index = objectAt; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];
      if (lineComment) {
        if (char === "\n") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (char === "*" && next === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "/" && next === "/") {
        lineComment = true;
        index += 1;
        continue;
      }
      if (char === "/" && next === "*") {
        blockComment = true;
        index += 1;
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        quote = char;
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    assert(end > objectAt, "agent_messages insert object must be balanced");
    bodies.push(source.slice(objectAt, end));
    cursor = end;
  }
  return bodies;
}

Deno.test("#2013 tester retest: every chat and confirmation message writer emits tenant-v1 provenance", async () => {
  const writers = [
    [
      "agent-chat",
      await Deno.readTextFile("supabase/functions/agent-chat/index.ts"),
    ],
    [
      "agent-confirm-action",
      await Deno.readTextFile(
        "supabase/functions/agent-confirm-action/index.ts",
      ),
    ],
  ] as const;

  const observed: Record<string, number> = {};
  for (const [name, source] of writers) {
    const bodies = findInsertBodies(source);
    assert(
      bodies.length > 0,
      `${name} must expose at least one agent_messages writer`,
    );
    observed[name] = bodies.length;
    for (const [index, body] of bodies.entries()) {
      assertEquals(
        body.match(/\bprompt_version\s*:/g)?.length ?? 0,
        1,
        `${name} writer ${index + 1} must have exactly one provenance field`,
      );
      assert(
        /\bprompt_version\s*:\s*TENANT_CONTEXT_VERSION\b/.test(body),
        `${name} writer ${
          index + 1
        } can persist replayable data without tenant-v1 provenance`,
      );
    }
  }

  // [TEST-MOD-APPROVED #1985] #1972 still owns terminal tool rows atomically,
  // and #1985 moves one chat assistant writer into its service-only state CAS.
  // Edge retains four chat writers and one confirmation follow-up writer.
  assertEquals(observed, { "agent-chat": 4, "agent-confirm-action": 1 });

  const taskStateMigration = await Deno.readTextFile(
    "supabase/migrations/20270503001985_issue_1985_ari_conversation_task_state.sql",
  );
  const assistantWriter = taskStateMigration.slice(
    taskStateMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.commit_agent_task_assistant_turn",
    ),
    taskStateMigration.indexOf(
      "CREATE OR REPLACE FUNCTION public.commit_agent_task_outcome",
    ),
  );
  assert(assistantWriter.includes("INSERT INTO public.agent_messages"));
  assert(assistantWriter.includes("p_prompt_version"));
  assert(assistantWriter.includes("AND user_id = p_user_id"));
  assert(assistantWriter.includes(") TO service_role;"));
});
