/**
 * webAnalytics.ts — NATIVE no-op stub.
 *   META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 2 (buyer web).
 *
 * Metro resolves the sibling `webAnalytics.web.ts` on web and THIS file on
 * native, so the native bundle NEVER imports posthog-js / gtag (mirrors the
 * mixpanelService.web.ts split). Native product analytics are added separately
 * in LEG 3 via posthog-react-native — this stub keeps the import surface stable
 * so the shared call sites (`captureWeb`, `initWebAnalytics`, …) compile and
 * no-op on native.
 *
 * Every export is a pure no-op. Do NOT import posthog-js here.
 */

const noopVoid = (..._args: unknown[]): void => {};

export const initWebAnalytics = async (): Promise<void> => {};
export const grantConsent = noopVoid;
export const denyConsent = noopVoid;
export const captureWeb = noopVoid;
export const gaEvent = noopVoid;
export const identifyWeb = noopVoid;
export const readStoredConsent = (): "granted" | "denied" | null => null;
export const getFeatureFlagWeb = (
  _key: string,
): boolean | string | undefined => undefined;

// ISSUE-865 WP-C — ad-conversion pixels + click capture are WEB-ONLY (the
// browser pixels + fbclid/ttclid cookies exist only in the web export). Native
// no-ops keep the shared import surface stable so app/e|t|b + the three checkout
// confirm pages + the checkout services compile and no-op on iOS/Android. The
// app deep-link attribution lane (WP-C2) ships separately in a native build.
export interface CaptureAdClickDest {
  pageType?: "event" | "trip" | "brand" | "venue";
  brandSlug?: string | null;
  entitySlug?: string | null;
  eventId?: string | null;
}
export const captureAdClickIds = (_dest?: CaptureAdClickDest): void => {};
export const fireAdPageView = noopVoid;
export const fireAdViewContent = noopVoid;
export const fireAdPurchase = (
  _eventId: string,
  _props: { value?: number; currency?: string },
): void => {};
// ISSUE-865 PR1 WP-2 — reservation (lead-type) browser fire is WEB-ONLY; native
// no-op keeps the .web/.native export surface at parity (i-1378 shim gate).
export const fireAdReservation = (
  _eventId: string,
  _props?: { value?: number; currency?: string },
): void => {};
export const adPixelsReady = (): boolean => false;
export const getStoredClickAttribution = (): { clickId: string | null } => ({
  clickId: null,
});
export const postAttributionTouch = async (
  _input: unknown,
): Promise<string | null> => null;
export const postAttributionConversion = noopVoid;
// ISSUE-855 PR-2 — referrer host is a web-only concept; native has no
// document.referrer. No-op keeps the .web/.native export surface at parity.
export const readReferrerHost = (): string | null => null;
