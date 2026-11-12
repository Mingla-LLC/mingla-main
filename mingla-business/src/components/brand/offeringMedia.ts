/**
 * #4389 addendum 2 — the five offering clips (cut from the marketing site's
 * `-sm` loops: 480px, 5s, no audio) and their poster frames, bundled so they
 * play instantly and offline.
 *
 * Loaded on first use, inside a try: the bundler resolves the static
 * requires; a plain node test run (no asset transform) gets null and the row
 * draws without media instead of failing to load the module.
 */
// The same five kinds as OfferingChooser's OfferingKind, spelled here so this
// module does not import the chooser back (I-PROPOSED-K require cycle).
type OfferingKind = "event" | "trip" | "experience" | "rsvp" | "venue";

export type OfferingMedia = { video: number; poster: number };

let cache: Record<OfferingKind, OfferingMedia> | null | undefined;

/* eslint-disable @typescript-eslint/no-require-imports */
function load(): Record<OfferingKind, OfferingMedia> | null {
  try {
    return {
      event: {
        video: require("../../../assets/offerings/offer-event.mp4") as number,
        poster: require("../../../assets/offerings/offer-event.jpg") as number,
      },
      experience: {
        video: require("../../../assets/offerings/offer-experience.mp4") as number,
        poster: require("../../../assets/offerings/offer-experience.jpg") as number,
      },
      trip: {
        video: require("../../../assets/offerings/offer-trip.mp4") as number,
        poster: require("../../../assets/offerings/offer-trip.jpg") as number,
      },
      rsvp: {
        video: require("../../../assets/offerings/offer-rsvp.mp4") as number,
        poster: require("../../../assets/offerings/offer-rsvp.jpg") as number,
      },
      venue: {
        video: require("../../../assets/offerings/offer-venue.mp4") as number,
        poster: require("../../../assets/offerings/offer-venue.jpg") as number,
      },
    };
  } catch (error) {
    console.warn("[offering-media] clips unavailable; rows draw without media", error);
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

export function offeringMedia(kind: OfferingKind): OfferingMedia | null {
  if (cache === undefined) cache = load();
  return cache?.[kind] ?? null;
}
