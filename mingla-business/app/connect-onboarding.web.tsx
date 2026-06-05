/**
 * /connect-onboarding — Mingla-hosted Stripe Connect Embedded Components page.
 *
 * ORCH-1083: the heavy body (Stripe Connect web SDK + embedded components) is
 * code-split out of the initial web bundle via React.lazy. The body lives in
 * src/components/stripe/connect-pages/ConnectOnboardingBody.web.tsx — it is the
 * ONLY place that statically imports @stripe/*. DO NOT re-add a static
 * `@stripe/connect-js` / `@stripe/react-connect-js` import to this route file
 * (breaks the mobile boot budget). See SPEC §C-1.
 *
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.5.4.
 * ROUTE: business.mingla.com/connect-onboarding?session=...&brand_id=...&return_to=...
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — web-only Stripe Connect Embedded Components page; renders DOM elements (<div>) via @stripe/react-connect-js, NOT React Native primitives. Does not render natively on iOS/Android — only loads in Expo Web bundle / mobile expo-web-browser session. iOS status bar bleed cannot occur because the page never renders in the native React Native stack. Per ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 5b 2026-05-17.

import React, { Suspense } from "react";

import ConnectLoadingFallback from "../src/components/stripe/connect-pages/ConnectLoadingFallback.web";

const ConnectOnboardingBody = React.lazy(
  () => import("../src/components/stripe/connect-pages/ConnectOnboardingBody.web"),
);

export default function ConnectOnboardingPage(): React.ReactElement {
  return (
    <Suspense fallback={<ConnectLoadingFallback />}>
      <ConnectOnboardingBody />
    </Suspense>
  );
}
