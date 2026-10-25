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
// #2331 — the privacy bar is web-only; native consent is asked in onboarding.
export interface PrivacyChoice {
  analytics: boolean;
  ads: boolean;
  ts: number;
}
export interface PrivacySnapshot {
  saved: boolean;
  analytics: boolean;
  ads: boolean;
  gpc: boolean;
}
export const PRIVACY_STORAGE_KEY = "mingla_privacy_v2";
export const LEGACY_CONSENT_STORAGE_KEY = "mingla_consent_v1";
export const savePrivacyChoice = async (_input: {
  analytics: boolean;
  ads: boolean;
}): Promise<void> => {};
export const readPrivacyChoice = (): PrivacyChoice | null => null;
export const parseLegacyConsentRecord = (
  _raw: string | null,
): PrivacyChoice | null => null;
export const isAnalyticsOn = (): boolean => false;
export const isAdsOn = (): boolean => false;
export const globalPrivacyControlOn = (): boolean => false;
const NATIVE_PRIVACY_SNAPSHOT: PrivacySnapshot = {
  saved: true,
  analytics: false,
  ads: false,
  gpc: false,
};
export const getPrivacySnapshot = (): PrivacySnapshot => NATIVE_PRIVACY_SNAPSHOT;
export const subscribePrivacy = (_subscriber: () => void): (() => void) => () => {};
export const captureWeb = noopVoid;
export const gaEvent = noopVoid;
export const captureWebSearchOutcome = noopVoid;
export const isHostPublicInventoryPathname = (_pathname: string): boolean => false;
export const captureHostPublicSearchPageView = (_pathname: string): void => {};
export const identifyWeb = noopVoid;
export const getFeatureFlagWeb = (
  _key: string,
): boolean | string | undefined => undefined;

// ISSUE-865 WP-C — ad-conversion pixels + click capture are WEB-ONLY (the
// browser pixels + fbclid/ttclid cookies exist only in the web export). Native
// no-ops keep the shared import surface stable so app/e|t|b + the three checkout
// confirm pages + the checkout services compile and no-op on iOS/Android. The
// app deep-link attribution lane (WP-C2) ships separately in a native build.
export interface CaptureAdClickDest {
  pageType?: "event" | "trip" | "brand" | "venue" | "experience";
  brandSlug?: string | null;
  entitySlug?: string | null;
  eventId?: string | null;
}
export const captureAdClickIds = (_dest?: CaptureAdClickDest): void => {};
export const fireAdPageView = noopVoid;
export const fireAdViewContent = noopVoid;
export const fireAdPurchase = (
  _eventId: string,
  _props: AdCommerceEventProps,
): void => {};
// ISSUE-865 PR1 WP-2 — reservation (lead-type) browser fire is WEB-ONLY; native
// no-op keeps the .web/.native export surface at parity (i-1378 shim gate).
export const fireAdReservation = (
  _eventId: string,
  _props?: AdCommerceEventProps,
): void => {};
export const fireAdInitiateCheckout = (
  _eventId: string,
  _props?: AdCommerceEventProps,
): void => {};
export interface AdCommerceEventProps {
  value?: number;
  currency?: string;
  contentId?: string;
  brandId?: string;
}
export const identifyAdBuyer = async (_input: {
  email?: string | null;
  phone?: string | null;
}): Promise<void> => {};
export const adPixelsReady = (): boolean => false;
export const getStoredClickAttribution = (): { clickId: string | null } => ({
  clickId: null,
});
export const getStoredAdMatchData = (): {
  fbp: string | null;
  fbc: string | null;
  scid: string | null;
  ttp: string | null;
  clientUserAgent: string | null;
  trackingOptOut: boolean;
} => ({
  fbp: null,
  fbc: null,
  scid: null,
  ttp: null,
  clientUserAgent: null,
  trackingOptOut: false,
});
export const postAttributionTouch = async (
  _input: unknown,
): Promise<string | null> => null;
export const postAttributionConversion = noopVoid;
// ISSUE-855 PR-2 — referrer host is a web-only concept; native has no
// document.referrer. No-op keeps the .web/.native export surface at parity.
export const readReferrerHost = (): string | null => null;
