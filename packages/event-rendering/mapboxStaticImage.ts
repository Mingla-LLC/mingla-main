/**
 * mapboxStaticImage — the app-facing static-Mapbox URL builder: the SINGLE
 * shared owner of the "Where you'll be"/"Where you'll start" map across the
 * public trip, event, and experience pages.
 *
 * ORCH-1162 Bug 2 (B.0): PROMOTED into @mingla/event-rendering so there is
 * exactly ONE buildStaticMapUrl owner. mingla-business/src/utils/mapboxStaticImage
 * and app-mobile/src/utils/mapboxStaticImage now RE-EXPORT from here (the prior
 * byte-for-byte duplication ended). This preserves I-MOR-0827-PACKAGE-ISOLATION:
 * app-mobile imports from the @mingla/* package, never from mingla-business/src.
 *
 * A `pk.*` Mapbox token is client-safe by design (publishable, scoped), so the
 * static map is just a plain <Image> with this URL — NO new dependency, NO map
 * SDK, works on native AND react-native-web.
 *
 * Composition: this module wires the runtime token read (./mapboxToken, the only
 * file with the `expo-constants` import) to the PURE URL assembly (./mapboxStaticUrl,
 * Deno-unit-testable). When no `token` override is given, the public token is read
 * at call-time.
 *
 * FAIL-SAFE (Constitution rule 9 / I-PROPOSED-1162-MAP-FAILSAFE-HIDES): if the
 * token is absent OR coords are missing/non-finite, the builder returns null and
 * the caller HIDES the map (honest text/address fallback) — never a fabricated/
 * placeholder tile, never a crash.
 */
import { getPublicMapboxToken } from "./mapboxToken";
import {
  buildStaticMapUrlWithToken,
  type StaticMapParams,
} from "./mapboxStaticUrl";

export { getPublicMapboxToken };
export type { StaticMapParams };

/**
 * Build a Mapbox Static Images API URL for a single destination pin, or null
 * when the token is absent or coords are missing/non-finite (caller hides map).
 * Resolves the runtime public token unless an explicit `token` is supplied.
 */
export const buildStaticMapUrl = (params: StaticMapParams): string | null => {
  const token =
    params.token !== undefined ? params.token : getPublicMapboxToken();
  return buildStaticMapUrlWithToken(params, token);
};
