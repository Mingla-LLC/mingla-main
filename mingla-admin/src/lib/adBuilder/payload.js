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
 * Build the per-channel create body from the wizard state.
 *
 * @param {"meta"|"google"} platform  — only the create-wired channels
 * @param {object} state — the wizard's assembled state:
 *   { lane, name, goal:{metaObjective, metaOptimizationGoal},
 *     destination:{page_type, brand_slug, entity_slug},
 *     audience:{countries, ageMin, ageMax, gender},
 *     budget:{dailyCentsForChannel},
 *     creative:{imageUrl, aiGenerated},
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
