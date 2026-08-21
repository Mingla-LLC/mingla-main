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
import { buildSystemPrompt, PROMPT_VERSION } from "../agentSystemPrompt.ts";
import { AGENT_TOOLS, findTool, READ_ONLY_TOOL_NAMES, ToolError } from "../agentTools.ts";
import { assertCanCollect, isUuid } from "../agentToolHelpers.ts";
import { DOMAIN_READ_ONLY, MONEY_CONFIRM_TOOLS } from "../agentDomainTools.ts";
import type { BrandSummary } from "../agentSystemPrompt.ts";

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

Deno.test("#1970 happy: PROMPT_VERSION is v5 and create_experience is advertised", () => {
  // [TEST-MOD-APPROVED #1978] issue #1978 bumps PROMPT_VERSION v4 → v5 (venue
  // listings/claims corrected + PII-minimised venue reads advertised).
  assertEquals(PROMPT_VERSION, "v5");
  const prompt = buildSystemPrompt(null, []);
  const caps = prompt.slice(prompt.indexOf("CAPABILITIES"));
  assertStringIncludes(caps, "create_experience");
  assertStringIncludes(caps, "publish_event");
  assertStringIncludes(caps, "upsert_ticket_tier");
  assertStringIncludes(caps, "get_operator_snapshot");
});

Deno.test("#1970 happy: every registered tool name appears in CAPABILITIES", () => {
  const prompt = buildSystemPrompt(null, []);
  const caps = prompt.slice(prompt.indexOf("CAPABILITIES"));
  for (const tool of AGENT_TOOLS) {
    assert(caps.includes(`- ${tool.name} —`), `missing CAPABILITIES line for ${tool.name}`);
  }
});

Deno.test("#1970 happy: richer prompt context injects offerings + payout + summary", () => {
  const prompt = buildSystemPrompt(null, [brand("b1", "Lumen")], {
    injectStrictReminder: false,
    business: {
      brands: [brand("b1", "Lumen")],
      offerings: [{ id: "e1", title: "Friday Social", kind: "ticketed", status: "draft" }],
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
