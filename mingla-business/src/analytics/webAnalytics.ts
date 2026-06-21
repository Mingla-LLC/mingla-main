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
