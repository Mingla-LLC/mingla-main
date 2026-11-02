/**
 * #4238 — tester adversarial suite for Host and Ari ads on Mingla's consumer
 * accounts. Attacks angles the implementor's happy-path suite does not:
 *
 *  A. A Host forging a lane (business, garbage, wrong case) is refused, never
 *     rewritten; Admin keeps its own lane logic (business still allowed).
 *  B. A Host binding a consumer account of the WRONG platform, an unknown id,
 *     or one business row hidden in a mixed batch is refused.
 *  C. A Host asking for ticket sales on a website, brand, RSVP or venue page,
 *     or on Google/Reddit, or with a malformed goal map, is refused.
 *  D. A frozen plan whose goal the platform cannot run never yields provider
 *     objective fields; a client that names any objective field is refused.
 *  E. Sales readiness never reports "ready" on a hang, NaN, a truthy non-true
 *     probe, 19 purchases, or a blank pixel id; it makes no probe call at all
 *     for a platform without a sales path or without a pixel.
 *  F. host_setup (the real handler) never returns another lane's accounts, the
 *     raw connection row (pixel / dataset ids, tokens, env names), or a
 *     fabricated country; it stops paging at the cap even if total_count lies.
 *  G. Ari on a non-admin Host: a website page never optimises for sales, a
 *     missing platform stops BEFORE any plan is opened.
 *
 * Fails on revert (verified by line-deletion): HOST_AD_LANE back to
 * "business" fails A/F; dropping the page_type check in hostPageSellsTickets
 * fails C/G; returning `connections.data` raw from host_setup fails F.
 */

// adChannel.ts owns the adapter registry and forms a cycle with the provider
// modules; evaluate it first, as every edge entrypoint does.
import "../adChannel.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type AdConnectionRow,
  adLaneForOwner,
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
import { salesReadiness, type SalesSignalProbes } from "../adSalesReadiness.ts";
import { findTool } from "../agentTools.ts";

// ── A. Lane forging ─────────────────────────────────────────────────────────
Deno.test("#4238 ADV-A a Host can never choose its own lane; Admin keeps its lane logic", () => {
  // A Host naming the business lane (an old OTA build) is refused, not rewritten.
  assertEquals(resolveOwnerLane("host", "business"), {
    ok: false,
    detail: "lane_owner_mismatch",
  });
  // Garbage / case tricks never slip through as a lane.
  for (const forged of ["BUSINESS", "Consumer", "", " consumer", 0, true, {}]) {
    const result = resolveOwnerLane("host", forged);
    assertEquals(
      result.ok,
      false,
      `host lane ${JSON.stringify(forged)} accepted`,
    );
  }
  // Absent (undefined or JSON null) resolves on the server to consumer.
  assertEquals(resolveOwnerLane("host", undefined), {
    ok: true,
    lane: "consumer",
  });
  assertEquals(resolveOwnerLane("host", null), { ok: true, lane: "consumer" });
  // Admin is unchanged: default consumer, and an explicit business lane is
  // still an Admin decision (business-lane support stays Admin infrastructure).
  assertEquals(resolveOwnerLane("mingla", undefined), {
    ok: true,
    lane: "consumer",
  });
  assertEquals(resolveOwnerLane("mingla", "consumer"), {
    ok: true,
    lane: "consumer",
  });
  assertEquals(resolveOwnerLane("mingla", "business"), {
    ok: true,
    lane: "business",
  });
  assertEquals(resolveOwnerLane("mingla", "BUSINESS"), {
    ok: false,
    detail: "lane_invalid",
  });
  assertEquals(adLaneForOwner("mingla"), "consumer");
  assertEquals(adLaneForOwner("host"), "consumer");
});

