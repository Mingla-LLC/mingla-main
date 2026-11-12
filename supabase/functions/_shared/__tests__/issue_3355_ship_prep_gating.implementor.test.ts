// #3355 ship-prep — with the "Ari understands first" rollout switch OFF for a
// brand, Ari runs as production does today (origin/main 7ace80fa0a, #4389 included). This
// pins the off path:
//   1. the system prompt is byte-identical to origin/main's builder output,
//      the tool declarations are origin/main's (same 187 tools, order,
//      descriptions and schemas), and the per-turn tool selection matches;
//   2. the Feature Guide search tool and its pre-answer / refusal guard are
//      offered and enforced only with the switch on;
//   3. typed words start a setup with origin/main's classifier, and an open
//      setup keeps origin/main's rules (the "can wait" card, no parking);
//   4. the post-approval continuation and the reply text keep origin/main's
//      words.
// The digests were made by running origin/main's buildSystemPrompt and
// AGENT_TOOLS on the fixtures in fixtures/issue_3355_ship_prep_prompt_fixtures.ts.
//
// MINGLA-INVARIANT: I-ARI-ROLLOUT-OFF-IS-MAIN | issue #3355 | With the rollout switch off, agent-chat's system prompt is byte-identical to origin/main's builder (PROMPT_VERSION v30) for the same inputs, and the turn offers origin/main's tool declarations without search_mingla_guide (enforced by supabase/functions/_shared/__tests__/issue_3355_ship_prep_gating.implementor.test.ts).
// MINGLA-INVARIANT: I-ARI-GUIDE-ONLY-WHEN-ON | issue #3355 | search_mingla_guide is offered, pre-read and forced (refusal recovery, stuck-host reads) only when the rollout switch covers the turn's brand (enforced by supabase/functions/_shared/__tests__/issue_3355_ship_prep_gating.implementor.test.ts).

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PROMPT_FIXTURES,
  TOOLSET_MESSAGES,
} from "./fixtures/issue_3355_ship_prep_prompt_fixtures.ts";
import {
  ariPromptVersionFor,
  buildAriTurnSystemPrompt,
  buildLegacySystemPrompt,
  LEGACY_PROMPT_VERSION,
} from "../agentSystemPromptLegacy.ts";
import {
  buildSystemPrompt,
  type BusinessContext,
  PROMPT_VERSION,
} from "../agentSystemPrompt.ts";
import {
  ariTurnAgentTools,
  ariTurnToolDeclarations,
  ariTurnToolError,
  findAriTurnTool,
  isAriTurnAgentStateCall,
} from "../ariRolloutTurn.ts";
import {
  inferAriToolsets,
  inferLegacyAriToolsets,
  selectAriTools,
} from "../agentToolsets.ts";
import { AGENT_TOOLS } from "../agentTools.ts";
import { searchAriCapabilities } from "../agentAri10xTools.ts";
import { ariToolDeclarations } from "../ariToolDescriptions.ts";
import { classifyOfferingIntent } from "../ariFlows/index.ts";
import { brandCanWaitStep } from "../ariFlows/brandGate.ts";
import type { FlowContext } from "../ariFlows/types.ts";

/** origin/main 7ace80fa0a, buildSystemPrompt on each fixture (sha-256). */
const MAIN_PROMPT_DIGESTS: Record<string, string> = {
  "owner with an active brand, offerings and a task":
    "5f8923ea6c2e3443057c8954b542aac583e8de37ccc2155eddb1c693092d73ae",
  "no profile, no brands, first run, injection reminder":
    "fa252906f21dab156d2c10978cca6648670dc9ade07f14c6d81b12841b138154",
  "teammate, payout ready, legacy unscoped summary":
    "65e687c809e6f14987a74fe1736558083c2552ab8a2a613ea0fa8b79f4ef6da4",
};
/** origin/main's AGENT_TOOLS as declared to the model (sha-256 of the JSON). */
const MAIN_DECLARATIONS_DIGEST =
  "72e6c9b02d8039292d87233052bdf10391fab46adb3a7da7c1570c3b9ea7e844";
