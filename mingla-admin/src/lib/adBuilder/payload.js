/**
 * ISSUE-864 WP4 [Campaign Builder] — the exact admin-ad-create-campaign
 * request bodies, one per channel (the endpoint creates one campaign per
 * (platform, lane) call; the wizard loops the admitted channel set).
 *
 * Hard contracts encoded here:
 *  - Everything is created PAUSED server-side; the payload has NO status
 *    field and the builder NEVER calls campaign-action (SC-10 /
 *    I-PROPOSED-864-CREATE-PAUSED — launch lives on the campaign surface).
 *  - Meta carries creative.call_to_action_type; the GOOGLE payload NEVER
 *    carries call_to_action_type anywhere (A4.b — not an RSA field; Search
 *    ads have no CTA button).
 *  - Budgets are CENTS at rest (dollars-in → cents here, once); micro/dollar
 *    conversion is the server adapter's job (blueprint §1.4 Discovery 3).
 *  - request_id per (channel, wizard-session) → server idempotency replay.
 *  - special_ad_categories comes from the validated selector, never a
 *    hardcoded [] (A4.d.4); NONE → [].
 */

import { metaGendersFor } from "./audienceRules.js";

/** Dollars-in → cents-at-rest, once (the CurrencyInput contract). */
export function dollarsToCents(dollars) {
  const value = typeof dollars === "string" ? parseFloat(dollars) : dollars;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

/** Spec §4.4: auto-suggested campaign name — "{brand} — {title} — {YYYY-MM-DD}", editable. */
export function suggestCampaignName({ brandName, title, date = new Date() }) {
  const day = date.toISOString().slice(0, 10);
  return [brandName, title, day].filter(Boolean).join(" — ");
}

/**
 * ISSUE-927: per-objective TikTok defaults — the server owns the enums; this
 * map only picks the consistent (optimization_goal, billing_event) pair for
 * the objectives the goal step can emit (goals.js). Unknown objectives fall
 * back to the TRAFFIC pair and the server validates loudly (everything is
 * created DISABLE/paused — zero spend risk on a 422/502).
 */
const TIKTOK_GOAL_DEFAULTS = {
  TRAFFIC: { optimization_goal: "TRAFFIC_LANDING_PAGE_VIEW", billing_event: "CPC" },
  REACH: { optimization_goal: "REACH", billing_event: "CPM" },
};

/**
 * Build the per-channel create body from the wizard state.
 *
 * @param {"meta"|"google"|"tiktok"|"reddit"|"snapchat"} platform — a
 *   create-wired channel (all five since ISSUE-927; channelPlan.CREATE_WIRED)
 * @param {object} state — the wizard's assembled state:
 *   { lane, name, goal:{metaObjective, metaOptimizationGoal, platforms},
 *     destination:{page_type, brand_slug, entity_slug},
 *     audience:{countries, ageMin, ageMax, gender},
 *     budget:{dailyCentsForChannel},
 *     creative:{imageUrl, aiGenerated, creativeLibraryId, brandName},
 *     copy:{primary, headline, description, cta, googleHeadlines,
 *           googleDescriptions, keywords, negativeKeywords},
 *     specialAdCategory, requestId }
 */
export function buildCreatePayload(platform, state) {
  const {
    lane = "consumer",
    name,
    goal,
    destination,
    audience,
    budget,
    creative,
    copy,
    specialAdCategory = "NONE",
    requestId,
    validateOnly = false,
  } = state;

  const destinationBody = {
    page_type: destination.page_type,
    brand_slug: destination.brand_slug,
    ...(destination.entity_slug ? { entity_slug: destination.entity_slug } : {}),
  };

  if (platform === "tiktok") {
    // ISSUE-927: the goal step's native objective (goals.js) rides through;
    // ad_text = the primary copy (copyRules pins TikTok's 100-hard no-emoji
    // cap before this is reachable). Media: the create-time UPLOAD_BY_URL
    // path (image_url), plus the #866 library ref when one was recorded.
    // TikTok CTAs are bare display strings — the SERVER owns the per-platform
    // map (GR-29: never a shared normalizer); the wizard sends none.
    const objective = goal.platforms?.tiktok?.objective ?? "TRAFFIC";
    const goalDefaults = TIKTOK_GOAL_DEFAULTS[objective] ?? TIKTOK_GOAL_DEFAULTS.TRAFFIC;
    return {
      platform: "tiktok",
      lane,
      request_id: requestId,
      name,
      objective,
      optimization_goal: goalDefaults.optimization_goal,
      billing_event: goalDefaults.billing_event,
      budget: { type: "daily", amount_cents: budget.dailyCentsForChannel },
      targeting: {
        countries: audience.countries,
        age_min: Number(audience.ageMin),
        age_max: Number(audience.ageMax),
        ...(audience.gender === "female"
          ? { gender: "GENDER_FEMALE" }
          : audience.gender === "male"
          ? { gender: "GENDER_MALE" }
          : {}),
      },
      destination: destinationBody,
      creative: {
        ad_text: copy.primary,
        image_url: creative.imageUrl,
        ...(creative.creativeLibraryId ? { creative_library_id: creative.creativeLibraryId } : {}),
      },
      ...(validateOnly ? { validate_only: true } : {}),
    };
  }

  if (platform === "reddit") {
    // ISSUE-927: Reddit v1 is the IMAGE structured-post variant — headline =
    // the primary copy (copyRules lints primary AS the Reddit headline),
    // budget on the ad group (non-CBO), no age targeting (unrepresentable on
    // Reddit — the server serializer warns and drops it). CTA: the SERVER
    // defaults from REDDIT_CTA_MAP (Title-Case verbatim — GR-29).
    return {
      platform: "reddit",
      lane,
      request_id: requestId,
      name,
      objective: goal.platforms?.reddit?.objective ?? "CLICKS",
      budget: { type: "daily", amount_cents: budget.dailyCentsForChannel },
      targeting: { countries: audience.countries },
      destination: destinationBody,
      creative: {
        headline: copy.primary,
        image_url: creative.imageUrl,
      },
      ...(validateOnly ? { validate_only: true } : {}),
    };
  }

  if (platform === "snapchat") {
    // ISSUE-927: the WP5 branch consumes media from the #866 creative
    // library ONLY (create never uploads inline) — the recorded library row
    // id rides along; the server 422s creative_not_uploaded/424s
    // snapchat_profile_missing fail-close until the Snap ref + profile
    // secret exist. Headline ≤34 / brand ≤32 are pinned by copyRules before
    // this is reachable; the CTA defaults server-side (S-3 allowlist).
    return {
      platform: "snapchat",
      lane,
      request_id: requestId,
      name,
      objective: goal.platforms?.snapchat?.objective ?? "TRAFFIC",
      optimization_goal: goal.platforms?.snapchat?.optimization_goal ?? "SWIPES",
      budget: { type: "daily", amount_cents: budget.dailyCentsForChannel },
      targeting: { countries: audience.countries },
      destination: destinationBody,
      creative: {
        headline: copy.headline || copy.primary,
        ...(creative.brandName ? { brand_name: creative.brandName } : {}),
        ...(creative.creativeLibraryId ? { creative_library_id: creative.creativeLibraryId } : {}),
      },
      ...(validateOnly ? { validate_only: true } : {}),
    };
  }

  if (platform === "google") {
    // A4.b: Google gets repeatable RSA fields + keywords and NO
    // call_to_action_type — assert-by-construction: the object below simply
    // never includes it.
    return {
      platform: "google",
      lane,
      request_id: requestId,
      name,
      budget: { type: "daily", amount_cents: budget.dailyCentsForChannel },
      targeting: { countries: audience.countries },
      destination: destinationBody,
      creative: {
        headlines: (copy.googleHeadlines ?? []).map((h) => h.trim()).filter(Boolean),
        descriptions: (copy.googleDescriptions ?? []).map((d) => d.trim()).filter(Boolean),
      },
      keywords: (copy.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      ...(Array.isArray(copy.negativeKeywords) && copy.negativeKeywords.length > 0
        ? { negative_keywords: copy.negativeKeywords.map((k) => k.trim()).filter(Boolean) }
        : {}),
      ...(validateOnly ? { validate_only: true } : {}),
    };
  }

  // Meta (the generic branch).
  const genders = metaGendersFor(audience.gender);
  const categories = specialAdCategory && specialAdCategory !== "NONE"
    ? [specialAdCategory]
    : [];
  return {
    platform: "meta",
    lane,
    request_id: requestId,
    name,
    objective: goal.metaObjective,
    optimization_goal: goal.metaOptimizationGoal,
    billing_event: "IMPRESSIONS",
    budget: { type: "daily", amount_cents: budget.dailyCentsForChannel },
    targeting: {
      countries: audience.countries,
      age_min: Number(audience.ageMin),
      age_max: Number(audience.ageMax),
      ...(genders ? { genders } : {}),
    },
    destination: destinationBody,
    creative: {
      message: copy.primary,
      ...(copy.headline ? { headline: copy.headline } : {}),
      ...(copy.description ? { description: copy.description } : {}),
      image_url: creative.imageUrl,
      call_to_action_type: copy.cta || "LEARN_MORE",
      ai_generated: creative.aiGenerated === true,
    },
    special_ad_categories: categories,
    ...(categories.length > 0 ? { special_ad_category_country: audience.countries } : {}),
    ...(validateOnly ? { validate_only: true } : {}),
  };
}
