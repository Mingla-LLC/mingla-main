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
 * ORCH-1328 client-side open byte-pattern (links-experience.tsx precedent):
 * open in a NEW context on the tap gesture so the event page stays mounted;
 * popup-blocked (window.open → null) → same-tab location.assign fallback (no
 * dead tap, T-A8). Never `location.href=` as the primary. No-op outside a
 * browser (the gate only ever opens on web).
 */
export function openExternal(dest: string): void {
  if (typeof window === "undefined") return;
  const win = window.open(dest, "_blank", "noopener,noreferrer");
  if (!win) window.location.assign(dest);
}
