// #1970 / #424 Wave 0 — platform: registry↔prompt sync, helpers, choices kinds.
// Happy path + adversarial. Fails-on-revert if create_experience drops from CAPABILITIES
// or PROMPT_VERSION is not bumped.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectChoices } from "../agentChoices.ts";
import { searchAriCapabilities } from "../agentAri10xTools.ts";
import {
  ARI_CAPABILITY_INDEX,
  buildSystemPrompt,
  PROMPT_VERSION,
} from "../agentSystemPrompt.ts";
import {
  AGENT_TOOLS,
  findTool,
  READ_ONLY_TOOL_NAMES,
  ToolError,
} from "../agentTools.ts";
import { assertCanCollect, isUuid } from "../agentToolHelpers.ts";
import { DOMAIN_READ_ONLY, MONEY_CONFIRM_TOOLS } from "../agentDomainTools.ts";
import type { BrandSummary } from "../agentSystemPrompt.ts";
import {
  ARI_HELP_SUPPORT_ONLY_TOOLS,
  ariHelpSupportToolAllowed,
} from "../ariHelpVideos.ts";

/**
 * Screen-scoped tools: offered only when the chat itself declares its screen,
 * so they are deliberately NOT in the capability map that search_capabilities
 * reads on every chat. show_help_video is offered only when the chat declares
 * workflow_context "help_support" (decision on #4420, 2026-11-21). Exactly
 * this list; the test below fails if a name here is not actually gated off
 * every other chat, so this can never hide an ordinary tool.
 */
const SCREEN_SCOPED_TOOLS: readonly string[] = ["show_help_video"];

function brand(id: string, name: string): BrandSummary {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    defaultCurrency: "USD",
    hasCover: false,
    hasBlockingEvents: false,
  };
}

Deno.test("#1970 happy: PROMPT_VERSION is v6 and create_experience is advertised", () => {
  // [TEST-MOD-APPROVED #1978] issue #1978 bumps PROMPT_VERSION v4 → v5 (venue
  // listings/claims corrected + PII-minimised venue reads advertised).
  // [TEST-MOD-APPROVED #1971] issue #1971 bumps v5 → v6 (trip days, inclusions,
  // packages, traveller intake and the aggregate money read are advertised, and
  // the trip rules block is new). ONE assertion is invalidated — the version
  // literal. Every capability-advertisement assertion below is unchanged.
  assertEquals(PROMPT_VERSION, "v40"); // #4453 Website workspace rules and tools on top of v39
  // #3355 Wave B: the capability list left the system prompt for the
  // capability index that feeds each tool's generated description.
  const prompt = buildSystemPrompt(null, []);
  assert(!prompt.includes("CAPABILITIES (your tools):"));
  const caps = ARI_CAPABILITY_INDEX;
  assertStringIncludes(caps, "create_experience");
  assertStringIncludes(caps, "publish_event");
  assertStringIncludes(caps, "upsert_ticket_tier");
  assertStringIncludes(caps, "get_operator_snapshot");
});

Deno.test("#3355 every registered tool is discoverable through Ari's capability map", () => {
  // #3355 Wave B: the capability list left the system prompt for the
  // capability index that feeds each tool's generated description.
  const prompt = buildSystemPrompt(null, []);
  assert(!prompt.includes("CAPABILITIES (your tools):"));
  const caps = ARI_CAPABILITY_INDEX;
  assertStringIncludes(caps, "search_capabilities");
  assertStringIncludes(caps, "request_tools");
  for (const tool of AGENT_TOOLS) {
    const findable = searchAriCapabilities(tool.name, 20).some((match) =>
      match.name === tool.name
    );
    if (SCREEN_SCOPED_TOOLS.includes(tool.name)) {
      // A screen-scoped tool must stay out of the map (no ordinary chat can
      // discover it)...
      assert(!findable, `${tool.name} is screen-scoped but discoverable`);
      continue;
    }
    assert(findable, `missing searchable capability for ${tool.name}`);
  }
});

