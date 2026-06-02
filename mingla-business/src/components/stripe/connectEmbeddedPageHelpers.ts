/**
 * Shared layout + viewport helpers for the Mingla-hosted Stripe Connect
 * Embedded Components pages (ORCH-1056).
 *
 * Background: on 2026-06-02 we shipped two hotfixes to the PARTNER pages
 * (connect-partner-onboarding.web.tsx + connect-partner-account-management
 * .web.tsx):
 *   1. Absolute-positioned page wrapper — react-native-web compiles to a
 *      fixed-viewport root (`html, body, #root { height: 100%; overflow:
 *      hidden }`), so we make the page wrapper an absolute-positioned scroll
 *      container with `overflowY: auto`. This avoids mutating root-level
 *      styles (which would break RN-web layout elsewhere) while letting the
 *      Stripe iframe scroll naturally inside the wrapper. Fix for iOS
 *      WKWebView scrolling regression.
 *   2. Viewport meta tag override — Stripe's embedded form inputs use
 *      font-size < 16px, which triggers iOS Safari to auto-zoom on focus.
 *      Override the viewport tag with `maximum-scale=1, user-scalable=no`
 *      on mount; restore on unmount so other pages keep pinch-zoom.
 *
 * ORCH-1056 backports those fixes to the BRAND pages
 * (connect-onboarding.web.tsx + connect-account-management.web.tsx) and
 * institutionalizes the shared module so every future Connect Embedded
 * Components page in mingla-business inherits both behaviors automatically.
 *
 * Stripe docs:
 *   - https://docs.stripe.com/connect/embedded-components/quickstart
 *     (Account Onboarding / Account Management embedded components)
 *   - https://docs.stripe.com/connect/embedded-components/customization
 *     (iframe behavior, viewport considerations)
 */

import { useEffect } from "react";
import type { CSSProperties } from "react";

/**
 * Absolute-positioned scroll wrapper for Connect Embedded pages.
 *
 * Apply as the root <div style={pageWrapperStyle}> on every connect-*.web
 * .tsx page. Critically uses position:absolute + inset:0 + overflowY:auto
 * to detach from the RN-web fixed-viewport root without forcing global
 * style overrides.
 */
export const pageWrapperStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  backgroundColor: "#FAFAFA",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

/**
 * Override the viewport meta tag on mount to block iOS Safari's auto-zoom
 * when the user focuses one of Stripe's embedded inputs (font-size < 16px).
 * Restores the original tag on unmount so other pages keep normal
 * pinch-zoom behavior.
 *
 * No-op on platforms where `document` is undefined (e.g. RN native, SSR).
 */
export function useStripeConnectViewportZoomLock(): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute("content");
    meta.setAttribute(
      "content",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, shrink-to-fit=no",
    );
    return () => {
      if (original) meta.setAttribute("content", original);
    };
  }, []);
}

/**
 * Bundle of additional shared styles used by all Connect Embedded pages.
 * Each page may override per-instance, but starting from a consistent base
 * is one of the reasons this module exists.
 */
export const connectEmbeddedPageStyles = {
  pageWrapperStyle,
  headerStyle: {
    padding: "24px 24px 16px",
    textAlign: "center" as const,
    borderBottom: "1px solid #E5E7EB",
    backgroundColor: "#FFFFFF",
  } satisfies CSSProperties,
  headerTitleStyle: {
    fontSize: "20px",
    fontWeight: 600,
    margin: 0,
    color: "#0F172A",
  } satisfies CSSProperties,
  mainStyle: {
    padding: "24px",
    maxWidth: "780px",
    width: "100%",
    margin: "0 auto",
    boxSizing: "border-box" as const,
  } satisfies CSSProperties,
  footerStyle: {
    padding: "16px 24px",
    borderTop: "1px solid #E5E7EB",
    backgroundColor: "#FFFFFF",
    textAlign: "center" as const,
  } satisfies CSSProperties,
  footerTextStyle: {
    fontSize: "13px",
    color: "#475569",
    margin: 0,
  } satisfies CSSProperties,
  errorCardStyle: {
    maxWidth: "480px",
    margin: "80px auto",
    padding: "32px",
    backgroundColor: "#FFFFFF",
    border: "1px solid #FCA5A5",
    borderRadius: "12px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  } satisfies CSSProperties,
  errorTitleStyle: {
    fontSize: "20px",
    fontWeight: 600,
    margin: "0 0 12px",
    color: "#0F172A",
  } satisfies CSSProperties,
  errorBodyStyle: {
    fontSize: "15px",
    lineHeight: 1.5,
    margin: 0,
    color: "#475569",
  } satisfies CSSProperties,
  loadingCardStyle: {
    maxWidth: "480px",
    margin: "80px auto",
    padding: "32px",
    textAlign: "center" as const,
    color: "#475569",
  } satisfies CSSProperties,
} as const;
