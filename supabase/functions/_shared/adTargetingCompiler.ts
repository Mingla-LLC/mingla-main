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
  /** `${CC}:${normalized city name}` -> server-resolved coordinates. */
  locationCoordinates?: Record<
    string,
    { latitude: number; longitude: number } | null
  >;
  /** normalized interest name -> provider-native id/category. */
  interestIds?: Record<string, string>;
  /**
   * Provider audience ids loaded server-side from public.ad_audiences.
   * These fields are deliberately refs, not browser audience intent: callers
   * cannot smuggle an arbitrary Custom Audience / Segment id into a plan.
   */
  includeAudienceIds?: string[];
  excludeAudienceIds?: string[];
  /** Prospecting only. Meta may treat the literal targeting as suggestions. */
  advantageAudience?: boolean;
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

export type AdCampaignTargetingKind = "web" | "native_app";

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

function intentValidationIssues(input: AdAudienceIntent): string[] {
  const raw = input as unknown as Record<string, unknown>;
  const issues: string[] = [];
  const countries = raw.countries;
  if (!Array.isArray(countries) || countries.length === 0) {
    issues.push("At least one explicit target country is required.");
  } else if (
    countries.some((value) =>
      typeof value !== "string" || !/^[A-Za-z]{2}$/.test(value.trim())
    )
  ) {
    issues.push("Every target country must be a two-letter ISO code.");
  }

  const cities = raw.cities;
  if (cities !== undefined && !Array.isArray(cities)) {
    issues.push("Target cities must be a list.");
  } else if (Array.isArray(cities)) {
    for (const value of cities) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        issues.push("Every target city must be an object.");
        continue;
      }
      const city = value as Record<string, unknown>;
      if (typeof city.name !== "string" || city.name.trim().length === 0) {
        issues.push("Every target city needs a name.");
      }
      if (
        typeof city.countryCode !== "string" ||
        !/^[A-Za-z]{2}$/.test(city.countryCode.trim())
      ) {
        issues.push("Every target city needs a two-letter country code.");
      }
      const latitude = city.latitude;
      const longitude = city.longitude;
      if ((latitude === undefined) !== (longitude === undefined)) {
        issues.push(
          "A target city coordinate needs both latitude and longitude.",
        );
      } else if (latitude !== undefined && longitude !== undefined) {
        if (
          typeof latitude !== "number" || !Number.isFinite(latitude) ||
          latitude < -90 || latitude > 90 ||
          typeof longitude !== "number" || !Number.isFinite(longitude) ||
          longitude < -180 || longitude > 180
        ) {
          issues.push("Target city coordinates are outside valid bounds.");
        }
      }
      if (
        city.radiusKm !== undefined &&
        (typeof city.radiusKm !== "number" ||
          !Number.isFinite(city.radiusKm) || city.radiusKm <= 0)
      ) {
        issues.push("Every city radius must be a positive distance.");
      }
    }
  }

  if (
    raw.radiusKm !== undefined &&
    (typeof raw.radiusKm !== "number" || !Number.isFinite(raw.radiusKm) ||
      raw.radiusKm <= 0)
  ) {
    issues.push("The target radius must be a positive distance.");
  }
  for (const key of ["ageMin", "ageMax"] as const) {
    const value = raw[key];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isInteger(value) || value < 13 ||
        value > 100)
    ) {
      issues.push(`${key} must be a whole number from 13 through 100.`);
    }
  }
  if (
    typeof raw.ageMin === "number" && typeof raw.ageMax === "number" &&
    raw.ageMin > raw.ageMax
  ) {
    issues.push("The minimum age cannot exceed the maximum age.");
  }
  if (
    raw.gender !== undefined &&
    !["all", "men", "women"].includes(String(raw.gender))
  ) {
    issues.push("Target gender must be all, men, or women.");
  }

  const interests = raw.interests;
  if (interests !== undefined && !Array.isArray(interests)) {
    issues.push("Target interests must be a list.");
  } else if (
    Array.isArray(interests) &&
    interests.some((value) =>
      value === null || typeof value !== "object" || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).name !== "string" ||
      String((value as Record<string, unknown>).name).trim().length === 0
    )
  ) {
    issues.push("Every target interest needs a name.");
  }

  return [...new Set(issues)];
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

function cleanAudienceIds(value: string[] | undefined): string[] {
  return [...new Set((value ?? []).map((id) => id.trim()).filter(Boolean))];
}

function coordinatesForCity(
  city: AudienceCity,
  refs: ProviderTargetingRefs,
): { latitude: number; longitude: number } | null {
  const coordinateKey = cityKey(city);
  if (
    refs.locationCoordinates &&
    Object.prototype.hasOwnProperty.call(
      refs.locationCoordinates,
      coordinateKey,
    )
  ) {
    const resolved = refs.locationCoordinates[coordinateKey];
    if (
      resolved && Number.isFinite(resolved.latitude) &&
      Number.isFinite(resolved.longitude)
    ) return resolved;
    return null;
  }
  if (
    Number.isFinite(city.latitude) && Number.isFinite(city.longitude)
  ) {
    return {
      latitude: city.latitude as number,
      longitude: city.longitude as number,
    };
  }
  return null;
}