const MAIN_DECLARATION_COUNT = 187;
/** origin/main's selectAriTools(inferAriToolsets(m), 12, m) names. */
const MAIN_SELECTION: Record<string, string[]> = {
  "Create a discount code FAVY10 for 10% off until 19 December": [
    "get_operator_snapshot",
    "search_capabilities",
    "request_tools",
    "get_capability_inventory",
    "create_discount",
    "end_discount",
    "pause_discount",
    "resume_discount",
    "read_public_url",
    "list_discounts",
    "list_referral_offers",
    "list_ad_audiences",
  ],
  "Actually, I always want prices in naira from now on": [
    "get_operator_snapshot",
    "search_capabilities",
    "request_tools",
    "get_capability_inventory",
    "list_brands",
    "get_brand_site",
    "inspect_public_social_profile",
    "get_brand_readiness",
    "list_brand_audit_log",
    "get_brand_balances_reports",
    "list_partner_brand_links",
    "get_brand_analytics",
  ],
  "Remember that our doors open at 8pm": [
    "get_operator_snapshot",
    "search_capabilities",
    "request_tools",
    "get_capability_inventory",
    "list_memory_notes",
    "save_memory_note",
    "forget_memory_note",
    "manage_ari_history",
    "update_ari_prefs",
    "manage_agent_job",
  ],
  "Refund the order for Ada": [
    "get_operator_snapshot",
    "search_capabilities",
    "request_tools",
    "get_capability_inventory",
    "get_order_refund_preview",
    "refund_order",
    "get_event_order_reconciliation",
    "get_trip_order_money",
    "refund_rsvp_contribution",
    "cancel_order",
    "set_refund_policy",
    "list_events",
  ],
  "Help me set up my website": [
    "get_operator_snapshot",
    "search_capabilities",
    "request_tools",
    "get_capability_inventory",
    "get_brand_site",
    "search_public_web",
    "read_public_url",
    "get_onboarding_plan",
    "inspect_public_social_profile",
    "fetch_public_listing_page",
    "extract_listing_candidates",
    "build_host_onboarding_blueprint",
  ],
  "How do I add a ticket tier?": [
    "get_operator_snapshot",
    "search_capabilities",
    "request_tools",
    "get_capability_inventory",
    "upsert_ticket_tier",
    "create_support_ticket",
    "list_events",
    "fetch_public_listing_page",
    "extract_listing_candidates",
    "list_venue_listings",
    "get_venue_listing_status",
    "get_order_refund_preview",
  ],
  "Publish Lagos Night Out": [
    "get_operator_snapshot",
    "search_capabilities",
    "request_tools",
    "get_capability_inventory",
    "list_brands",
    "get_brand_site",
    "inspect_public_social_profile",
    "get_brand_readiness",
    "get_brand_balances_reports",
    "list_brand_audit_log",
    "list_partner_brand_links",
    "get_brand_analytics",
  ],
  "Never mind, list my events": [
    "get_operator_snapshot",
    "search_capabilities",
    "request_tools",
    "get_capability_inventory",
    "list_brands",
    "get_brand_site",
    "inspect_public_social_profile",
    "list_brand_audit_log",
    "list_partner_brand_links",
    "get_brand_readiness",
    "get_brand_balances_reports",
    "get_brand_analytics",
  ],
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

const AGENT_CHAT = await Deno.readTextFile(
  new URL("../../agent-chat/index.ts", import.meta.url),
);
const POST_APPROVAL = await Deno.readTextFile(
  new URL("../agentPostApproval.ts", import.meta.url),
);

// ── 1. The prompt ───────────────────────────────────────────────────────────

Deno.test("ship-prep 1: switch OFF builds a prompt byte-identical to origin/main's builder", async () => {
  for (const fixture of PROMPT_FIXTURES) {
    const off = buildAriTurnSystemPrompt(
      false,
      fixture.profile,
      fixture.brands,
      fixture.options as {
        injectStrictReminder: boolean;
        business?: BusinessContext | null;
      },
    );
    assertEquals(
      await sha256(off),
      MAIN_PROMPT_DIGESTS[fixture.name],
      fixture.name,
    );
  }
  assertEquals(LEGACY_PROMPT_VERSION, "v30");
  assertEquals(ariPromptVersionFor(false), "v30");
});

Deno.test("ship-prep 1: switch ON builds the current prompt, which differs", async () => {
  for (const fixture of PROMPT_FIXTURES) {
    const options = fixture.options as {
      injectStrictReminder: boolean;
      business?: BusinessContext | null;
    };
    const on = buildAriTurnSystemPrompt(
      true,
      fixture.profile,
      fixture.brands,
      options,
    );
    assertEquals(
      on,
      buildSystemPrompt(fixture.profile, fixture.brands, options),
    );
    assertNotEquals(await sha256(on), MAIN_PROMPT_DIGESTS[fixture.name]);
    assertMatch(on, /search_mingla_guide/);
    assert(
      !buildLegacySystemPrompt(fixture.profile, fixture.brands, options)
        .includes("search_mingla_guide"),
    );
  }
  assertEquals(ariPromptVersionFor(true), PROMPT_VERSION);
  assertNotEquals(PROMPT_VERSION, LEGACY_PROMPT_VERSION);
});

Deno.test("ship-prep 1: agent-chat builds the turn's prompt through the switch", () => {
  assertMatch(
    AGENT_CHAT,
    /const systemPrompt = buildAriTurnSystemPrompt\(\s*understandFirst,/,
  );
  assert(!/\bbuildSystemPrompt\(/.test(AGENT_CHAT));
  // The loop's extra prompt lines are on-path only.
  assertMatch(
    AGENT_CHAT,
    /\(understandFirst\s*\?\s*`\\n\\nTURN HINTS/,
  );
  // origin/main's memory notes stay in the caller-scoped context when off.
  assertMatch(AGENT_CHAT, /memory_notes: Array\.isArray\(memoryNotes\)/);
});

Deno.test("ship-prep 1: switch OFF declares origin/main's tools, in order, with their own descriptions", async () => {
  const off = ariTurnToolDeclarations(ariTurnAgentTools(false), false);
  assertEquals(off.length, MAIN_DECLARATION_COUNT);
  assertEquals(await sha256(JSON.stringify(off)), MAIN_DECLARATIONS_DIGEST);
  const on = ariTurnToolDeclarations(ariTurnAgentTools(true), true);
  assertEquals(on, ariToolDeclarations(AGENT_TOOLS));
  assertNotEquals(await sha256(JSON.stringify(on)), MAIN_DECLARATIONS_DIGEST);
});

Deno.test("ship-prep 1: switch OFF selects origin/main's tools for each message", () => {
  const off = ariTurnAgentTools(false);
  for (const message of TOOLSET_MESSAGES) {
    assertEquals(
      selectAriTools(off, inferLegacyAriToolsets(message), 12, message)
        .map((tool) => tool.name),
      MAIN_SELECTION[message],
      message,
    );
  }
  // The on path's wider memory words ("actually", "always") are on-path only.
  const words = "Actually, I always want prices in naira from now on";
  assert(inferAriToolsets(words).includes("memory"));
  assert(!inferLegacyAriToolsets(words).includes("memory"));
});

Deno.test("ship-prep 1: agent-chat selects, declares and runs tools through the switch", () => {
  assertMatch(
    AGENT_CHAT,
    /: !understandFirst\s*\? inferLegacyAriToolsets\(semanticMessage\)/,
  );
  assertMatch(
    AGENT_CHAT,
    /const turnTools = ariTurnAgentTools\(understandFirst\);/,
  );
  assert(!/\bariToolDeclarations\(/.test(AGENT_CHAT));
  assert(!/\bselectAriTools\(\s*AGENT_TOOLS/.test(AGENT_CHAT));
  assertMatch(
    AGENT_CHAT,
    /const intentTargetTool = understandFirst && turnRoute\.targetTool/,
  );
  assertMatch(AGENT_CHAT, /budget: !understandFirst\s*\?/);
  assertMatch(
    AGENT_CHAT,
    /ariTurnToolError\(normalizeAriToolError\(error\), understandFirst\)/,
  );
});

Deno.test("ship-prep 1: the off path keeps save_memory_note as Ari-owned state and drops the Wave B error fields", () => {
  const save = findAriTurnTool("save_memory_note", false);
  assert(save);
  assertEquals(save.requiredRole, "self");
  assertEquals(findAriTurnTool("remember_note", false), undefined);
  assertEquals(findAriTurnTool("save_memory_note", true), undefined);
  assert(isAriTurnAgentStateCall("save_memory_note", false));
  assert(!isAriTurnAgentStateCall("remember_note", false));
  assert(isAriTurnAgentStateCall("remember_note", true));
  const tellOwner = findAriTurnTool("tell_owner_in_brand_group", false)!;
  assertEquals(
    (tellOwner.parameters.properties as Record<string, { enum?: unknown }>)
      .about.enum,
    ["payment_setup"],
  );
  const normal = {
    code: "PAYOUT_NOT_READY",
    message: "Payouts are not set up.",
    recoverable: true,
    user_reason: "Payouts aren't set up yet.",
    next_step: { kind: "tool", tool: "get_payout_status" },
  };
  assertEquals(ariTurnToolError(normal, false), {
    code: "PAYOUT_NOT_READY",
    message: "Payouts are not set up.",
    recoverable: true,
  });
  assertEquals(ariTurnToolError(normal, true), normal);
});

// ── 2. The Feature Guide tool and its guard ─────────────────────────────────

Deno.test("ship-prep 2: search_mingla_guide is offered only with the switch on", () => {
  const offNames = ariTurnAgentTools(false).map((tool) => tool.name);
  const onNames = ariTurnAgentTools(true).map((tool) => tool.name);
  assert(!offNames.includes("search_mingla_guide"));
  assert(onNames.includes("search_mingla_guide"));
  assertEquals(findAriTurnTool("search_mingla_guide", false), undefined);
  assert(findAriTurnTool("search_mingla_guide", true));
  // The capability map behind search_capabilities does not name it either.
  const legacyMap = searchAriCapabilities("Feature Guide steps memory", 40, {
    legacy: true,
  }).map((item) => item.name);
  assert(!legacyMap.includes("search_mingla_guide"));
  assert(
    searchAriCapabilities("Feature Guide steps", 40).some((item) =>
      item.name === "search_mingla_guide"
    ),
  );
  assert(
    searchAriCapabilities("save preference correction", 40, { legacy: true })
      .some((item) => item.name === "save_memory_note"),
  );
});

Deno.test("ship-prep 2: the guide's pre-reads, forced reads and refusal recovery are on-path only", () => {
  // Pre-answer and stuck-host reads.
  assertMatch(
    AGENT_CHAT,
    /: !understandFirst\s*\? \[\]\s*\/\/ #3355 Wave D \(D4\): a stuck host's answer comes from the guide/,
  );
  // The refusal guard (a "can't" with no guide search re-runs the model).
  assertMatch(
    AGENT_CHAT,
    /recoverReadsFromPrematureText: !understandFirst\s*\? standaloneResearchRequest && !completeFromSearchIndex\s*\? \(_text, observations\) => requiredPublicPageReads\(observations\)\s*: undefined/,
  );
  const guideCalls = [...AGENT_CHAT.matchAll(
    /ariGuide(?:Initial|Forced|Recovery)Calls\(/g,
  )].length;
  assertEquals(guideCalls, 3);
});

// ── 3. Setups ───────────────────────────────────────────────────────────────

Deno.test("ship-prep 3: typed words start a setup with origin/main's classifier when off", () => {
  const favy =
    "I want to create discount codes for influencers and marketers of my event to give their followers to get discounts when purchasing tickets";
  assertEquals(classifyOfferingIntent(favy), null);
  assertEquals(classifyOfferingIntent(favy, { legacy: true }), "create_event");
  assertMatch(
    AGENT_CHAT,
    /route: understandFirst\s*\? turnRoute\.flow\s*: flowRouteFromHints\(semanticMessage\),\s*legacy: !understandFirst,/,
  );
  assertMatch(
    AGENT_CHAT,
    /\(!understandFirst && isWebsiteSetupRequest\(semanticMessage\)\)/,
  );
  assertMatch(
    AGENT_CHAT,
    /const eventPlannerRequest = understandFirst\s*\? turnRoute\.planner\s*: isCreateEventPlanningRequest\(semanticMessage\);/,
  );
});

Deno.test("ship-prep 3: the 'can wait' items are origin/main's card when off, never a step when on", async () => {
  const readiness = {
    items: [{
      key: "tagline",
      label: "Tagline",
      group: "identity",
      state: "missing",
      severity: "skippable",
      blocks_action: false,
      blocking_for: [],
      recommended_for: ["publish_free"],
      value_preview: null,
      deferrable: true,
      deferral: null,
      skip_in_ari: false,
      owner_action: "Add a tagline",
      fix: {
        route: "/brand/b/edit",
        route_label: "Brand profile",
        can_caller_fix: true,
        who_can_fix: "you",
      },
    }],
  };
  const ctx = (legacy: boolean) =>
    ({
      run: { step_states: {}, session_skips: [], answers: {} },
      def: { noun: "event", readiness: { publish: "publish_free" } },
      deps: { readiness: () => Promise.resolve(readiness) },
      brandName: "Lantern",
      state: undefined,
      ...(legacy ? { legacy: true } : {}),
    }) as unknown as FlowContext;
  const off = await brandCanWaitStep.probe(ctx(true));
  const on = await brandCanWaitStep.probe(ctx(false));
  assertEquals(on.done, true);
  assertEquals(off.done, false);
  const ask = (off as { ask?: { title: string; options: unknown[] } }).ask;
  assertEquals(ask?.title, "Before your event goes live");
  assertEquals(ask?.options[0], {
    id: "not_now",
    label: "Not now, keep going",
  });
});

// ── 4. After approval and the reply text ────────────────────────────────────

Deno.test("ship-prep 4: the post-approval continuation and the reply text keep origin/main's words when off", () => {
  assertMatch(
    POST_APPROVAL,
    /if \(!understandFirst\) \{\s*const legacy = await continueAfterApprovedActionLegacy\(args\);/,
  );
  assertMatch(
    AGENT_CHAT,
    /const legacyText = unguardedArgs\.understandFirst === false;/,
  );
  assertMatch(
    AGENT_CHAT,
    /const brandDisplay = args\.understandFirst === false\s*\? null/,
  );
});
