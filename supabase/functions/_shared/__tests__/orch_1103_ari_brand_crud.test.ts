// ORCH-1103 [Ari smart brand CRUD + in-chat media]
// Implementor happy-path + guard regression (mingla-implementor side).
// The tester writes the adversarial counterpart separately.
//
// Covers:
//   - G-1: create_brand executor never contains the literal "GBP" (de-GBP).
//   - G-2: delete_brand executor has NO hard-delete / admin_suspend / service role.
//   - G-3: every WRITE tool registered in AGENT_TOOLS (minus READ_ONLY) appears
//          in the system-prompt CAPABILITIES block (registry↔prompt sync) —
//          scoped to the ORCH-1103 tools (create_experience drift is flagged
//          separately, SPEC §12, and is NOT fixed here).
//   - G-4 / SC-3: delete_brand with a blocking future event is REFUSED — it
//          throws DELETE_BLOCKED_BY_EVENTS and does NOT stamp deleted_at.
//   - SC-2: delete with NO blocking events stamps deleted_at + clears default.
//   - SC-4/T-09: create_brand with no currency + no pref OMITS default_currency
//          (column default applies) — never writes a literal code.
//
// fails-on-revert: on pre-ORCH-1103 source, delete_brand / update_brand are not
// registered (findTool returns undefined → the delete-guard test throws on the
// optional-chain call), and create_brand wrote `"GBP"` literally (the G-1 grep
// would find "GBP" in the executor) and the CAPABILITIES block lacked the new
// tools (G-3 fails). Verified by stash-revert.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AGENT_TOOLS,
  findTool,
  READ_ONLY_TOOL_NAMES,
  ToolError,
} from "../agentTools.ts";
import { buildSystemPrompt, PROMPT_VERSION } from "../agentSystemPrompt.ts";

// ── source for the strict-grep gates ────────────────────────────────────────
const TOOLS_SRC = await Deno.readTextFile(
  new URL("../agentTools.ts", import.meta.url),
);

