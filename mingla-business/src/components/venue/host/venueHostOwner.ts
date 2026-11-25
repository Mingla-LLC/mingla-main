/**
 * #4490 — the ONLY way to the Host venue owner (venueHostScreens.ts). Every
 * caller (the venue and Stay shells, the menu, settings, reservations and the
 * full-screen venue routes) resolves this same dynamic import, so all Host
 * venue code ships as one chunk loaded on intent and nothing it shares is
 * hoisted into the eager web `__common` chunk.
 *
 * Import-light on purpose: callers in the eager shells import this file, so
 * it must stay a few lines with type-only imports.
 */
export type VenueHostScreens = typeof import("./venueHostScreens");

let venueHostScreensPromise: Promise<VenueHostScreens> | null = null;

/** One request per session; a failed load is retried on the next call. */
export const loadVenueHostScreens = (): Promise<VenueHostScreens> => {
  venueHostScreensPromise ??= import("./venueHostScreens").catch((error: unknown) => {
    venueHostScreensPromise = null;
    throw error;
  });
  return venueHostScreensPromise;
};

