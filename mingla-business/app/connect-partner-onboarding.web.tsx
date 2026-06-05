/**
 * /connect-partner-onboarding — Mingla-hosted Stripe Connect Embedded
 * Components page for PARTNER (account-level) Stripe onboarding. ORCH-1052.
 *
 * ORCH-1083: the heavy body (Stripe Connect web SDK + embedded components) is
 * code-split out of the initial web bundle via React.lazy. The body lives in
 * src/components/stripe/connect-pages/ConnectPartnerOnboardingBody.web.tsx — it
 * is the ONLY place that statically imports @stripe/*. DO NOT re-add a static
 * @stripe/connect-js / @stripe/react-connect-js import here. See SPEC §C-1.
 *
 * ROUTE: business.usemingla.com/connect-partner-onboarding?session=...&account_id=...&return_to=...
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — web-only Stripe Connect Embedded Components page; renders DOM elements (<div>) via @stripe/react-connect-js, NOT React Native primitives. Mirrors connect-onboarding.web.tsx per I-PROPOSED-O.

import React, { Suspense } from "react";

import ConnectLoadingFallback from "../src/components/stripe/connect-pages/ConnectLoadingFallback.web";

const ConnectPartnerOnboardingBody = React.lazy(
  () =>
    import(
      "../src/components/stripe/connect-pages/ConnectPartnerOnboardingBody.web"
    ),
);

export default function ConnectPartnerOnboardingPage(): React.ReactElement {
  return (
    <Suspense fallback={<ConnectLoadingFallback />}>
      <ConnectPartnerOnboardingBody />
    </Suspense>
  );
}
