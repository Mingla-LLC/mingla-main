/**
 * functionsBase — the runtime read of the Supabase Edge Functions base URL
 * (`<EXPO_PUBLIC_SUPABASE_URL>/functions/v1`), split out of staticMapImage so
 * the pure proxy-URL builder (staticMapProxyUrl.ts) carries NO `expo-constants`
 * import and stays Deno-unit-testable.
 *
 * The static map image is served by the `static-map` edge function (ORCH-1165;
 * Google Maps Static API behind it since #4334). Each app already ships
 * EXPO_PUBLIC_SUPABASE_URL, so no new env var is needed. Inlining-safe read:
 * Expo `extra` FIRST, then a STATIC process.env member access (babel inlines it
 * on Metro-dev / web-export).
 */
import Constants from "expo-constants";

export const getSupabaseFunctionsBaseUrl = (): string | null => {
  const extra = Constants.expoConfig?.extra as
    | Record<string, string | undefined>
    | undefined;
  // STATIC member access on the fallback so babel-preset-expo inlines it.
  const raw = extra?.EXPO_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return `${raw.trim().replace(/\/+$/, "")}/functions/v1`;
};