Deno.test("#4420 the screen-scoped exemption is exactly show_help_video, and it is really gated", () => {
  assertEquals([...SCREEN_SCOPED_TOOLS], ["show_help_video"]);
  for (const name of SCREEN_SCOPED_TOOLS) {
    // ...it is a registered tool...
    assert(findTool(name), `${name} is not a registered tool`);
    // ...and the help_support gate removes it from every other chat.
    assert(
      ARI_HELP_SUPPORT_ONLY_TOOLS.has(name),
      `${name} is exempt but not screen-gated`,
    );
    assertEquals(ariHelpSupportToolAllowed(name, false), false, name);
    assertEquals(ariHelpSupportToolAllowed(name, true), true, name);
  }
  // Every gated tool is on the exemption list, and nothing else is.
  assertEquals(
    [...ARI_HELP_SUPPORT_ONLY_TOOLS].sort(),
    [...SCREEN_SCOPED_TOOLS].sort(),
  );
});

Deno.test("#1970 happy: richer prompt context injects offerings + payout + summary", () => {
  const prompt = buildSystemPrompt(null, [brand("b1", "Lumen")], {
    injectStrictReminder: false,
    business: {
      brands: [brand("b1", "Lumen")],
      offerings: [{
        id: "e1",
        title: "Friday Social",
        kind: "ticketed",
        status: "draft",
      }],
      payoutReady: false,
      roleHint: "owner",
      conversationSummary: "User asked to publish Friday Social",
    },
  });
  assertStringIncludes(prompt, "Friday Social");
  assertStringIncludes(prompt, "Payout-ready: no");
  assertStringIncludes(prompt, "User asked to publish Friday Social");
});

Deno.test("#1970 happy: clarifying + multi_select + next_step detectors", () => {
  const one = [brand("b1", "Lumen")];
  const clarifying = detectChoices(
    "create an event",
    "What date should we use for Friday?",
    one,
  );
  assertEquals(clarifying?.kind, "clarifying");

  const multi = detectChoices(
    "who should come",
    "Pick all that apply:\n- VIPs\n- Staff\n- Press",
    one,
  );
  assertEquals(multi?.kind, "multi_select");
  assertEquals(multi?.options.length, 3);

  const next = detectChoices(
    "brand is ready",
    "Want me to add your first event?",
    one,
  );
  assertEquals(next?.kind, "next_step");
});

Deno.test("#1970 adversarial: unknown uuid is rejected before any RPC", async () => {
  const tool = findTool("publish_event");
  assert(tool, "publish_event registered");
  await assertRejects(
    // #1972: keep the caller valid so this regression still isolates the
    // malformed resource id before any database lookup.
    () =>
      tool!.executor(
        { event_id: "not-a-uuid" },
        {} as never,
        "11111111-1111-4111-8111-111111111111",
      ),
    ToolError,
    "event_id must be a uuid",
  );
});

Deno.test("#1970 adversarial: assertCanCollect refuses when RPC says no", async () => {
  const client = {
    rpc: async () => ({ data: false, error: null }),
  } as never;
  await assertRejects(
    () => assertCanCollect(client, "11111111-1111-4111-8111-111111111111"),
    ToolError,
    "cannot collect",
  );
});

Deno.test("#1970 happy: read-only set includes snapshot + payout status", () => {
  assert(READ_ONLY_TOOL_NAMES.has("list_brands"));
  assert(READ_ONLY_TOOL_NAMES.has("get_payout_status"));
  assert(READ_ONLY_TOOL_NAMES.has("get_operator_snapshot"));
  for (const name of DOMAIN_READ_ONLY) {
    assert(READ_ONLY_TOOL_NAMES.has(name), `${name} should be inline-readable`);
  }
  assert(!READ_ONLY_TOOL_NAMES.has("publish_event"));
  assert(!READ_ONLY_TOOL_NAMES.has("refund_order"));
  assert(MONEY_CONFIRM_TOOLS.has("send_campaign_now"));
  assert(MONEY_CONFIRM_TOOLS.has("request_account_deletion"));
  assert(isUuid("11111111-1111-4111-8111-111111111111"));
  assert(!isUuid("nope"));
});
