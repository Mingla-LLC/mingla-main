/**
 * #4490 P2 — where a signed-out guest's booking token lives on this device.
 *
 * The token is the guest's key to their booking (read, pay, cancel). It is
 * returned once by `hold`, and arrives in a link only in the URL FRAGMENT
 * (`/visit/<groupId>#t=<token>`: emails and the gate's pay code), which a
 * browser never sends to a server. On arrival the fragment is copied here and
 * scrubbed from the address bar and history (the #1221 pattern), so the token
 * never sits in a URL the guest shares and never goes to the payment provider:
 * the provider only ever sees `/visit/<groupId>?paid=1`, and the page finds the
 * token here when the guest comes back on the same device.
 *
 * Keyed by group id. Web only (native has no `window.localStorage`); every
 * access is guarded so a blocked or full storage never breaks the page.
 */
const PREFIX = "mingla.visit.token.";
const CART_KEY = "mingla.visit.cart";
const GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^(?:[a-z0-9_-]{1,16}\.)?[A-Za-z0-9_-]{43}$/;

const storage = (): Storage | null => {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

export const isVenueOfferBookingToken = (value: unknown): value is string =>
  typeof value === "string" && TOKEN.test(value);

export function saveVenueOfferBookingToken(groupId: string, token: string): void {
  if (!GROUP_ID.test(groupId) || !isVenueOfferBookingToken(token)) return;
  try {
    storage()?.setItem(`${PREFIX}${groupId.toLowerCase()}`, token);
  } catch {
    // storage full or blocked: the page still works for this visit
  }
}

export function readVenueOfferBookingToken(groupId: string): string | null {
  if (!GROUP_ID.test(groupId)) return null;
  try {
    const value = storage()?.getItem(`${PREFIX}${groupId.toLowerCase()}`) ?? null;
    return isVenueOfferBookingToken(value) ? value : null;
  } catch {
    return null;
  }
}

/** The token in a `#t=<token>` fragment, or null. */
export function tokenFromFragment(hash: string | null | undefined): string | null {
  if (typeof hash !== "string" || hash.length < 2) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("t");
  return isVenueOfferBookingToken(token) ? token : null;
}

/**
 * Take the token from the address bar's fragment (if any), keep it on this
 * device, and remove the fragment from the address bar and history.
 */
export function adoptFragmentToken(groupId: string): string | null {
  if (typeof window === "undefined" || typeof window.location === "undefined") return null;
  const token = tokenFromFragment(window.location.hash);
  if (token !== null) saveVenueOfferBookingToken(groupId, token);
  if (window.location.hash.length > 0) scrubVisitAddress({ dropQuery: false });
  return token;
}

/**
 * Remove the fragment (and, when asked, the query such as `?paid=1&reference=…`)
 * from the address bar and the current history entry. The router may rewrite
 * the address once while it settles after load, so this runs now and again a
 * moment later.
 */
export function scrubVisitAddress(options: { dropQuery: boolean }): void {
  if (typeof window === "undefined" || typeof window.history === "undefined") return;
  const scrub = (): void => {
    try {
      const { pathname, search, hash } = window.location;
      const nextSearch = options.dropQuery ? "" : search;
      if (hash.length === 0 && nextSearch === search) return;
      window.history.replaceState(window.history.state, "", `${pathname}${nextSearch}`);
    } catch {
      // a browser that refuses replaceState keeps the address; nothing breaks
    }
  };
  scrub();
  window.setTimeout(scrub, 400);
  window.setTimeout(scrub, 1500);
}

const PAY_URL_PREFIX = "mingla.visit.payurl.";

/**
 * The secure payment page opened for a booking in this tab, so a guest who
 * stepped back from it can continue the SAME payment (a second one is refused
 * while the first is still open). Session-only.
 */
export function rememberVenueOfferPayUrl(groupId: string, url: string): void {
  if (!GROUP_ID.test(groupId) || !/^https:\/\//.test(url)) return;
  try {
    window.sessionStorage.setItem(`${PAY_URL_PREFIX}${groupId.toLowerCase()}`, url);
  } catch {
    // no storage: the guest can still check the payment
  }
}

export function recallVenueOfferPayUrl(groupId: string): string | null {
  if (!GROUP_ID.test(groupId)) return null;
  try {
    const url = window.sessionStorage.getItem(`${PAY_URL_PREFIX}${groupId.toLowerCase()}`);
    return url !== null && /^https:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A random 43-character cart key (the guest's identity before the hold). */
export function newCartKey(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  const bytes = new Uint8Array(32);
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return base64Url(bytes);
}

/** This browser's cart key, made once and kept (so a retried hold matches its quote). */
export function venueOfferCartKey(): string {
  try {
    const store = storage();
    const existing = store?.getItem(CART_KEY) ?? null;
    if (existing !== null && /^[A-Za-z0-9_-]{32,64}$/.test(existing)) return existing;
    const next = newCartKey();
    store?.setItem(CART_KEY, next);
    return next;
  } catch {
    return newCartKey();
  }
}

const LAST_HOLD_PREFIX = "mingla.visit.lasthold.";

/** The booking this tab last held for an offer (so checkout can offer to continue it). */
export function rememberLastHold(offerId: string, groupId: string): void {
  if (!GROUP_ID.test(offerId) || !GROUP_ID.test(groupId)) return;
  try {
    window.sessionStorage.setItem(`${LAST_HOLD_PREFIX}${offerId.toLowerCase()}`, groupId.toLowerCase());
  } catch {
    // no storage: checkout simply starts fresh
  }
}

export function recallLastHold(offerId: string): string | null {
  if (!GROUP_ID.test(offerId)) return null;
  try {
    const value = window.sessionStorage.getItem(`${LAST_HOLD_PREFIX}${offerId.toLowerCase()}`);
    return value !== null && GROUP_ID.test(value) ? value : null;
  } catch {
    return null;
  }
}
