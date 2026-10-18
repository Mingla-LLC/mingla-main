export type AdMeasurementManifest = {
  result_kind: string;
  result_hierarchy: string[];
  quality: "trusted" | "provider_reported" | "directional";
  capture_authority: string;
  consent: {
    first_party_touch: "retained_90_days";
    browser_pixels: "granted_only";
    platform_conversion_sharing: "granted_only";
    mingla_reporting: "trusted_results_even_when_sharing_withheld";
  };
  privacy: {
    pii_in_plan: false;
    cross_currency_value_sum: false;
  };
};

const RESULT_HIERARCHY: Record<string, string[]> = {
  tickets: [
    "ticket_purchase",
    "checkout_started",
    "landing_page_view",
    "click",
  ],
  signups: ["rsvp_registration", "landing_page_view", "click"],
  bookings: ["booking_confirmed", "landing_page_view", "click"],
  installs: ["install", "app_store_click", "click"],
  clicks: ["landing_page_view", "click"],
};

export function buildAdMeasurementManifest(
  destination: Record<string, unknown>,
): AdMeasurementManifest {
  const candidate = String(
    destination.result_kind ?? destination.measurement_event ?? "clicks",
  ).toLowerCase();
  const resultKind = candidate in RESULT_HIERARCHY ? candidate : "clicks";
  const quality = ["tickets", "signups", "bookings"].includes(resultKind)
    ? "trusted"
    : resultKind === "installs"
    ? "provider_reported"
    : "directional";
  const captureAuthority = quality === "trusted"
    ? "mingla_server_finalization"
    : quality === "provider_reported"
    ? "provider_and_app_attribution"
    : "first_party_and_provider_click_reporting";

  return {
    result_kind: resultKind,
    result_hierarchy: RESULT_HIERARCHY[resultKind],
    quality,
    capture_authority: captureAuthority,
    consent: {
      first_party_touch: "retained_90_days",
      browser_pixels: "granted_only",
      platform_conversion_sharing: "granted_only",
      mingla_reporting: "trusted_results_even_when_sharing_withheld",
    },
    privacy: {
      pii_in_plan: false,
      cross_currency_value_sum: false,
    },
  };
}
