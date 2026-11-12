/**
 * #4389 — brand setup, door and Ari analytics through the app's existing
 * analytics client (AppsFlyer, `logAppsFlyerEvent`); no new SDK. Properties
 * carry ids and states only: never names, bank details or other PII.
 *
 * The client loads when the first event is sent, so a screen that imports this
 * module does not pull the AppsFlyer and Supabase clients in with it.
 */

export const BRAND_SETUP_EVENTS = [
  "brand_setup_step_viewed",
  "brand_setup_step_completed",
  "brand_setup_free_only_chosen",
  "brand_setup_bank_now_chosen",
  "brand_draft_discarded",
  "brand_draft_continued",
  "ttp_home_card_shown",
  "ttp_home_card_cta",
  "ttp_home_card_not_now",
  "take_payment_opened",
  "take_payment_method_chosen",
  "ari_brand_switched",
  "door_sale_completed",
  "door_mode_opened",
] as const;

export type BrandSetupEvent = (typeof BRAND_SETUP_EVENTS)[number];

type Value = string | number | boolean | null | undefined;

/** Allowed property keys: ids and states only. */
const ALLOWED_KEYS = new Set([
  "step", "brand_id", "resumed", "from_step", "had_payment_setup", "platform",
  "source", "method", "while_streaming", "seconds_from_open",
]);

export function trackBrandSetup(event: BrandSetupEvent, props: Record<string, Value>): void {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_KEYS.has(k) || v === undefined || v === null) continue;
    clean[k] = String(v);
  }
  // Analytics must never break setup; failures surface in the console.
  void import("../../services/appsFlyerService")
    .then(({ logAppsFlyerEvent }) => logAppsFlyerEvent(event, clean))
    .catch((error: unknown) => console.warn("[brandSetupAnalytics] event failed", event, error));
}
