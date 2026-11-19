/**
 * #4490 P2-5 — the ONLY way to prove what the gate's pay-by-code QR may encode.
 *
 * A gate pay code is a link to one held walk-in booking that the guest pays on
 * their own phone: `<business web origin>/visit/<groupId>#t=<booking token>`
 * (built by the `venue-check-in` edge function; the token rides in the
 * fragment, which never reaches a server log). It is not an entry credential
 * for the gate: the pass is only issued once the payment is confirmed.
 * `VenuePayQr` accepts only the branded type minted here, so no other string
 * can reach the QR renderer.
 */

declare const venuePayUrlBrand: unique symbol;

export type VenuePayUrl = string & { readonly [venuePayUrlBrand]: true };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PAY_URL = new RegExp(`^https?://[^/\\s#?]+/visit/${UUID}#t=[A-Za-z0-9._~-]{16,200}$`, "i");

export const isVenuePayUrl = (value: unknown): value is VenuePayUrl =>
  typeof value === "string" && PAY_URL.test(value);

/** null when the server sent anything that is not a visit pay link. */
export const toVenuePayUrl = (value: unknown): VenuePayUrl | null => (isVenuePayUrl(value) ? value : null);

export class VenuePayUrlError extends Error {
  constructor() {
    super("Only a /visit/ pay link can be shown as a gate pay code.");
    this.name = "VenuePayUrlError";
  }
}

export const assertVenuePayUrl = (value: unknown): VenuePayUrl => {
  if (!isVenuePayUrl(value)) throw new VenuePayUrlError();
  return value;
};
