/**
 * #4238 live check (2026-11-04, #4238 comment 6635583198) — TikTok returns
 * no place below the country for Nigeria or Kenya (city Lagos, Abuja and
 * Nairobi, region "Lagos" and "Lagos State" all empty). The Host builder
 * then said "TikTok couldn't find Lagos. Remove it, or turn TikTok off.",
 * which drops Lagos for every app. Now an app with nothing at the asked
 * level and nothing one level up answers `wider` with its whole country
 * (TikTok's own country id, the one a whole-country campaign sends), for a
 * city, a region and a pin. An app error stays `unavailable`.
 */
// adChannel.ts owns the adapter registry and forms a cycle with tiktok.ts;
// evaluate it FIRST (as the edge-fn entrypoints do).
import "../adChannel.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isWholeCountryCandidate,
  matchPlace,
  searchMatch,
} from "../adTargetingMatch.ts";
import {
  buildTikTokAdGroupBody,
  type TikTokClient,
  tiktokResolvePlace,
  validateTikTokLocationIds,
} from "../tiktok.ts";
import {
  compileProviderTargeting,
  providerExecutionTargeting,
} from "../adTargetingCompiler.ts";
import { resolveAriTargetingRefs } from "../agentDomainTools.ts";

const NIGERIA = {
  id: "2328926",
  name: "Nigeria",
  meta: { location_id: "2328926", country_code: "NG", level: "COUNTRY" },
};
const LAGOS_STATE = {
  id: "2332453",
  name: "Lagos State",
  meta: { level: "PROVINCE" },
};

// ── The matcher ─────────────────────────────────────────────────────────────

Deno.test("matcher: nothing at the level or one up → the whole country is the wider area", () => {
  assertEquals(matchPlace("Lagos", "city", [], [], NIGERIA), {
    state: "wider",
    wider: NIGERIA,
  });
  assertEquals(matchPlace("Lagos State", "region", [], [], NIGERIA), {
    state: "wider",
    wider: NIGERIA,
  });
  assert(isWholeCountryCandidate(NIGERIA));
  assert(!isWholeCountryCandidate(LAGOS_STATE));
  // searchMatch passes the country through for every place kind it matches.
  for (const kind of ["city", "region"]) {
    assertEquals(
      searchMatch(kind, "Lagos", { results: [], country: NIGERIA }),
      { state: "wider", wider: NIGERIA },
    );
  }
});

Deno.test("matcher: a smaller answer always wins over the country", () => {
  // A state one level up still wins (the existing Lagos State offer).
  assertEquals(matchPlace("Lagos", "city", [], [LAGOS_STATE], NIGERIA), {
    state: "wider",
    wider: LAGOS_STATE,
  });
  // The US still matches its own city.
  const newYork = {
    id: "5128581",
    name: "New York",
    meta: { geo_type: "DISTRICT" },
  };
  assertEquals(matchPlace("New York", "city", [newYork], [], null), {
    state: "match",
    best: newYork,
  });
  // No country answer (TikTok doesn't run there) stays "none".
  assertEquals(matchPlace("London", "city", [], [], null), { state: "none" });
});

// ── TikTok's place lookup (fetch mocked; read-only) ─────────────────────────

const client = {
  platform: "tiktok",
  token: "tok-test",
  advertiserId: "7627974536397766673",
  apiVersion: "v1.3",
  apiBase: "https://business-api.tiktok.com",
} as unknown as TikTokClient;

type Call = { url: string; method: string; body: Record<string, unknown> };

