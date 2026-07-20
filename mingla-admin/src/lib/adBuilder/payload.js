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
import {
  DEFAULT_RADIUS_MI,
  googleLocationsFrom,
  metaCitiesFrom,
  metaInterestIdsFrom,
  redditGendersFor,
  redditInterestNamesFrom,
  snapDemographicsFrom,
  tiktokGenderFor,
  tiktokInterestCategoryIdsFrom,
  tiktokLocationIdsFrom,
} from "./targeting.js";

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
 *     creative:{kind, imageUrl, aiGenerated, creativeLibraryId, brandName},
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

  // ISSUE-979 Bug 3 [Campaign Builder correctness] — the GLOBAL compliance
  // intent (AI-generated disclosure + special-ad-category) travels to EVERY
  // platform's create path, not Meta alone. It used to reach only the Meta
  // branch and was silently dropped for the other four even though the UI
  // presents both as global. This is a platform-NEUTRAL descriptor (camelCase,
  // deliberately distinct from Meta's platform-specific API keys
  // `special_ad_categories` / `ai_generated`, which stay Meta-shaped below).
  // Each backend adapter applies it where its API supports it and documents the
  // drop where it does not (admin-ad-create-campaign):
  //   - Meta      → self_ai_disclosure=OPT_IN + special_ad_categories (applied).
  //   - TikTok    → aigc_disclosure_type is CUSTOMIZED_USER-only and unreachable
  //                 for our account (PROOF T-P6); no special-category field.
  //   - Snapchat  → no AI-disclosure field, no special-ad-category field.
  //   - Reddit    → no AI-disclosure field, no special-ad-category field.
  //   - Google    → containsEuPoliticalAdvertising only (already declared); no
  //                 general special-ad-category field, no RSA AI-disclosure field.
  // Never silently dropped at the client — the flags always leave for the server.
  const compliance = {
    aiGenerated: creative?.aiGenerated === true,
    specialAdCategory: specialAdCategory && specialAdCategory !== "" ? specialAdCategory : "NONE",
  };

  // ISSUE-995 [Campaign Builder creative] Wave 3 — VIDEO. A video creative is
  // never inline bytes: it was recorded to the #866 library (kind:"video" +
  // bunny_video_id/poster_url/mp4_master_url) via admin-ad-creative-upload, and
  // the create endpoint resolves it by its library row id (NOT an image_url).
  // So the video media descriptor is `{ creative_library_id, kind:"video" }`
  // for every platform — never image_url. Image creatives keep the byte-
  // identical `image_url` (+ optional library ref) shape they had before, so
  // the ISSUE-864/927/989 payload suites stay green.
  const creativeIsVideo = creative?.kind === "video";
  const videoRef = creativeIsVideo
    ? {
      kind: "video",
      ...(creative.creativeLibraryId ? { creative_library_id: creative.creativeLibraryId } : {}),
    }
    : null;

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
      // ISSUE-989: real city + interest targeting. City location_ids (resolved
      // via the search proxy) REPLACE country resolution when present; interest
      // category ids narrow the ad group; gender now maps correctly (the old
      // "female"/"male" check never matched the wizard's women/men values —
      // TikTok gender was silently dropped). Empty selections omit the keys, so
      // broad country+age targeting is unchanged.
      targeting: {
        countries: audience.countries,
        ...(tiktokLocationIdsFrom(audience.cities).length > 0
          ? { location_ids: tiktokLocationIdsFrom(audience.cities) }
          : {}),
        ...(tiktokInterestCategoryIdsFrom(audience.interests).length > 0
          ? { interest_category_ids: tiktokInterestCategoryIdsFrom(audience.interests) }
          : {}),
        age_min: Number(audience.ageMin),
        age_max: Number(audience.ageMax),
        ...(tiktokGenderFor(audience.gender) ? { gender: tiktokGenderFor(audience.gender) } : {}),
      },
      destination: destinationBody,
      creative: videoRef
        ? { ad_text: copy.primary, ...videoRef }
        : {
          ad_text: copy.primary,
          image_url: creative.imageUrl,
          ...(creative.creativeLibraryId ? { creative_library_id: creative.creativeLibraryId } : {}),
        },
      // Bug 3: global compliance intent reaches TikTok's create path. TikTok's
      // only AI-disclosure field (aigc_disclosure_type) is CUSTOMIZED_USER-only
      // and unreachable for our account (T-P6); it has no special-category field.
      compliance,
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
      // ISSUE-989: gender (scalar, was silently dropped — Lane D finding #2) +
      // community/interest names via passthrough.reddit (the serializer takes
      // NAMES verbatim). Reddit has NO age field (R-8) — age is never sent.
      // Country stays the geo (Reddit is country/metro, not city).
      targeting: {
        countries: audience.countries,
        ...(redditGendersFor(audience.gender) ? { genders: redditGendersFor(audience.gender) } : {}),
        ...(redditInterestNamesFrom(audience.interests).length > 0
          ? { passthrough: { reddit: { interests: redditInterestNamesFrom(audience.interests) } } }
          : {}),
      },
      destination: destinationBody,
      creative: videoRef
        ? { headline: copy.primary, ...videoRef }
        : {
          headline: copy.primary,
          image_url: creative.imageUrl,
        },
      // Bug 3: global compliance intent reaches Reddit's create path. Reddit has
      // no AI-disclosure field and no special-ad-category field on its API.
      compliance,
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
      // ISSUE-989: age/gender via demographics (STRINGS — GR-39). These were
      // silently dropped before (the server forced min_age:"18"); now the
      // wizard's age/gender travels. Absent → server default [{min_age:"18"}].
      // City circles + interest segments consumption is deferred (ISSUE-989
      // split); Snap uses the picked countries + these demographics.
      targeting: {
        countries: audience.countries,
        ...(snapDemographicsFrom(audience)
          ? { demographics: snapDemographicsFrom(audience) }
          : {}),
      },
      destination: destinationBody,
      creative: {
        headline: copy.headline || copy.primary,
        ...(creative.brandName ? { brand_name: creative.brandName } : {}),
        ...(creative.creativeLibraryId ? { creative_library_id: creative.creativeLibraryId } : {}),
        ...(videoRef ? { kind: "video" } : {}),
      },
      // Bug 3: global compliance intent reaches Snapchat's create path. Snapchat
      // has no AI-disclosure field and no special-ad-category field on its API.
      compliance,
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
      // ISSUE-989: named city locations [{name, country_code}] — the create fn
      // re-resolves each to an ENABLED geoTargetConstant by name (the London/
      // Ontario disambiguation path already wired backend-side). Empty → the
      // country seed constants target the whole country (unchanged).
      targeting: {
        countries: audience.countries,
        ...(googleLocationsFrom(audience.cities).length > 0
          ? { locations: googleLocationsFrom(audience.cities) }
          : {}),
      },
      destination: destinationBody,
      creative: {
        headlines: (copy.googleHeadlines ?? []).map((h) => h.trim()).filter(Boolean),
        descriptions: (copy.googleDescriptions ?? []).map((d) => d.trim()).filter(Boolean),
        // ISSUE-995: a video RSA rides on the library ref (Google runs it
        // YouTube-hosted, resolved from the #866 row); image RSAs carry no media.
        ...(videoRef ?? {}),
      },
      keywords: (copy.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      ...(Array.isArray(copy.negativeKeywords) && copy.negativeKeywords.length > 0
        ? { negative_keywords: copy.negativeKeywords.map((k) => k.trim()).filter(Boolean) }
        : {}),
      // Bug 3: global compliance intent reaches Google's create path. Google
      // Ads has no general special-ad-category field (housing/employment/etc.
      // are account-level policy) and no RSA AI-disclosure field; the only
      // related declaration is containsEuPoliticalAdvertising (already sent).
      compliance,
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
    // ISSUE-989: real city + radius + interest targeting. cities carry the
    // resolved Meta geo keys with the chosen radius (the server enforces
    // {key,radius,distance_unit} and Meta's 1-50mi bounds); interests carry the
    // resolved adinterest ids → flexible_spec on the server. Empty selections
    // omit the keys, so broad country+age targeting is byte-identical to before.
    targeting: {
      countries: audience.countries,
      ...(metaCitiesFrom(audience.cities, audience.radius ?? DEFAULT_RADIUS_MI, audience.distanceUnit).length > 0
        ? { cities: metaCitiesFrom(audience.cities, audience.radius ?? DEFAULT_RADIUS_MI, audience.distanceUnit) }
        : {}),
      ...(metaInterestIdsFrom(audience.interests).length > 0
        ? { interests: metaInterestIdsFrom(audience.interests) }
        : {}),
      age_min: Number(audience.ageMin),
      age_max: Number(audience.ageMax),
      ...(genders ? { genders } : {}),
    },
    destination: destinationBody,
    creative: {
      message: copy.primary,
      ...(copy.headline ? { headline: copy.headline } : {}),
      ...(copy.description ? { description: copy.description } : {}),
      // ISSUE-995: video rides on the library ref (kind:"video" +
      // creative_library_id) instead of an inline image_url; image is unchanged.
      ...(videoRef ? videoRef : { image_url: creative.imageUrl }),
      call_to_action_type: copy.cta || "LEARN_MORE",
      ai_generated: creative.aiGenerated === true,
    },
    special_ad_categories: categories,
    ...(categories.length > 0 ? { special_ad_category_country: audience.countries } : {}),
    // Bug 3: Meta ALSO carries the platform-neutral compliance descriptor (it
    // applies both flags via self_ai_disclosure + special_ad_categories above)
    // so every platform's payload carries `compliance` uniformly.
    compliance,
    ...(validateOnly ? { validate_only: true } : {}),
  };
}
