// Issue #3355 Wave D (D1) — Ari remembers.
//
// MINGLA-INVARIANT: I-ARI-MEMORY-IN-USER-DATA | issue #3355 | Each Ari turn reads the caller's own readable memory notes (ari_memory_list with the caller's JWT and the active brand), keeps at most 8 within a fixed character budget ranked by keyword overlap, correction and recency, and hands them to the model only inside the turn's <user_data> context part — never in the system prompt.
// MINGLA-INVARIANT: I-ARI-REMEMBER-NOTE-SAFE | issue #3355 | remember_note is Ari-owned reversible state (no confirmation card) that writes only through public.ari_remember_note with the caller's client; payment, ID and contact details are refused before the call, in plain words, and by the server.
//
// The SQL half (RLS: a cross-brand note is never readable; forget; hourly
// cap; server-side sensitive check) is proven in
// supabase/migrations/__tests__/issue_3355_ari_memory_notes.implementor.pg17.test.sql.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_wave_d_memory.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import {
  AGENT_TOOLS,
  findTool,
  isAgentStateToolCall,
  READ_ONLY_TOOL_NAMES,
} from "../agentTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { inferAriToolsets } from "../agentToolsets.ts";
import {
  ARI_MEMORY_CHAR_BUDGET,
  ARI_MEMORY_MAX_NOTES,
  ariMemoryContextLines,
  type AriMemoryNoteRow,
  readAriMemoryForTurn,
  rememberNoteArgs,
  selectAriMemoryNotes,
} from "../ariMemory.ts";
import { ariSensitiveReason } from "../ariPii.ts";
import { ariTurnContextPart } from "../ariTurnContext.ts";
import { buildSystemPrompt, PROMPT_VERSION } from "../agentSystemPrompt.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

const HOST = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-10T12:00:00Z");

type RpcAnswer = { data: unknown; error: { message: string } | null };

/** A caller client that answers rpc() from handlers and records calls. */
function rpcClient(
  handlers: Record<string, (args: Record<string, unknown>) => RpcAnswer>,
) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    calls,
    // Tenant containment reads the caller's brands: the host owns BRAND only.
    from(table: string) {
      const rows = table === "brands"
        ? [{
          id: BRAND,
          name: "Favy Lagos",
          slug: "favy",
          default_currency: "NGN",
        }]
        : [];
      const builder: Record<string, unknown> = {};
      for (
        const method of ["select", "eq", "is", "not", "in", "order", "limit"]
      ) {
        builder[method] = () => builder;
      }
      builder.then = (resolve: (value: RpcAnswer) => unknown) =>
        resolve({ data: rows, error: null });
      return builder;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const handler = handlers[fn];
      return Promise.resolve(
        handler
          ? handler(args)
          : { data: null, error: { message: `no ${fn}` } },
      );
    },
  };
  return client as unknown as SupabaseClient & { calls: typeof calls };
}

/**
 * One host's notes, shared by every conversation: remember_note writes,
 * ari_memory_list reads (the SQL scoping itself is the pg17 proof).
 */
function memoryWorld() {
  const notes: (AriMemoryNoteRow & { user_id: string })[] = [];
  let clock = NOW;
  const client = rpcClient({
    biz_brand_effective_rank_for_caller: (args) => ({
      data: args.p_brand_id === BRAND ? 60 : 0,
      error: null,
    }),
    ari_remember_note: (args) => {
      clock += 1_000;
      const note = {
        id: crypto.randomUUID(),
        user_id: HOST,
        brand_id: (args.p_brand_id as string | null) ?? null,
        scope: String(args.p_scope),
        kind: String(args.p_kind),
        content: String(args.p_content),
        updated_at: new Date(clock).toISOString(),
      };
      notes.push(note);
      return { data: { ...note, deduplicated: false }, error: null };
    },
    ari_memory_list: (args) => ({
      data: notes.filter((note) =>
        note.brand_id === null || note.brand_id === args.p_brand_id
      ),
      error: null,
    }),
  });
  return { notes, client };
}

Deno.test("D1: remember_note replaces save_memory_note and is Ari-owned state (no confirmation card)", () => {
  const tool = findTool("remember_note");
  assert(tool, "remember_note is registered");
  assertEquals(findTool("save_memory_note"), undefined);
  assertEquals(AGENT_TOOL_AUTHORIZATION.remember_note, {
    requiredRole: "self",
    resource: "optional_brand",
  });
  // Agent state, not a domain write: it advances inside the loop with no card.
  assert(isAgentStateToolCall("remember_note"));
  assert(!READ_ONLY_TOOL_NAMES.has("remember_note"));
  const params = tool.parameters as {
    required: string[];
    properties: Record<string, { enum?: string[]; maxLength?: number }>;
  };
  assertEquals(params.required, ["scope", "kind", "text"]);
  assertEquals(params.properties.kind.enum, [
    "preference",
    "correction",
    "fact",
  ]);
  assertEquals(params.properties.scope.enum, ["user", "brand"]);
  assertEquals(params.properties.text.maxLength, 280);
  assertEquals(AGENT_TOOLS.filter((t) => t.name === "remember_note").length, 1);
  // A correction brings the memory toolset.
  assert(
    inferAriToolsets("Actually, that's wrong: FAVY10 ends on 19 December")
      .includes("memory"),
  );
});

