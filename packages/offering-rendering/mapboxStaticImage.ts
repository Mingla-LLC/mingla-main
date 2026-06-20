/**
 * mapboxStaticImage — the app-facing static-Mapbox URL builder: the SINGLE
 * shared owner of the "Where you'll be"/"Where you'll start" map across the
 * public trip, event, and experience pages.
 *
 * ORCH-1162 Bug 2 (B.0): PROMOTED into @mingla/offering-rendering so there is
 * exactly ONE buildStaticMapUrl owner. mingla-business/src/utils/mapboxStaticImage
 * and app-mobile/src/utils/mapboxStaticImage RE-EXPORT from here (the prior
 * byte-for-byte duplication ended). This preserves I-MOR-0827-PACKAGE-ISOLATION:
 * app-mobile imports from the @mingla/* package, never from mingla-business/src.
 *
 * ORCH-1165 [Mapbox static map server-proxy] — KEYSTONE CHANGE: the static map is
 * now fetched through the vendor-NEUTRAL `static-map` Supabase edge fn (server
 * secret MAPBOX_ACCESS_TOKEN), mirroring the `mapbox-geocode` proxy. The CLIENT
 * URL is a plain `<functionsBaseUrl>/static-map?lat=…&lng=…&accent=…&w=…&h=…` — it
 * carries NO map-vendor token, the substring "mapbox" appears NOWHERE in it, and
 * `api.mapbox.com` never appears in client network traffic; the upstream logo +
 * attribution are stripped server-side. This replaces
 * the prior client-`pk.*`-token URL (which was never provisioned, so the map never
 * rendered) and HIDES the tech stack (Seth's requirement). The static map needs NO
 * client token now — it only needs the Supabase functions base URL, which every
 * app already ships in Constants.expoConfig.extra (no new env, no app.config
 * change).
 *
 * Composition: this module wires the runtime functions-base read
 * (./mapboxFunctionsBase, the file with the `expo-constants` import) to the PURE
 * proxy-URL assembly (./mapboxStaticProxyUrl, Deno-unit-testable). When no
 * `functionsBaseUrl` override is given, the base is read at call-time.
 *
 * The pure CLIENT-side Mapbox URL contract (./mapboxStaticUrl,
 * buildStaticMapUrlWithToken) is RETAINED as the SERVER-side contract owned by the
 * static-map edge fn — it is no longer used to render the client <Image>.
 *
 * FAIL-SAFE (Constitution rule 9 / I-PROPOSED-1162-MAP-FAILSAFE-HIDES): if the
 * functions base URL is absent OR coords are missing/non-finite, the builder
 * returns null and the caller HIDES the map (honest text/address fallback) — never
 * a fabricated/placeholder tile, never a crash. The proxy returns a non-200 for an
 * unreachable/invalid request so the <Image> simply fails to paint.
 */
import { getSupabaseFunctionsBaseUrl } from "./mapboxFunctionsBase";
import {
  buildProxyStaticMapUrl,
  type StaticMapParams,
} from "./mapboxStaticProxyUrl";

export { getSupabaseFunctionsBaseUrl };
export type { StaticMapParams };

/**
 * Build a server-proxy static-map URL for a single destination pin, or null when
 * the functions base URL is absent or coords are missing/non-finite (caller hides
 * map). Resolves the runtime Supabase functions base URL unless an explicit
 * `functionsBaseUrl` is supplied (mainly for tests). The returned URL carries NO
 * Mapbox token and NO `api.mapbox.com` host.
 */
export const buildStaticMapUrl = (params: StaticMapParams): string | null => {
  const base =
    params.functionsBaseUrl !== undefined
      ? params.functionsBaseUrl
      : getSupabaseFunctionsBaseUrl();
  return buildProxyStaticMapUrl(params, base);
};
