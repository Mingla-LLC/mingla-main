/**
 * Single source of truth for the Mingla Host public web URL.
 *
 * Per B2a Path C V3 forensics — config-drift fix R-1
 * (Mingla_Artifacts/reports/INVESTIGATION_B2A_PATH_C_V3_CONFIG_DRIFT.md).
 *
 * Reads at runtime from EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL — set in
 * mingla-business/app.config.js `extra` block which Expo bakes into the
 * native bundle, AND set as a Vercel env var for the web export.
 *
 * Production canonical: `https://host.usemingla.com`.
 *
 * NEVER hardcode `business.mingla.com` or `mingla.com` anywhere; both are
 * not Mingla-owned and trigger I-PROPOSED-Y CI gate failures.
 */

import Constants from "expo-constants";

const FROM_EXTRA =
  (Constants.expoConfig?.extra as Record<string, string> | undefined)
    ?.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL;
const FROM_PROCESS_ENV = process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL;
const HOST_PUBLIC_ORIGIN = "https://host.usemingla.com";
const RETIRED_BUSINESS_ORIGIN = /^https:\/\/business\.usemingla\.com\/?$/i;
const CONFIGURED = FROM_EXTRA ?? FROM_PROCESS_ENV;
// Issue #2986: a stale control-plane value may not resurrect the retired
// Business hostname in generated links while #2050's external drains continue.
const RESOLVED = CONFIGURED && RETIRED_BUSINESS_ORIGIN.test(CONFIGURED.trim())
  ? HOST_PUBLIC_ORIGIN
  : CONFIGURED;

if (!RESOLVED || RESOLVED.length === 0) {
  // Fail loud at module load — better than silent fallback to a broken URL.
  // [TRANSITIONAL] removed in v1.0 once env is guaranteed in all build paths.
  // Exit condition: app.config.js asserts the env at config-resolve time.
  throw new Error(
    "EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL is not set. Configure in mingla-business/app.config.js extra block or .env.local for dev.",
  );
}

export const MINGLA_BUSINESS_WEB_URL: string = RESOLVED;
