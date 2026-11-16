/**
 * webPrivacyGuards.web.ts — #4238 buyer-web privacy guards, loaded on arrival.
 *
 * webAnalytics.web.ts awaits this chunk at the top of initWebAnalytics, at the
 * top of the analytics boot (before GA4 and posthog.init, so before_send and
 * the stored first-page scrub are in place) and before any ad pixel boots, so
 * every check here runs before PostHog, GA4 or a pixel can see the address. It lives outside
 * the eager web chunk (#3493 boot payload); until it has loaded, the callers
 * treat the document as blocked (no pixel boots or fires).
 */
import { isAdPixelRoute } from "../utils/coldLoadAuthGates";
import type { CaptureResult, PostHog } from "posthog-js";
import {
  hasPrivateUrlToken,
  PRIVATE_URL_QUERY_KEYS,
  stripPrivateUrlParams,
  stripPrivateUrlProperties,
} from "../utils/privateUrlTokens";

/** posthog-js masks these keys in the addresses it stores (P1-R4). */
export { PRIVATE_URL_QUERY_KEYS };

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/**
 * #4238 P1-5 (I-4238-NO-PRIVATE-TOKEN-TO-PIXELS): once this document's address
 * has carried a buyer return page's private keys (`bst`, `csi`, `cs`, …), no
 * third-party ad pixel boots or fires for the rest of the document. Sticky on
 * purpose: a vendor's own SPA history tracking (TikTok measures every URL
 * change by default) would otherwise see the token again on a back
 * navigation. The confirmation's Purchase still reaches every platform from
 * the server (CAPI, same event_id = the order id). The address is not
 * rewritten: the confirm pages read these keys, and a refresh must resume.
 */
let privateTokenSeen = false;

export function privateTokenDocument(): boolean {
  if (privateTokenSeen) return true;
  if (!hasWindow()) return false;
  const location = (window as unknown as {
    location?: { search?: unknown; hash?: unknown };
  }).location;
  const search = typeof location?.search === "string" ? location.search : "";
  const hash = typeof location?.hash === "string" ? location.hash : "";
  if (hasPrivateUrlToken(search) || hasPrivateUrlToken(hash)) {
    privateTokenSeen = true;
  }
  return privateTokenSeen;
}

/** #4238 W2-4 (I-4238-NO-BUYER-PIXEL-ON-HOST-ROUTES). */
export function pixelRouteAllowed(pathname: string | null): boolean {
  if (privateTokenDocument()) return false;
  return pathname === null || isAdPixelRoute(pathname);
}

/** The live address, without a buyer return page's private keys. */
function sanitizedHref(): string {
  const href = (window as unknown as { location?: { href?: unknown } }).location
    ?.href;
  return typeof href === "string" ? stripPrivateUrlParams(href) : "";
}

/**
 * #4238 P1-5: GA4 reads the address and referrer itself for every hit,
 * including automatic (enhanced measurement) events. In a document whose
 * address or referrer carried a buyer return page's private keys, sanitized
 * values are set as the tag-wide defaults (and kept current on every route,
 * so a later page is never reported under the stale one). Any other document
 * is left to GA4's own defaults (#3176 config unchanged).
 */
export function gaPageFields(): Record<string, string> {
  const referrer =
    typeof window.document?.referrer === "string" ? window.document.referrer : "";
  if (!privateTokenDocument() && !hasPrivateUrlToken(referrer)) return {};
  const fields: Record<string, string> = {};
  const location = sanitizedHref().split("#", 1)[0] ?? "";
  if (location) fields.page_location = location;
  if (referrer) fields.page_referrer = stripPrivateUrlParams(referrer);
  return fields;
}

export function refreshGaPageFields(): void {
  if (!hasWindow()) return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== "function") return;
  const fields = gaPageFields();
  if (Object.keys(fields).length === 0) return;
  try {
    gtag("set", fields);
  } catch (err) {
    console.warn("[webAnalytics] GA4 page fields failed (non-fatal):", err);
  }
}

// ── #4238 W3-3 / W3-4: host-funnel browser state (host web only) ────────────

