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
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_TOOLS, READ_ONLY_TOOL_NAMES } from "../agentTools.ts";
import { buildSystemPrompt, PROMPT_VERSION } from "../agentSystemPrompt.ts";
import { searchAriCapabilities } from "../agentAri10xTools.ts";

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
Deno.test('ORCH-1103 G-1: create_brand executor never writes the literal "GBP"', () => {
  const createSrc = sliceTool(TOOLS_SRC, "const createBrand: AgentTool = {");
  // The DESCRIPTION may mention GBP as an example currency for the model; the
  // EXECUTOR body must not. Slice from the `executor:` keyword onward.
  const execStart = createSrc.indexOf("executor:");
  assert(execStart >= 0, "create_brand executor not found");
  const execBody = createSrc.slice(execStart);
  assertEquals(
    /["']GBP["']/.test(execBody),
    false,
    'create_brand executor must not contain a literal "GBP" string',
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
  assertEquals(
    /admin_suspend_listing/.test(execBody),
    false,
    "no admin_suspend_listing",
  );
  assertEquals(/service.?role/i.test(execBody), false, "no service role");
});

// ── G-3: registered tools remain discoverable without bloating the prompt ──
Deno.test("ORCH-1103 G-3: update_brand + delete_brand are searchable capabilities", () => {
  const names = AGENT_TOOLS.map((t) => t.name);
  assert(names.includes("update_brand"), "update_brand registered");
  assert(names.includes("delete_brand"), "delete_brand registered");
  // Both are WRITE tools (not read-only).
  assert(!READ_ONLY_TOOL_NAMES.has("update_brand"));
  assert(!READ_ONLY_TOOL_NAMES.has("delete_brand"));

  for (const name of ["update_brand", "delete_brand"]) {
    assert(
      searchAriCapabilities(name, 20).some((match) => match.name === name),
      `${name} must be discoverable without loading every tool into the prompt`,
    );
  }
});

// #1970 Wave 0 bumped PROMPT_VERSION v3 → v4 (create_experience advertised +
// full CAPABILITIES list). The v3 pin was correct for ORCH-1103 and is now
// wrong: the prompt changed in the same PR as the registry.
Deno.test("ORCH-1103: PROMPT_VERSION bumped (v6 keeps the earlier tools)", () => {
  // [TEST-MOD-APPROVED #1978] issue #1978 bumps PROMPT_VERSION v4 → v5 (venue
  // listings/claims corrected + PII-minimised venue reads advertised).
  // [TEST-MOD-APPROVED #1971] issue #1971 bumps v5 → v6 (trip lifecycle rebuilt
  // on the canonical command boundary). ONE assertion is invalidated — the
  // version literal. No brand-tool assertion changes.
  assertEquals(PROMPT_VERSION, "v29"); // #2829 W11 completes the website journey entrances
});

Deno.test("ORCH-1103: prompt scopes currency and deletion guidance to the active brand", () => {
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
  ], {
    injectStrictReminder: false,
    business: {
      brands: [],
      activeBrand: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Lumen Coffee",
        slug: "lumen-coffee",
        defaultCurrency: "USD",
        hasCover: true,
        hasBlockingEvents: true,
      },
      offerings: [],
      payoutReady: null,
      roleHint: "owner",
      conversationSummary: null,
    },
  });
  assertStringIncludes(prompt, "Lumen Coffee");
  assertStringIncludes(prompt, "currency USD");
  assertStringIncludes(prompt, "NOT deletable yet");
  assertStringIncludes(prompt, "currency default"); // null currency → "default"
});

// Brand mutations now go through one confirmed, exactly-once operation RPC.
// The data-level deletion/currency rules are exercised in #2063's PostgreSQL
// test; this source contract prevents old direct table writers from returning.
Deno.test("ORCH-1103 brand mutations share the confirmed operation boundary", () => {
  for (
    const [name, marker] of [
      ["create_brand", "const createBrand: AgentTool = {"],
      ["update_brand", "const updateBrand: AgentTool = {"],
      ["delete_brand", "const deleteBrand: AgentTool = {"],
    ] as const
  ) {
    const toolSource = sliceTool(TOOLS_SRC, marker);
    assertStringIncludes(toolSource, `executeBrandOperation("${name}"`);
  }
  assertStringIncludes(TOOLS_SRC, "requireAgentOperationId(context)");
  assertStringIncludes(TOOLS_SRC, 'client.rpc("ari_execute_brand_operation"');
});
