/**
 * Issue #3697: Snapchat spend sync reads campaign stats from the right URL in
 * the ad account's timezone
 * (https://developers.snap.com/api/marketing-api/Ads-API/measurement).
 *
 * Live bug (2026-10-20): admin-ad-spend-sync called
 * `${apiBase}/v1/campaigns/{id}/stats` on an apiBase that already ends in /v1
 * (→ /v1/v1 → 404) with UTC-midnight bounds over 31 days, so every launched
 * Snap campaign was auto-paused with spend_fetch_failed. Fails on revert of
 * snapchatSpendStats.ts or of the admin-ad-spend-sync wiring.
 */

// adChannel.ts owns the adapter registry and forms a cycle with the leaf
// modules; evaluate it first (as the edge-fn entrypoints do).
import "../adChannel.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { AdApiError } from "../adChannelCore.ts";
import { SNAPCHAT_API_BASE, type SnapchatClient } from "../snapchat.ts";
import {
  fetchSnapchatCampaignStats,
  SNAPCHAT_STATS_WINDOW_DAYS,
  snapchatStatsWindow,
} from "../snapchatSpendStats.ts";
import { parseSnapchatStatsSpend } from "../adSpendSync.ts";

const ACCOUNT_ID = "6421cc96-dcaf-4a09-a7fa-b24199dcb391";
const CAMPAIGN_ID = "ccf5d298-0f30-4217-9289-d1834e62a470";
const TOKEN = "snap-test-access-token-xyz";

function client(): SnapchatClient {
  return {
    platform: "snapchat",
    accessToken: TOKEN,
    adAccountId: ACCOUNT_ID,
    organizationId: null,
    profileId: null,
    pixelId: null,
    apiBase: SNAPCHAT_API_BASE,
  };
}

type Handler = (url: URL) => { status: number; body: unknown };

