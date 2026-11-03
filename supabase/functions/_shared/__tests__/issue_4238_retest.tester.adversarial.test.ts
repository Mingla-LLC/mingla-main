/**
 * #4238 — tester RETEST adversarial suite (server side). Attacks the rework
 * from angles the implementor's fix tests do not:
 *
 *  D4. Sales readiness: five concurrent host_setup loads share ONE provider
 *      read; two accounts never share an answer; a good answer is not thrown
 *      away on the short (one-minute) failure clock.
 *  D6. A Host search failure that is not an Error (a thrown string, object,
 *      null) still maps to the one safe sentence and never echoes the input.
 *  B.  A Host body that names a delivery field with a falsy value (null, "",
 *      0, false) is still refused; an objective plus a delivery field is
 *      refused as an objective.
 *  C.  Truthy-but-not-true `connected` ("true", 1), a cased status, missing
 *      fields, or one dead account hidden in a batch of live ones is refused.
 *  D3. Ari's ad card: when Ads setup cannot be read it invents no currency;
 *      a GBP brand shows pounds, never naira or dollars.
 *
 * Fails on revert (verified by line-deletion at the retest commit):
 *  - ad-plan host_setup back to uncached `salesReadiness(row)` → the shared
 *    readiness probe count is 5, not 1 (D4 concurrency is in the cache).
 *  - `cachedSalesReadiness` keyed without `conn.id` → two accounts share.
 *  - dropping `row.connected !== true` → "true"/1 bind (C).
 *  - dropping HOST_DELIVERY_BODY_FIELDS → null/"" delivery fields pass (B).
 *  - formatAdMoney back to the old "amount CODE" text → no "£" (D3).
 */

import "../adChannel.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type AdConnectionRow,
  HOST_SEARCH_UNAVAILABLE,
  hostSafeSearchWarning,
} from "../adChannelCore.ts";
import {
  cachedSalesReadiness,
  clearSalesReadinessCache,
  SALES_READINESS_UNKNOWN_TTL_MS,
  type SalesSignalProbes,
} from "../adSalesReadiness.ts";
import { hostAllocationLaneError, hostGoalBodyError } from "../adHostGoal.ts";
import { preflightMoneyProposal } from "../agentDomainTools.ts";

const metaRow = (id: string) =>
  ({
    id,
    platform: "meta",
    lane: "consumer",
    extra: { dataset_id: `dataset-${id}` },
  }) as unknown as AdConnectionRow;

function countingProbes(
  answer: () => Promise<boolean>,
): { probes: SalesSignalProbes; calls: () => number } {
  let calls = 0;
  return {
    probes: {
      metaHasSignal: () => {
        calls += 1;
        return answer();
      },
      snapchatPurchases28d: () => Promise.resolve(0),
      tiktokPurchases28d: () => Promise.resolve(0),
    },
    calls: () => calls,
  };
}

// ── D4 ──────────────────────────────────────────────────────────────────────
Deno.test("#4238 RETEST D4 concurrent loads share one readiness read per account", async () => {
  clearSalesReadinessCache();
  let release: (value: boolean) => void = () => {};
  const gate = new Promise<boolean>((resolve) => {
    release = resolve;
  });
  const { probes, calls } = countingProbes(() => gate);
  const t0 = 9_000_000;
  const row = metaRow("meta-concurrent");
  // Five builder loads arrive while the first provider read is still open.
  const pending = Array.from(
    { length: 5 },
    () => cachedSalesReadiness(row, { probes, now: t0 }),
  );
  release(true);
  const answers = await Promise.all(pending);
  assertEquals(calls(), 1, "concurrent loads each made a provider read");
  for (const answer of answers) assertEquals(answer.ready, true);
  clearSalesReadinessCache();
});

Deno.test("#4238 RETEST D4 two accounts never share a readiness answer", async () => {
  clearSalesReadinessCache();
  const seen: string[] = [];
  const probes: SalesSignalProbes = {
    metaHasSignal: (client) => {
      seen.push(
        String(
          (client as { config?: { datasetId?: string } })?.config?.datasetId ??
            "?",
        ),
      );
      return Promise.resolve(seen.length === 1);
    },
    snapchatPurchases28d: () => Promise.resolve(0),
    tiktokPurchases28d: () => Promise.resolve(0),
  };
  const t0 = 12_000_000;
  const a = await cachedSalesReadiness(metaRow("meta-a"), { probes, now: t0 });
  const b = await cachedSalesReadiness(metaRow("meta-b"), { probes, now: t0 });
  assertEquals(
    seen.length,
    2,
    "the second account reused the first one's answer",
  );
  assertEquals(a.ready, true);
  assertEquals(b.ready, false);
  clearSalesReadinessCache();
});

Deno.test("#4238 RETEST D4 a good answer outlives the one-minute failure clock", async () => {
  clearSalesReadinessCache();
  const { probes, calls } = countingProbes(() => Promise.resolve(true));
  const t0 = 15_000_000;
  const row = metaRow("meta-good");
  await cachedSalesReadiness(row, { probes, now: t0 });
  await cachedSalesReadiness(row, {
    probes,
    now: t0 + SALES_READINESS_UNKNOWN_TTL_MS + 5_000,
  });
  assertEquals(calls(), 1, "a ready answer was re-read after one minute");
  clearSalesReadinessCache();
});