Deno.test("#4238 ADV-A creative prepare refuses a Host plan named onto the business lane", () => {
  const binding = (
    owner: "host" | "mingla",
    requestedLane: CreativePreparationBinding["requestedLane"],
  ) =>
    creativePreparationBindingError({
      plan: {
        id: "p1",
        owner_kind: owner,
        brand_id: owner === "host" ? "b1" : null,
        current_version_id: "v1",
        state: "creating_paused_objects",
      },
      version: {
        id: "v1",
        plan_id: "p1",
        plan_hash: "h".repeat(64),
        canonical_plan: { creative_library_id: "c1" },
      },
      allocation: { platform: "meta", connection_id: "conn-1" },
      connection: { id: "conn-1" },
      confirmationPresent: true,
      requestedPlanVersionId: "v1",
      requestedPlanHash: "h".repeat(64),
      requestedCreativeId: "c1",
      requestedPlatform: "meta",
      requestedLane,
      requestedBrandId: owner === "host" ? "b1" : "",
    });
  assertEquals(binding("host", "business"), "plan_lane_mismatch");
  assertEquals(binding("host", "consumer"), null);
  assertEquals(binding("host", undefined), null);
  // Admin unchanged: a Mingla plan stays on consumer.
  assertEquals(binding("mingla", "business"), "plan_lane_mismatch");
  assertEquals(binding("mingla", "consumer"), null);
  assertEquals(binding("mingla", undefined), null);
});

// ── B. Allocation binding ───────────────────────────────────────────────────
Deno.test("#4238 ADV-B a Host plan cannot bind a wrong-platform, unknown or hidden business account", () => {
  const rows = [
    { id: "meta-c", platform: "meta", lane: "consumer" },
    { id: "snap-c", platform: "snapchat", lane: "consumer" },
    { id: "meta-b", platform: "meta", lane: "business" },
  ];
  // A consumer Snapchat account smuggled into a Meta allocation.
  assertEquals(
    hostAllocationLaneError(rows, [{
      platform: "meta",
      connection_id: "snap-c",
    }]),
    "host_connection_lane_invalid",
  );
  // An id the server never loaded (e.g. another brand's or a deleted row).
  assertEquals(
    hostAllocationLaneError(rows, [{
      platform: "meta",
      connection_id: "nope",
    }]),
    "host_connection_lane_invalid",
  );
  // One business row hidden after a valid one.
  assertEquals(
    hostAllocationLaneError(rows, [
      { platform: "snapchat", connection_id: "snap-c" },
      { platform: "meta", connection_id: "meta-b" },
    ]),
    "host_connection_lane_invalid",
  );
  // The honest binding passes.
  assertEquals(
    hostAllocationLaneError(rows, [
      { platform: "meta", connection_id: "meta-c" },
      { platform: "snapchat", connection_id: "snap-c" },
    ]),
    null,
  );
});

// ── C. Goal tampering at create_version ─────────────────────────────────────
const EVENT_TICKETS = { page_type: "event", result_kind: "tickets" };

Deno.test("#4238 ADV-C ticket sales only for event/trip/experience pages that sell tickets", () => {
  for (
    const destination of [
      { page_type: "site", result_kind: "tickets" }, // a brand website reports tickets but sells nothing itself
      { page_type: "brand", result_kind: "tickets" },
      { page_type: "rsvp", result_kind: "signups" },
      { page_type: "rsvp", result_kind: "tickets" },
      { page_type: "venue", result_kind: "tickets" },
      { page_type: "reservation", result_kind: "tickets" },
      { page_type: "event", result_kind: "signups" },
      { page_type: "event", result_kind: null },
      { result_kind: "tickets" },
      null,
    ]
  ) {
    assertEquals(
      validateHostOptimization({ meta: "sales" }, ["meta"], destination),
      { ok: false, detail: "optimization_sales_unsupported" },
      `sales allowed on ${JSON.stringify(destination)}`,
    );
  }
  for (const pageType of ["event", "trip", "experience"]) {
    assertEquals(
      validateHostOptimization(
        { meta: "sales", snapchat: "sales", tiktok: "sales" },
        ["meta", "snapchat", "tiktok"],
        { page_type: pageType, result_kind: "tickets" },
      ).ok,
      true,
    );
  }
});

