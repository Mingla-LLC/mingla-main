/**
 * Issue #3697 v1.4 provider targeting compiler.
 *
 * The audience intent is currency-free on purpose. Each selected provider gets
 * a frozen compiled payload plus an explicit verdict. Unsupported constraints
 * are never omitted silently: a representable wider plan is `broader`, missing
 * provider identity is `check_required`, and an unusable plan is `unavailable`.
 */

import type { Platform } from "./adChannelCore.ts";

export type TargetingVerdict =
  | "exact"
  | "broader"
  | "unavailable"
  | "check_required";

export type AudienceCity = {
  name: string;
  countryCode: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
};

export type AudienceInterest = { name: string };

export type AdAudienceIntent = {
  countries: string[];
  cities?: AudienceCity[];
  radiusKm?: number;
  ageMin?: number;
  ageMax?: number;
  gender?: "all" | "men" | "women";
  interests?: AudienceInterest[];
};

export type ProviderTargetingRefs = {
  /** `${CC}:${normalized city name}` -> provider-native location id/key. */
  locationIds?: Record<string, string>;
  /** normalized interest name -> provider-native id/category. */
  interestIds?: Record<string, string>;
};

export type TargetingCompileResult = {
  platform: Platform;
  verdict: TargetingVerdict;
  audienceIntent: Record<string, unknown>;
  compiledTargeting: Record<string, unknown>;
  wideningSummary: string[];
  checksRequired: string[];
  compilerVersion: "v1.4.0";
};

const TIKTOK_AGE_BUCKETS = [
  { id: "AGE_13_17", min: 13, max: 17 },
  { id: "AGE_18_24", min: 18, max: 24 },
  { id: "AGE_25_34", min: 25, max: 34 },
  { id: "AGE_35_44", min: 35, max: 44 },
  { id: "AGE_45_54", min: 45, max: 54 },
  { id: "AGE_55_100", min: 55, max: 100 },
] as const;

const GOOGLE_AGE_BUCKETS = [
  { id: "AGE_RANGE_18_24", min: 18, max: 24 },
  { id: "AGE_RANGE_25_34", min: 25, max: 34 },
  { id: "AGE_RANGE_35_44", min: 35, max: 44 },
  { id: "AGE_RANGE_45_54", min: 45, max: 54 },
  { id: "AGE_RANGE_55_64", min: 55, max: 64 },
  { id: "AGE_RANGE_65_UP", min: 65, max: 100 },
] as const;

function normName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function cityKey(city: AudienceCity): string {
  return `${city.countryCode.trim().toUpperCase()}:${normName(city.name)}`;
}

function cleanIntent(input: AdAudienceIntent): AdAudienceIntent {
  const countries = [
    ...new Set(
      (input.countries ?? []).map((value) => value.trim().toUpperCase()).filter(
        (value) => /^[A-Z]{2}$/.test(value),
      ),
    ),
  ];
  const cities = (input.cities ?? []).map((city) => ({
    ...city,
    name: city.name.trim(),
    countryCode: city.countryCode.trim().toUpperCase(),
  })).filter((city) => city.name && /^[A-Z]{2}$/.test(city.countryCode));
  const interests = (input.interests ?? []).map((interest) => ({
    name: interest.name.trim(),
  })).filter((interest) => interest.name);
  return {
    countries,
    ...(cities.length ? { cities } : {}),
    ...(Number.isFinite(input.radiusKm) ? { radiusKm: input.radiusKm } : {}),
    ...(Number.isInteger(input.ageMin) ? { ageMin: input.ageMin } : {}),
    ...(Number.isInteger(input.ageMax) ? { ageMax: input.ageMax } : {}),
    gender: input.gender ?? "all",
    ...(interests.length ? { interests } : {}),
  };
}

function bucketedAge(
  min: number | undefined,
  max: number | undefined,
  buckets: ReadonlyArray<{ id: string; min: number; max: number }>,
): { ids: string[]; broader: boolean } {
  if (min == null && max == null) return { ids: [], broader: false };
  const requestedMin = min ?? buckets[0].min;
  const requestedMax = max ?? buckets[buckets.length - 1].max;
  const selected = buckets.filter((bucket) =>
    bucket.max >= requestedMin && bucket.min <= requestedMax
  );
  return {
    ids: selected.map((bucket) => bucket.id),
    broader: selected.length > 0 &&
      (selected[0].min !== requestedMin ||
        selected[selected.length - 1].max !== requestedMax),
  };
}