async function withTikTok<T>(
  answer: (call: Call) => unknown,
  run: (calls: Call[]) => Promise<T>,
): Promise<T> {
  const calls: Call[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const call = {
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : {},
    };
    calls.push(call);
    return Promise.resolve(
      new Response(JSON.stringify(answer(call)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const EMPTY_SEARCH = { code: 0, message: "OK", data: { targeting_tag_list: [] } };
const REGIONS = {
  code: 0,
  message: "OK",
  data: {
    region_info: [
      { location_id: "6252001", region_code: "US", name: "United States", level: "COUNTRY" },
      { location_id: "2328926", region_code: "NG", name: "Nigeria", level: "COUNTRY" },
      { location_id: "192950", region_code: "KE", name: "Kenya", level: "COUNTRY" },
    ],
  },
};
const tikTokAnswer = (call: Call) =>
  call.url.includes("/tool/region/") ? REGIONS : EMPTY_SEARCH;

for (const [kind, q] of [["city", "Lagos"], ["region", "Lagos State"]] as const) {
  Deno.test(`TikTok ${kind} "${q}" in NG: empty everywhere → Nigeria, then wider`, async () => {
    await withTikTok(tikTokAnswer, async (calls) => {
      const out = await tiktokResolvePlace(client, { kind, q, country: "NG" });
      assertEquals(out.results, []);
      assertEquals(out.country?.id, "2328926");
      assertEquals(out.country?.meta.level, "COUNTRY");
      assertEquals(out.country?.meta.country_code, "NG");
      // City: own level, then PROVINCE, then the country list.
      const searches = calls.filter((c) => c.url.includes("/tool/targeting/search/"));
      assertEquals(searches.length, kind === "city" ? 2 : 1);
      assertEquals(searches.at(-1)?.body.geo_types, ["PROVINCE"]);
      assert(calls.some((c) => c.url.includes("/tool/region/") && c.method === "GET"));
      const match = searchMatch(kind, q, out);
      assertEquals(match.state, "wider");
      assertEquals((match as { wider: { id: string } }).wider.id, "2328926");
    });
  });
}

Deno.test("TikTok pin in KE: the pin's last part is a city lookup → Kenya", async () => {
  await withTikTok(tikTokAnswer, async () => {
    // The builder and Ari look a pin up as a city (its last part).
    const out = await tiktokResolvePlace(client, { kind: "city", q: "Westlands", country: "KE" });
    assertEquals(out.country?.id, "192950");
    assertEquals(searchMatch("city", "Westlands", out).state, "wider");
  });
});

Deno.test("TikTok US city still matches its own city, with no country lookup", async () => {
  await withTikTok((call) =>
    call.url.includes("/tool/region/") ? REGIONS : {
      code: 0,
      message: "OK",
      data: {
        targeting_tag_list: [{
          name: "New York",
          targeting_type: "GEO",
          status_info: { status: "ENABLED" },
          geo: { geo_id: "5128581", geo_type: "DISTRICT", region_code: "US", description: "City" },
        }],
      },
    }, async (calls) => {
    const out = await tiktokResolvePlace(client, { kind: "city", q: "New York", country: "US" });
    assertEquals(out.results[0].id, "5128581");
    assertEquals(out.country, undefined);
    assert(!calls.some((c) => c.url.includes("/tool/region/")));
    assertEquals(searchMatch("city", "New York", out).state, "match");
  });
});

Deno.test("TikTok doesn't offer a country it can't run in (GB) → none", async () => {
  await withTikTok(tikTokAnswer, async () => {
    const out = await tiktokResolvePlace(client, { kind: "city", q: "London", country: "GB" });
    assertEquals(out.country, undefined);
    assertEquals(searchMatch("city", "London", out), { state: "none" });
  });
});

Deno.test("a TikTok error throws (the search marks it unavailable), never the country", async () => {
  await withTikTok(
    (call) =>
      call.url.includes("/tool/region/")
        ? { code: 40100, message: "Too many requests", data: {} }
        : EMPTY_SEARCH,
    async () => {
      await assertRejects(() =>
        tiktokResolvePlace(client, { kind: "city", q: "Lagos", country: "NG" })
      );
    },
  );
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-targeting-search/index.ts", import.meta.url),
  );
  // The edge fn hands TikTok places to the shared lookup inside its one
  // try/catch, whose catch returns the unavailable shape.
  assertStringIncludes(src, "tiktokResolvePlace(client, { kind, q, country })");
  assertStringIncludes(src, "return json(failOpen(err, hostCaller));");
});

// ── What TikTok is sent for an accepted whole-country place ─────────────────

Deno.test("an accepted all-of-Nigeria place sends TikTok Nigeria's location id once", () => {
  const intent = {
    countries: ["NG"],
    cities: [
      { name: "Lagos", countryCode: "NG", radiusKm: 17 },
      { name: "Abuja", countryCode: "NG", radiusKm: 17 },
    ],
  };
  const row = compileProviderTargeting("tiktok", intent, {
    locationIds: { "NG:lagos": "2328926", "NG:abuja": "2328926" },
  });
  assertEquals(row.checksRequired, []);
  assertEquals(row.compiledTargeting.location_ids, ["2328926"]);
  const exec = providerExecutionTargeting(
    "tiktok",
    row.audienceIntent,
    row.compiledTargeting,
  );
  assertEquals(exec.location_ids, ["2328926"]);
  assertEquals(validateTikTokLocationIds(exec.location_ids), { ok: true });
  const body = buildTikTokAdGroupBody("adv", "camp", {
    name: "Rooftop",
    optimizationGoal: "TRAFFIC_LANDING_PAGE_VIEW",
    billingEvent: "CPC",
    budgetCents: 5_000,
    locationIds: exec.location_ids as string[],
    nowMs: Date.parse("2026-11-04T12:00:00Z"),
  });
  assertEquals(body.location_ids, ["2328926"]);
  // The other apps still get Lagos itself.
  const meta = compileProviderTargeting("meta", intent, {
    locationIds: { "NG:lagos": "1630653", "NG:abuja": "2352778" },
  });
  const cities = (meta.compiledTargeting.geo_locations as Record<string, unknown>)
    .cities as { key: string }[];
  assertEquals(cities.map((c) => c.key), ["1630653", "2352778"]);
});

// ── Ari uses the same matcher ──────────────────────────────────────────────

Deno.test("Ari takes all of Nigeria on TikTok and says so on its card", async () => {
  const calls: Record<string, unknown>[] = [];
  const client = {
    functions: {
      invoke(_name: string, request: { body: Record<string, unknown> }) {
        calls.push(request.body);
        const body = request.body;
        if (body.platform === "tiktok") {
          return Promise.resolve({
            data: { results: [], match: { state: "wider", wider: NIGERIA } },
            error: null,
          });
        }
        return Promise.resolve({
          data: { results: [], match: { state: "match", best: { id: "1630653", name: "Lagos" } } },
          error: null,
        });
      },
    },
  } as never;
  const out = await resolveAriTargetingRefs(
    client,
    "b",
    ["meta", "tiktok"],
    [{ name: "Lagos", countryCode: "NG", radiusKm: 17 }],
    [],
  );
  assertEquals(out.refs, {
    meta: { locationIds: { "NG:lagos": "1630653" } },
    tiktok: { locationIds: { "NG:lagos": "2328926" } },
  });
  assertEquals(out.notes, [
    "TikTok has no smaller area for Lagos, so it shows your ad across all of Nigeria (wider area).",
  ]);
  assertEquals(out.wider, {
    tiktok: { "NG:lagos": { name: "all of Nigeria", wholeCountry: true } },
  });
  assert(calls.every((body) => body.match === true));
});
