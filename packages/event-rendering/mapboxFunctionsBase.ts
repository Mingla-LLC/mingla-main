/**
 * mapboxFunctionsBase — the runtime read of the Supabase Edge Functions base URL
 * (`<EXPO_PUBLIC_SUPABASE_URL>/functions/v1`), split out of mapboxStaticImage so
 * the pure proxy-URL builder (mapboxStaticProxyUrl.ts) carries NO `expo-constants`
 * top-level import and stays unit-testable under Deno.
 *
 * ORCH-1165 [Mapbox static map server-proxy]: the static map now points at the
 * `mapbox-static` edge fn instead of `api.mapbox.com`. Each app ALREADY ships
 * `EXPO_PUBLIC_SUPABASE_URL` in `Constants.expoConfig.extra` (it is how the
 * supabase client + the stripe-mode handshake resolve their URLs) — so there is
 * NO new client env var and NO app.config.ts change on any surface.
 *
 * Token read is inlining-safe: Constants.expoConfig.extra FIRST (the only path
 * that survives Hermes standalone/OTA builds), then a STATIC process.env fallback
 * (Metro-dev / web-export). Mirrors the proven supabase-client / mapboxToken
 * pattern — do NOT switch to a dynamic process.env[name] read (babel-preset-expo
 * does not inline it).
 */
import Constants from "expo-constants";

/**
 * Resolve `<EXPO_PUBLIC_SUPABASE_URL>/functions/v1`, or null when the supabase URL
 * is absent (the static-map builder then returns null and the caller hides the
 * map — rule-9 fail-safe).
 */
export const getSupabaseFunctionsBaseUrl = (): string | null => {
  const extra = Constants.expoConfig?.extra as
    | Record<string, string | undefined>
    | undefined;
  // STATIC member access on the fallback so babel-preset-expo inlines it.
  const raw = extra?.EXPO_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return `${raw.trim().replace(/\/+$/, "")}/functions/v1`;
};
