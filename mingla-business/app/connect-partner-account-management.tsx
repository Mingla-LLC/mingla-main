/**
 * /connect-partner-account-management (NATIVE fallback) — ORCH-1052 follow-up.
 *
 * Expo Router requires every route under `app/` to have a non-platform-
 * specific sibling. Mirrors connect-partner-onboarding.tsx — Stripe
 * Connect Embedded Components are web-only; on native iOS/Android we
 * render a "open it from Partner Earnings instead" prompt. The web
 * variant takes over on Expo Web bundles.
 */

import React from "react";

import { NativeConnectWebOnlyFallback } from "../src/components/stripe/NativeConnectWebOnlyFallback";

export default function ConnectPartnerAccountManagementNativeRoute(): React.ReactElement {
  return (
    <NativeConnectWebOnlyFallback
      title="Open Stripe account management in the browser"
      body="Mingla opens Stripe account management in its hosted web page. Return to Partner Earnings and tap Manage Stripe account again to open it in the in-app browser."
    />
  );
}
