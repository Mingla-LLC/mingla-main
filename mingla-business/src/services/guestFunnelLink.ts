/**
 * guestFunnelLink — ORCH-1342 [web-see-whos-going-funnel] (META-ORCH-1337
 * Leg 5, SPEC §4.2).
 *
 * THE ONE smart URL builder for the buyer-web "See who's going" install gate:
 * while the guest-funnel OneLink is DARK (GUEST_FUNNEL_ONELINK_URL === null,
 * SPEC §4.1 flip constant) the gate opens the platform store directly and the
 * QR encodes the marketing smart-download page; once Seth flips the constant
 * at AppsFlyer go-live (COMMS-0083) BOTH the CTA and the QR emit the SAME
 * OneLink carrying the deferred guest-list payload.
 *
 * URL GRAMMAR (ORCHESTRATOR AMENDMENT A-1 — mirrors the consumer minting rail
 * app-mobile/src/services/oneLinkShare.ts; do NOT invent a second grammar):
 *   https://go.usemingla.com/w36m
 *     ?deep_link_value={event|trip|experience}   ('rsvp' maps to 'event' — the
 *                                                 resolver has no rsvp kind;
 *                                                 RSVP events ride /e/ exactly
 *                                                 like their public page)
 *     &deep_link_sub1={brandSlug}                (encodeURIComponent, §B.5.5)
 *     &deep_link_sub2={entitySlug}               (encodeURIComponent)
 *     &deep_link_sub3=guest-list                 (the ORCH-1342 landing
 *                                                 discriminator — parsed ONLY
 *                                                 by oneLinkResolver.ts)
 *     &pid=buyer_web&c=see_whos_going            (AppsFlyer media-source /
 *                                                 campaign — SPEC §10-4)
 *
 * Platform detection is copied VERBATIM from
 * mingla-marketing/lib/device-platform.ts (the reviewed ORCH-1319 trio incl.
 * the iPad-as-Mac maxTouchPoints catch) and pinned by
 * __tests__/orch_1342_guest_funnel_link.test.ts against the same cases.
 *
 * openExternal is the ORCH-1328 client-side store-open byte-pattern
 * (links-experience.tsx): window.open('_blank','noopener,noreferrer'),
 * popup-blocked → window.location.assign — the event page STAYS MOUNTED,
 * never a redirect (DESIGN §3.1; I-PROPOSED-1342-GATE-NEVER-NAMES-NEVER-
 * REDIRECTS).
 *
 * PURE module: no react, no react-native, no fetch — unit-testable under the
 * default node/ts-jest config.
 */

import {
  APP_STORE_URL,
  BUSINESS_INVITE_ONELINK_URL,
  DOWNLOAD_PAGE_URL,
  GUEST_FUNNEL_ONELINK_URL,
  PLAY_STORE_URL,
} from "../constants/storeLinks";

// ─── ORCH-1319 device-platform trio — VERBATIM copy (no behavior drift) ──────
// Source: mingla-marketing/lib/device-platform.ts. A unit test pins the
// iPad-as-Mac / Android / desktop cases against the originals.

// 3-way platform. 'other' = desktop / anything non-mobile-Apple and non-Android,
// so desktop NEVER resolves to iOS or Android.
export type Platform = "ios" | "android" | "other";

/** True for iPhone / iPad (incl. iPadOS reporting a desktop "MacIntel" UA). */
export function isIosDevice(
  ua: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  // Classic iOS UA.
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ Safari masquerades as desktop Mac: platform "MacIntel" +
  // a touch screen (maxTouchPoints > 1) ⇒ it is an iPad, not a Mac.
  if (platform === "MacIntel" && maxTouchPoints > 1) return true;
  return false;
}

/**
 * Resolve a 3-way platform from UA + platform + touch points. iOS wins first (an
 * iPad masquerading as Mac is still iOS); then Android by UA; everything else
 * (desktop incl. real Macs, Windows, Linux, ChromeOS) is 'other'.
 */
