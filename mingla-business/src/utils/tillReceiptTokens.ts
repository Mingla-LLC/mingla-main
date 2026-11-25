/**
 * #4490 spec 08 O1 (T20) — where a guest's Till receipt token lives on this
 * device. The token arrives once, in the URL FRAGMENT of the receipt link
 * (`/receipt/till/<paymentId>#t=<token>`), which a browser never sends to a
 * server. On arrival it is copied here and scrubbed from the address bar and
 * history (the same pattern as booking tokens), so it never sits in an
 * address the guest shares. Web only; every access is guarded.
 */
import { scrubVisitAddress, tokenFromFragment } from "./venueOfferBookingTokens";

const PREFIX = "mingla.receipt.token.";
const PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A derived receipt token: `kid.mac`. */
const TOKEN = /^[a-z0-9_-]{1,16}\.[A-Za-z0-9_-]{43}$/;

export const isTillReceiptToken = (value: unknown): value is string =>
  typeof value === "string" && TOKEN.test(value);

const storage = (): Storage | null => {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

export function readTillReceiptToken(paymentId: string): string | null {
  if (!PAYMENT_ID.test(paymentId)) return null;
  try {
    const value = storage()?.getItem(`${PREFIX}${paymentId.toLowerCase()}`) ?? null;
    return isTillReceiptToken(value) ? value : null;
  } catch {
    return null;
  }
}

/** Take the token from the fragment (if any), keep it here, scrub the address. */
export function adoptTillReceiptToken(paymentId: string): string | null {
  if (typeof window === "undefined" || typeof window.location === "undefined") return null;
  const raw = tokenFromFragment(window.location.hash);
  const token = isTillReceiptToken(raw) ? raw : null;
  if (token !== null && PAYMENT_ID.test(paymentId)) {
    try {
      storage()?.setItem(`${PREFIX}${paymentId.toLowerCase()}`, token);
    } catch {
      // storage full or blocked: the page still works for this visit
    }
  }
  if (window.location.hash.length > 0) scrubVisitAddress({ dropQuery: false });
  return token;
}