Deno.test("#4238 ADV-C a Host cannot ask Google or Reddit for sales, or send a malformed goal", () => {
  for (const platform of ["google", "reddit"]) {
    assertEquals(
      validateHostOptimization(
        { [platform]: "sales" },
        [platform],
        EVENT_TICKETS,
      ),
      { ok: false, detail: "optimization_sales_unsupported" },
    );
  }
  const invalid: unknown[] = [
    ["sales"], // array
    "sales", // string
    { meta: "SALES" }, // wrong case
    { meta: "conversions" }, // Admin vocabulary
    { meta: null },
    {}, // missing key
    { meta: "visits", snapchat: "visits" }, // extra platform not in the plan
    JSON.parse('{"meta":"visits","__proto__":"sales"}'), // own __proto__ key
  ];
  for (const input of invalid) {
    assertEquals(
      validateHostOptimization(input, ["meta"], EVENT_TICKETS),
      { ok: false, detail: "optimization_invalid" },
      `accepted ${JSON.stringify(input)}`,
    );
  }
  // Absent always freezes visits for EVERY platform, so the hash carries it.
  assertEquals(validateHostOptimization(undefined, ["meta", "google"], null), {
    ok: true,
    map: { meta: "visits", google: "visits" },
  });
});

// ── D. Create-time derivation ───────────────────────────────────────────────
Deno.test("#4238 ADV-D an unrunnable frozen goal never yields provider objective fields", () => {
  // A plan frozen before validation tightened (or tampered in the DB).
  assertEquals(
    hostOptimizationFor(
        { optimization_by_platform: { google: "sales" } },
        "google",
      )
      ? hostAdGoalFields("google", "sales")
      : null,
    null,
  );
  assertEquals(hostAdGoalFields("reddit", "sales"), null);
  assertEquals(
    hostOptimizationFor({ optimization_by_platform: ["sales"] }, "meta"),
    null,
  );
  assertEquals(
    hostOptimizationFor({ optimization_by_platform: "sales" }, "meta"),
    null,
  );
  assertEquals(
    hostOptimizationFor({ optimization_by_platform: { meta: 1 } }, "meta"),
    null,
  );
  // A platform missing from the map falls back to visits (never to sales).
  assertEquals(
    hostOptimizationFor(
      { optimization_by_platform: { meta: "sales" } },
      "tiktok",
    ),
    "visits",
  );
  // "visits" is byte-equal to the mapping the Business client and Ari used to
  // send before #4238 (origin/main hostAdPlanService.providerCreatePayload).
  assertEquals(hostAdGoalFields("meta", "visits"), {
    objective: "OUTCOME_TRAFFIC",
    optimization_goal: "LINK_CLICKS",
    billing_event: "IMPRESSIONS",
  });
  assertEquals(hostAdGoalFields("tiktok", "visits"), {
    objective: "TRAFFIC",
    optimization_goal: "TRAFFIC_LANDING_PAGE_VIEW",
    billing_event: "CPC",
  });
  assertEquals(hostAdGoalFields("snapchat", "visits"), {
    objective: "TRAFFIC",
    optimization_goal: "SWIPES",
  });
  assertEquals(hostAdGoalFields("reddit", "visits"), { objective: "CLICKS" });
  assertEquals(hostAdGoalFields("google", "visits"), {});
});

Deno.test("#4238 ADV-D a Host body naming ANY objective field is refused, even null or empty", () => {
  for (const field of ["objective", "optimization_goal", "billing_event"]) {
    for (const value of ["OUTCOME_SALES", "", null, 0, false]) {
      assertEquals(
        hostGoalBodyError({ platform: "meta", [field]: value }),
        "plan_optimization_mismatch",
        `${field}=${JSON.stringify(value)} accepted`,
      );
    }
  }
  assertEquals(
    hostGoalBodyError({ platform: "meta", name: "x", budget: {} }),
    null,
  );
});

Deno.test("#4238 ADV-D create-campaign refuses a Host lane before it reads any body objective", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const laneGate = source.indexOf(
    "resolveOwnerLane(requestedOwnerKind, body.lane)",
  );
  const goalGate = source.indexOf("hostGoalBodyError(body)");
  const inject = source.indexOf("Object.assign(body, hostGoal)");
  const firstObjectiveRead = source.indexOf("typeof body.objective");
  assert(laneGate > 0 && goalGate > 0 && inject > 0 && firstObjectiveRead > 0);
  // Old clients (lane:"business" + objective) hit lane_owner_mismatch first.
  assert(laneGate < goalGate, "goal check runs before the lane check");
  // The server-derived goal is in place before any branch reads body.objective.
  assert(goalGate < inject && inject < firstObjectiveRead);
});

