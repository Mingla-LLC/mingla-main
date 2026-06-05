/**
 * /connect-partner-onboarding (NATIVE fallback) — ORCH-1052 hotfix.
 *
 * Expo Router requires every route under `app/` to have a non-platform-
 * specific sibling. The ORCH-1052 implementor only shipped
 * `connect-partner-onboarding.web.tsx`, which crashed Expo Router at boot
 * with "The file ./connect-partner-onboarding.web.tsx does not have a
 * fallback sibling file without a platform extension." That crash white-
 * screened the entire app on EVERY route (partner onboarding AND brand
 * onboarding AND home AND account), because the router couldn't initialize.
 *
 * Mirrors `connect-onboarding.tsx` + `connect-account-management.tsx` from
 * the ORCH-0954 brand-side pattern. Stripe Connect Embedded Components
 * are web-only; on native iOS/Android we render a "open it from the brand
 * payments screen instead" prompt. The web variant
 * (`connect-partner-onboarding.web.tsx`) takes over on Expo Web bundles.
 */

import React from "react";

import { NativeConnectWebOnlyFallback } from "../src/components/stripe/NativeConnectWebOnlyFallback";

export default function ConnectPartnerOnboardingNativeRoute(): React.ReactElement {
  return (
    <NativeConnectWebOnlyFallback
      title="Open partner onboarding in the browser"
      body="Partner bank onboarding runs in Mingla's hosted web page. Return to Partner Earnings and tap Connect bank again to open it in the in-app browser."
    />
  );
}
