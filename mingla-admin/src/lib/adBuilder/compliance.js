/**
 * ISSUE-986 [Campaign Builder platform picker] — the special-ad-category
 * COMPLIANCE guard (surfaced by the ISSUE-979 Bug-3 discovery).
 *
 * The hazard: a special ad category (Housing / Employment / Financial /
 * Politics) is a LEGAL declaration the ad platform must enforce. ONLY Meta has
 * a special-ad-category field on its create API (`special_ad_categories`) —
 * TikTok, Snapchat, Reddit and Google have NO such field (payload.js documents
 * this per-branch; admin-ad-create-campaign's documentComplianceDrop records
 * the drop server-side). So a special-category ad built on any of those four
 * would run UN-DECLARED — an account-integrity / legal exposure.
 *
 * The rule established here: when a special ad category is selected, the four
 * platforms that cannot enforce it are excluded from the buildable channel set
 * WITH a plain-English reason (never silently). Meta stays. The picker warns;
 * the effective channel set drops the four; a special-category ad can never
 * silently create on a platform that can't declare it.
 */

import { PLATFORM_LABELS } from "./channelPlan.js";
import { SPECIAL_AD_CATEGORIES } from "./policyLinter.js";

/**
 * The only platforms whose create API can DECLARE a special ad category. Meta
 * carries `special_ad_categories`; the other four have no equivalent field
 * (see payload.js + admin-ad-create-campaign documentComplianceDrop).
 */
export const SPECIAL_CATEGORY_CAPABLE_PLATFORMS = ["meta"];

/** True when this special ad category is a real declaration (not "none"). */
export function isSpecialCategoryActive(specialAdCategory) {
  return Boolean(specialAdCategory) && specialAdCategory !== "NONE" && specialAdCategory !== "";
}

/** True when the platform's create API can declare/enforce a special ad category. */
export function platformCanDeclareSpecialCategory(platform) {
  return SPECIAL_CATEGORY_CAPABLE_PLATFORMS.includes(platform);
}

/** Human label for a special-ad-category value (from the policy selector). */
export function specialCategoryLabel(specialAdCategory) {
  const found = SPECIAL_AD_CATEGORIES.find((c) => c.value === specialAdCategory);
  return found?.label ?? specialAdCategory;
}

/**
 * The plain-English reason a platform is excluded because a special ad category
 * is active and the platform cannot declare it.
 */
export function complianceExclusionReason(specialAdCategory, platform) {
  const label = specialCategoryLabel(specialAdCategory);
  const name = PLATFORM_LABELS[platform] ?? platform;
  return (
    `${name} can't declare the "${label}" special ad category — only Meta can. ` +
    `Building here would run an undeclared special-category ad (an account-integrity risk), so it's excluded. ` +
    `Set the category back to "None", or build Meta only.`
  );
}

/**
 * Given the candidate platforms and the active special ad category, the map of
 * platform → exclusion reason for every platform that must be dropped for
 * compliance. Empty when no special category is active.
 *
 * @param {string} specialAdCategory  the selected special-ad-category value
 * @param {string[]} platforms        the candidate platform ids to test
 * @returns {Record<string,string>}   platform → plain-English reason
 */
export function complianceExclusions(specialAdCategory, platforms = []) {
  if (!isSpecialCategoryActive(specialAdCategory)) return {};
  const out = {};
  for (const platform of platforms) {
    if (!platformCanDeclareSpecialCategory(platform)) {
      out[platform] = complianceExclusionReason(specialAdCategory, platform);
    }
  }
  return out;
}

/** The platform ids excluded for compliance (keys of complianceExclusions). */
export function complianceExcludedPlatforms(specialAdCategory, platforms = []) {
  return Object.keys(complianceExclusions(specialAdCategory, platforms));
}
