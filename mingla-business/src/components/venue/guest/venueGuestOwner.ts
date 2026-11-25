/**
 * #4490 — the ONLY way to the Guest venue owner (venueGuestScreens.ts). The
 * public venue page, the guest reservation sheet and the guest venue routes
 * all resolve this same dynamic import, so the guest venue code ships as one
 * chunk loaded on intent and nothing it shares is hoisted into the eager web
 * `__common` chunk. Never reaches Host code.
 *
 * Import-light on purpose (type-only imports): the public route imports it.
 */
export type VenueGuestScreens = typeof import("./venueGuestScreens");

let venueGuestScreensPromise: Promise<VenueGuestScreens> | null = null;

/** One request per session; a failed load is retried on the next call. */
export const loadVenueGuestScreens = (): Promise<VenueGuestScreens> => {
  venueGuestScreensPromise ??= import("./venueGuestScreens").catch((error: unknown) => {
    venueGuestScreensPromise = null;
    throw error;
  });
  return venueGuestScreensPromise;
};
