/**
 * #426 — Feature flags / kill switches for risky or new surfaces.
 *
 * Defaults keep current production behavior (everything on except Paystack).
 * Disable without deploy by setting EXPO_PUBLIC_FF_* to "false" in EAS Secrets
 * and shipping an OTA update.
 */

export type FeatureFlagKey =
  "ari" | "marketingSend" | "paystack" | "accountSideToggle" | "sites";

function readEnvFlag(envName: string, defaultEnabled: boolean): boolean {
  // Expo statically substitutes the five literal call-site names below; this
  // helper centralizes the common boolean normalization intentionally.
  // eslint-disable-next-line expo/no-dynamic-env-var
  const raw = process.env[envName];
  if (raw === undefined || raw === "") {
    return defaultEnabled;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "off";
}

export const featureFlags: Readonly<Record<FeatureFlagKey, boolean>> = {
  ari: readEnvFlag("EXPO_PUBLIC_FF_ARI_ENABLED", true),
  marketingSend: readEnvFlag("EXPO_PUBLIC_FF_MARKETING_SEND_ENABLED", true),
  paystack: readEnvFlag("EXPO_PUBLIC_FF_PAYSTACK_ENABLED", false),
  /** #668 — consumer↔business toggle; dark in prod until product is ready. */
  accountSideToggle: readEnvFlag("EXPO_PUBLIC_FF_ACCOUNT_SIDE_TOGGLE", false),
  /** #2830 — dark until the separately governed Gogi pilot enablement. */
  sites: readEnvFlag("EXPO_PUBLIC_FF_SITES_ENABLED", false),
};

export function isFeatureEnabled(key: FeatureFlagKey): boolean {
  return featureFlags[key];
}

/** Maps bottom-nav tab ids to feature flags (tabs without flags always show). */
export function isTabVisible(tabId: string): boolean {
  if (tabId === "ari") return isFeatureEnabled("ari");
  if (tabId === "marketing") return isFeatureEnabled("marketingSend");
  return true;
}