// ── E. Sales readiness fail-closed ──────────────────────────────────────────
function conn(
  platform: string,
  extra: Record<string, unknown> = {},
): AdConnectionRow {
  return {
    id: `${platform}-1`,
    platform,
    lane: "consumer",
    connected: true,
    status: "connected",
    extra,
  } as unknown as AdConnectionRow;
}

Deno.test("#4238 ADV-E sales readiness never claims ready on a hang, NaN, truthy junk or 19 sales", async () => {
  const calls: string[] = [];
  const probes = (
    overrides: Partial<SalesSignalProbes>,
  ): SalesSignalProbes => ({
    metaHasSignal: (c) => {
      calls.push(`meta:${c.id}`);
      return Promise.resolve(true);
    },
    snapchatPurchases28d: () => {
      calls.push("snap");
      return Promise.resolve(50);
    },
    tiktokPurchases28d: () => {
      calls.push("tiktok");
      return Promise.resolve(50);
    },
    ...overrides,
  });
  // A probe that never settles times out to unknown (the timer is cleared).
  let hangTimer: number | undefined;
  const hang = await salesReadiness(
    conn("meta", { dataset_id: "d1" }),
    probes({
      metaHasSignal: () =>
        new Promise<boolean>((resolve) => {
          hangTimer = setTimeout(() => resolve(true), 200);
        }),
    }),
    20,
  );
  clearTimeout(hangTimer);
  assertEquals(hang, { ready: false, reason: "unknown" });
  // A truthy value that is not literally true is not a signal.
  assertEquals(
    await salesReadiness(
      conn("meta", { dataset_id: "d1" }),
      probes({
        metaHasSignal: () => Promise.resolve("yes" as unknown as boolean),
      }),
    ),
    { ready: false, reason: "waiting_for_sales" },
  );
  assertEquals(
    await salesReadiness(
      conn("snapchat", { pixel_id: "px" }),
      probes({ snapchatPurchases28d: () => Promise.resolve(Number.NaN) }),
    ),
    { ready: false, reason: "unknown" },
  );
  assertEquals(
    await salesReadiness(
      conn("tiktok", { pixel_id: "px" }),
      probes({ tiktokPurchases28d: () => Promise.resolve(19) }),
    ),
    { ready: false, reason: "waiting_for_sales" },
  );
  assertEquals(
    await salesReadiness(
      conn("tiktok", { pixel_id: "px" }),
      probes({ tiktokPurchases28d: () => Promise.resolve(20) }),
    ),
    { ready: true, reason: "ready" },
  );
  // No pixel (blank or wrong type) and no sales path make NO provider call.
  calls.length = 0;
  const silent = probes({});
  assertEquals(
    await salesReadiness(conn("meta", { dataset_id: "   " }), silent),
    {
      ready: false,
      reason: "no_pixel",
    },
  );
  assertEquals(
    await salesReadiness(conn("snapchat", { pixel_id: 123 }), silent),
    {
      ready: false,
      reason: "no_pixel",
    },
  );
  assertEquals(await salesReadiness(conn("tiktok", {}), silent), {
    ready: false,
    reason: "no_pixel",
  });
  assertEquals(
    await salesReadiness(conn("google", { pixel_id: "px" }), silent),
    {
      ready: false,
      reason: "not_supported",
    },
  );
  assertEquals(
    await salesReadiness(conn("reddit", { pixel_id: "px" }), silent),
    {
      ready: false,
      reason: "not_supported",
    },
  );
  assertEquals(calls, [], "a probe ran for a platform that cannot be ready");
});

// ── F. host_setup through the real handler ──────────────────────────────────
const HOST_USER = {
  id: "a0000000-0000-4000-8000-000000000002",
  email: "host@test.local",
};
const BRAND_ID = "b0000000-0000-4000-8000-0000000000aa";
const SECRET_DATASET = "DATASET-SECRET-918273";
const SECRET_PIXEL = "PIXEL-SECRET-564738";
const SECRET_TOKEN = "EAA-SECRET-TOKEN-1029";

