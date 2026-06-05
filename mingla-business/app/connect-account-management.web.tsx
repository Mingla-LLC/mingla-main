/**
 * /connect-account-management — Mingla-hosted Stripe Connect management page.
 *
 * ORCH-1083: the heavy body (Stripe Connect web SDK + embedded components) is
 * code-split out of the initial web bundle via React.lazy. The body lives in
 * src/components/stripe/connect-pages/ConnectAccountManagementBody.web.tsx — it
 * is the ONLY place that statically imports @stripe/*. DO NOT re-add a static
 * @stripe/connect-js / @stripe/react-connect-js import here. See SPEC §C-1.
 *
 * Web-only Path B surface opened from mingla-business via expo-web-browser.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — web-only Stripe Connect Embedded Components page; renders DOM elements (<div>) via @stripe/react-connect-js, NOT React Native primitives. Does not render natively on iOS/Android — only loads in Expo Web bundle / mobile expo-web-browser session. iOS status bar bleed cannot occur because the page never renders in the native React Native stack. Per ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk].

import React, { Suspense } from "react";

import ConnectLoadingFallback from "../src/components/stripe/connect-pages/ConnectLoadingFallback.web";

const ConnectAccountManagementBody = React.lazy(
  () =>
    import("../src/components/stripe/connect-pages/StripeConnectPages.web").then(
      (mod) => ({ default: mod.ConnectAccountManagementBody }),
    ),
);

export default function ConnectAccountManagementPage(): React.ReactElement {
  return (
    <Suspense fallback={<ConnectLoadingFallback />}>
      <ConnectAccountManagementBody />
    </Suspense>
  );
}
