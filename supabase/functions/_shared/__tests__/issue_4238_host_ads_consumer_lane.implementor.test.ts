/**
 * #4238 — Host and Ari ads run on Mingla's consumer accounts, and the Host
 * ad goal is owned by the server.
 *
 * invariant: {"id":"I-PROPOSED-HOST-AD-LANE-SINGLE-OWNER","status":"DRAFT","issue":4238,"rule":"The provider lane for Host and Ari ads is decided only by HOST_AD_LANE in supabase/functions/_shared/adChannelCore.ts; no lane: \"business\" literal exists in the Host/Ari path.","gate":"this file: T-A1..T-A8"}
 * invariant: {"id":"I-PROPOSED-HOST-AD-GOAL-SERVER-OWNED","status":"DRAFT","issue":4238,"rule":"Host and Ari provider objective fields are derived server-side from canonical_plan.optimization_by_platform (inside the plan hash); clients never send them.","gate":"this file: T-F1..T-F7"}
 *
 * Fails on revert: T-A1 fails if HOST_AD_LANE goes back to "business"; T-A4
 * fails if any Host/Ari file names the business lane again; T-F1 fails if
 * the goal table is removed or changed.
 */

// adChannel.ts owns the adapter registry and forms a cycle with the provider
// modules; evaluate it first, as every edge entrypoint does.
import "../adChannel.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type AdConnectionRow,
  adLaneForOwner,
  HOST_AD_LANE,
  resolveOwnerLane,
} from "../adChannelCore.ts";
import {
  type CreativePreparationBinding,
  creativePreparationBindingError,
} from "../adCreativePreparationPlan.ts";
import {
  hostAdGoalFields,
  hostAllocationLaneError,
  hostGoalBodyError,
  hostOptimizationFor,
  validateHostOptimization,
} from "../adHostGoal.ts";
import {
  PURCHASE_SIGNAL_MIN_28D,
  salesReadiness,
  type SalesSignalProbes,
} from "../adSalesReadiness.ts";
import { collectAdvertisablePages } from "../../ad-plan/index.ts";
import { findTool } from "../agentTools.ts";

const read = (relative: string): Promise<string> =>
  Deno.readTextFile(new URL(relative, import.meta.url));

// ── T-A1 the single owner ───────────────────────────────────────────────────
Deno.test("T-A1 #4238 Host ads use Mingla's consumer lane", () => {
  assertEquals(HOST_AD_LANE, "consumer");
  assertEquals(adLaneForOwner("host"), "consumer");
  assertEquals(adLaneForOwner("mingla"), "consumer");
});

// ── T-A2 creative prepare binding ───────────────────────────────────────────
const ID = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);
function binding(
  patch: Partial<CreativePreparationBinding> = {},
): CreativePreparationBinding {
  return {
    plan: {
      id: ID,
      owner_kind: "host",
      brand_id: ID,
      current_version_id: ID,
      state: "creating_paused_objects",
    },
    version: {
      id: ID,
      plan_id: ID,
      plan_hash: HASH,
      canonical_plan: { creative_library_id: ID },
    },
    allocation: { platform: "meta", connection_id: ID },
    connection: { id: ID },
    confirmationPresent: true,
    requestedPlanVersionId: ID,
    requestedPlanHash: HASH,
    requestedCreativeId: ID,
    requestedPlatform: "meta",
    requestedBrandId: ID,
    ...patch,
  };
}

Deno.test("T-A2 #4238 Host creative prepare binds the consumer lane", () => {
  assertEquals(
    creativePreparationBindingError(binding({ requestedLane: "consumer" })),
    null,
  );
  assertEquals(creativePreparationBindingError(binding()), null);
  assertEquals(
    creativePreparationBindingError(binding({ requestedLane: "business" })),
    "plan_lane_mismatch",
  );
});

