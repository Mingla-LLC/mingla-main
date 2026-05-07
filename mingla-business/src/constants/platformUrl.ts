/**
 * Single source of truth for the Mingla Business public web URL.
 *
 * Per B2a Path C V3 forensics — config-drift fix R-1
 * (Mingla_Artifacts/reports/INVESTIGATION_B2A_PATH_C_V3_CONFIG_DRIFT.md).
 *
 * Reads at runtime from EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL — set in
 * mingla-business/app.config.ts `extra` block which Expo bakes into the
 * native bundle, AND set as a Vercel env var for the web export.
 *
 * Production canonical: `https://business.usemingla.com`.
 *
 * NEVER hardcode `business.mingla.com` or `mingla.com` anywhere; both are
 * not Mingla-owned and trigger I-PROPOSED-Y CI gate failures.
 */

import Constants from "expo-constants";

const FROM_EXTRA =
  (Constants.expoConfig?.extra as Record<string, string> | undefined)
    ?.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL;
const FROM_PROCESS_ENV = process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL;
const RESOLVED = FROM_EXTRA ?? FROM_PROCESS_ENV;

if (!RESOLVED || RESOLVED.length === 0) {
  // Fail loud at module load — better than silent fallback to a broken URL.
  // [TRANSITIONAL] removed in v1.0 once env is guaranteed in all build paths.
  // Exit condition: app.config.ts asserts the env at config-resolve time.
  throw new Error(
    "EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL is not set. Configure in mingla-business/app.config.ts extra block or .env.local for dev.",
  );
}

export const MINGLA_BUSINESS_WEB_URL: string = RESOLVED;
export const MINGLA_BUSINESS_WEB_HOST: string = new URL(RESOLVED).host;