type Row = Record<string, unknown>;

/** Minimal service-role stand-in for the host_setup reads. */
function setupDb(tables: Record<string, Row[]>, currency = "NGN") {
  const query = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: (tables[table] ?? []).filter((r) =>
            filters.every((f) =>
              f(r)
            )
          )[0] ?? null,
          error: null,
        }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))),
          error: null,
        }).then(resolve),
    };
    return chain;
  };
  return {
    auth: {
      getUser: (token: string) =>
        Promise.resolve(
          token === "host"
            ? { data: { user: HOST_USER }, error: null }
            : { data: { user: null }, error: { message: "bad" } },
        ),
    },
    from: query,
    rpc: (name: string) => {
      if (name === "ad_can_host_action") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "ad_brand_currency_authority") {
        return Promise.resolve({
          data: { resolved: true, currency },
          error: null,
        });
      }
      return Promise.resolve({
        data: null,
        error: { message: `missing ${name}` },
      });
    },
  };
}

function pageRow(index: number, total: number): Row {
  return {
    page_type: index % 2 ? "event" : "trip",
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    brand_slug: "femzy",
    entity_slug: `page-${index}`,
    title: `Page ${index}`,
    brand_name: "Femzy",
    starts_at: null,
    city: "Lagos",
    cover_url: null,
    canonical_url: `https://usemingla.com/e/femzy/page-${index}`,
    availability: "available",
    result_kind: "tickets",
    total_count: total,
  };
}

async function hostSetup(
  tables: Record<string, Row[]>,
  pages: (page: number) => Row[],
): Promise<
  { status: number; body: Row; rpcPages: number[]; blocked: string[] }
