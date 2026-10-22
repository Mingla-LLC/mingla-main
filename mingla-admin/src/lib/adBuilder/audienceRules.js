/**
 * ISSUE-864 WP4 [Campaign Builder] — A4.f: audience step rules (blueprint
 * §1.3). Countries are first-class today; city+radius is flag-gated on the
 * missing admin-ad-targeting-search proxy (flags.js).
 */

/** OD-5: prefill the live markets, editable. */
export const DEFAULT_COUNTRIES = ["US", "GB", "NG"];

export const COUNTRY_OPTIONS = [
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "NG", label: "Nigeria" },
  { value: "CA", label: "Canada" },
];

export const DEFAULT_AGE_MIN = 18;
export const DEFAULT_AGE_MAX = 65;

/** Gender control → Meta enum (1=male, 2=female; omit for All — no non-binary value documented). */
export const GENDER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "women", label: "Women" },
  { value: "men", label: "Men" },
];

export function metaGendersFor(genderValue) {
  if (genderValue === "women") return [2];
  if (genderValue === "men") return [1];
  return null; // All → omit the field
}

/**
 * The default plan is 70/20/10. The retargeting shortcut turns prospecting
 * off, so the server conserves the same budget across the enabled warm stages
 * in their 20:10 ratio (or gives it all to the only enabled warm stage).
 */
export function stageSplitLabels(stages = {}) {
  const prospecting = stages.prospecting !== false;
  const retarget = stages.retarget !== false;
  const abandoners = stages.abandoners !== false;
  if (prospecting) {
    return { prospecting: "70%", retarget: "20%", abandoners: "10%" };
  }
  if (retarget && abandoners) {
    return { prospecting: "Off", retarget: "67%", abandoners: "33%" };
  }
  return {
    prospecting: "Off",
    retarget: retarget ? "100%" : "Off",
    abandoners: abandoners ? "100%" : "Off",
  };
}

/** A4.f verbatim: Reddit has NO age field at all — render this passthrough note. */
export const REDDIT_AGE_PASSTHROUGH_NOTE =
  "Reddit can't target by age at all — this campaign will reach adults of any age there. If age matters for this creative, exclude Reddit.";

/** A4.f: Advantage+ audience ON caps age_min at 25 (age_max pinned 65) — reject WITH the explanation. */
export const ADVANTAGE_PLUS_AGE_EXPLANATION =
  "Meta's Advantage+ audience is on, which means it treats your age range as a suggestion — and it won't accept a minimum above 25. To target 30+, turn Advantage+ audience off in Advanced (it'll narrow your reach and Meta advises against it).";

/**
 * Validate the audience step. Returns string[] of blocking errors (each with
 * its exact inline message — SC-5).
 */
export function validateAudience({
  countries,
  ageMin,
  ageMax,
  advantagePlusAudience = false,
  stages,
}) {
  const errors = [];
  if (
    stages &&
    stages.prospecting === false &&
    stages.retarget === false &&
    stages.abandoners === false
  ) {
    errors.push("Turn on at least one audience stage.");
  }
  if (!Array.isArray(countries) || countries.length === 0) {
    errors.push("Pick at least one country.");
  }
  const min = Number(ageMin);
  const max = Number(ageMax);
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    errors.push("Age range needs both a minimum and a maximum.");
    return errors;
  }
  if (min > max) {
    errors.push("The minimum age can't be higher than the maximum.");
  }
  if (min < 13 || max > 65) {
    errors.push(
      "Meta's range is 13 to 65+. 65 means 65 and over — there's no band above it.",
    );
  }
  if (advantagePlusAudience && min > 25) {
    errors.push(ADVANTAGE_PLUS_AGE_EXPLANATION);
  }
  return errors;
}
