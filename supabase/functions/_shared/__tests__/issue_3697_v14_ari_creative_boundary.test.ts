import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool } from "../agentTools.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const CREATIVE = "44444444-4444-4444-8444-444444444444";
const CAMPAIGN = "55555555-5555-4555-8555-555555555555";
const USER = "66666666-6666-4666-8666-666666666666";
const OPERATION = "77777777-7777-4777-8777-777777777777";
const CONNECTION = "88888888-8888-4888-8888-888888888888";
const HASH = "a".repeat(64);

function aggregate(funded: boolean) {
  return {
    plan: {
      id: PLAN,
      brand_id: BRAND,
      owner_kind: "host",
      state: funded ? "funded_held" : "ready_for_funding",
    },
    version: {
      id: VERSION,
      plan_hash: HASH,
      host_currency: "NGN",
      host_budget_cents: 30000,
      canonical_plan: {
        creative_library_id: CREATIVE,
        name: "Deserted Island",
        destination: {
          page_type: "event",
          brand_slug: "nightlifefemzyevents",
          entity_slug: "deserted-island",
          canonical_url:
            "https://usemingla.com/e/nightlifefemzyevents/deserted-island",
        },
        schedule: {},
        copy: { primary: "Three days off-grid." },
        audience_intent: { countries: ["NG"] },
        delivery_budgets: {
          meta: {
            host_amount_cents: 3000,
            provider_amount_cents: 200,
          },
        },
      },
    },
    provider_allocations: [{
      platform: "meta",
      connection_id: CONNECTION,
      host_budget_cents: 30000,
      provider_budget_cents: 2000,
      host_currency: "NGN",
      provider_currency: "USD",
    }],
    targeting_snapshots: [{
      platform: "meta",
      verdict: "exact",
      audience_intent: { countries: ["NG"] },
      compiled_targeting: { geo_locations: { countries: ["NG"] } },
    }],
    funding_hold: funded ? { state: "held" } : null,
  };
}

Deno.test("#3697 Ari requires a brand-owned active video before plan freeze", async () => {
  const source = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  const propose = source.slice(
    source.indexOf("const proposeAdPlan = writeTool("),
    source.indexOf("const approveAdPlan = writeTool("),
  );
  assert(propose.includes("Choose and finish preparing one paid-ad video"));
  assert(propose.includes('.from("ad_creatives")'));
  assert(propose.includes('creative.kind !== "video"'));
  assert(propose.includes('creative.status !== "active"'));
  assert(propose.includes("creative.brand_id !== args.brand_id"));
  assert(propose.includes("creative_library_id: args.creative_library_id"));
  assertEquals(propose.includes("creative_library_id: null"), false);
});

Deno.test("#3697 LAUNCH preflight returns the readable immutable plan", async () => {
  const source = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  for (
    const field of [
      "ad_destination",
      "ad_result",
      "ad_audience",
      "ad_targeting",
      "ad_schedule",
      "ad_creative",
      "ad_measurement",
      "ad_review",
      "ad_binding",
    ]
  ) {
    assert(source.includes(field), `missing ${field}`);
  }
});

Deno.test("#3697 Ari prepares provider media only after fund and exact LAUNCH confirmation", async () => {
  const source = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  const approve = source.slice(
    source.indexOf("const approveAdPlan = writeTool("),
    source.indexOf("const pauseAdCampaign = writeTool("),
  );
  const fund = approve.indexOf('action: "fund"');
  const confirm = approve.indexOf('action: "confirm_launch"');
  const prepare = approve.indexOf('"admin-ad-creative-prepare"');
  const validate = approve.indexOf(
    "buildHostAdCreatePayload(aggregate, platform, operationId, true)",
  );
  const create = approve.indexOf(
    "buildHostAdCreatePayload(aggregate, platform, operationId)",
  );
  const launch = approve.indexOf('action: "launch"');

  assert(fund > 0);
  assert(confirm > fund);
  assert(prepare > confirm);
  assert(validate > prepare);
  assert(create > validate);
  assert(launch > create);
  assert(approve.includes('lane: "business"'));
  assert(approve.includes('action: "record_create_failure"'));
  assertEquals(
    approve.slice(0, confirm).includes('"admin-ad-create-campaign"'),
    false,
  );
});

Deno.test("#3697 Ari runtime calls fund, confirm, prepare, validate, create and launch in order", async () => {
  const calls: string[] = [];
  let getCount = 0;
  const client = {
    rpc(name: string) {
      assertEquals(name, "ad_can_host_action_for_caller");
      return Promise.resolve({ data: true, error: null });
    },
    functions: {
      invoke(
        name: string,
        request: { body: Record<string, unknown> },
      ) {
        const body = request.body;
        const action = name === "admin-ad-create-campaign"
          ? (body.validate_only === true ? "validate" : "create")
          : String(body.action ?? "");
        calls.push(`${name}:${action}`);

        if (name === "ad-plan" && action === "get") {
          getCount += 1;
          return Promise.resolve({
            data: aggregate(getCount > 1),
            error: null,
          });
        }
        if (name === "admin-ad-creative-prepare") {
          assertEquals(body.lane, "business");
          assertEquals(body.brand_id, BRAND);
          assertEquals(body.plan_version_id, VERSION);
          assertEquals(body.plan_hash, HASH);
          return Promise.resolve({ data: { state: "ready" }, error: null });
        }
        if (name === "admin-ad-create-campaign" && action === "create") {
          return Promise.resolve({
            data: { campaign_id: CAMPAIGN },
            error: null,
          });
        }
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
  } as never;

  const result = await findTool("approve_ad_plan")!.executor(
    {
      brand_id: BRAND,
      plan_id: PLAN,
      plan_version_id: VERSION,
      plan_hash: HASH,
      confirm_phrase: "LAUNCH",
    },
    client,
    USER,
    { operationId: OPERATION },
  ) as { created: unknown[]; launched: unknown[] };

  assertEquals(calls, [
    "ad-plan:get",
    "ad-plan:fund",
    "ad-plan:get",
    "ad-plan:confirm_launch",
    "admin-ad-creative-prepare:status",
    "admin-ad-create-campaign:validate",
    "admin-ad-create-campaign:create",
    "host-ad-campaign:launch",
  ]);
  assertEquals(result.created.length, 1);
  assertEquals(result.launched.length, 1);
});
