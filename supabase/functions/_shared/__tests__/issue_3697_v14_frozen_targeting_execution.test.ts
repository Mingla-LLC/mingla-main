import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  compileProviderTargeting,
  providerExecutionTargeting,
} from "../adTargetingCompiler.ts";

const intent = {
  countries: ["NG"],
  cities: [{ name: "Lagos", countryCode: "NG" }],
  radiusKm: 15,
  ageMin: 25,
  ageMax: 44,
  gender: "women" as const,
  interests: [{ name: "Live music" }],
};

const refs = {
  locationIds: { "NG:lagos": "100001" },
  locationCoordinates: {
    "NG:lagos": { latitude: 6.5244, longitude: 3.3792 },
  },
  interestIds: { "live music": "200001" },
};

Deno.test("#3697 frozen targeting is converted to each provider execution shape", () => {
  const meta = compileProviderTargeting("meta", intent, refs);
  assertEquals(
    providerExecutionTargeting(
      "meta",
      meta.audienceIntent,
      meta.compiledTargeting,
    ),
    {
      countries: ["NG"],
      cities: [{
        key: "100001",
        radius: 15,
        distance_unit: "kilometer",
      }],
      age_min: 25,
      age_max: 44,
      genders: [2],
      interests: [{ id: "200001" }],
    },
  );

  const tiktok = compileProviderTargeting("tiktok", intent, refs);
  assertEquals(
    providerExecutionTargeting(
      "tiktok",
      tiktok.audienceIntent,
      tiktok.compiledTargeting,
    ),
    {
      countries: ["NG"],
      location_ids: ["100001"],
      interest_category_ids: ["200001"],
      age_min: 25,
      age_max: 44,
      gender: "GENDER_FEMALE",
    },
  );

  const snapchat = compileProviderTargeting("snapchat", intent, refs);
  assertEquals(snapchat.verdict, "exact");
  assertEquals(
    providerExecutionTargeting(
      "snapchat",
      snapchat.audienceIntent,
      snapchat.compiledTargeting,
    ),
    {
      countries: ["NG"],
      demographics: [{
        min_age: "25",
        max_age: "44",
        genders: ["FEMALE"],
      }],
      resolved_circles: [{
        country_code: "NG",
        latitude: 6.5244,
        longitude: 3.3792,
        radius: 15,
        unit: "kilometer",
      }],
      interests: ["200001"],
    },
  );

  const google = compileProviderTargeting("google", intent, refs);
  assertEquals(google.verdict, "broader");
  assertEquals(google.compiledTargeting.proximity, undefined);
  assertStringIncludes(
    google.wideningSummary.join(" "),
    "does not apply the free-form radius",
  );
  assertEquals(
    providerExecutionTargeting(
      "google",
      google.audienceIntent,
      google.compiledTargeting,
    ),
    {
      countries: ["NG"],
      resolved_locations: [{
        criterion_id: "100001",
        name: "Lagos",
        canonical_name: "Lagos",
        country_code: "NG",
        target_type: "City",
      }],
      age_min: 25,
      age_max: 44,
      genders: ["FEMALE"],
      audiences: ["200001"],
    },
  );

  const reddit = compileProviderTargeting("reddit", intent);
  assertEquals(
    providerExecutionTargeting(
      "reddit",
      reddit.audienceIntent,
      reddit.compiledTargeting,
    ),
    {
      countries: ["NG"],
      genders: ["FEMALE"],
      passthrough: { reddit: { interests: ["Live music"] } },
    },
  );
});

Deno.test("#3697 provider writes replace caller targeting with the frozen snapshot", async () => {
  const create = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  const bind = create.indexOf(
    "frozenExecutionTargeting = providerExecutionTargeting",
  );
  const replace = create.indexOf("body.targeting = frozenExecutionTargeting");
  const firstWrite = create.indexOf(
    "await googleCreateDemandGenVideoCampaign(",
  );
  assert(bind > 0);
  assert(replace > bind);
  assert(firstWrite > replace);
  assertStringIncludes(create, "targetingSnapshot.compiled_targeting");
  assertStringIncludes(create, "parseFrozenGoogleLocations");
  assertStringIncludes(create, "targetingS.resolved_circles");
  assertStringIncludes(plan, "withServerTargetingCoordinates");
  assertStringIncludes(plan, "forwardGeocodeText");
});

Deno.test("#3697 targeting search authorizes Host planning without exposing consumer lane", async () => {
  const search = await Deno.readTextFile(
    new URL("../../admin-ad-targeting-search/index.ts", import.meta.url),
  );
  const auth = search.indexOf("supabase.auth.getUser");
  const permission = search.indexOf('p_action: "plan"');
  const validation = search.indexOf("// ── Input validation");
  assert(auth > 0);
  assert(permission > auth);
  assert(validation > permission);
  assertStringIncludes(search, 'requestedLane !== "business"');
  assertStringIncludes(search, "ad_can_host_action");
  assertStringIncludes(search, 'return json({ error: "forbidden" }, 403)');
});

Deno.test("#3697 Ari resolves the same granular target and describes end settlement honestly", async () => {
  const ari = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  const propose = ari.slice(
    ari.indexOf("const proposeAdPlan"),
    ari.indexOf("const approveAdPlan"),
  );
  assertStringIncludes(propose, "resolveAriTargetingRefs");
  assertStringIncludes(propose, "cities:");
  assertStringIncludes(propose, "radius_km");
  assertStringIncludes(propose, "interests:");
  assertStringIncludes(propose, "gender:");
  assertStringIncludes(propose, "refs_by_platform: targetingRefs");
  assertStringIncludes(ari, "providerExecutionTargeting(");
  assertStringIncludes(
    ari,
    "Unspent Ads credit settles only after every provider confirms stop and final spend",
  );
  assert(!ari.includes("End a Host ad campaign and return unspent Ads credit"));
});