export function resolvePlatform(
  ua: string,
  platform: string,
  maxTouchPoints: number,
): Platform {
  if (isIosDevice(ua, platform, maxTouchPoints)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "other";
}

/** SSR-safe client platform read (never touches navigator at module load). */
export function detectClientPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  return resolvePlatform(
    navigator.userAgent ?? "",
    navigator.platform ?? "",
    navigator.maxTouchPoints ?? 0,
  );
}

// ─── The guest-funnel target (SPEC §4.2) ─────────────────────────────────────

export type GuestFunnelEntity = {
  entityType: "event" | "rsvp" | "trip" | "experience";
  brandSlug: string;
  entitySlug: string;
};

/** The analytics/store discriminator carried into §4.4.3-b captures. */
export type GuestFunnelStore = "app_store" | "play" | "download_page" | "onelink";

export type GuestFunnelTarget = {
  mode: "onelink" | "store_direct";
  ctaUrl: string;
  qrUrl: string;
  store: GuestFunnelStore;
};

/**
 * Compose the guest-funnel OneLink (SPEC §4.2). Returns null while DARK
 * (GUEST_FUNNEL_ONELINK_URL === null — the §4.1 go-live flip). Every slug is
 * encodeURIComponent-encoded (ORCH-1318 §B.5.5 — never raw-concat).
 * BINDING: `rsvp` maps to deep_link_value 'event' — the ONE resolver
 * (oneLinkResolver.ts) has no 'rsvp' discriminator; RSVP events ride the /e/
 * route exactly like their public page.
 */
export function buildGuestFunnelOneLinkUrl(e: GuestFunnelEntity): string | null {
  if (GUEST_FUNNEL_ONELINK_URL === null) return null;
  const value = e.entityType === "rsvp" ? "event" : e.entityType;
  const params = [
    `deep_link_value=${encodeURIComponent(value)}`,
    `deep_link_sub1=${encodeURIComponent(e.brandSlug.trim())}`,
    `deep_link_sub2=${encodeURIComponent(e.entitySlug.trim())}`,
    "deep_link_sub3=guest-list",
    "pid=buyer_web",
    "c=see_whos_going",
  ].join("&");
  return `${GUEST_FUNNEL_ONELINK_URL}?${params}`;
}

/**
 * Compose the BUSINESS-APP invite download target — ORCH-1378.
 *
 * ONE URL for every platform: the OneLink's own 301 IS the device-awareness
 * (curl-verified 2026-07-15 — Android → `market://…&referrer=af_tranid…`,
 * iOS → `apps.apple.com/US/app/id6768737367`). Branching client-side to a store
 * URL would DESTROY the `af_tranid` install attribution the OneLink exists to
 * carry — which is exactly the defect in `success.tsx`'s hand-rolled iOS/Android
 * button pair that ORCH-1378 replaces.
 *
 * Params mirror the `buildGuestFunnelOneLinkUrl` grammar above (the proven
 * precedent): the SSOT constant stays clean, the channel is minted here.
 *
 * Lives in THIS pure module (no react, no react-native) so it is unit-testable
 * under the node/ts-jest harness — the component that renders it cannot be
 * imported there.
 */
export function buildBusinessInviteDownloadUrl(): string {
  const params = ["pid=business_web", "c=brand_invite_accept"].join("&");
  return `${BUSINESS_INVITE_ONELINK_URL}?${params}`;
}

/**
 * Resolve the gate's CTA + QR targets for the detected platform.
 * - DARK (store_direct): CTA = platform store (iOS App Store / Play) or the
 *   smart-download page for 'other'; QR = the smart-download page (ONE QR
 *   serves both platforms — the ORCH-1319 mechanism).
 * - LIVE (onelink): CTA and QR are the SAME OneLink — the QR must always
 *   encode exactly what the CTA opens (dispatch rule; adversarial T-A7).
 */
