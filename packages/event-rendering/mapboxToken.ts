/**
 * mapboxToken — the runtime public Mapbox token read, split out of
 * mapboxStaticImage so the pure URL builder (mapboxStaticImage.ts) carries NO
 * `expo-constants` top-level import and is therefore unit-testable under Deno.
 *
 * ORCH-1162 Bug 2 (B.0). Token read is inlining-safe: Constants.expoConfig.extra
 * FIRST (the only path that survives Hermes standalone/OTA builds), then a STATIC
 * process.env fallback (Metro-dev / web-export). Mirrors the proven GIPHY pattern
 * — do NOT switch to a dynamic process.env[name] read (babel-preset-expo does not
 * inline it).
 */
import Constants from "expo-constants";

const TOKEN_EXTRA_KEY = "EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN";

/** Inlining-safe public Mapbox token read: extra FIRST, static process.env fallback. */
export const getPublicMapboxToken = (): string | null => {
  const extra = Constants.expoConfig?.extra as
    | Record<string, string | undefined>
    | undefined;
  // STATIC member access on the fallback so babel-preset-expo inlines it.
  const raw =
    extra?.[TOKEN_EXTRA_KEY] ?? process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
};