// ── T-A3 / T-A8 lane resolution (search + create) ───────────────────────────
Deno.test("T-A3/A8 #4238 a Host lane is resolved, never rewritten", () => {
  assertEquals(resolveOwnerLane("host", undefined), {
    ok: true,
    lane: "consumer",
  });
  assertEquals(resolveOwnerLane("host", "consumer"), {
    ok: true,
    lane: "consumer",
  });
  // An old Business build still sending "business" is refused clearly.
  assertEquals(resolveOwnerLane("host", "business"), {
    ok: false,
    detail: "lane_owner_mismatch",
  });
  assertEquals(resolveOwnerLane("host", "sideways"), {
    ok: false,
    detail: "lane_invalid",
  });
  // Admin unchanged: body.lane ?? "consumer".
  assertEquals(resolveOwnerLane("mingla", undefined), {
    ok: true,
    lane: "consumer",
  });
  assertEquals(resolveOwnerLane("mingla", "business"), {
    ok: true,
    lane: "business",
  });
});

Deno.test("T-A3/A8 #4238 search and create route the lane through resolveOwnerLane", async () => {
  const search = await read("../../admin-ad-targeting-search/index.ts");
  assertStringIncludes(search, 'hostCaller ? "host" : "mingla"');
  assertStringIncludes(search, '"lane_owner_mismatch" }, 422');
  assertStringIncludes(
    search,
    "Search isn't available for this platform right now.",
  );
  const create = await read("../../admin-ad-create-campaign/index.ts");
  assertStringIncludes(
    create,
    "resolveOwnerLane(requestedOwnerKind, body.lane)",
  );
  assertStringIncludes(create, '"lane_owner_mismatch" }, 422');
  assert(!create.includes("host_requires_business_lane"));
});

// ── T-A4 / T-A5 source ratchet ──────────────────────────────────────────────
Deno.test("T-A4 #4238 no Host/Ari file names the business lane", async () => {
  const files = [
    "../../../../mingla-business/src/services/hostAdPlanService.ts",
    "../agentDomainTools.ts",
    "../../ad-plan/index.ts",
    "../../admin-ad-targeting-search/index.ts",
    "../adCreativePreparationPlan.ts",
  ];
  for (const file of files) {
    const source = await read(file);
    assert(!source.includes('lane: "business"'), `${file} lane: "business"`);
    assert(
      !source.includes('.eq("lane", "business")'),
      `${file} .eq("lane", "business")`,
    );
    assert(
      !source.includes('requestedLane !== "business"'),
      `${file} requestedLane !== "business"`,
    );
  }
  const create = await read("../../admin-ad-create-campaign/index.ts");
  const hostBlock = create.slice(
    create.indexOf('if (requestedOwnerKind === "host") {'),
    create.indexOf("const destGroupId = pickDestGroupId(body);"),
  );
  assert(hostBlock.length > 0);
  assert(!hostBlock.includes('"business"'));
});

Deno.test("T-A5 #4238 host_setup reads the HOST_AD_LANE accounts", async () => {
  const plan = await read("../../ad-plan/index.ts");
  const setup = plan.slice(
    plan.indexOf('if (action === "host_setup")'),
    plan.indexOf('if (action === "creative_library")'),
  );
  assertStringIncludes(setup, '.eq("lane", HOST_AD_LANE)');
  assertStringIncludes(setup, "available: hostConnections.length > 0");
  assertStringIncludes(setup, "brand_country_code");
  assert(!setup.includes('"business"'));
});

// ── T-A6 allocation guard ───────────────────────────────────────────────────
Deno.test("T-A6 #4238 a Host plan cannot bind a business-lane account", () => {
  const requested = [{ platform: "meta", connection_id: "c1" }];
  assertEquals(
    hostAllocationLaneError(
      [{ id: "c1", platform: "meta", lane: "consumer" }],
      requested,
    ),
    null,
  );
  assertEquals(
    hostAllocationLaneError(
      [{ id: "c1", platform: "meta", lane: "business" }],
      requested,
    ),
    "host_connection_lane_invalid",
  );
  assertEquals(
    hostAllocationLaneError(
      [{ id: "c1", platform: "tiktok", lane: "consumer" }],
      requested,
    ),
    "host_connection_lane_invalid",
  );
  assertEquals(
    hostAllocationLaneError([], requested),
    "host_connection_lane_invalid",
  );
});

