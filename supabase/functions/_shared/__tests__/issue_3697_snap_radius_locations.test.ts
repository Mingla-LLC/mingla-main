/**
 * Issue #3697: Snapchat radius targeting uses Snap's documented
 * targeting.locations shape
 * (https://developers.snap.com/api/marketing-api/Ads-API/targeting).
 *
 * Live bug: nesting circles inside targeting.geos[].circles with lowercase
 * "mile"/"kilometer" units made POST campaigns/{id}/adsquads fail with HTTP 400
 * "Request body can not be correctly processed". Fails on revert of the
 * snapchat.ts geo builder.
 */

// adChannel.ts owns the adapter registry and forms a cycle with the leaf
// modules; evaluate it first (as the edge-fn entrypoints do).
import "../adChannel.ts";
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { AdApiError } from "../adChannelCore.ts";
import {
  buildSnapchatAdSquadBody,
  type SnapchatAdSquadSpec,
  type SnapchatCircleGeo,
} from "../snapchat.ts";
import { buildSnapAudienceSizeBody } from "../adProviderEstimate.ts";

const LAGOS: SnapchatCircleGeo = {
  country_code: "NG",
  latitude: 6.4550,
  longitude: 3.3841,
  radius: 48,
  unit: "kilometer",
};

function spec(over: Partial<SnapchatAdSquadSpec> = {}): SnapchatAdSquadSpec {
  return {
    name: "Lagos — ad squad",
    optimizationGoal: "SWIPES",
    countries: ["NG"],
    ...over,
  };
}

function targetingOf(body: Record<string, unknown>): Record<string, unknown> {
  return body.targeting as Record<string, unknown>;
}

Deno.test("#3697 circles ride in targeting.locations with uppercase units + INCLUDE", () => {
  const targeting = targetingOf(
    buildSnapchatAdSquadBody("camp-id", spec({ circles: [LAGOS] })),
  );
  assertEquals(targeting.geos, [{ country_code: "ng" }]);
  assertEquals(targeting.locations, [{
    circles: [{
      latitude: 6.4550,
      longitude: 3.3841,
      radius: 48,
      unit: "KILOMETERS",
    }],
    operation: "INCLUDE",
  }]);
  const miles = targetingOf(
    buildSnapchatAdSquadBody(
      "camp-id",
      spec({ circles: [{ ...LAGOS, radius: 30, unit: "mile" }] }),
    ),
  );
  const circle = ((miles.locations as Record<string, unknown>[])[0]
    .circles as Record<string, unknown>[])[0];
  assertEquals(circle.unit, "MILES");
});

Deno.test("#3697 no circle is ever nested inside targeting.geos", () => {
  const targeting = targetingOf(
    buildSnapchatAdSquadBody(
      "camp-id",
      spec({
        countries: ["NG", "GB"],
        circles: [LAGOS, { ...LAGOS, country_code: "GH", latitude: 5.6 }],
      }),
    ),
  );
  const geos = targeting.geos as Record<string, unknown>[];
  for (const geo of geos) {
    assertEquals(Object.keys(geo), ["country_code"]);
  }
  // Picked countries kept; a circle's own country is included.
  assertEquals(geos, [
    { country_code: "ng" },
    { country_code: "gb" },
    { country_code: "gh" },
  ]);
  assertEquals(
    ((targeting.locations as Record<string, unknown>[])[0].circles as unknown[])
      .length,
    2,
  );
});

Deno.test("#3697 no circles means no targeting.locations key", () => {
  const targeting = targetingOf(buildSnapchatAdSquadBody("camp-id", spec()));
  assertEquals(targeting.geos, [{ country_code: "ng" }]);
  assert(!("locations" in targeting), "locations must be omitted");
  const junkOnly = targetingOf(
    buildSnapchatAdSquadBody(
      "camp-id",
      spec({ circles: [{ ...LAGOS, latitude: NaN }] }),
    ),
  );
  assert(!("locations" in junkOnly), "junk circles never produce locations");
});

Deno.test("#3697 an out-of-range radius is refused, never sent", () => {
  for (
    const bad of [
      { ...LAGOS, radius: 101, unit: "kilometer" }, // > 100,000 m
      { ...LAGOS, radius: 63, unit: "mile" }, // > 100,000 m
      { ...LAGOS, radius: 0.05, unit: "kilometer" }, // < 96 m
    ]
  ) {
    const err = assertThrows(
      () => buildSnapchatAdSquadBody("camp-id", spec({ circles: [bad] })),
      AdApiError,
    );
    assertEquals(err.code, "targeting_circle_radius_out_of_range");
  }
  // Boundaries inside the span are accepted.
  buildSnapchatAdSquadBody(
    "camp-id",
    spec({ circles: [{ ...LAGOS, radius: 100 }] }),
  );
  buildSnapchatAdSquadBody(
    "camp-id",
    spec({ circles: [{ ...LAGOS, radius: 62, unit: "mile" }] }),
  );
});

Deno.test("#3697 audience-size estimate sends the same documented shape", () => {
  const body = buildSnapAudienceSizeBody(
    {
      platform: "snapchat",
      verdict: "available",
      providerBudgetCents: 1000,
      compiledTargeting: { country_codes: ["NG"], geo_circles: [LAGOS] },
    } as unknown as Parameters<typeof buildSnapAudienceSizeBody>[0],
  );
  const targeting = body.ad_squad.targeting as Record<string, unknown>;
  assertEquals(targeting.geos, [{ country_code: "ng" }]);
  assertEquals(targeting.locations, [{
    circles: [{
      latitude: 6.4550,
      longitude: 3.3841,
      radius: 48,
      unit: "KILOMETERS",
    }],
    operation: "INCLUDE",
  }]);
});
