// @mingla/offering-rendering — issue #2469 [explorer-venue-name-duplicated].
//
// THE ONE place a public event's location is split into its two display halves.
//
// WHY IT LIVES IN THIS PACKAGE. Three surfaces need this rule and they live in
// three different npm projects: `mingla-business/src/services/publicEventsService.ts`
// (buyer web + business), `app-mobile/src/components/ConnectionsPage.tsx` and
// `app-mobile/src/services/publicEventSeedService.ts` (the explorer). An app's
// `src/` is not reachable from another app, so a shared package is the only home
// that can hold ONE owner. It sits beside `mapsDeepLink.ts` because the label it
// produces is exactly what that builder puts on the pin.
//
// PURITY CONTRACT: this file imports NOTHING. `publicEventSeedService.ts` is
// loaded directly by `deno test`, and it reaches this module by relative path
// under `--unstable-sloppy-imports` (see the workflows that run it), so nothing
// here may pull react, react-native or any app module.
//
// THE BUG THIS CLOSES
// -------------------
// `events.location_text` is a COMBINED string:
//
//   "Didi Museum  · Akin Adesola Street 175, Lagos 10, Lagos, Nigeria"
//
// Two explorer mappers assigned that WHOLE string to the card's `address` while
// separately rendering `venueName`, so the explorer printed the venue name twice
// and then fed the doubled string to the maps deep link
// ("Didi Museum, Didi Museum  · Akin Adesola Street 175, ...") — which is why
// #2468 reproduced most reliably on the explorer.

export interface PublicEventLocationParts {
  /** The venue's own name, e.g. "Didi Museum". Never the combined string. */
  venueName: string | null;
  /**
   * The STREET address only, e.g. "Akin Adesola Street 175, Lagos 10, Lagos,
   * Nigeria". Never carries the venue name when `venueName` is non-null.
   */
  address: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Split a public-event row's location into `{ venueName, address }`, reading
 * `public_theme -> business_event -> location`.
 *
 * `locationText` (the combined `events.location_text`) is the fallback ONLY when
 * the parsed object is absent, and it is then assigned to exactly ONE half:
 *
 *   parsed venueName + parsed address -> both, as stored (the normal case)
 *   parsed venueName only             -> venueName; address null
 *   parsed address only               -> address; venueName null
 *   neither                           -> the whole locationText lands on
 *                                        `venueName` ALONE, address null
 *
 * THE INVARIANT: the combined string is NEVER returned in BOTH halves, and never
 * on `address` while `venueName` is also non-null.
 *
 * The fallback lands on `venueName` rather than `address` for a concrete reason:
 * every shared renderer gates the whole "Where you'll be" card on
 * `event.venueName !== null` (EventOfferingBody, PublicEventPage,
 * RsvpOfferingBody). Putting it on `address` would hide the card outright —
 * which is the second half of #2469.
 *
 * DE-DUPLICATION (tester P3-1 on PR #2479). When the two STORED halves are
 * byte-identical the row is carrying the same fact twice, and returning both
 * reproduces #2469's exact symptom from data rather than from a mapper — the
 * name renders twice and the maps label becomes "X, X". The address half is
 * dropped, because `venueName` is the half the card's render gate reads.
 *
 * Never fabricates: a half the row cannot supply comes back null
 * (Constitution #9).
 */
export function extractPublicEventLocation(
  publicTheme: unknown,
  locationText: string | null | undefined,
): PublicEventLocationParts {
  const businessEvent = asRecord(asRecord(publicTheme).business_event);
  const location = asRecord(businessEvent.location);

  const parsedVenueName =
    asTrimmedString(location.venueName) ??
    asTrimmedString(businessEvent.venueName);
  const parsedAddress = asTrimmedString(location.address);
  const combined = asTrimmedString(locationText);

  if (parsedVenueName !== null || parsedAddress !== null) {
    // The same fact stored twice is still one fact.
    if (parsedVenueName !== null && parsedVenueName === parsedAddress) {
      return { venueName: parsedVenueName, address: null };
    }
    return { venueName: parsedVenueName, address: parsedAddress };
  }

  // No parsed halves at all. The combined string is the only honest thing we
  // hold, and it goes to ONE slot — assigning it to both is the #2469 defect.
  return { venueName: combined, address: null };
}
