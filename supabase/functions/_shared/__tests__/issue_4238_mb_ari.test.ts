/**
 * #4238 media-buyer, wave E — Ari uses the same per-app matching as the Host
 * builder and Admin (I-4238-PER-APP-MATCH, I-4238-ERROR-IS-NOT-MISSING), and
 * its card carries the new fields: places with their own distance, the
 * button, the minimums-first split and the tracking tags.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  preflightMoneyProposal,
  resolveAriTargetingRefs,
} from "../agentDomainTools.ts";
import { splitDailyWithMinimums } from "../adHostPlanRules.ts";

function searchClient(answer: (body: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    client: {
      functions: {
        invoke(_name: string, request: { body: Record<string, unknown> }) {
          calls.push(request.body);
          const data = answer(request.body);
          return data instanceof Error
            ? Promise.resolve({ data: null, error: { message: data.message } })
            : Promise.resolve({ data, error: null });
        },
      },
    } as never,
  };
}

Deno.test("E1 Ari takes TikTok's state as the wider area and Meta's own interest name", async () => {
  const { client, calls } = searchClient((body) => {
    if (body.platform === "tiktok" && body.kind === "city") {
      return { results: [], match: { state: "wider", wider: { id: "2332453", name: "Lagos State" } } };
    }
    if (body.platform === "meta" && body.kind === "city") {
      return { results: [], match: { state: "match", best: { id: "1630653", name: "Lagos" } } };
    }
    if (body.platform === "tiktok" && body.kind === "interest") {
      return { results: [], match: { state: "match", best: { id: "t7", name: "Music › Live performances" } } };
    }
    return { results: [], match: { state: "match", best: { id: "m1", name: "Live music" } } };
  });
  const out = await resolveAriTargetingRefs(
    client,
    "b",
    ["meta", "tiktok"],
    [{ name: "Lagos", countryCode: "NG", radiusKm: 17 }],
    ["Live music"],
  );
  assertEquals(out.refs, {
    meta: { locationIds: { "NG:lagos": "1630653" }, interestIds: { "live music": "m1" } },
    tiktok: { locationIds: { "NG:lagos": "2332453" }, interestIds: { "live music": "t7" } },
  });
  assertStringIncludes(out.notes.join(" "), "TikTok only knows Lagos State, not Lagos");
  // Every lookup used the server's matcher.
  assert(calls.every((body) => body.match === true));
});

Deno.test("E1 an app error is 'Couldn't check', never a missing match", async () => {
  const { client } = searchClient((body) =>
    body.platform === "google" ? new Error("boom") : { results: [], unavailable: true }
  );
  const out = await resolveAriTargetingRefs(client, "b", ["google", "meta"], [
    { name: "Accra", countryCode: "GH", radiusKm: 17 },
  ], []);
  assertEquals(out.refs, { google: {}, meta: {} });
  assert(out.notes.every((note) => note.startsWith("Couldn't check")));
  assert(!out.notes.some((note) => /couldn't find/i.test(note)));
});

Deno.test("E1 Ari's card shows each place's distance, the button, the split and the tags", async () => {
  const page = {
    page_type: "event",
    brand_slug: "femzy",
    entity_slug: "sunday-rooftop",
    ok: true,
    last_bookable_at: "2026-12-06T23:30:00Z",
    timezone: "Africa/Lagos",
  };
  const client = {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from() {
      const q = { select: () => q, eq: () => q, in: () => q, maybeSingle: () => Promise.resolve({ data: null, error: null }) };
      return q;
    },
    functions: {
      invoke: () =>
        Promise.resolve({
          data: {
            currency: "NGN",
            connections: [],
            pages: [page],
            minimums: [
              { platform: "meta", visits_daily_minimum_cents: 2_000_00 },
              { platform: "tiktok", visits_daily_minimum_cents: 78_000_00 },
            ],
          },
          error: null,
        }),
    },
  } as never;
  const context = await preflightMoneyProposal("propose_ad_plan", {
    brand_id: "4238aaaa-0000-4000-8000-000000000001",
    name: "Sunday Rooftop Sessions",
    dest_page_type: "event",
    dest_brand_slug: "femzy",
    dest_entity_slug: "sunday-rooftop",
    platforms: ["meta", "tiktok"],
    budget_cents: 5_000_000_00,
    daily_budget_cents: 90_000_00,
    countries: ["NG"],
    cities: [
      { name: "Lagos", country_code: "NG", radius_km: 20 },
      { name: "Lagos State", country_code: "NG", kind: "region" },
    ],
    call_to_action: "tickets",
  }, client) as Record<string, unknown>;
  assertStringIncludes(String(context.ad_audience), "Lagos, 20 km; Lagos State (whole region)");
  assertStringIncludes(String(context.ad_audience), "not people who already bought");
  assertEquals(context.ad_button, "Get tickets");
  assertEquals(
    context.ad_tracking,
    "utm_source per app · utm_medium=paid_social · utm_campaign=sunday-rooftop-sessions",
  );
  // The NGN 5,000,000 total follows the daily shares (7,000 : 83,000).
  assertStringIncludes(String(context.ad_provider_allocation), "TikTok: NGN 4,611,111.11");
  assertStringIncludes(String(context.ad_provider_allocation), "each app gets its minimum first");
  assertEquals(splitDailyWithMinimums(90_000_00, ["meta", "tiktok"], { meta: 2_000_00, tiktok: 78_000_00 }), [7_000_00, 83_000_00]);
});