/** Set after any successful host sign-in in this browser. */
const HOST_KNOWN_ACCOUNT_KEY = "mingla_host_known_account";
/** The last host sign-up-started id and when it was minted. */
const HOST_SIGNUP_STARTED_KEY = "mingla_hss_v1";
const HOST_SIGNUP_STARTED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Remember that this browser has signed in to a host account. */
export function markHostKnownAccount(): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(HOST_KNOWN_ACCOUNT_KEY, "1");
  } catch {
    // Storage unavailable: a later sign-up-started may fire once more.
  }
}

/**
 * #4238 W3-4: the first sign-in attempt (email code request, Google or Apple
 * tap) of a browser that has never signed in to a host account fires
 * HostSignUpStarted once per 24 h, browser only (no identity exists yet).
 * Returns the minted `hss:<uuid>` id, or null when nothing fired. The caller
 * has already checked that ads are on and passes the pixel sender.
 */
export function fireHostSignUpStarted(
  fire: (eventId: string) => void,
): string | null {
  if (!hasWindow()) return null;
  try {
    const storage = window.localStorage;
    if (storage.getItem(HOST_KNOWN_ACCOUNT_KEY) !== null) return null;
    const prior = JSON.parse(storage.getItem(HOST_SIGNUP_STARTED_KEY) ?? "null") as
      | { at?: unknown }
      | null;
    if (
      prior !== null &&
      typeof prior.at === "number" &&
      Date.now() - prior.at < HOST_SIGNUP_STARTED_WINDOW_MS
    ) {
      return null;
    }
    const uuid =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const eventId = `hss:${uuid}`;
    storage.setItem(
      HOST_SIGNUP_STARTED_KEY,
      JSON.stringify({ id: eventId, at: Date.now() }),
    );
    fire(eventId);
    return eventId;
  } catch {
    return null;
  }
}

// ── #4238 P1-5 / P1-R4: PostHog private-URL scrub ───────────────────────────

/**
 * No PostHog event (custom, autocapture, exception, replay) carries a buyer
 * return page's private keys in any URL-bearing property.
 */
export function stripPrivateEventUrls(event: CaptureResult): CaptureResult {
  return {
    ...event,
    properties: stripPrivateUrlProperties(
      (event.properties ?? {}) as Record<string, unknown>,
    ) as CaptureResult["properties"],
    ...(event.$set
      ? { $set: stripPrivateUrlProperties(event.$set as Record<string, unknown>) }
      : {}),
    ...(event.$set_once
      ? {
          $set_once: stripPrivateUrlProperties(
            event.$set_once as Record<string, unknown>,
          ),
        }
      : {}),
  };
}

/**
 * PostHog stores the first page's address once (`$initial_person_info`) and
 * sends it as person properties with every flags request, which never passes
 * through before_send. Rewrite the stored copy without a buyer return page's
 * private keys, right after init (before the first flags request) and for a
 * copy persisted on an earlier visit.
 */
const POSTHOG_INITIAL_PERSON_INFO = "$initial_person_info";
const POSTHOG_CLIENT_SESSION_PROPS = "$client_session_props";

export function scrubPostHogInitialPersonInfo(posthog: PostHog): void {
  try {
    const persistence = posthog.persistence;
    if (persistence === undefined || persistence === null) return;
    const props = persistence.props as Record<string, unknown> | undefined;
    const updates: Record<string, unknown> = {};
    const info = props?.[POSTHOG_INITIAL_PERSON_INFO];
    if (info !== null && typeof info === "object") {
      const record = info as Record<string, unknown>;
      const next = stripPrivateUrlProperties(record);
      if (next.u !== record.u || next.r !== record.r) {
        updates[POSTHOG_INITIAL_PERSON_INFO] = next;
      }
    }
    // The per-session first page ({ sessionId, props: { r, u } }).
    const session = props?.[POSTHOG_CLIENT_SESSION_PROPS];
    if (session !== null && typeof session === "object") {
      const sessionRecord = session as Record<string, unknown>;
      const next = stripPrivateUrlProperties(sessionRecord);
      if (JSON.stringify(next) !== JSON.stringify(sessionRecord)) {
        updates[POSTHOG_CLIENT_SESSION_PROPS] = next;
      }
    }
    if (Object.keys(updates).length === 0) return;
    persistence.register(updates);
  } catch (err) {
    console.warn("[webAnalytics] PostHog initial URL scrub failed (non-fatal):", err);
  }
}