// Extract a single executor's source by name (between the tool's `const <x>:
// AgentTool = {` and the next top-level `const ... AgentTool` / registry).
function sliceTool(src: string, marker: string): string {
  const start = src.indexOf(marker);
  assert(start >= 0, `marker not found: ${marker}`);
  // Stop at the NEXT `const <name>: AgentTool = {` declaration (or the registry
  // export) so the slice contains exactly ONE tool's declaration + executor.
  const after = start + marker.length;
  const nextTool = src.slice(after).search(/const \w+: AgentTool = \{/);
  const registry = src.indexOf("export const AGENT_TOOLS", after);
  const candidates = [
    nextTool >= 0 ? after + nextTool : Infinity,
    registry >= 0 ? registry : Infinity,
  ];
  const end = Math.min(...candidates);
  return src.slice(start, Number.isFinite(end) ? end : undefined);
}

// ── G-1: de-GBP — create_brand executor must not contain the literal "GBP" ──
Deno.test("ORCH-1103 G-1: create_brand executor never writes the literal \"GBP\"", () => {
  const createSrc = sliceTool(TOOLS_SRC, "const createBrand: AgentTool = {");
  // The DESCRIPTION may mention GBP as an example currency for the model; the
  // EXECUTOR body must not. Slice from the `executor:` keyword onward.
  const execStart = createSrc.indexOf("executor:");
  assert(execStart >= 0, "create_brand executor not found");
  const execBody = createSrc.slice(execStart);
  assertEquals(
    /["']GBP["']/.test(execBody),
    false,
    "create_brand executor must not contain a literal \"GBP\" string",
  );
});

// ── G-2: no hard delete / admin / service role in delete_brand executor ──
Deno.test("ORCH-1103 G-2: delete_brand executor has no hard-delete / admin / service-role", () => {
  const delSrc = sliceTool(TOOLS_SRC, "const deleteBrand: AgentTool = {");
  const execStart = delSrc.indexOf("executor:");
  assert(execStart >= 0, "delete_brand executor not found");
  const execBody = delSrc.slice(execStart);
  assertEquals(/\.delete\(/.test(execBody), false, "no .delete(");
  assertEquals(/DELETE FROM/i.test(execBody), false, "no DELETE FROM");
  assertEquals(/admin_suspend_listing/.test(execBody), false, "no admin_suspend_listing");
  assertEquals(/service.?role/i.test(execBody), false, "no service role");
});

// ── G-3: registry ↔ prompt sync for the ORCH-1103 WRITE tools ──
Deno.test("ORCH-1103 G-3: update_brand + delete_brand are in BOTH registry and CAPABILITIES", () => {
  const names = AGENT_TOOLS.map((t) => t.name);
  assert(names.includes("update_brand"), "update_brand registered");
  assert(names.includes("delete_brand"), "delete_brand registered");
  // Both are WRITE tools (not read-only).
  assert(!READ_ONLY_TOOL_NAMES.has("update_brand"));
  assert(!READ_ONLY_TOOL_NAMES.has("delete_brand"));

  const prompt = buildSystemPrompt(null, []);
  const capsStart = prompt.indexOf("CAPABILITIES");
  assert(capsStart >= 0, "CAPABILITIES block present");
  const caps = prompt.slice(capsStart);
  assertStringIncludes(caps, "update_brand");
  assertStringIncludes(caps, "delete_brand");
});

Deno.test("ORCH-1103: PROMPT_VERSION bumped to v3", () => {
  assertEquals(PROMPT_VERSION, "v3");
});

// ── richer brand context in the prompt (currency / cover / deletable hint) ──
Deno.test("ORCH-1103: prompt injects per-brand currency + cover + deletable hint", () => {
  const prompt = buildSystemPrompt(null, [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Lumen Coffee",
      slug: "lumen-coffee",
      defaultCurrency: "USD",
      hasCover: true,
      hasBlockingEvents: true,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Night Owl Bar",
      slug: "night-owl-bar",
      defaultCurrency: null,
      hasCover: false,
      hasBlockingEvents: false,
    },
  ]);
  assertStringIncludes(prompt, "Lumen Coffee");
  assertStringIncludes(prompt, "currency USD");
  assertStringIncludes(prompt, "has cover");
  assertStringIncludes(prompt, "NOT deletable yet");
  assertStringIncludes(prompt, "currency default"); // null currency → "default"
  assertStringIncludes(prompt, "no cover");
  assertStringIncludes(prompt, "deletable");
});

// ── mock Supabase client (chainable query-builder) ──────────────────────────
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

interface TableScript {
  // count returned by .select(..., {count:'exact'}) terminal awaits
  count?: number;
  // single()/maybeSingle() row
  single?: Row | null;
  // error to surface on the terminal
  error?: { message: string; code?: string } | null;
}

// Records mutations so the test can assert what was (or was NOT) written.
interface Recorder {
  updates: { table: string; payload: Row }[];
  inserts: { table: string; payload: Row }[];
}

function makeClient(
  scripts: Record<string, TableScript>,
  rec: Recorder,
) {
  function builder(table: string) {
    let pendingUpdate: Row | null = null;
    let pendingInsert: Row | null = null;
    const script = scripts[table] ?? {};
    const chain: Record<string, unknown> = {};
    const passthrough = (): Record<string, unknown> => chain;
    // terminal that resolves with {data,count,error}
    const terminal = (data: unknown) =>
      Promise.resolve({
        data,
        count: script.count ?? null,
        error: script.error ?? null,
      });

    Object.assign(chain, {
      select: (_cols?: string, _opts?: unknown) => {
        // head:true count query is awaited directly on the chain
        return Object.assign(
          terminal(null),
          chain,
        );
      },
      insert: (payload: Row) => {
        pendingInsert = payload;
        rec.inserts.push({ table, payload });
        return chain;
      },
      update: (payload: Row) => {
        pendingUpdate = payload;
        rec.updates.push({ table, payload });
        return chain;
      },
      eq: passthrough,
      in: passthrough,
      is: passthrough,
      gt: passthrough,
      order: passthrough,
      limit: passthrough,
      maybeSingle: () => terminal(script.single ?? null),
      single: () => terminal(script.single ?? null),
      // allow `await chain` after a head:true count select
      then: (resolve: (v: unknown) => void) =>
        terminal(pendingInsert ?? pendingUpdate ?? null).then(resolve),
    });
    return chain;
  }
  return { from: (t: string) => builder(t) } as unknown as Parameters<
    NonNullable<ReturnType<typeof findTool>>["executor"]
  >[1];
}

const OWNED_BRAND_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// ── G-4 / SC-3: delete REFUSED when a blocking future event exists ──
Deno.test("ORCH-1103 G-4: delete_brand with a blocking future event is REFUSED (no deleted_at)", async () => {
  const rec: Recorder = { updates: [], inserts: [] };
  const client = makeClient(
    {
      // assertBrandOwned → ownership ok
      brands: { single: { id: OWNED_BRAND_ID } },
      // blocking-events count → 2 upcoming
      events: { count: 2 },
    },
    rec,
  );
  const del = findTool("delete_brand");
  assert(del, "delete_brand registered");

  const err = await assertRejects(
    () => del!.executor({ brand_id: OWNED_BRAND_ID }, client, USER_ID),
    ToolError,
  );
  assertEquals((err as ToolError).code, "DELETE_BLOCKED_BY_EVENTS");
  assertStringIncludes((err as ToolError).message, "2 upcoming");

  // CRITICAL: no deleted_at stamp happened (no update to `brands`).
  const brandUpdates = rec.updates.filter((u) => u.table === "brands");
  assertEquals(brandUpdates.length, 0, "deleted_at must NOT be stamped on refusal");
});

// ── SC-2: delete with NO blocking events stamps deleted_at + clears default ──
Deno.test("ORCH-1103 SC-2: delete_brand with no blocking events soft-deletes + clears default", async () => {
  const rec: Recorder = { updates: [], inserts: [] };
  const client = makeClient(
    {
      brands: { single: { id: OWNED_BRAND_ID } },
      events: { count: 0 },
      creator_accounts: { single: null },
    },
    rec,
  );
  const del = findTool("delete_brand");
  const result = await del!.executor({ brand_id: OWNED_BRAND_ID }, client, USER_ID) as {
    deleted: boolean;
    recovery_window_days: number;
  };
  assertEquals(result.deleted, true);
  assertEquals(result.recovery_window_days, 30);

  const brandUpdates = rec.updates.filter((u) => u.table === "brands");
  assertEquals(brandUpdates.length, 1, "exactly one brands update (the soft-delete)");
  assert("deleted_at" in brandUpdates[0].payload, "deleted_at stamped");

  const defaultClears = rec.updates.filter(
    (u) => u.table === "creator_accounts" && u.payload.default_brand_id === null,
  );
  assertEquals(defaultClears.length, 1, "default_brand_id cleared (non-fatal)");
});

// ── SC-4 / T-09: create_brand with no currency + no pref OMITS default_currency ──
Deno.test("ORCH-1103 SC-4: create_brand omits default_currency when no arg + no pref (no literal code)", async () => {
  const rec: Recorder = { updates: [], inserts: [] };
  const client = makeClient(
    {
      // agent_user_profile lookup → no preferred_currency
      agent_user_profile: { single: { preferred_currency: null } },
      // insert returns the new row
      brands: {
        single: {
          id: OWNED_BRAND_ID,
          name: "Lumen",
          slug: "lumen",
          default_currency: "USD", // column default applied server-side
          cover_media_url: null,
          cover_media_type: null,
          created_at: "2026-06-08T00:00:00Z",
        },
        // count for the first-brand default check
        count: 1,
      },
      creator_accounts: { single: { id: USER_ID } },
    },
    rec,
  );
  const create = findTool("create_brand");
  await create!.executor({ name: "Lumen" }, client, USER_ID);

  const brandInsert = rec.inserts.find((i) => i.table === "brands");
  assert(brandInsert, "brand insert happened");
  assertEquals(
    "default_currency" in brandInsert!.payload,
    false,
    "default_currency must be OMITTED so the column default applies",
  );
});

// ── SC-4: create_brand with an explicit currency arg writes it uppercased ──
Deno.test("ORCH-1103 SC-4b: create_brand honors an explicit currency arg (uppercased)", async () => {
  const rec: Recorder = { updates: [], inserts: [] };
  const client = makeClient(
    {
      brands: {
        single: { id: OWNED_BRAND_ID, name: "Lumen", slug: "lumen", default_currency: "USD", created_at: "x" },
        count: 2, // not the first brand → default not changed
      },
    },
    rec,
  );
  const create = findTool("create_brand");
  await create!.executor({ name: "Lumen", default_currency: "usd" }, client, USER_ID);
  const brandInsert = rec.inserts.find((i) => i.table === "brands");
  assertEquals(brandInsert!.payload.default_currency, "USD");
});

// ── update_brand: empty patch → INVALID_ARGS ──
Deno.test("ORCH-1103: update_brand with no editable fields → INVALID_ARGS", async () => {
  const rec: Recorder = { updates: [], inserts: [] };
  const client = makeClient({ brands: { single: { id: OWNED_BRAND_ID } } }, rec);
  const upd = findTool("update_brand");
  const err = await assertRejects(
    () => upd!.executor({ brand_id: OWNED_BRAND_ID }, client, USER_ID),
    ToolError,
  );
  assertEquals((err as ToolError).code, "INVALID_ARGS");
});
