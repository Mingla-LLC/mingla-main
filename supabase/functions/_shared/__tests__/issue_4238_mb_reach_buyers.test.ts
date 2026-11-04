/**
 * #4238 media-buyer, wave B — reach per app and leaving out past buyers.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildTikTokAudienceEstimateBody,
  fetchProviderAudienceEstimate,
  metaReachTargetingSpec,
  tiktokLocationIdsAreIso,
} from "../adProviderEstimate.ts";
import { reachCacheKey, reachMeter } from "../adHostPlanRules.ts";
import { validateAudienceSelection } from "../adListAudienceRules.ts";
import type { AdConnectionRow } from "../adChannelCore.ts";

const BRAND = "4238aaaa-0000-4000-8000-000000000001";

Deno.test("reach meter: too narrow / good / broad", () => {
  assertEquals(reachMeter(10_000, 40_000), "too_narrow");
  assertEquals(reachMeter(1_200_000, 1_600_000), "good");
  assertEquals(reachMeter(8_000_000, 9_000_000), "broad");
  assertEquals(reachMeter(null, null), null);
  // Same audience, any key order → same cache key.
  assertEquals(reachCacheKey({ a: 1, b: [2] }), reachCacheKey({ b: [2], a: 1 }));
});

Deno.test("Meta reach asks about the cities, not the whole country (no union)", () => {
  const spec = metaReachTargetingSpec({
    geo_locations: { countries: ["NG"], cities: [{ key: "1" }] },
    age_min: 21,
  });
  assertEquals(spec.geo_locations, { cities: [{ key: "1" }] });
  assertEquals(spec.age_min, 21);
  assertEquals(
    metaReachTargetingSpec({ geo_locations: { countries: ["NG"] } })
      .geo_locations,
    { countries: ["NG"] },
  );
});

Deno.test("TikTok reach swaps ISO countries for TikTok's own numeric ids", () => {
  assertEquals(tiktokLocationIdsAreIso({ location_ids: ["NG"] }), true);
  assertEquals(tiktokLocationIdsAreIso({ location_ids: ["2328926"] }), false);
  const body = buildTikTokAudienceEstimateBody({
    platform: "tiktok",
    verdict: "exact",
    compiledTargeting: { location_ids: ["NG"] },
    connection: { external_account_id: "adv" } as AdConnectionRow,
    providerBudgetCents: 2_000,
  }, ["2328926"]);
  assertEquals(body.location_ids, ["2328926"]);
});

Deno.test("reach stays off until staff switch it on for that app", async () => {
  const off = await fetchProviderAudienceEstimate({
    platform: "meta",
    verdict: "exact",
    compiledTargeting: {},
    connection: { extra: {} } as unknown as AdConnectionRow,
    providerBudgetCents: 2_000,
  });
  assertEquals(off.state, "certification_required");
});

Deno.test("a Host may leave out only its own past guests", () => {
  const ok = validateAudienceSelection({
    raw: { include_keys: [], exclude_keys: [`brand:${BRAND}:guests`] },
    ownerKind: "host",
    planBrandId: BRAND,
  });
  assertEquals(ok.ok && ok.selection.exclude_keys, [`brand:${BRAND}:guests`]);
  const other = validateAudienceSelection({
    raw: {
      exclude_keys: [
        "brand:4238bbbb-0000-4000-8000-000000000002:guests",
      ],
    },
    ownerKind: "host",
    planBrandId: BRAND,
  });
  assertEquals(other.ok ? "" : other.detail, "audience_not_owned");
  // Plans without exclusions keep their exact selection (hash-stable).
  const plain = validateAudienceSelection({
    raw: { include_keys: [] },
    ownerKind: "host",
    planBrandId: BRAND,
  });
  assertEquals(plain.ok && plain.selection, { include_keys: [] });
});
