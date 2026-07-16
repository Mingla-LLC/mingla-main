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
 * country_code disambiguation — the London,Canada-first hazard). The edge fn
 * is specced on the #862 side and NOT deployed. Until it exists the audience
 * step collects countries only and shows the city picker as "coming".
 */
export const TARGETING_SEARCH_PROXY_ENABLED = false;

/**
 * Blueprint §1.4's `Preview split` button posts to
 * `admin-ad-budget-plan-preview` (pure, no writes). The endpoint does not
 * exist (#884). The builder computes the split CLIENT-SIDE (channelPlan.js)
 * and labels it as a local estimate.
 */
export const BUDGET_PLAN_PREVIEW_ENDPOINT_ENABLED = false;

/**
 * A4.g ad-preview step (Meta GET /{ad_id}/previews, TikTok
 * creative_ads_preview_create, Reddit preview_url) needs a preview edge fn
 * that does not exist. The Preview step draws the client-side safe-zone
 * overlay instead (blueprint §1.7a "where no API preview exists, draw one").
 */
export const API_AD_PREVIEWS_ENABLED = false;

/**
 * A4.g frequency-cap control: Meta `frequency_control_specs` is writable only
 * on REACH/THRUPLAY ad sets — AND `admin-ad-create-campaign` does not accept
 * a frequency_control_specs field at all today. Exposing the control would be
 * a lie (the server would silently drop it). budgetRules.frequencyCapAllowed
 * encodes the REACH/THRUPLAY gate for the day the endpoint gains the field.
 */
export const FREQUENCY_CAP_CONTROL_ENABLED = false;
