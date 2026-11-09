/**
 * staticMapImage — the app-facing static map URL builder: the SINGLE owner of
 * buildStaticMapUrl (I-PROPOSED-1162-MAP-PRIMITIVE-SINGLE-OWNER). The trip,
 * event, experience, venue and RSVP pages all draw their "Where you'll be" map
 * from it; mingla-business/src/utils/staticMapImage and
 * app-mobile/src/utils/staticMapImage RE-EXPORT it, never re-fork it.
 *
 * The image comes from the `static-map` edge function (ORCH-1165), which holds
 * the provider key server-side (Google Maps Static API since #4334). The client
 * URL carries no key and no provider host. When no functions base is available
 * the builder returns null and the caller renders no map (rule 9 — never a
 * fabricated tile); an upstream failure is a non-200 and the <Image onError>
 * hides the map (I-PROPOSED-1162-MAP-FAILSAFE-HIDES).
 */
import { getSupabaseFunctionsBaseUrl } from "./functionsBase";
import {
  buildProxyStaticMapUrl,
  type StaticMapParams,
} from "./staticMapProxyUrl";

export { getSupabaseFunctionsBaseUrl };
export type { StaticMapParams };

/** The proxy URL for one pin, or null when there is no coordinate or no base. */
export const buildStaticMapUrl = (params: StaticMapParams): string | null => {
  const base =
    params.functionsBaseUrl !== undefined
      ? params.functionsBaseUrl
      : getSupabaseFunctionsBaseUrl();
  return buildProxyStaticMapUrl(params, base);
};