export function resolveGuestFunnelTarget(
  e: GuestFunnelEntity,
  platform: Platform,
): GuestFunnelTarget {
  const oneLinkUrl = buildGuestFunnelOneLinkUrl(e);
  if (oneLinkUrl !== null) {
    return { mode: "onelink", ctaUrl: oneLinkUrl, qrUrl: oneLinkUrl, store: "onelink" };
  }
  const ctaUrl =
    platform === "ios"
      ? APP_STORE_URL
      : platform === "android"
        ? PLAY_STORE_URL
        : DOWNLOAD_PAGE_URL;
  const store: GuestFunnelStore =
    platform === "ios" ? "app_store" : platform === "android" ? "play" : "download_page";
  return { mode: "store_direct", ctaUrl, qrUrl: DOWNLOAD_PAGE_URL, store };
}

/**
 * THE ONE OWNER of "open an external destination" inside mingla-business —
 * ORCH-1382 (#917), extending ORCH-1381's single-owner invariant to this package.
 *
 * ⚠️ THE BUG THIS SHIPPED WITH, LIVE ON PRODUCTION:
 *
 *     const win = window.open(dest, '_blank', 'noopener,noreferrer')
 *     if (!win) window.location.assign(dest)   // "popup-blocked fallback"
 *
 * Per the HTML spec, `noopener` — and `noreferrer`, which IMPLIES `noopener` —
 * force window.open to return `null` EVEN ON SUCCESS. So `!win` was ALWAYS true
 * and the "fallback" fired on EVERY tap: a new tab opened AND the origin page
 * navigated away. Every single tap double-navigated.
 *
 * WHY IT MATTERED HERE SPECIFICALLY. This is the opener behind
 * `SeeWhosGoingGate.tsx:273`, whose contract
 * I-PROPOSED-1342-GATE-NEVER-NAMES-NEVER-REDIRECTS says the page "STAYS
 * MOUNTED, never a redirect". The bug VIOLATED that live invariant while the
 * invariant read GREEN — because ORCH-1381 fixed only the marketing copy and
 * scoped its gate to `mingla-marketing/lib/open-external.ts`. mingla-business has
 * NO import path to mingla-marketing (tsconfig `paths` maps only `@/*` and
 * `@mingla/*` → packages/*), so it kept its own broken twin. ORCH-1381's
 * single-owner invariant was, in this package, fiction.
 *
 * ⚠️ THE HALF-FIX TRAP (browser-verified, ORCH-1381 ADDENDUM C-4): `noreferrer`
 * ALONE also returns null. Dropping only `noopener` reships the IDENTICAL bug
 * with no visible difference. BOTH tokens must stay absent — the gate
 * `.github/scripts/strict-grep/orch-1381-open-external-no-double-nav.mjs` now
 * covers THIS file too and bans both, case-insensitively.
 *
 * SECURITY: dropping `noopener` loses nothing — `win.opener = null` severs the
 * reference synchronously, before any script in the popup can run, so reverse
 * tabnabbing remains impossible.
 *
 * REFERRER: dropping `noreferrer` lets the `Referer` header reach the
 * destination. ACCEPTED (Seth, ORCH-1381 OQ-2, 2026-07-15): these are Mingla's
 * own store listings, no PII, useful attribution.
 *
 * `w` is injectable so the behaviour is testable with a fake Window that
 * reproduces the null-on-success contract. No-op outside a browser.
 */
export function openExternal(dest: string, w: Window | undefined = typeof window === "undefined" ? undefined : window): void {
  if (w === undefined) return;
  // NO feature string — see the docblock. Either token nulls the return.
  const win = w.open(dest, "_blank");
  if (win) {
    // Preserve the noopener SECURITY property without the null-return side effect.
    win.opener = null;
  } else {
    // Genuine popup block → no silent failure, no dead tap.
    w.location.assign(dest);
  }
}