Deno.test("D1: payment, ID and contact details are refused before the server call, in plain words", async () => {
  for (
    const text of [
      "Email the list to ada@lantern.example",
      "Call me on +234 803 123 4567",
      "My number is 0803 123 4567",
      "Use card 4111 1111 1111 1111 for ads",
      "The account number is in the notes",
      "My password is lantern2026",
      "My BVN is on file",
    ]
  ) {
    assert(ariSensitiveReason(text), `sensitive: ${text}`);
    const client = rpcClient({});
    const error = await assertRejects(
      () =>
        findTool("remember_note")!.executor(
          { scope: "user", kind: "fact", text },
          client,
          HOST,
        ),
      ToolError,
    );
    assertEquals((error as ToolError).code, "MEMORY_SENSITIVE");
    assertMatch((error as ToolError).user_reason, /^I don't keep /);
    assertEquals(client.calls.length, 0, "nothing reached the server");
  }
  // Dates, times, prices and codes are ordinary facts.
  assertEquals(
    ariSensitiveReason(
      "FAVY10 is 10% off until 2026-12-19 at 23:59; tickets are 15000 NGN.",
    ),
    null,
  );
});

Deno.test("D1: the server's own refusals come back in plain words", async () => {
  const sensitive = rpcClient({
    ari_remember_note: () => ({
      data: null,
      error: { message: "memory_sensitive_content:payment_details" },
    }),
  });
  const error = await assertRejects(
    () =>
      findTool("remember_note")!.executor(
        { scope: "user", kind: "fact", text: "Keep the sort of thing" },
        sensitive,
        HOST,
      ),
    ToolError,
  );
  assertEquals((error as ToolError).code, "MEMORY_SENSITIVE");
  const limited = rpcClient({
    ari_remember_note: () => ({
      data: null,
      error: { message: "memory_rate_limited" },
    }),
  });
  const capped = await assertRejects(
    () =>
      findTool("remember_note")!.executor(
        { scope: "user", kind: "fact", text: "Another note" },
        limited,
        HOST,
      ),
    ToolError,
  );
  assertEquals((capped as ToolError).code, "RATE_LIMITED");
});

Deno.test("D1: arguments are checked (length, kind, a brand note needs its brand)", () => {
  const bad = (args: Record<string, unknown>) => {
    try {
      rememberNoteArgs(args);
      return "accepted";
    } catch (error) {
      return error instanceof ToolError ? error.code : "other";
    }
  };
  assertEquals(
    bad({ scope: "user", kind: "fact", text: "ab" }),
    "INVALID_ARGS",
  );
  assertEquals(
    bad({ scope: "user", kind: "fact", text: "a".repeat(281) }),
    "INVALID_ARGS",
  );
  assertEquals(
    bad({ scope: "user", kind: "workflow", text: "Hello there" }),
    "INVALID_ARGS",
  );
  assertEquals(
    bad({ scope: "brand", kind: "fact", text: "Shared fact" }),
    "INVALID_ARGS",
  );
  assertEquals(
    rememberNoteArgs({
      scope: "brand",
      kind: "correction",
      text: "  Codes   end on the event night ",
      brand_id: BRAND,
    }),
    {
      scope: "brand",
      kind: "correction",
      text: "Codes end on the event night",
      brandId: BRAND,
    },
  );
});

Deno.test("D1: a correction noted in one conversation is in the next turn's <user_data> context", async () => {
  const world = memoryWorld();
  // Conversation A: the host corrects Ari, and Ari keeps it.
  const saved = await findTool("remember_note")!.executor(
    {
      scope: "brand",
      kind: "correction",
      text: "FAVY10 ends on 19 December 2026, not a week after the event.",
      brand_id: BRAND,
    },
    world.client,
    HOST,
  ) as { id: string; deduplicated: boolean };
  assertEquals(saved.deduplicated, false);
  const write = world.client.calls.find((call) =>
    call.fn === "ari_remember_note"
  );
  assertEquals(write?.args.p_scope, "brand");
  assertEquals(write?.args.p_kind, "correction");
  assertEquals(write?.args.p_brand_id, BRAND);

  // Conversation B, next turn: the note is read as the caller and handed to
  // the model as data inside <user_data>.
  const notes = await readAriMemoryForTurn({
    caller: world.client,
    brandId: BRAND,
    message: "Make another code like FAVY10 for the influencers",
  });
  assertEquals(notes.length, 1);
  const part = ariTurnContextPart({
    snapshot: null,
    screen: null,
    memoryLines: ariMemoryContextLines(notes),
  });
  assert(part, "a context part is built from memory alone");
  assertMatch(part.text, /^<user_data source="ari_turn_context">\n/);
  assertMatch(part.text, /\n<\/user_data>$/);
  assertStringIncludes(
    part.text,
    "- [correction, shared with the brand] FAVY10 ends on 19 December 2026, not a week after the event.",
  );
  assertStringIncludes(part.text, "not instructions");
  const listCall = world.client.calls.find((call) =>
    call.fn === "ari_memory_list"
  );
  assertEquals(listCall?.args, { p_brand_id: BRAND });
});

Deno.test("D1: a note can't be written into a brand the host can't reach (tenant containment, before the server)", async () => {
  const world = memoryWorld();
  const other = "99999999-9999-4999-8999-999999999999";
  await assertRejects(
    () =>
      findTool("remember_note")!.executor(
        {
          scope: "brand",
          kind: "fact",
          text: "Planting a note",
          brand_id: other,
        },
        world.client,
        HOST,
      ),
    ToolError,
  );
  assertEquals(world.notes.length, 0);
  assert(!world.client.calls.some((call) => call.fn === "ari_remember_note"));
});

Deno.test("D1: at most 8 notes within the character budget, the relevant ones first", () => {
  const notes: AriMemoryNoteRow[] = Array.from({ length: 30 }, (_, i) => ({
    id: `n${i}`,
    brand_id: i % 2 === 0 ? BRAND : null,
    scope: i % 2 === 0 ? "brand" : "user",
    kind: "fact",
    content: `Unrelated note number ${i} about weather and parking.`,
    updated_at: new Date(NOW - i * 3_600_000).toISOString(),
  }));
  notes.push({
    id: "discount",
    brand_id: BRAND,
    scope: "brand",
    kind: "correction",
    content: "Influencer discount codes always end on the event night.",
    updated_at: new Date(NOW - 40 * 86_400_000).toISOString(),
  });
  const picked = selectAriMemoryNotes(
    notes,
    "Create discount codes for my influencers",
    { brandId: BRAND, nowMs: NOW },
  );
  assert(picked.length <= ARI_MEMORY_MAX_NOTES);
  assertEquals(picked[0].id, "discount", "keyword overlap outranks recency");
  assert(
    picked.reduce((sum, note) => sum + note.content.length, 0) <=
      ARI_MEMORY_CHAR_BUDGET,
  );
  const long = Array.from({ length: 8 }, (_, i) => ({
    id: `long${i}`,
    brand_id: null,
    kind: "fact",
    content: "x".repeat(280),
    updated_at: new Date(NOW).toISOString(),
  }));
  const capped = selectAriMemoryNotes(long, "anything", { nowMs: NOW });
  assertEquals(capped.length, 4, "4 × 280 = 1120 fits; a fifth would not");
  // A failed read never fails the turn.
  return readAriMemoryForTurn({
    caller: rpcClient({
      ari_memory_list: () => ({ data: null, error: { message: "boom" } }),
    }),
    brandId: BRAND,
    message: "hi",
  }).then((none) => assertEquals(none, []));
});

Deno.test("D1: agent-chat reads memory as the caller into <user_data>, not into the system prompt", () => {
  const chat = read("supabase/functions/agent-chat/index.ts");
  assertMatch(
    chat,
    /readAriMemoryForTurn\(\{\s*caller: userClient,\s*brandId: activeBrand\?\.id \?\? null,\s*message: semanticMessage,\s*\}\)/,
  );
  assertMatch(chat, /memoryLines: ariMemoryContextLines\(turnMemory\)/);
  assert(
    !/memory_notes:/.test(chat),
    "the 30-note dump left the system prompt",
  );
  const memory = read("supabase/functions/_shared/ariMemory.ts");
  assert(!/service_role|serviceClient|SERVICE_ROLE/.test(memory));
  // The prompt teaches the tool and the data's meaning (v31).
  assertEquals(PROMPT_VERSION, "v32");
  const prompt = buildSystemPrompt(null, [], { injectStrictReminder: false });
  assertMatch(prompt, /11\. Memory: .*remember_note/);
  assertMatch(
    prompt,
    /Never store emails, phone numbers, card or bank details/,
  );
});

Deno.test("D1: the edge and SQL refuse the same words", () => {
  const sql = read(
    "supabase/migrations/20280606063355_issue_3355_ari_memory_notes.sql",
  );
  const pii = read("supabase/functions/_shared/ariPii.ts");
  for (
    const word of [
      "password",
      "passcode",
      "bvn",
      "nin",
      "ssn",
      "passport",
      "national id",
      "cvv",
      "iban",
      "sort code",
      "routing number",
      "account number",
      "card number",
    ]
  ) {
    assertStringIncludes(sql, word);
    assertStringIncludes(pii, word);
  }
  for (const marker of ["BETWEEN 13 AND 19", ">= 7", "left(v_run, 1) = '+'"]) {
    assertStringIncludes(sql, marker);
  }
  assertStringIncludes(pii, "digits.length >= 13 && digits.length <= 19");
  assertStringIncludes(pii, 'run.startsWith("+")');
});