async function withFetch<T>(
  handler: Handler,
  run: (calls: URL[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url,
    );
    calls.push(url);
    const { status, body } = handler(url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function accountBody(timezone: string | null) {
  return {
    request_status: "SUCCESS",
    request_id: "req-acct",
    adaccounts: [{
      sub_request_status: "SUCCESS",
      adaccount: {
        id: ACCOUNT_ID,
        name: "Mingla",
        currency: "USD",
        timezone,
      },
    }],
  };
}

const STATS_OK = {
  request_status: "SUCCESS",
  request_id: "req-stats",
  timeseries_stats: [{
    sub_request_status: "SUCCESS",
    timeseries_stat: {
      id: CAMPAIGN_ID,
      type: "CAMPAIGN",
      granularity: "DAY",
      timeseries: [
        {
          start_time: "2026-10-19T00:00:00.000-07:00",
          end_time: "2026-10-20T00:00:00.000-07:00",
          stats: { impressions: 1200, swipes: 31, spend: 4_560_000 },
        },
        {
          start_time: "2026-10-20T00:00:00.000-07:00",
          end_time: "2026-10-21T00:00:00.000-07:00",
          stats: { impressions: 80, swipes: 2, spend: 1_234_567 },
        },
      ],
    },
  }],
};

function standardHandler(timezone: string | null): Handler {
  return (url) =>
    url.pathname.endsWith(`/adaccounts/${ACCOUNT_ID}`)
      ? { status: 200, body: accountBody(timezone) }
      : { status: 200, body: STATS_OK };
}

const LA_NOW = new Date("2026-10-20T18:00:00Z"); // 11:00 PDT on 2026-10-20

function localDays(startIso: string, endIso: string): number {
  return (Date.parse(endIso) - Date.parse(startIso)) / 86_400_000;
}

Deno.test("#3697 stats URL has a single /v1/campaigns/{id}/stats", async () => {
  await withFetch(standardHandler("America/Los_Angeles"), async (calls) => {
    await fetchSnapchatCampaignStats(client(), CAMPAIGN_ID, { now: LA_NOW });
    const stats = calls.find((u) => u.pathname.includes("/stats"));
    assert(stats, "stats endpoint was called");
    assertEquals(stats.origin, "https://adsapi.snapchat.com");
    assertEquals(stats.pathname, `/v1/campaigns/${CAMPAIGN_ID}/stats`);
    assert(!stats.href.includes("/v1/v1"), stats.href);
    assertEquals(stats.searchParams.get("granularity"), "DAY");
  });
});

Deno.test("#3697 window is local midnights with the account offset (America/Los_Angeles, 2026-10-20)", async () => {
  await withFetch(standardHandler("America/Los_Angeles"), async (calls) => {
    await fetchSnapchatCampaignStats(client(), CAMPAIGN_ID, { now: LA_NOW });
    const stats = calls.find((u) => u.pathname.includes("/stats"))!;
    assertEquals(
      stats.searchParams.get("start_time"),
      "2026-09-23T00:00:00-07:00",
    );
    assertEquals(
      stats.searchParams.get("end_time"),
      "2026-10-21T00:00:00-07:00",
    );
  });
});

Deno.test("#3697 DST-crossing windows keep each boundary's own offset", () => {
  // US fall-back 2026-11-01: start is PDT, end is PST.
  const la = snapchatStatsWindow(
    "America/Los_Angeles",
    new Date("2026-11-10T20:00:00Z"),
  );
  assertEquals(la.start_time, "2026-10-14T00:00:00-07:00");
  assertEquals(la.end_time, "2026-11-11T00:00:00-08:00");
  // EU spring-forward 2026-03-29: start is GMT, end is BST.
  const london = snapchatStatsWindow(
    "Europe/London",
    new Date("2026-04-05T12:00:00Z"),
  );
  assertEquals(london.start_time, "2026-03-09T00:00:00+00:00");
  assertEquals(london.end_time, "2026-04-06T00:00:00+01:00");
  // Non-hour offset.
  const kolkata = snapchatStatsWindow(
    "Asia/Kolkata",
    new Date("2026-10-20T20:00:00Z"), // already 2026-10-21 01:30 IST
  );
  assertEquals(kolkata.end_time, "2026-10-22T00:00:00+05:30");
});

Deno.test("#3697 range is at most 28 days and Snap's 31-day ceiling is never reached", () => {
  assert(SNAPCHAT_STATS_WINDOW_DAYS <= 28);
  for (
    const [tz, now] of [
      ["America/Los_Angeles", "2026-10-20T18:00:00Z"],
      ["America/Los_Angeles", "2026-11-10T20:00:00Z"],
      ["Europe/London", "2026-04-05T12:00:00Z"],
      ["Africa/Lagos", "2026-10-20T23:30:00Z"],
      ["Pacific/Kiritimati", "2026-10-20T11:00:00Z"],
    ] as const
  ) {
    const w = snapchatStatsWindow(tz, new Date(now));
    const span = localDays(w.start_time, w.end_time);
    assert(span <= 28 + 1 / 24, `${tz} ${now}: ${span} days`);
    assert(span >= 28 - 1 / 24, `${tz} ${now}: ${span} days`);
    assert(/T00:00:00[+-]\d{2}:\d{2}$/.test(w.start_time), w.start_time);
    assert(/T00:00:00[+-]\d{2}:\d{2}$/.test(w.end_time), w.end_time);
    // The window ends after "now" (today's partial spend is included).
    assert(Date.parse(w.end_time) > Date.parse(now));
  }
  // Callers cannot widen it past the cap.
  const wide = snapchatStatsWindow("UTC", LA_NOW, 90);
  assertEquals(localDays(wide.start_time, wide.end_time), 28);
});

Deno.test("#3697 unknown or unreadable timezone falls back to UTC", async () => {
  const bogus = snapchatStatsWindow("Mars/Olympus_Mons", LA_NOW);
  assertEquals(bogus.timeZone, "UTC");
  assertEquals(bogus.start_time, "2026-09-23T00:00:00+00:00");
  assertEquals(bogus.end_time, "2026-10-21T00:00:00+00:00");
  assertEquals(snapchatStatsWindow(null, LA_NOW).timeZone, "UTC");

  // Account read fails (HTTP 500) → UTC window, stats still fetched.
  await withFetch(
    (url) =>
      url.pathname.endsWith(`/adaccounts/${ACCOUNT_ID}`)
        ? { status: 500, body: { request_status: "ERROR" } }
        : { status: 200, body: STATS_OK },
    async (calls) => {
      await fetchSnapchatCampaignStats(client(), CAMPAIGN_ID, { now: LA_NOW });
      const stats = calls.find((u) => u.pathname.includes("/stats"))!;
      assertEquals(
        stats.searchParams.get("start_time"),
        "2026-09-23T00:00:00+00:00",
      );
    },
  );
});

Deno.test("#3697 account timezone is read once per account per sync run", async () => {
  await withFetch(standardHandler("America/Los_Angeles"), async (calls) => {
    const cache = new Map<string, string | null>();
    await fetchSnapchatCampaignStats(client(), CAMPAIGN_ID, {
      now: LA_NOW,
      timeZoneCache: cache,
    });
    await fetchSnapchatCampaignStats(client(), CAMPAIGN_ID, {
      now: LA_NOW,
      timeZoneCache: cache,
    });
    assertEquals(
      calls.filter((u) => u.pathname.includes("/adaccounts/")).length,
      1,
    );
    assertEquals(calls.filter((u) => u.pathname.includes("/stats")).length, 2);
  });
});

Deno.test("#3697 Snap refusal still fails closed, naming HTTP status + error_code, token scrubbed", async () => {
  await withFetch(
    (url) =>
      url.pathname.endsWith(`/adaccounts/${ACCOUNT_ID}`)
        ? { status: 200, body: accountBody("America/Los_Angeles") }
        : {
          status: 400,
          body: {
            request_status: "ERROR",
            request_id: "req-err",
            error_code: "E1008",
            debug_message: `bad window for Bearer ${TOKEN}`,
          },
        },
    async () => {
      const err = await assertRejects(
        () =>
          fetchSnapchatCampaignStats(client(), CAMPAIGN_ID, { now: LA_NOW }),
        AdApiError,
      );
      assertStringIncludes(err.message, "snapchat_stats_fetch_failed");
      assertStringIncludes(err.message, "http_400");
      assertStringIncludes(err.message, "error_code=E1008");
      assertStringIncludes(err.message, "HTTP 400");
      assert(!err.message.includes(TOKEN), err.message);
    },
  );
});

Deno.test("#3697 spend parsing yields the right cents per account-local day", async () => {
  const payload = await withFetch(
    standardHandler("America/Los_Angeles"),
    () => fetchSnapchatCampaignStats(client(), CAMPAIGN_ID, { now: LA_NOW }),
  );
  assertEquals(parseSnapchatStatsSpend(payload), [
    {
      spend_date: "2026-10-19",
      spend_cents: 456,
      impressions: 1200,
      clicks: 31,
    },
    {
      spend_date: "2026-10-20",
      spend_cents: 123,
      impressions: 80,
      clicks: 2,
    },
  ]);
});

Deno.test("#3697 admin-ad-spend-sync uses the account-timezone stats fetcher, never a /v1 path", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-spend-sync/index.ts", import.meta.url),
  );
  assertStringIncludes(src, "fetchSnapchatCampaignStats(");
  assert(!src.includes("/v1/campaigns"), "hand-built /v1 stats path is back");
  assert(!/snapchatApi\(/.test(src), "spend sync calls snapchatApi directly");
});