/**
 * Open a NON-http app scheme (`com.mingla.app.v2://…`) from buyer-web —
 * issue #2326. Same owner file as `openExternal` on purpose: this package gets
 * exactly one module that is allowed to move the browser.
 *
 * WHY THIS IS A SEPARATE FUNCTION AND NOT `openExternal`. A custom scheme must
 * be assigned to the CURRENT tab, never handed to a new one:
 *
 *  - `openAttendanceClaimWithFallback` decides "the app took the navigation"
 *    from `document.visibilitychange` on THIS page. Handing the scheme to a new
 *    tab leaves this page visible no matter what the app does, so the 1200 ms
 *    store fallback fires even on the success path — the buyer gets bounced to
 *    the store immediately after Mingla opened.
 *  - A new tab pointed at a scheme no app handles is a dead tab the buyer has
 *    to find and close.
 *
 * Assigning in-place has neither problem: if an app claims the scheme the OS
 * takes over and this page is backgrounded (which is exactly the signal the
 * fallback watches for); if nothing claims it the page simply stays put and the
 * fallback sends the same tap to the store.
 *
 * MUST stay synchronous — it is called from inside a tap handler and a browser
 * only honours a navigation while the user gesture is still live.
 */
export function openAppScheme(dest: string, w: Window | undefined = typeof window === "undefined" ? undefined : window): void {
  if (w === undefined) return;
  w.location.assign(dest);
}

/**
 * Compose the CONFIRMATION-SCREEN app target — issue #2217.
 *
 * The confirmation screen used to carry TWO buttons ("Open in Mingla" and a
 * hardcoded "Google Play"), because `DownloadMinglaCta` branched on
 * `Platform.OS` — which is `'web'` for every buyer on buyer-web, so the iOS and
 * Android arms were BOTH dead there and the second badge sent an iPhone to the
 * Play Store. #2217 replaces the pair with ONE button whose destination is
 * resolved from the BROWSER (`detectClientPlatform`, the reviewed ORCH-1319
 * trio above), not from `Platform.OS`.
 *
 * Grammar mirrors `buildGuestFunnelOneLinkUrl` exactly — same SSOT base, same
 * deep_link_* payload — and mints its OWN channel (`c=ticket_confirmation`) at
 * the call site, the `buildBusinessInviteDownloadUrl` precedent. Returns null
 * while the guest funnel is DARK (`GUEST_FUNNEL_ONELINK_URL === null`).
 */
export function buildConfirmationFunnelOneLinkUrl(
  e: GuestFunnelEntity,
): string | null {
  if (GUEST_FUNNEL_ONELINK_URL === null) return null;
  const value = e.entityType === "rsvp" ? "event" : e.entityType;
  const params = [
    `deep_link_value=${encodeURIComponent(value)}`,
    `deep_link_sub1=${encodeURIComponent(e.brandSlug.trim())}`,
    `deep_link_sub2=${encodeURIComponent(e.entitySlug.trim())}`,
    "deep_link_sub3=guest-list",
    "pid=buyer_web",
    "c=ticket_confirmation",
  ].join("&");
  return `${GUEST_FUNNEL_ONELINK_URL}?${params}`;
}

/**
 * Resolve the ONE confirmation-screen button's destination (issue #2217).
 *
 * LIVE (onelink): one URL for every platform — the OneLink's own 301 IS the
 * device-awareness and it carries the `af_tranid` install referrer.
 * DARK (store_direct): iOS → App Store, Android → Play, desktop → the smart
 * download page. `qrUrl` mirrors `ctaUrl` on the live arm and the smart
 * download page on the dark arm, exactly like `resolveGuestFunnelTarget`, so
 * the two resolvers can never disagree about what a QR encodes.
 *
 * NEVER returns a store URL for `platform === 'other'`: a desktop buyer must
 * not be dropped into a mobile store listing.
 */
export function resolveConfirmationAppTarget(
  e: GuestFunnelEntity,
  platform: Platform,
): GuestFunnelTarget {
  const oneLinkUrl = buildConfirmationFunnelOneLinkUrl(e);
  if (oneLinkUrl !== null) {
    return { mode: "onelink", ctaUrl: oneLinkUrl, qrUrl: oneLinkUrl, store: "onelink" };
  }
  const ctaUrl =
    platform === "ios"
      ? APP_STORE_URL
      : platform === "android"
        ? PLAY_STORE_URL
        : DOWNLOAD_PAGE_URL;
  const store: GuestFunnelStore =
    platform === "ios" ? "app_store" : platform === "android" ? "play" : "download_page";
  return { mode: "store_direct", ctaUrl, qrUrl: DOWNLOAD_PAGE_URL, store };
}