// ── T-B6 pagination ─────────────────────────────────────────────────────────
Deno.test("T-B6 #4238 Host setup loads every page up to the cap", async () => {
  const calls: number[] = [];
  const page = (n: number, size: number, total: number) =>
    Array.from({ length: size }, (_, i) => ({
      id: `${n}-${i}`,
      total_count: total,
    }));
  const thirty = await collectAdvertisablePages((n) => {
    calls.push(n);
    return Promise.resolve({
      data: page(n, n === 0 ? 24 : 6, 30),
      error: null,
    });
  });
  assertEquals(calls, [0, 1]);
  assertEquals(thirty.data.length, 30);

  calls.length = 0;
  const huge = await collectAdvertisablePages((n) => {
    calls.push(n);
    return Promise.resolve({ data: page(n, 24, 1000), error: null });
  });
  assertEquals(calls.length, 8);
  assertEquals(huge.data.length, 192);

  const failed = await collectAdvertisablePages(() =>
    Promise.resolve({ data: null, error: { message: "boom" } })
  );
  assert(failed.error !== null);
});

// ── T-F1 goal table ─────────────────────────────────────────────────────────
Deno.test("T-F1 #4238 the Host goal table", () => {
  assertEquals(hostAdGoalFields("meta", "sales"), {
    objective: "OUTCOME_SALES",
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
  });
  assertEquals(hostAdGoalFields("snapchat", "sales"), {
    objective: "SALES",
    optimization_goal: "PIXEL_PURCHASE",
  });
  assertEquals(hostAdGoalFields("tiktok", "sales"), {
    objective: "WEB_CONVERSIONS",
    optimization_goal: "CONVERT",
    billing_event: "OCPM",
  });
  assertEquals(hostAdGoalFields("google", "sales"), null);
  assertEquals(hostAdGoalFields("reddit", "sales"), null);
  // Visits: byte-equal to the mapping the Business client used to send.
  assertEquals(hostAdGoalFields("meta", "visits"), {
    objective: "OUTCOME_TRAFFIC",
    optimization_goal: "LINK_CLICKS",
    billing_event: "IMPRESSIONS",
  });
  assertEquals(hostAdGoalFields("snapchat", "visits"), {
    objective: "TRAFFIC",
    optimization_goal: "SWIPES",
  });
  assertEquals(hostAdGoalFields("tiktok", "visits"), {
    objective: "TRAFFIC",
    optimization_goal: "TRAFFIC_LANDING_PAGE_VIEW",
    billing_event: "CPC",
  });
  assertEquals(hostAdGoalFields("google", "visits"), {});
  assertEquals(hostAdGoalFields("reddit", "visits"), { objective: "CLICKS" });
  assertEquals(hostOptimizationFor({}, "meta"), "visits");
  assertEquals(
    hostOptimizationFor(
      { optimization_by_platform: { meta: "sales" } },
      "meta",
    ),
    "sales",
  );
  assertEquals(
    hostOptimizationFor(
      { optimization_by_platform: { meta: "boost" } },
      "meta",
    ),
    null,
  );
});

