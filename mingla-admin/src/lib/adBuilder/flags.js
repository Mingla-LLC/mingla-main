/**
 * ISSUE-864 WP4 [Campaign Builder] — feature-flag constants for spec'd UI that
 * needs backend endpoints which DO NOT EXIST yet. The builder ships the UI
 * fail-soft behind these flags (dispatch rule: never invent endpoints).
 *
 * Flip a flag ONLY when its endpoint lands on main — each constant names the
 * missing endpoint so the flip is a one-word change + a test update.
 */

/**
 * A4.f city + radius targeting needs the admin-gated targeting-search proxy
 * (`admin-ad-targeting-search` → Graph GET /search?type=adgeolocation with
 * country_code disambiguation — the London,Canada-first hazard).
 *
 * ISSUE-989: the proxy now EXISTS and is deployed (supabase/functions/
 * admin-ad-targeting-search, verify_jwt + admin-gated, read-only; Meta city+
 * interest + TikTok city+interest + Google city PROVEN live 2026-07-20). The
 * Audience step ships the real city typeahead + radius + interest picker.
 */
export const TARGETING_SEARCH_PROXY_ENABLED = true;

/**
 * Blueprint §1.4's `Preview split` button posts to
 * `admin-ad-budget-plan-preview` (pure, no writes). The endpoint does not
 * exist (#884). The builder computes the split CLIENT-SIDE (channelPlan.js)
 * and labels it as a local estimate.
 */
export const BUDGET_PLAN_PREVIEW_ENDPOINT_ENABLED = false;

/**
 * Legacy all-platform switch retained OFF because a single boolean would
 * falsely imply that every provider has a real preview. ISSUE-1184 adds the
 * narrower, truthful source map below.
 */
export const API_AD_PREVIEWS_ENABLED = false;

/**
 * ISSUE-1184 Phase A: real provider previews exist only for Meta and TikTok.
 * Snapchat and Google remain explicitly labelled Mingla approximations;
 * Reddit is outside this phase.
 */
export const VIDEO_API_AD_PREVIEWS_ENABLED = Object.freeze({
  meta: true,
  tiktok: true,
  snapchat: false,
  google: false,
  reddit: false,
});

/**
 * A4.g frequency-cap control: Meta `frequency_control_specs` is writable only
 * on REACH/THRUPLAY ad sets — AND `admin-ad-create-campaign` does not accept
 * a frequency_control_specs field at all today. Exposing the control would be
 * a lie (the server would silently drop it). budgetRules.frequencyCapAllowed
 * encodes the REACH/THRUPLAY gate for the day the endpoint gains the field.
 */
export const FREQUENCY_CAP_CONTROL_ENABLED = false;
