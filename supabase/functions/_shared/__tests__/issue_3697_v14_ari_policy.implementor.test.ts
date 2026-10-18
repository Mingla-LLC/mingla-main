import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { preflightMoneyProposal } from "../agentDomainTools.ts";
import {
  AGENT_TOOL_AUTHORIZATION,
  authorizeAgentTool,
} from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { findTool, READ_ONLY_TOOL_NAMES } from "../agentTools.ts";
import { TENANT_SCOPED_READ_TOOL_NAMES } from "../agentTenantScope.ts";
import { verifiedProposalArgs } from "../agentTicketPricing.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const HASH = "a".repeat(64);

const PROPOSE_ARGS = {
  brand_id: BRAND,
  name: "Deserted Island",
  dest_page_type: "event",
  dest_brand_slug: "nightlifefemzyevents",
  dest_entity_slug: "deserted-island",
  platforms: ["meta", "tiktok"],
  budget_cents: 30000,
  daily_budget_cents: 3000,
  countries: ["NG"],
  cities: [{ name: "Lagos", country_code: "NG" }],
  radius_km: 30,
  interests: ["Camping", "Nightlife"],
  age_min: 21,
  age_max: 40,
  gender: "all",
  primary_text: "Three days off-grid.",
  rights_confirmed: true,
  rights_basis: "authorized_by_brand",
  ai_generated: false,
};

function authorizationClient(
  allowed: readonly string[],
  rank = 20,
  calls: string[] = [],
) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push(`${name}:${String(args.p_action ?? "")}`);
      if (name === "ad_can_host_action_for_caller") {
        return Promise.resolve({
          data: allowed.includes(String(args.p_action)),
          error: null,
        });
      }
      if (name === "biz_brand_effective_rank_for_caller") {
        return Promise.resolve({ data: rank, error: null });
      }
      return Promise.resolve({ data: 0, error: null });
    },
  } as never;
}

Deno.test("#3697 Ari plan is a confirmed video-bound write, never an inline read", () => {
  assert(!READ_ONLY_TOOL_NAMES.has("propose_ad_plan"));
  assert(!TENANT_SCOPED_READ_TOOL_NAMES.has("propose_ad_plan"));
  assertEquals(AGENT_TOOL_AUTHORIZATION.propose_ad_plan.hostAdActions, [
    "plan",
  ]);
  assertEquals(AGENT_TOOL_AUTHORIZATION.approve_ad_plan.hostAdActions, [
    "fund",
    "launch",
  ]);
  assertEquals(AGENT_TOOL_AUTHORIZATION.pause_ad_campaign.hostAdActions, [
    "pause",
  ]);
  assertEquals(AGENT_TOOL_AUTHORIZATION.end_ad_campaign.hostAdActions, [
    "end",
  ]);
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_ad_campaign_report.hostAdActions, [
    "read",
  ]);
});

Deno.test("#3697 Ari Host Ads authorization uses exact actions, not role rank", async () => {
  const calls: string[] = [];
  await authorizeAgentTool(
    findTool("propose_ad_plan")!,
    PROPOSE_ARGS,
    authorizationClient(["plan"], 20, calls),
    BRAND,
  );
  assertEquals(calls, ["ad_can_host_action_for_caller:plan"]);

  calls.length = 0;
  await authorizeAgentTool(
    findTool("approve_ad_plan")!,
    {
      brand_id: BRAND,
      plan_id: PLAN,
      plan_version_id: VERSION,
      plan_hash: HASH,
      confirm_phrase: "LAUNCH",
    },
    authorizationClient(["fund", "launch"], 20, calls),
    BRAND,
  );
  assertEquals(calls.sort(), [
    "ad_can_host_action_for_caller:fund",
    "ad_can_host_action_for_caller:launch",
  ]);

  let code = "";
  try {
    await authorizeAgentTool(
      findTool("pause_ad_campaign")!,
      { brand_id: BRAND, campaign_id: CAMPAIGN },
      authorizationClient([], 20),
      BRAND,
    );
  } catch (error) {
    if (error instanceof ToolError) code = error.code;
  }
  assertEquals(code, "ROLE_DENIED");
});

Deno.test("#3697 Ari permission declaration cannot omit the exact action contract", async () => {
  const registered = findTool("propose_ad_plan")!;
  let code = "";
  try {
    await authorizeAgentTool(
      { ...registered, hostAdActions: undefined },
      PROPOSE_ARGS,
      authorizationClient(["plan"]),
      BRAND,
    );
  } catch (error) {
    if (error instanceof ToolError) code = error.code;
  }
  assertEquals(code, "ROLE_CHECK_UNAVAILABLE");
});