// ── T-F2 create_version validation ──────────────────────────────────────────
Deno.test("T-F2 #4238 create_version accepts sales only where it can work", () => {
  assertEquals(
    validateHostOptimization(
      { meta: "sales", google: "visits" },
      ["meta", "google"],
      "tickets",
    ),
    { ok: true, map: { meta: "sales", google: "visits" } },
  );
  assertEquals(
    validateHostOptimization(undefined, ["meta", "reddit"], "signups"),
    { ok: true, map: { meta: "visits", reddit: "visits" } },
  );
  assertEquals(
    validateHostOptimization({ meta: "sales" }, ["meta"], "signups"),
    { ok: false, detail: "optimization_sales_unsupported" },
  );
  assertEquals(
    validateHostOptimization({ reddit: "sales" }, ["reddit"], "tickets"),
    { ok: false, detail: "optimization_sales_unsupported" },
  );
  assertEquals(
    validateHostOptimization(
      { meta: "visits", tiktok: "visits" },
      ["meta"],
      "tickets",
    ),
    { ok: false, detail: "optimization_invalid" },
  );
  assertEquals(
    validateHostOptimization({ meta: "boost" }, ["meta"], "tickets"),
    { ok: false, detail: "optimization_invalid" },
  );
  assertEquals(
    validateHostOptimization(["sales"], ["meta"], "tickets"),
    { ok: false, detail: "optimization_invalid" },
  );
});

Deno.test("T-F2 #4238 ad-plan validates the Host goal before it versions the plan", async () => {
  const plan = await read("../../ad-plan/index.ts");
  const createVersion = plan.slice(
    plan.indexOf('if (action === "create_version")'),
    plan.indexOf('if (action === "freeze_targeting")'),
  );
  const resolve = createVersion.indexOf('"ad_plan_destination_resolve"');
  const validate = createVersion.indexOf("validateHostOptimization(");
  const persist = createVersion.indexOf('db.rpc("ad_plan_create_version"');
  assert(resolve > 0 && validate > resolve && persist > validate);
  assertStringIncludes(
    createVersion,
    "canonical.optimization_by_platform = optimization.map",
  );
});

// ── T-F3 clients never author the goal ──────────────────────────────────────
Deno.test("T-F3 #4238 clients never author Host objectives", async () => {
  assertEquals(
    hostGoalBodyError({ objective: "OUTCOME_SALES" }),
    "plan_optimization_mismatch",
  );
  assertEquals(
    hostGoalBodyError({ billing_event: "CPC" }),
    "plan_optimization_mismatch",
  );
  assertEquals(hostGoalBodyError({ platform: "meta" }), null);

  const service = await read(
    "../../../../mingla-business/src/services/hostAdPlanService.ts",
  );
  const ari = await read("../agentDomainTools.ts");
  const ariPayload = ari.slice(
    ari.indexOf("function buildHostAdCreatePayload("),
    ari.indexOf("function normalizedAdTargetName("),
  );
  for (const source of [service, ariPayload]) {
    assert(!/\bobjective:/.test(source));
    assert(!source.includes("optimization_goal"));
    assert(!source.includes("billing_event"));
  }
  const create = await read("../../admin-ad-create-campaign/index.ts");
  const derive = create.indexOf("Object.assign(body, hostGoal)");
  const firstRead = create.indexOf("const objective = typeof body.objective");
  assert(derive > 0 && firstRead > derive);
  assertStringIncludes(create, "hostGoalBodyError(body)");
});

// ── T-F6 readiness preview fails closed ─────────────────────────────────────
function connection(
  platform: AdConnectionRow["platform"],
  extra: Record<string, unknown>,
): AdConnectionRow {
  return {
    id: `${platform}-1`,
    platform,
    lane: "consumer",
    extra,
  } as unknown as AdConnectionRow;
}

const ready: SalesSignalProbes = {
  metaHasSignal: () => Promise.resolve(true),
  snapchatPurchases28d: () => Promise.resolve(PURCHASE_SIGNAL_MIN_28D),
  tiktokPurchases28d: () => Promise.resolve(PURCHASE_SIGNAL_MIN_28D - 1),
};