> {
  Deno.env.set(
    "SUPABASE_URL",
    Deno.env.get("SUPABASE_URL") || "http://stub.supabase.test",
  );
  Deno.env.set(
    "SUPABASE_ANON_KEY",
    Deno.env.get("SUPABASE_ANON_KEY") || "anon-test",
  );
  Deno.env.set(
    "SUPABASE_SERVICE_ROLE_KEY",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "service-test",
  );
  const { handleAdPlan } = await import("../../ad-plan/index.ts");
  const rpcPages: number[] = [];
  const blocked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    if (url.includes("/rest/v1/rpc/ad_advertisable_pages")) {
      const raw = typeof init?.body === "string" ? init.body : "{}";
      const page = Number(JSON.parse(raw).p_page ?? 0);
      rpcPages.push(page);
      return Promise.resolve(
        new Response(JSON.stringify(pages(page)), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    // NEVER reach a real ad provider from a test.
    blocked.push(url);
    return Promise.reject(new TypeError(`blocked network: ${url}`));
  }) as typeof fetch;
  try {
    const response = await handleAdPlan(
      new Request("https://edge.test/ad-plan", {
        method: "POST",
        headers: {
          authorization: "Bearer host",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "host_setup", brand_id: BRAND_ID }),
      }),
      { db: setupDb(tables) as never },
    );
    return {
      status: response.status,
      body: await response.json(),
      rpcPages,
      blocked,
    };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const CONNECTIONS: Row[] = [
  {
    id: "c-meta-consumer",
    platform: "meta",
    lane: "consumer",
    connected: true,
    status: "connected",
    currency: "USD",
    external_account_id: "act_SECRET_ACCOUNT",
    access_token: SECRET_TOKEN,
    extra: { dataset_id: SECRET_DATASET, page_id: "PAGE-SECRET" },
  },
  {
    id: "c-snap-consumer",
    platform: "snapchat",
    lane: "consumer",
    connected: true,
    status: "connected",
    currency: "USD",
    extra: { pixel_id: SECRET_PIXEL },
  },
  {
    id: "c-google-consumer",
    platform: "google",
    lane: "consumer",
    connected: true,
    status: "connected",
    currency: "USD",
    extra: {},
  },
  {
    id: "c-meta-business",
    platform: "meta",
    lane: "business",
    connected: true,
    status: "connected",
    currency: "USD",
    extra: { dataset_id: "BUSINESS-DATASET" },
  },
  {
    id: "c-tiktok-consumer-down",
    platform: "tiktok",
    lane: "consumer",
    connected: false,
    status: "disconnected",
    currency: "USD",
    extra: { pixel_id: "px" },
  },
];

Deno.test("#4238 ADV-F host_setup returns only consumer accounts, projected, with no secret ids", async () => {
  const result = await hostSetup(
    {
      ad_connections: CONNECTIONS,
      ad_creatives: [],
      ad_plans: [],
      brands: [{ id: BRAND_ID, country_code: " gb " }],
    },
    (page) =>
      page === 0
        ? Array.from({ length: 24 }, (_, i) => pageRow(i, 30))
        : page === 1
        ? Array.from({ length: 6 }, (_, i) => pageRow(24 + i, 30))
        : [],
  );
  assertEquals(result.status, 200, JSON.stringify(result.body));
  const body = result.body as {
    available: boolean;
    currency: string;
    brand_country_code: string | null;
    pages: Row[];
    connections: Row[];
  };
  assertEquals(body.available, true);
  // NGN brand keeps NGN settlement; provider USD never replaces it.
  assertEquals(body.currency, "NGN");
  assertEquals(body.brand_country_code, "GB");
  assertEquals(
    body.connections.map((row) => row.id).sort(),
    ["c-google-consumer", "c-meta-consumer", "c-snap-consumer"],
  );
  for (const row of body.connections) {
    assertEquals(
      Object.keys(row).sort(),
      [
        "connected",
        "currency",
        "id",
        "platform",
        "sales",
        "status",
        "updated_at",
      ],
    );
    const sales = row.sales as { ready: boolean; reason: string };
    // Every probe was blocked offline, so nothing may claim ready.
    assertEquals(sales.ready, false);
  }
  const google = body.connections.find((row) => row.platform === "google")!;
  assertEquals((google.sales as Row).reason, "not_supported");
  const text = JSON.stringify(result.body);
  for (
    const secret of [
      SECRET_DATASET,
      SECRET_PIXEL,
      SECRET_TOKEN,
      "act_SECRET_ACCOUNT",
      "PAGE-SECRET",
      "BUSINESS-DATASET",
      "dataset_id",
      "pixel_id",
      "access_token",
      "external_account_id",
      '"lane"',
      "META_",
      "SNAPCHAT_",
      "TIKTOK_",
    ]
  ) {
    assert(!text.includes(secret), `host_setup leaked ${secret}`);
  }
  // Paged to the reported total: exactly two RPC pages.
  assertEquals(result.rpcPages, [0, 1]);
  assertEquals(body.pages.length, 30);
  // Any network the readiness preview attempted was a provider host, blocked.
  for (const url of result.blocked) {
    assert(
      !url.includes("stub.supabase.test"),
      `unexpected supabase call ${url}`,
    );
  }
});

Deno.test("#4238 ADV-F host_setup: no consumer account is unavailable; a bad country is never invented; paging stops at the cap", async () => {
  const lying = await hostSetup(
    {
      ad_connections: CONNECTIONS.filter((row) =>
        row.lane === "business" || row.connected === false
      ),
      ad_creatives: [],
      ad_plans: [],
      brands: [{ id: BRAND_ID, country_code: "NGA" }],
    },
    // total_count claims 9999 rows forever.
    () => Array.from({ length: 24 }, (_, i) => pageRow(i, 9999)),
  );
  assertEquals(lying.status, 200, JSON.stringify(lying.body));
  assertEquals(lying.body.available, false);
  assertEquals(lying.body.connections, []);
  assertEquals(lying.body.brand_country_code, null);
  assertEquals(lying.rpcPages, [0, 1, 2, 3, 4, 5, 6, 7]);
  assertEquals((lying.body.pages as Row[]).length, 192);
  // No account means no readiness probe and no network at all.
  assertEquals(lying.blocked, []);

  const missingBrandCountry = await hostSetup(
    {
      ad_connections: CONNECTIONS,
      ad_creatives: [],
      ad_plans: [],
      brands: [{ id: BRAND_ID, country_code: null }],
    },
    () => [],
  );
  assertEquals(missingBrandCountry.status, 200);
  assertEquals(missingBrandCountry.body.brand_country_code, null);
  assertEquals(missingBrandCountry.body.pages, []);
});

// ── G. Ari for a non-admin Host ─────────────────────────────────────────────
const ARI_BRAND = "11111111-1111-4111-8111-111111111111";
const ARI_CREATIVE = "44444444-4444-4444-8444-444444444444";
const ARI_META = "88888888-8888-4888-8888-888888888888";

function ariClient(setup: Row, bodies: Array<{ name: string; body: Row }>) {
  return {
    rpc: () => Promise.resolve({ data: true, error: null }),
    from(table: string) {
      // RLS on ad_connections is admin-only: a Host read returns nothing.
      if (table === "ad_connections") {
        throw new Error("Ari read ad_connections under Host RLS");
      }
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: {
              id: ARI_CREATIVE,
              brand_id: ARI_BRAND,
              kind: "video",
              status: "active",
            },
            error: null,
          }),
      };
      return query;
    },
    functions: {
      invoke(name: string, request: { body: Row }) {
        bodies.push({ name, body: request.body });
        const action = String(request.body.action ?? "");
        if (name === "ad-plan" && action === "host_setup") {
          return Promise.resolve({ data: setup, error: null });
        }
        if (name === "ad-plan" && action === "open") {
          return Promise.resolve({
            data: { plan: { id: "22222222-2222-4222-8222-222222222222" } },
            error: null,
          });
        }
        if (name === "ad-plan" && action === "create_version") {
          return Promise.resolve({
            data: {
              version: {
                id: "33333333-3333-4333-8333-333333333333",
                plan_hash: "a".repeat(64),
              },
            },
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
}

const ARI_ARGS = {
  brand_id: ARI_BRAND,
  name: "Femzy site",
  dest_brand_slug: "femzy",
  budget_cents: 20000,
  daily_budget_cents: 2000,
  countries: ["GB"],
  rights_confirmed: true,
  rights_basis: "owned",
  ai_generated: false,
  creative_library_id: ARI_CREATIVE,
  optimize_for: "sales",
};

Deno.test("#4238 ADV-G Ari never optimises a website page for sales, even when Meta is ready", async () => {
  const bodies: Array<{ name: string; body: Row }> = [];
  await findTool("propose_ad_plan")!.executor(
    { ...ARI_ARGS, dest_page_type: "site", platforms: ["meta"] },
    ariClient(
      {
        connections: [{
          id: ARI_META,
          platform: "meta",
          sales: { ready: true },
        }],
        pages: [{
          page_type: "site",
          brand_slug: "femzy",
          entity_slug: null,
          result_kind: "tickets",
        }],
      },
      bodies,
    ),
    ARI_BRAND,
    {} as never,
  );
  const version = bodies.find((row) => row.body.action === "create_version");
  assert(version, "no plan version created");
  assertEquals(
    (version.body.canonical_plan as Row).optimization_by_platform,
    { meta: "visits" },
  );
  for (const row of bodies) {
    assert(!("lane" in row.body), `${row.name} sent a lane`);
    assert(!("objective" in row.body), `${row.name} sent an objective`);
  }
});

Deno.test("#4238 ADV-G Ari stops before opening a plan when a chosen platform is not available", async () => {
  const bodies: Array<{ name: string; body: Row }> = [];
  let message = "";
  try {
    await findTool("propose_ad_plan")!.executor(
      {
        ...ARI_ARGS,
        dest_page_type: "event",
        dest_entity_slug: "deserted-island",
        platforms: ["meta", "tiktok"],
      },
      ariClient(
        {
          // host_setup for a brand with only Meta ready (and a business row the
          // server would never return anyway).
          connections: [{
            id: ARI_META,
            platform: "meta",
            sales: { ready: true },
          }],
          pages: [],
        },
        bodies,
      ),
      ARI_BRAND,
      {} as never,
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(/aren't available on TikTok/.test(message), `unexpected: ${message}`);
  assertEquals(
    bodies.map((row) => `${row.name}:${row.body.action ?? ""}`),
    ["ad-plan:host_setup"],
    "Ari opened or versioned a plan for an unavailable platform",
  );
});