function compiledLocations(
  cities: AudienceCity[],
  refs: ProviderTargetingRefs,
): { ids: string[]; missing: string[] } {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const city of cities) {
    const id = refs.locationIds?.[cityKey(city)]?.trim();
    if (id) ids.push(id);
    else missing.push(cityKey(city));
  }
  return { ids, missing };
}

function compiledInterests(
  interests: AudienceInterest[],
  refs: ProviderTargetingRefs,
): { ids: string[]; missing: string[] } {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const interest of interests) {
    const key = normName(interest.name);
    const id = refs.interestIds?.[key]?.trim();
    if (id) ids.push(id);
    else missing.push(interest.name);
  }
  return { ids, missing };
}

export function compileProviderTargeting(
  platform: Platform,
  rawIntent: AdAudienceIntent,
  refs: ProviderTargetingRefs = {},
): TargetingCompileResult {
  const intent = cleanIntent(rawIntent);
  const wideningSummary: string[] = [];
  const checksRequired: string[] = [];
  const compiled: Record<string, unknown> = {};
  const cities = intent.cities ?? [];
  const interests = intent.interests ?? [];

  if (intent.countries.length === 0) {
    return {
      platform,
      verdict: "unavailable",
      audienceIntent: intent as unknown as Record<string, unknown>,
      compiledTargeting: {},
      wideningSummary: ["At least one explicit target country is required."],
      checksRequired,
      compilerVersion: "v1.4.0",
    };
  }

  if (platform === "meta") {
    compiled.geo_locations = { countries: intent.countries };
    if (cities.length) {
      const locations = compiledLocations(cities, refs);
      if (locations.missing.length) {
        checksRequired.push(
          `Resolve Meta city keys for: ${locations.missing.join(", ")}.`,
        );
      } else {
        (compiled.geo_locations as Record<string, unknown>).cities = locations
          .ids.map((key) => ({
            key,
            ...(intent.radiusKm != null
              ? {
                radius: intent.radiusKm,
                distance_unit: "kilometer",
              }
              : {}),
          }));
      }
    }
    if (intent.radiusKm != null && !cities.length) {
      checksRequired.push(
        "Meta radius targeting needs at least one verified city center.",
      );
    }
    if (intent.ageMin != null) compiled.age_min = intent.ageMin;
    if (intent.ageMax != null) compiled.age_max = intent.ageMax;
    if (intent.gender === "men") compiled.genders = [1];
    if (intent.gender === "women") compiled.genders = [2];
    if (interests.length) {
      const resolved = compiledInterests(interests, refs);
      if (resolved.missing.length) {
        checksRequired.push(
          `Resolve Meta interest IDs for: ${resolved.missing.join(", ")}.`,
        );
      } else {
        compiled.flexible_spec = [{
          interests: resolved.ids.map((id) => ({ id })),
        }];
      }
    }
  } else if (platform === "tiktok") {
    const locations = compiledLocations(cities, refs);
    if (cities.length && locations.missing.length) {
      checksRequired.push(
        `Resolve TikTok location IDs for: ${locations.missing.join(", ")}.`,
      );
    }
    compiled.location_ids = cities.length ? locations.ids : intent.countries;
    if (intent.radiusKm != null) {
      wideningSummary.push(
        "TikTok cannot preserve the requested free-form radius; the resolved location boundary is wider.",
      );
    }
    const age = bucketedAge(intent.ageMin, intent.ageMax, TIKTOK_AGE_BUCKETS);
    if (age.ids.length) compiled.age_groups = age.ids;
    if (age.broader) {
      wideningSummary.push(
        "TikTok age buckets extend beyond the requested numeric age range.",
      );
    }
    compiled.gender = intent.gender === "men"
      ? "MALE"
      : intent.gender === "women"
      ? "FEMALE"
      : "GENDER_UNLIMITED";
    if (interests.length) {
      const resolved = compiledInterests(interests, refs);
      if (resolved.missing.length) {
        checksRequired.push(
          `Resolve TikTok interest category IDs for: ${
            resolved.missing.join(", ")
          }.`,
        );
      } else compiled.interest_category_ids = resolved.ids;
    }
  } else if (platform === "snapchat") {
    compiled.country_codes = intent.countries;
    if (cities.length) {
      const invalid = cities.filter((city) =>
        !Number.isFinite(city.latitude) || !Number.isFinite(city.longitude)
      );
      if (invalid.length) {
        checksRequired.push(
          `Resolve Snapchat coordinates for: ${
            invalid.map(cityKey).join(", ")
          }.`,
        );
      } else {
        compiled.geo_circles = cities.map((city) => ({
          latitude: city.latitude,
          longitude: city.longitude,
          radius_km: city.radiusKm ?? intent.radiusKm ?? 10,
        }));
      }
    } else if (intent.radiusKm != null) {
      checksRequired.push(
        "Snapchat radius targeting needs at least one verified center.",
      );
    }
    if (intent.ageMin != null) compiled.age_min = intent.ageMin;
    if (intent.ageMax != null) compiled.age_max = intent.ageMax;
    compiled.gender = intent.gender ?? "all";
    if (interests.length) {
      const resolved = compiledInterests(interests, refs);
      if (resolved.missing.length) {
        checksRequired.push(
          `Resolve Snapchat interest category IDs for: ${
            resolved.missing.join(", ")
          }.`,
        );
      } else compiled.interest_category_ids = resolved.ids;
    }
  } else if (platform === "google") {
    const locations = compiledLocations(cities, refs);
    if (cities.length && locations.missing.length) {
      checksRequired.push(
        `Resolve Google geo target constants for: ${
          locations.missing.join(", ")
        }.`,
      );
    }
    compiled.location_ids = cities.length ? locations.ids : intent.countries;
    if (intent.radiusKm != null) {
      const invalid = cities.filter((city) =>
        !Number.isFinite(city.latitude) || !Number.isFinite(city.longitude)
      );
      if (!cities.length || invalid.length) {
        checksRequired.push(
          "Google proximity targeting needs a verified center.",
        );
      } else {
        compiled.proximity = cities.map((city) => ({
          latitude: city.latitude,
          longitude: city.longitude,
          radius_km: city.radiusKm ?? intent.radiusKm,
        }));
      }
    }
    const age = bucketedAge(intent.ageMin, intent.ageMax, GOOGLE_AGE_BUCKETS);
    if (age.ids.length) compiled.age_ranges = age.ids;
    if (age.broader || (intent.ageMin != null && intent.ageMin < 18)) {
      wideningSummary.push(
        "Google demographic buckets extend beyond the requested numeric age range.",
      );
    }
    compiled.gender_types = intent.gender === "men"
      ? ["MALE"]
      : intent.gender === "women"
      ? ["FEMALE"]
      : [];
    if (interests.length) {
      const resolved = compiledInterests(interests, refs);
      if (resolved.missing.length) {
        checksRequired.push(
          `Resolve Google audience IDs for: ${resolved.missing.join(", ")}.`,
        );
      } else compiled.audience_ids = resolved.ids;
    }
  } else {
    compiled.country_codes = intent.countries;
    if (cities.length) {
      wideningSummary.push(
        "Reddit cannot preserve city targeting; the selected countries are broader.",
      );
    }
    if (intent.radiusKm != null) {
      wideningSummary.push(
        "Reddit cannot preserve radius targeting; the selected countries are broader.",
      );
    }
    if (intent.ageMin != null || intent.ageMax != null) {
      wideningSummary.push(
        "Reddit cannot preserve the requested numeric age range.",
      );
    }
    compiled.gender = intent.gender ?? "all";
    if (interests.length) {
      compiled.interests = interests.map((item) => item.name);
    }
  }

  const verdict: TargetingVerdict = checksRequired.length
    ? "check_required"
    : wideningSummary.length
    ? "broader"
    : "exact";
  return {
    platform,
    verdict,
    audienceIntent: intent as unknown as Record<string, unknown>,
    compiledTargeting: compiled,
    wideningSummary,
    checksRequired,
    compilerVersion: "v1.4.0",
  };
}

export function compileTargetingPlan(input: {
  platforms: Platform[];
  intent: AdAudienceIntent;
  refsByPlatform?: Partial<Record<Platform, ProviderTargetingRefs>>;
}): TargetingCompileResult[] {
  return [...new Set(input.platforms)].map((platform) =>
    compileProviderTargeting(
      platform,
      input.intent,
      input.refsByPlatform?.[platform] ?? {},
    )
  );
}