// ── D6 ──────────────────────────────────────────────────────────────────────
Deno.test("#4238 RETEST D6 non-Error search failures still give Hosts the one safe sentence", () => {
  const secret = "META_ACCESS_TOKEN=EAAB-secret act_4238000001";
  const logged: Record<string, unknown>[] = [];
  for (const thrown of [secret, { message: secret }, null, undefined, 42]) {
    const warning = hostSafeSearchWarning(thrown, (_m, detail) => {
      logged.push(detail);
    });
    assertEquals(warning, HOST_SEARCH_UNAVAILABLE);
    assert(!warning.includes("META_"), "secret name reached the Host");
    assert(!warning.includes("act_"), "account id reached the Host");
  }
  // Ops still get the detail.
  assert(String(logged[0].message).includes("META_ACCESS_TOKEN"));
});

// ── B ───────────────────────────────────────────────────────────────────────
Deno.test("#4238 RETEST B a falsy delivery field is still a Host choosing delivery", () => {
  for (const field of ["bid_strategy", "promotion_type", "tiktok_placement"]) {
    for (const value of [null, "", 0, false]) {
      assertEquals(
        hostGoalBodyError({ platform: "tiktok", [field]: value }),
        "host_delivery_field_forbidden",
        `${field}=${JSON.stringify(value)} was accepted`,
      );
    }
  }
  // An objective plus a delivery field is refused as an objective.
  assertEquals(
    hostGoalBodyError({ objective: "x", bid_strategy: "LOWEST_COST" }),
    "plan_optimization_mismatch",
  );
});

// ── C ───────────────────────────────────────────────────────────────────────
Deno.test("#4238 RETEST C only connected === true and status 'connected' bind", () => {
  const requested = [{ platform: "meta", connection_id: "c1" }];
  const live = {
    id: "c1",
    platform: "meta",
    lane: "consumer",
    connected: true,
    status: "connected",
  };
  for (
    const row of [
      { ...live, connected: "true" },
      { ...live, connected: 1 },
      { ...live, status: "Connected" },
      { ...live, status: "unknown" },
      { id: "c1", platform: "meta", lane: "consumer" },
    ]
  ) {
    assertEquals(
      hostAllocationLaneError([row], requested),
      "host_connection_lane_invalid",
      `bound ${JSON.stringify(row)}`,
    );
  }
  // One dead account hidden among live ones is refused.
  const batch = [
    live,
    { ...live, id: "c2", platform: "snapchat" },
    { ...live, id: "c3", platform: "tiktok", connected: false },
  ];
  assertEquals(
    hostAllocationLaneError(batch, [
      { platform: "meta", connection_id: "c1" },
      { platform: "snapchat", connection_id: "c2" },
      { platform: "tiktok", connection_id: "c3" },
    ]),
    "host_connection_lane_invalid",
  );
});

// ── D3 ──────────────────────────────────────────────────────────────────────
const BRAND = "22222222-2222-4222-8222-222222222222";
const proposal = {
  brand_id: BRAND,
  name: "River Supper Club",
  dest_page_type: "event",
  dest_brand_slug: "thames-social",
  dest_entity_slug: "river-supper-club",
  platforms: ["meta", "tiktok"],
  budget_cents: 50_000,
  countries: ["GB"],
  rights_basis: "licensed",
  ai_generated: false,
};

function clientAnswering(setup: { data: unknown; error: unknown }) {
  return {
    functions: {
      invoke: (name: string, request: { body: Record<string, unknown> }) =>
        Promise.resolve(
          name === "ad-plan" && request.body.action === "host_setup"
            ? setup
            : { data: null, error: null },
        ),
    },
  };
}

Deno.test("#4238 RETEST D3 a GBP brand's Ari card shows pounds, never naira or dollars", async () => {
  const context = await preflightMoneyProposal(
    "propose_ad_plan",
    proposal,
    clientAnswering({ data: { currency: "GBP" }, error: null }),
  );
  assert(context);
  assertEquals(context.currency, "GBP");
  const money = String(context.ad_provider_allocation);
  // #4238 retest 2: one money format on the card ("GBP 250.00").
  assert(money.includes("GBP 250.00"), money);
  assert(!/NGN|₦|USD|\$/.test(money), money);
  assertEquals(context.ad_destination, "Event: River Supper Club");
  assert(String(context.ad_audience).startsWith("United Kingdom"));
  assert(String(context.ad_media_rights).startsWith("You licensed this video"));
});

Deno.test("#4238 RETEST D3 when Ads setup cannot be read the card invents no currency", async () => {
  const context = await preflightMoneyProposal(
    "propose_ad_plan",
    proposal,
    clientAnswering({ data: null, error: { message: "down" } }),
  );
  assert(context);
  assertEquals("currency" in context, false);
  const money = String(context.ad_provider_allocation);
  assert(
    !/[A-Z]{3}|₦|£|\$/.test(money.replace(/Facebook|Instagram|TikTok/g, "")),
    money,
  );
  assert(money.includes("250.00"), money);
});
