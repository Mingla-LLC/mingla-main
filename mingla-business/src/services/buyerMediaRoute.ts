/**
 * buyerMediaRoute — #4518: the picture road for buyer pages on Host web.
 *
 * THE DEFECT. Buyer pages reach the database through our own site when the
 * database host is blocked (`resilientFetch.ts`), but pictures (event cover,
 * brand logo, galleries) still loaded only from that host: the page worked and
 * every picture was missing.
 *
 * THE FIX. A Supabase PUBLIC-STORAGE picture that fails (or hangs for 8 s) is
 * fetched once more through our own site (`/_sb/...`, the existing Vercel
 * rewrite). After the first rescued picture, the rest of this visit's
 * pictures go that way first. A visit whose database traffic already moved
 * to the second road starts its pictures there too.
 *
 * WHAT IT NEVER DOES.
 *   - never builds, requests or rewrites to the image-transformation endpoint
 *     (`/render/image/`, spend-cap hold #1643); existing objects (including
 *     `<placeId>/<n>_thumb.jpg` thumbnails) are used byte-for-byte, no
 *     width/quality/format parameters are ever added
 *   - never rewrites signed (`/object/sign/`) or authenticated storage, or any
 *     non-Supabase host (Cloudinary, Mux, maps)
 *   - never switches the DATABASE route: the auth-health probe in
 *     `resilientFetch.ts` stays its only switcher. The flag here is the
 *     picture road's own fact.
 *
 * Buyers whose connection is fine see no change and cost nothing extra.
 * Web only: the root layout provides this; native gets the package's
 * pass-through default.
 */
import type { OfferingMediaRoute } from "@mingla/offering-rendering/offeringMediaRoute";

import { databaseRouteNow, supabaseProjectUrl } from "./supabase";

/** Same value as `SAME_ORIGIN_PREFIX` in resilientFetch.ts (restated so this
 *  boot-path module never loads that off-boot chunk). */
const SAME_ORIGIN_PREFIX = "/_sb";
/** Same value as `DIRECT_TIME_LIMIT_MS` in resilientFetch.ts: how long a
 *  first attempt may hang before the second road is tried. */
const DIRECT_TIME_LIMIT_MS = 8000;
const PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";
const REPORT_PATH = "/storage/v1/object/public";

export const isPublicStorageUrl = (url: string, origin: string = supabaseProjectUrl): boolean =>
  origin.length > 0 && url.startsWith(`${origin}${PUBLIC_OBJECT_PATH}`);

/** `https://<project>.supabase.co/storage/v1/object/public/a/b.jpg?x=1` →
 *  `/_sb/storage/v1/object/public/a/b.jpg?x=1` (path and query kept as is). */
export const toSameOriginStorage = (url: string, origin: string = supabaseProjectUrl): string =>
  SAME_ORIGIN_PREFIX + url.slice(origin.length);

let imagesViaSameOrigin = false;
let reportedRescued = false;
let reportedUnreachable = false;

/** Test seam. */
export const resetBuyerMediaRoute = (): void => {
  imagesViaSameOrigin = false;
  reportedRescued = false;
  reportedUnreachable = false;
};

const report = (outcome: "rescued" | "unreachable"): void => {
  // Counted in product analytics (sent only when analytics is on for the
  // visitor; no personal data). Imported on use, never on the boot path.
  void import("../analytics/webAnalytics")
    .then((analytics) =>
      analytics.captureWeb("buyer_database_route", { outcome, path: REPORT_PATH }),
    )
    .catch(() => {
      // Reporting is best-effort; the picture outcome is unaffected.
    });
};

export const createBuyerMediaRoute = (
  routeNow: () => "direct" | "sameOrigin" = databaseRouteNow,
  origin: string = supabaseProjectUrl,
): OfferingMediaRoute => ({
  resolve: (url: string): string =>
    isPublicStorageUrl(url, origin) && (imagesViaSameOrigin || routeNow() === "sameOrigin")
      ? toSameOriginStorage(url, origin)
      : url,
  fallback: (url: string): string | null =>
    isPublicStorageUrl(url, origin) ? toSameOriginStorage(url, origin) : null,
  onFallbackResult: (ok: boolean): void => {
    if (ok) {
      imagesViaSameOrigin = true;
      if (!reportedRescued) {
        reportedRescued = true;
        report("rescued");
      }
      return;
    }
    if (!reportedUnreachable) {
      reportedUnreachable = true;
      report("unreachable");
    }
  },
  timeLimitMs: DIRECT_TIME_LIMIT_MS,
});

/** The one value the root layout provides (stable identity). */
export const buyerMediaRoute: OfferingMediaRoute = createBuyerMediaRoute();
