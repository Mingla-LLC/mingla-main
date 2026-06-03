/**
 * /connect-partner-onboarding — Mingla-hosted Stripe Connect Embedded
 * Components page for PARTNER (account-level) Stripe onboarding. ORCH-1052.
 *
 * Mirrors /connect-onboarding (the brand-level page) verbatim, but for
 * partner identity: query param `account_id` (the partner's
 * creator_accounts.id / auth.uid()) instead of `brand_id`. On exit, deep-
 * links back to the native partner-onboarding-complete handler or routes to
 * the partner earnings screen.
 *
 * ROUTE: business.usemingla.com/connect-partner-onboarding?session=...&account_id=...&return_to=...
 *
 * Uses Stripe's web Connect SDK (@stripe/react-connect-js + @stripe/connect-js).
 * Cites https://docs.stripe.com/connect/embedded-components/account-onboarding.md.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — web-only Stripe Connect Embedded Components page; renders DOM elements (<div>) via @stripe/react-connect-js, NOT React Native primitives. Mirrors connect-onboarding.web.tsx per I-PROPOSED-O.

import React, { useMemo, useState } from "react";
import Constants from "expo-constants";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
} from "@stripe/react-connect-js";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  connectEmbeddedPageStyles,
  pageWrapperStyle,
  useStripeConnectViewportZoomLock,
} from "../src/components/stripe/connectEmbeddedPageHelpers";

const MINGLA_BRAND_COLOR = "#eb7825" as const;

export default function ConnectPartnerOnboardingPage(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    session: string | string[];
    account_id: string | string[];
    return_to: string | string[];
  }>();

  const sessionClientSecret = Array.isArray(params.session)
    ? params.session[0]
    : params.session;
  const accountId = Array.isArray(params.account_id)
    ? params.account_id[0]
    : params.account_id;
  const returnTo = Array.isArray(params.return_to)
    ? params.return_to[0]
    : params.return_to;

  const [hasExited, setHasExited] = useState<boolean>(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ORCH-1056: iOS auto-zoom fix moved to shared helper.
  useStripeConnectViewportZoomLock();

  const stripeConnectInstance = useMemo(() => {
    if (typeof sessionClientSecret !== "string") return null;
    const fromExtra = (Constants.expoConfig?.extra as
      | Record<string, string>
      | undefined)?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const fromProcessEnv = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const publishableKey = fromExtra ?? fromProcessEnv;
    if (publishableKey === undefined || publishableKey.length === 0) {
      setInitError(
        "Stripe publishable key is not configured. Contact support@usemingla.com.",
      );
      return null;
    }
    try {
      return loadConnectAndInitialize({
        publishableKey,
        fetchClientSecret: async () => sessionClientSecret,
        appearance: { variables: { colorPrimary: MINGLA_BRAND_COLOR } },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInitError(`Couldn't initialize Stripe: ${message}`);
      return null;
    }
  }, [sessionClientSecret]);

  const handleExit = (): void => {
    setHasExited(true);
    if (
      typeof returnTo === "string" &&
      returnTo.startsWith("mingla-business://")
    ) {
      if (typeof window !== "undefined") {
        window.location.href = returnTo;
      }
    } else {
      router.replace("/partner/earnings" as never);
    }
  };

  const handleStepChange = (event: unknown): void => {
    const step = typeof event === "object" && event !== null && "step" in event
      ? String((event as { step?: unknown }).step ?? "unknown")
      : "unknown";
    console.info("[connect-partner-onboarding] step changed", {
      accountId,
      step,
    });
    try {
      window.localStorage.setItem(
        "mingla:partner-stripe-connect:last-onboarding-step",
        JSON.stringify({ accountId, step, at: new Date().toISOString() }),
      );
    } catch {
      // LocalStorage may be hardened-off.
    }
  };

  const handleLoadError = (event: unknown): void => {
    const message =
      typeof event === "object" && event !== null && "error" in event
        ? String(
          (event as { error?: { message?: unknown } }).error?.message ?? "",
        )
        : "";
    setLoadError(
      message.length > 0 ? message : "Stripe couldn't load onboarding.",
    );
  };

  if (typeof sessionClientSecret !== "string") {
    return (
      <div style={pageWrapperStyle}>
        <div style={errorCardStyle}>
          <h2 style={errorTitleStyle}>Invalid onboarding link</h2>
          <p style={errorBodyStyle}>
            This partner-onboarding link is missing a required parameter.
            Return to Mingla Business and tap &ldquo;Set up partner
            payouts&rdquo; again to start fresh.
          </p>
        </div>
      </div>
    );
  }

  if (initError !== null) {
    return (
      <div style={pageWrapperStyle}>
        <div style={errorCardStyle}>
          <h2 style={errorTitleStyle}>Couldn&rsquo;t start onboarding</h2>
          <p style={errorBodyStyle}>{initError}</p>
        </div>
      </div>
    );
  }

  if (loadError !== null) {
    return (
      <div style={pageWrapperStyle}>
        <div style={errorCardStyle}>
          <h2 style={errorTitleStyle}>Couldn&rsquo;t load onboarding</h2>
          <p style={errorBodyStyle}>{loadError}</p>
        </div>
      </div>
    );
  }

  if (stripeConnectInstance === null) {
    return (
      <div style={pageWrapperStyle}>
        <div style={loadingCardStyle}>
          <p>Initializing onboarding…</p>
        </div>
      </div>
    );
  }

  if (hasExited) {
    return (
      <div style={pageWrapperStyle}>
        <div style={loadingCardStyle}>
          <p>Onboarding session ended. Redirecting…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageWrapperStyle}>
      <header style={headerStyle}>
        <h1 style={headerTitleStyle}>Mingla — Partner payouts</h1>
      </header>
      <main style={mainStyle}>
        <ConnectComponentsProvider connectInstance={stripeConnectInstance}>
          <ConnectNotificationBanner
            collectionOptions={{
              fields: "eventually_due",
              futureRequirements: "include",
            }}
          />
          <ConnectAccountOnboarding
            onExit={handleExit}
            onStepChange={handleStepChange}
            onLoadError={handleLoadError}
            fullTermsOfServiceUrl="https://www.usemingla.com/terms-of-service/"
            recipientTermsOfServiceUrl="https://www.usemingla.com/terms-of-service/"
            privacyPolicyUrl="https://www.usemingla.com/privacy-policy/"
            collectionOptions={{
              fields: "eventually_due",
              futureRequirements: "include",
            }}
          />
        </ConnectComponentsProvider>
      </main>
      <footer style={footerStyle}>
        <p style={footerTextStyle}>
          Powered by Stripe. Your bank details go directly to Stripe — Mingla
          never sees them.
        </p>
      </footer>
    </div>
  );
}

// ORCH-1056: styles + layout consolidated into the shared helper module.
// Local aliases so the existing JSX `style={…Style}` references still resolve.
const headerStyle = connectEmbeddedPageStyles.headerStyle;
const headerTitleStyle = connectEmbeddedPageStyles.headerTitleStyle;
const mainStyle = connectEmbeddedPageStyles.mainStyle;
const footerStyle = connectEmbeddedPageStyles.footerStyle;
const footerTextStyle = connectEmbeddedPageStyles.footerTextStyle;
const errorCardStyle = connectEmbeddedPageStyles.errorCardStyle;
const errorTitleStyle = connectEmbeddedPageStyles.errorTitleStyle;
const errorBodyStyle = connectEmbeddedPageStyles.errorBodyStyle;
const loadingCardStyle = connectEmbeddedPageStyles.loadingCardStyle;
// `pageWrapperStyle` re-exported as a top-level import to preserve current
// JSX bindings (`style={pageWrapperStyle}` appears throughout the file).
void pageWrapperStyle;