Deno.test("#3697 Ari plan proposal explains fee, currency and approval boundary", async () => {
  const context = await preflightMoneyProposal(
    "propose_ad_plan",
    PROPOSE_ARGS,
    null,
  );
  assert(context);
  assertStringIncludes(String(context.ad_fee), "15%");
  assertStringIncludes(String(context.ad_fee), "no second Mingla fee");
  assertStringIncludes(
    String(context.ad_currency_policy),
    "settlement currency",
  );
  assertStringIncludes(String(context.ad_provider_allocation), "meta: 150.00");
  assertStringIncludes(
    String(context.ad_provider_allocation),
    "tiktok: 150.00",
  );
  assertStringIncludes(String(context.ad_credit), "no provider object");
  assertStringIncludes(
    String(context.ad_media_rights),
    "no Mingla house reuse",
  );
  assertEquals(context.ad_ai_disclosure, "Not marked AI-generated");

  const wire = verifiedProposalArgs(PROPOSE_ARGS, {
    ...context,
    attacker_supplied_context: "must not cross the wire",
  });
  const displayed = wire.__proposal_context as Record<string, unknown>;
  assertEquals(displayed.ad_fee, context.ad_fee);
  assertEquals(
    displayed.ad_provider_allocation,
    context.ad_provider_allocation,
  );
  assertEquals(displayed.ad_media_rights, context.ad_media_rights);
  assertEquals(displayed.ad_measurement, context.ad_measurement);
  assertEquals(displayed.attacker_supplied_context, undefined);
});

Deno.test("#3697 Ari LAUNCH review shows immutable provider, rights and measurement policy", async () => {
  const context = await preflightMoneyProposal(
    "approve_ad_plan",
    {
      brand_id: BRAND,
      plan_id: PLAN,
      plan_version_id: VERSION,
      plan_hash: HASH,
    },
    {
      functions: {
        invoke: () =>
          Promise.resolve({
            error: null,
            data: {
              plan: {
                id: PLAN,
                brand_id: BRAND,
                owner_kind: "host",
                state: "ready",
              },
              version: {
                id: VERSION,
                plan_hash: HASH,
                host_currency: "NGN",
                host_budget_cents: 30000,
                canonical_plan: {
                  destination: {
                    title: "Deserted Island",
                    result_kind: "tickets",
                  },
                  audience_intent: {
                    countries: ["NG"],
                    cities: [{ name: "Lagos" }],
                    ageMin: 21,
                    ageMax: 40,
                    gender: "all",
                    interests: [{ name: "Camping" }],
                  },
                  schedule: {},
                  copy: { primary: "Three days off-grid." },
                  media_rights: {
                    rights_basis: "authorized_by_brand",
                    ai_generated: false,
                  },
                  measurement: {
                    quality: "trusted",
                    result_hierarchy: ["ticket_purchase", "click"],
                    capture_authority: "mingla_server_finalization",
                    consent: { first_party_touch: "retained_90_days" },
                  },
                  delivery_budgets: {
                    meta: { host_amount_cents: 3000 },
                  },
                },
              },
              provider_allocations: [{
                platform: "meta",
                host_currency: "NGN",
                host_budget_cents: 30000,
                provider_currency: "USD",
                provider_budget_cents: 1900,
              }],
              targeting_snapshots: [{ platform: "meta", verdict: "exact" }],
            },
          }),
      },
    },
  );
  assert(context);
  assertStringIncludes(
    String(context.ad_provider_allocation),
    "300.00 NGN → 19.00 USD",
  );
  assertStringIncludes(
    String(context.ad_measurement),
    "ticket purchase → click",
  );
  assertStringIncludes(
    String(context.ad_measurement_scope),
    "retained 90 days",
  );
  assertStringIncludes(String(context.ad_media_rights), "authorized by brand");
  assertStringIncludes(String(context.ad_credit), "held only after LAUNCH");
});

Deno.test("#3697 Ari caller adapter is auth.uid-bound and least privilege", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20271102013697_issue_3697_ari_ad_authorization.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(migration, "auth.uid()");
  assertStringIncludes(
    migration,
    "ad_can_host_action(p_brand_id, auth.uid(), p_action)",
  );
  assertStringIncludes(migration, "FROM PUBLIC, anon");
  assert(!migration.includes("p_user_id"));
});
