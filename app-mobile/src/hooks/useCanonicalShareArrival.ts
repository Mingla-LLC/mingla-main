import { useEffect } from 'react';

/**
 * #3187 — call from every route a canonical share link can open
 * (`/b/:slug`, `/b/:brandSlug/v/:venueSlug`, `/e/…`, `/t/…`, `/exp/…`) with the
 * route's raw `ms` param. Records the share arrival once per mount per value;
 * a route opened without `ms` does nothing. See `contentShareArrival.ts`.
 *
 * The recorder is loaded LAZILY, only when a route actually carries `ms`: it
 * pulls in the analytics SDKs, and a route module must not put those in front
 * of every open of the page (or into every test that mounts one).
 */
export function useCanonicalShareArrival(ms: string | string[] | undefined): void {
  const value = Array.isArray(ms) ? ms[0] : ms;
  useEffect(() => {
    if (typeof value !== 'string' || value.length === 0) return;
    void import('../services/contentShareArrival')
      .then(({ recordCanonicalShareArrival }) => recordCanonicalShareArrival(value))
      .catch((error: unknown) => {
        // The recorder itself never throws; this is a failure to LOAD it.
        // Attribution never owns navigation, but it must not fail invisibly.
        console.warn('[content-share-arrival] recorder unavailable', error instanceof Error ? error.message : String(error));
      });
  }, [value]);
}