Deno.test("T-F6 #4238 sales readiness mirrors the Admin gates and fails closed", async () => {
  assertEquals(
    await salesReadiness(connection("meta", { dataset_id: "d" }), ready),
    { ready: true, reason: "ready" },
  );
  assertEquals(
    await salesReadiness(connection("meta", {}), ready),
    { ready: false, reason: "no_pixel" },
  );
  assertEquals(
    await salesReadiness(connection("snapchat", { pixel_id: "p" }), ready),
    { ready: true, reason: "ready" },
  );
  assertEquals(
    await salesReadiness(connection("tiktok", { pixel_id: "p" }), ready),
    { ready: false, reason: "waiting_for_sales" },
  );
  assertEquals(
    await salesReadiness(connection("google", {}), ready),
    { ready: false, reason: "not_supported" },
  );
  const throwing: SalesSignalProbes = {
    ...ready,
    metaHasSignal: () => Promise.reject(new Error("provider down")),
  };
  assertEquals(
    await salesReadiness(connection("meta", { dataset_id: "d" }), throwing),
    { ready: false, reason: "unknown" },
  );
  let timer: number | undefined;
  const slow: SalesSignalProbes = {
    ...ready,
    snapchatPurchases28d: () =>
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(500), 200);
      }),
  };
  assertEquals(
    await salesReadiness(connection("snapchat", { pixel_id: "p" }), slow, 10),
    { ready: false, reason: "unknown" },
  );
  clearTimeout(timer);
});

// ── T-F7 constant single owner ──────────────────────────────────────────────
Deno.test("T-F7 #4238 the purchase-signal minimum has one owner", async () => {
  const create = await read("../../admin-ad-create-campaign/index.ts");
  assert(!create.includes("const PURCHASE_SIGNAL_MIN_28D"));
  assertStringIncludes(
    create,
    'import { PURCHASE_SIGNAL_MIN_28D } from "../_shared/adSalesReadiness.ts"',
  );
  assertEquals(PURCHASE_SIGNAL_MIN_28D, 20);
});

// ── T-A7 / T-F5 Ari runtime ─────────────────────────────────────────────────
const BRAND = "11111111-1111-4111-8111-111111111111";
const CREATIVE = "44444444-4444-4444-8444-444444444444";
const META = "88888888-8888-4888-8888-888888888888";
const SNAP = "99999999-9999-4999-8999-999999999999";
const PLAN = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";

Deno.test("T-A7 #4238 Ari plans on host_setup accounts with a server-checked goal", async () => {
  const bodies: Array<{ name: string; body: Record<string, unknown> }> = [];
  const tables: string[] = [];
  const client = {
    rpc() {
      return Promise.resolve({ data: true, error: null });
    },
    from(table: string) {
      tables.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: {
              id: CREATIVE,
              brand_id: BRAND,
              kind: "video",
              status: "active",
            },
            error: null,
          }),
      };
      return query;
    },
    functions: {
      invoke(name: string, request: { body: Record<string, unknown> }) {
        bodies.push({ name, body: request.body });
        const action = String(request.body.action ?? "");
        if (name === "ad-plan" && action === "host_setup") {
          return Promise.resolve({
            data: {
              connections: [
                { id: META, platform: "meta", sales: { ready: true } },
                { id: SNAP, platform: "snapchat", sales: { ready: false } },
              ],
              pages: [{
                page_type: "event",
                brand_slug: "femzy",
                entity_slug: "deserted-island",
                result_kind: "tickets",
              }],
            },
            error: null,
          });
        }
        if (name === "ad-plan" && action === "open") {
          return Promise.resolve({ data: { plan: { id: PLAN } }, error: null });
        }
        if (name === "ad-plan" && action === "create_version") {
          return Promise.resolve({
            data: { version: { id: VERSION, plan_hash: "a".repeat(64) } },
            error: null,
          });
        }
        if (name === "ad-plan" && action === "freeze_targeting") {
          return Promise.resolve({
            data: { targeting_snapshots: [] },
            error: null,
          });
        }
        return Promise.resolve({
          data: { ok: true, results: [] },
          error: null,
        });
      },
    },
  } as never;

  const result = await findTool("propose_ad_plan")!.executor(
    {
      brand_id: BRAND,
      name: "Deserted Island",
      dest_page_type: "event",
      dest_brand_slug: "femzy",
      dest_entity_slug: "deserted-island",
      platforms: ["meta", "snapchat"],
      budget_cents: 20000,
      countries: ["NG"],
      interests: ["live music"],
      rights_confirmed: true,
      rights_basis: "owned",
      ai_generated: true,
      creative_library_id: CREATIVE,
      optimize_for: "sales",
    },
    client,
    BRAND,
    {} as never,
  ) as { optimization: { sales: string[]; visits: string[] } };

  assert(!tables.includes("ad_connections"), "Ari read ad_connections");
  const version = bodies.find((row) => row.body.action === "create_version");
  assert(version);
  const allocations = version.body.provider_allocations as Array<
    Record<string, unknown>
  >;
  assertEquals(allocations.map((row) => row.connection_id), [META, SNAP]);
  const canonical = version.body.canonical_plan as Record<string, unknown>;
  assertEquals(canonical.optimization_by_platform, {
    meta: "sales",
    snapchat: "visits",
  });
  assertEquals(result.optimization, { sales: ["meta"], visits: ["snapchat"] });
  for (const row of bodies) {
    assert(!("lane" in row.body), `${row.name} sent a lane`);
  }
});

