/**
 * #4238 media-buyer, tester round 8 — adversarial checks on the Host builder's
 * pure rules, from a different angle than the implementor tests:
 *
 *   B1  The budget split, over 3,000 seeded random cases (totals, days, apps,
 *       minimums): the apps' daily amounts add up exactly to the daily
 *       amount, the daily amount over the run never passes the total, the
 *       caps add up exactly to the total, every cap covers its own daily, and
 *       "ok" is true only when every app clears its minimum.
 *   B2  An app error is never shown or saved as "not found", in any order of
 *       answers, and a later good answer clears it.
 *   B3  A reopened plan keeps each app's id on the right place when one app
 *       found nothing for an earlier place (ids by key, never by position).
 */
import {
  hostAdAllocations,
  hostAdDailyFromTotal,
  hostAdSplitWithMinimums,
} from "../hostAdBudget";
import {
  type HostAdApp,
  type HostAdPlace,
  applyPlaceLookup,
  hostAdAppReviewStatus,
  hostAdPlaceAppStatus,
  hostAdPlaceForSave,
  hostAdRefsForApp,
  hostAdSelectionsFromCanonical,
} from "../hostAdTargeting";

/** Small deterministic generator (mulberry32) so a failure is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const APPS: HostAdApp[] = ["meta", "tiktok", "snapchat", "google", "reddit"];

describe("#4238 B1 the budget split never spends more than the Host set", () => {
  it("holds for 3,000 random cases", () => {
    const next = rng(4238);
    for (let i = 0; i < 3000; i += 1) {
      const appCount = 1 + Math.floor(next() * 5);
      const apps = APPS.slice(0, appCount);
      const days = 1 + Math.floor(next() * 60);
      const totalCents = 1 + Math.floor(next() * 50_000_000);
      const minimums: Record<string, number> = {};
      for (const app of apps) {
        if (next() < 0.8) minimums[app] = Math.floor(next() * 2_000_000);
      }
      const daily = hostAdDailyFromTotal(totalCents, days);
      expect(daily * days).toBeLessThanOrEqual(totalCents);

      const split = hostAdSplitWithMinimums(daily, apps, minimums);
      const sum = split.rows.reduce((acc, row) => acc + row.dailyCents, 0);
      const label = JSON.stringify({ i, apps, days, totalCents, minimums });
      expect([label, sum]).toEqual([label, daily]);
      const everyMinimumMet = split.rows.every((row) => row.dailyCents >= row.minimumCents);
      expect([label, split.ok]).toEqual([label, everyMinimumMet]);

      const alloc = hostAdAllocations({
        mode: "total",
        totalCents,
        dailyCents: 0,
        days,
        apps,
        minimums,
      });
      const caps = alloc.capShares.reduce((acc, value) => acc + value, 0);
      expect([label, caps]).toEqual([label, totalCents]);
      if (alloc.ok) {
        alloc.split.rows.forEach((row, index) => {
          expect([label, row.platform, alloc.capShares[index] >= row.dailyCents])
            .toEqual([label, row.platform, true]);
        });
      }
    }
  });

  it("refuses a total too small for one day of the minimums before any money", () => {
    const alloc = hostAdAllocations({
      mode: "total",
      totalCents: 4_999,
      dailyCents: 0,
      days: 1,
      apps: ["meta", "tiktok"],
      minimums: { meta: 100, tiktok: 5_000 },
    });
    expect(alloc.ok).toBe(false);
    expect(alloc.split.short?.platform).toBe("tiktok");
  });
});

const lagos: HostAdPlace = { name: "Lagos", countryCode: "NG", refs: {} };
const ctx = { radiusKm: 17, availability: [] };

describe("#4238 B2 an app error is never 'not found'", () => {
  it.each([
    ["no answer (the call threw)", null],
    ["the app said it couldn't check", { results: [], unavailable: true }],
  ])("%s", (_label, response) => {
    const place = applyPlaceLookup(lagos, "tiktok", response as never);
    const status = hostAdPlaceAppStatus(place, "tiktok", ctx);
    expect(status.state).toBe("error");
    expect(status.text).toBe("Couldn't check TikTok. Try again.");
    expect(status.text).not.toMatch(/couldn't find|not found/i);
    expect(place.missing?.tiktok).toBeUndefined();
    expect(hostAdAppReviewStatus({ app: "tiktok", verdict: "exact", places: [place], interests: [] }))
      .toBe("Couldn't check");
  });

  it("a later good answer clears the error, and a later empty answer is 'not found', not an error", () => {
    let place = applyPlaceLookup(lagos, "meta", null);
    place = applyPlaceLookup(place, "meta", { match: { state: "match", best: { id: "2420605", name: "Lagos" } } });
    expect(place.errors?.meta).toBeUndefined();
    expect(place.refs.meta).toBe("2420605");
    place = applyPlaceLookup(place, "google", { results: [], match: { state: "none" } });
    expect(hostAdPlaceAppStatus(place, "google", ctx).state).toBe("missing");
    expect(place.errors?.google).toBeUndefined();
  });

  it("a saved draft never carries an error as if it were an answer", () => {
    const saved = hostAdPlaceForSave(applyPlaceLookup(lagos, "tiktok", null));
    expect(saved.refs.tiktok).toBeUndefined();
    expect(JSON.stringify(saved)).not.toMatch(/missing/);
  });
});

describe("#4238 B3 a reopened plan keeps each app's id on the right place", () => {
  it("TikTok found nothing for the first place; ids stay with their own place", () => {
    const places: HostAdPlace[] = [
      { name: "Ikeja", countryCode: "NG", refs: { meta: "m-ikeja" }, missing: { tiktok: true } },
      { name: "Lagos", countryCode: "NG", refs: { meta: "m-lagos", tiktok: "t-lagos-state" }, accepted: { tiktok: true } },
      { name: "Accra", countryCode: "GH", kind: "region", refs: { meta: "m-accra-r", tiktok: "t-accra-r" } },
    ];
    const canonical = {
      // Compiled arrays deliberately in a different order (and shorter for TikTok).
      audience_intent: { countries: ["NG", "GH"], cities: [places[2], places[0], places[1]] },
      targeting_selection: { places: places.map(hostAdPlaceForSave), excluded: [], interests: [] },
    };
    const back = hostAdSelectionsFromCanonical(canonical).places;
    const tiktok = hostAdRefsForApp("tiktok", back, []).locationIds;
    const meta = hostAdRefsForApp("meta", back, []).locationIds;
    expect(tiktok).toEqual({ "NG:lagos": "t-lagos-state", "region:GH:accra": "t-accra-r" });
    expect(meta).toEqual({ "NG:ikeja": "m-ikeja", "NG:lagos": "m-lagos", "region:GH:accra": "m-accra-r" });
    expect(back[1].accepted?.tiktok).toBe(true);
  });
});