export function compileProviderTargeting(
  platform: Platform,
  rawIntent: AdAudienceIntent,
  refs: ProviderTargetingRefs = {},
  campaignKind: AdCampaignTargetingKind = "web",
): TargetingCompileResult {
  const validationIssues = intentValidationIssues(rawIntent);
  if (validationIssues.length > 0) {
    return {
      platform,
      verdict: "unavailable",
      audienceIntent: {},
      compiledTargeting: {},
      wideningSummary: validationIssues,
      checksRequired: [],
      compilerVersion: "v1.4.0",
    };
  }
  const intent = cleanIntent(rawIntent);
  const wideningSummary: string[] = [];
  const checksRequired: string[] = [];
  const compiled: Record<string, unknown> = {};
  const cities = intent.cities ?? [];
  const interests = intent.interests ?? [];
  const includeAudienceIds = cleanAudienceIds(refs.includeAudienceIds);
  const excludeAudienceIds = cleanAudienceIds(refs.excludeAudienceIds);

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
    if (includeAudienceIds.length) {
      compiled.custom_audiences = includeAudienceIds.map((id) => ({ id }));
    }
    if (excludeAudienceIds.length) {
      compiled.excluded_custom_audiences = excludeAudienceIds.map((id) => ({
        id,
      }));
    }
    // The Meta adapter already defaults ordinary targeting to literal
    // (advantage_audience: 0). Emit an override only for the prospecting stage
    // where #3697 explicitly turns Advantage+ suggestions on; keeping the
    // default absent preserves frozen pre-stage execution snapshots.
    if (refs.advantageAudience === true) {
      compiled.targeting_automation = { advantage_audience: 1 };
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
      ? "GENDER_MALE"
      : intent.gender === "women"
      ? "GENDER_FEMALE"
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
    if (includeAudienceIds.length) compiled.audience_ids = includeAudienceIds;
    if (excludeAudienceIds.length) {
      compiled.excluded_audience_ids = excludeAudienceIds;
    }
  } else if (platform === "snapchat") {
    compiled.country_codes = intent.countries;
    if (cities.length) {
      const coordinates = cities.map((city) => coordinatesForCity(city, refs));
      const invalid = cities.filter((_, index) => coordinates[index] === null);
      if (invalid.length) {
        checksRequired.push(
          `Resolve Snapchat coordinates for: ${
            invalid.map(cityKey).join(", ")
          }.`,
        );
      } else {
        compiled.geo_circles = cities.map((city, index) => ({
          country_code: city.countryCode,
          latitude: coordinates[index]!.latitude,
          longitude: coordinates[index]!.longitude,
          radius: city.radiusKm ?? intent.radiusKm ?? 10,
          unit: "kilometer",
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
    if (includeAudienceIds.length) {
      compiled.segment_include_ids = includeAudienceIds;
    }
    if (excludeAudienceIds.length) {
      compiled.segment_exclude_ids = excludeAudienceIds;
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
    if (intent.radiusKm != null && campaignKind === "native_app") {
      wideningSummary.push(
        "Google App campaigns preserve the selected location but not the free-form radius as a hard proximity filter.",
      );
    } else if (intent.radiusKm != null) {
      wideningSummary.push(
        "Google Search preserves the selected city but the current create path does not apply the free-form radius as a hard proximity filter.",
      );
    }
    if (campaignKind === "native_app") {
      if (intent.ageMin != null || intent.ageMax != null) {
        wideningSummary.push(
          "Google App campaigns optimize installs across eligible ages; the numeric age constraint is not a hard delivery filter.",
        );
      }
      if (intent.gender !== "all") {
        wideningSummary.push(
          "Google App campaigns do not preserve the selected gender as a hard delivery filter.",
        );
      }
      if (interests.length) {
        wideningSummary.push(
          "Google App campaigns use audience signals for learning, not the selected interests as hard delivery filters.",
        );
      }
    } else {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
      asRecord(item) !== null
    )
    : [];
}

/**
 * Convert one frozen compiler snapshot into the legacy create endpoint shape.
 * Real provider writes use this server-side result instead of caller-supplied
 * targeting, so the exact frozen snapshot is what reaches the adapter.
 */
export function providerExecutionTargeting(
  platform: Platform,
  rawIntent: Record<string, unknown>,
  compiled: Record<string, unknown>,
): Record<string, unknown> {
  const countries = Array.isArray(rawIntent.countries)
    ? rawIntent.countries.map(String)
    : [];
  const cities = arrayOfRecords(rawIntent.cities);
  const ageMin = typeof rawIntent.ageMin === "number"
    ? rawIntent.ageMin
    : undefined;
  const ageMax = typeof rawIntent.ageMax === "number"
    ? rawIntent.ageMax
    : undefined;

  if (platform === "meta") {
    const geo = asRecord(compiled.geo_locations) ?? {};
    const flexible = arrayOfRecords(compiled.flexible_spec);
    const firstFlexible = flexible[0] ?? {};
    return {
      countries,
      ...(Array.isArray(geo.cities) ? { cities: geo.cities } : {}),
      ...(typeof compiled.age_min === "number"
        ? { age_min: compiled.age_min }
        : {}),
      ...(typeof compiled.age_max === "number"
        ? { age_max: compiled.age_max }
        : {}),
      ...(Array.isArray(compiled.genders) ? { genders: compiled.genders } : {}),
      ...(Array.isArray(firstFlexible.interests)
        ? { interests: firstFlexible.interests }
        : {}),
      ...(Array.isArray(compiled.custom_audiences)
        ? { custom_audiences: compiled.custom_audiences }
        : {}),
      ...(Array.isArray(compiled.excluded_custom_audiences)
        ? { excluded_custom_audiences: compiled.excluded_custom_audiences }
        : {}),
      ...(asRecord(compiled.targeting_automation)
        ? { targeting_automation: compiled.targeting_automation }
        : {}),
    };
  }

  if (platform === "tiktok") {
    return {
      countries,
      ...(cities.length > 0 && Array.isArray(compiled.location_ids)
        ? { location_ids: compiled.location_ids }
        : {}),
      ...(Array.isArray(compiled.interest_category_ids)
        ? { interest_category_ids: compiled.interest_category_ids }
        : {}),
      ...(ageMin !== undefined ? { age_min: ageMin } : {}),
      ...(ageMax !== undefined ? { age_max: ageMax } : {}),
      ...(typeof compiled.gender === "string"
        ? { gender: compiled.gender }
        : {}),
      ...(Array.isArray(compiled.audience_ids)
        ? { audience_ids: compiled.audience_ids }
        : {}),
      ...(Array.isArray(compiled.excluded_audience_ids)
        ? { excluded_audience_ids: compiled.excluded_audience_ids }
        : {}),
    };
  }

  if (platform === "snapchat") {
    const gender = rawIntent.gender === "women"
      ? ["FEMALE"]
      : rawIntent.gender === "men"
      ? ["MALE"]
      : null;
    const demographic = {
      min_age: String(ageMin ?? 18),
      ...(ageMax !== undefined && ageMax < 65
        ? { max_age: String(ageMax) }
        : {}),
      ...(gender ? { genders: gender } : {}),
    };
    return {
      countries,
      demographics: [demographic],
      ...(Array.isArray(compiled.geo_circles)
        ? { resolved_circles: compiled.geo_circles }
        : {}),
      ...(Array.isArray(compiled.interest_category_ids)
        ? { interests: compiled.interest_category_ids }
        : {}),
      ...(Array.isArray(compiled.segment_include_ids)
        ? { segment_include_ids: compiled.segment_include_ids }
        : {}),
      ...(Array.isArray(compiled.segment_exclude_ids)
        ? { segment_exclude_ids: compiled.segment_exclude_ids }
        : {}),
    };
  }

  if (platform === "google") {
    const ids = Array.isArray(compiled.location_ids)
      ? compiled.location_ids.map(String)
      : [];
    const resolvedLocations = cities.map((city, index) => ({
      criterion_id: ids[index],
      name: String(city.name ?? ""),
      canonical_name: String(city.name ?? ""),
      country_code: String(city.countryCode ?? "").toUpperCase(),
      target_type: "City",
    })).filter((city) => city.criterion_id && city.name && city.country_code);
    return {
      countries,
      ...(resolvedLocations.length > 0
        ? { resolved_locations: resolvedLocations }
        : {}),
      ...(ageMin !== undefined && ageMin > 18 ? { age_min: ageMin } : {}),
      ...(ageMax !== undefined && ageMax < 65 ? { age_max: ageMax } : {}),
      ...(Array.isArray(compiled.gender_types) &&
          compiled.gender_types.length > 0
        ? { genders: compiled.gender_types }
        : {}),
      ...(Array.isArray(compiled.audience_ids)
        ? { audiences: compiled.audience_ids }
        : {}),
    };
  }

  const gender = rawIntent.gender === "women"
    ? ["FEMALE"]
    : rawIntent.gender === "men"
    ? ["MALE"]
    : null;
  return {
    countries,
    ...(gender ? { genders: gender } : {}),
    ...(Array.isArray(compiled.interests) && compiled.interests.length > 0
      ? { passthrough: { reddit: { interests: compiled.interests } } }
      : {}),
  };
}

export function compileTargetingPlan(input: {
  platforms: Platform[];
  intent: AdAudienceIntent;
  refsByPlatform?: Partial<Record<Platform, ProviderTargetingRefs>>;
  campaignKind?: AdCampaignTargetingKind;
}): TargetingCompileResult[] {
  return [...new Set(input.platforms)].map((platform) =>
    compileProviderTargeting(
      platform,
      input.intent,
      input.refsByPlatform?.[platform] ?? {},
      input.campaignKind ?? "web",
    )
  );
}
