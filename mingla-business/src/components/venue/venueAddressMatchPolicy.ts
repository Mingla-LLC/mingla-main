/**
 * Issue #1648 — WHEN a picked address may be resolved against our directory.
 *
 * The server half (`venue-address-pool-match`) asks Google exactly one question
 * per call and that call costs money, so the decision to fire it lives here, in
 * one pure place the node-env Jest harness can actually exercise. The hook and
 * the card are thin around this.
 *
 * THE LOAD-BEARING RULE is `coordinatePrecision === "exact"`. Issue #1629 made
 * that field mean something real: Mapbox's own `feature_type` said `address` or
 * `poi`, i.e. the brand PICKED a specific building. The other two ways the draft
 * acquires a coordinate must never reach Google:
 *   - free text resolved by `resolveFreeTextLocation` → "approximate", a CITY
 *     centroid. Biasing a 200 m text search on a city centre would either miss
 *     or, worse, confidently return a same-named venue a mile away.
 *   - a `place`/`region` suggestion (someone picked "Raleigh") → "approximate"
 *     for the same reason.
 * A city is not an identity. Only a picked building is.
 *
 * The other gates are cheap correctness: never re-ask for a draft that is
 * already pool-linked or already in claim mode (`claim !== null`), and mirror
 * the edge function's own validation so an obviously-bad body never leaves the
 * device.
 */

/** The draft fields this decision reads — structurally satisfied by
 *  `DraftVenueState`, declared narrowly so the policy stays store-free. */
export interface AddressMatchDraft {
  formattedAddress: string;
  lat: number | null;
  lng: number | null;
  coordinatePrecision?: "exact" | "approximate" | null;
  placePoolId: string | null;
  claim: unknown;
}

/** Mirrors the edge function's own `addr.length < 4` rejection. */
export const ADDRESS_MATCH_MIN_LENGTH = 4;

/**
 * The identity of one lookup: null when this draft must not be looked up at
 * all, otherwise a string that changes if and only if the picked place changes.
 * The hook keys its request on this, so re-renders are free and a re-pick of the
 * SAME address never spends a second call.
 */
export function addressMatchQueryKey(draft: AddressMatchDraft): string | null {
  // Already claiming, or already linked to a pool row — there is nothing left
  // to recognise, and prompting again would be a second answer to a settled
  // question.
  if (draft.claim !== null && draft.claim !== undefined) return null;
  if (draft.placePoolId !== null) return null;

  // See the header: only a PICKED building is an identity signal.
  if (draft.coordinatePrecision !== "exact") return null;

  const address = draft.formattedAddress.trim();
  if (address.length < ADDRESS_MATCH_MIN_LENGTH) return null;

  const { lat, lng } = draft;
  if (lat === null || lng === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // 0,0 is the null-island sentinel a failed geocode leaves behind.
  if (lat === 0 && lng === 0) return null;

  return `${lat}|${lng}|${address}`;
}

/** Convenience predicate — identical truth to a non-null query key. */
export function shouldQueryAddressMatch(draft: AddressMatchDraft): boolean {
  return addressMatchQueryKey(draft) !== null;
}

/**
 * A found match is shown unless this brand already waved this exact place away
 * on this draft. Dismissal is per PLACE, not per address: re-picking the same
 * building must not resurrect a card they already answered.
 *
 * Deliberately NOT keyed to the name gate's rejections. Saying "no" to a fuzzy
 * NAME guess and saying "no" to an EXACT ADDRESS match are different answers to
 * different questions, and the address one is the stronger signal — the moment
 * worth spending a prompt on.
 */
export function shouldShowAddressMatch(
  match: { id: string } | null,
  dismissedPlacePoolIds: readonly string[] | null | undefined,
): boolean {
  if (match === null) return false;
  return !(dismissedPlacePoolIds ?? []).includes(match.id);
}