Deno.test("T-F5 #4238 Ari carries the AI-generated attestation to provider create", async () => {
  const creates: Record<string, unknown>[] = [];
  let gets = 0;
  const aggregate = (funded: boolean) => ({
    plan: {
      id: PLAN,
      brand_id: BRAND,
      owner_kind: "host",
      state: funded ? "funded_held" : "ready_for_funding",
    },
    version: {
      id: VERSION,
      plan_hash: "a".repeat(64),
      host_currency: "NGN",
      host_budget_cents: 30000,
      canonical_plan: {
        creative_library_id: CREATIVE,
        name: "Deserted Island",
        destination: { page_type: "event", brand_slug: "femzy" },
        schedule: {},
        copy: { primary: "Three days off-grid." },
        media_rights: { ai_generated: true },
        optimization_by_platform: { meta: "sales" },
        delivery_budgets: {
          meta: { host_amount_cents: 3000, provider_amount_cents: 200 },
        },
      },
    },
    provider_allocations: [{
      platform: "meta",
      connection_id: META,
      host_budget_cents: 30000,
      provider_budget_cents: 2000,
    }],
    targeting_snapshots: [{
      platform: "meta",
      verdict: "exact",
      audience_intent: { countries: ["NG"] },
      compiled_targeting: { geo_locations: { countries: ["NG"] } },
    }],
    funding_hold: funded ? { state: "held" } : null,
  });
  const client = {
    rpc() {
      return Promise.resolve({ data: true, error: null });
    },
    functions: {
      invoke(name: string, request: { body: Record<string, unknown> }) {
        if (name === "ad-plan" && request.body.action === "get") {
          gets += 1;
          return Promise.resolve({ data: aggregate(gets > 1), error: null });
        }
        if (name === "admin-ad-creative-prepare") {
          return Promise.resolve({ data: { state: "ready" }, error: null });
        }
        if (name === "admin-ad-create-campaign") {
          creates.push(request.body);
          return Promise.resolve({
            data: { campaign_id: "55555555-5555-4555-8555-555555555555" },
            error: null,
          });
        }
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
  } as never;
  await findTool("approve_ad_plan")!.executor(
    {
      brand_id: BRAND,
      plan_id: PLAN,
      plan_version_id: VERSION,
      plan_hash: "a".repeat(64),
      confirm_phrase: "LAUNCH",
    },
    client,
    BRAND,
    { operationId: "77777777-7777-4777-8777-777777777777" },
  );
  assert(creates.length >= 1);
  for (const body of creates) {
    assertEquals(
      (body.compliance as Record<string, unknown>).aiGenerated,
      true,
    );
    assertEquals(
      (body.creative as Record<string, unknown>).ai_generated,
      true,
    );
    assert(!("lane" in body));
    assert(!("objective" in body));
  }
});
