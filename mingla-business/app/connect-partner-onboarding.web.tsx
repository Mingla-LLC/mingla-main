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

import React, { useEffect, useMemo, useState } from "react";
import Constants from "expo-constants";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
} from "@stripe/react-connect-js";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { useLocalSearchParams, useRouter } from "expo-router";

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

  // iOS auto-zoom fix: Stripe's embedded form inputs use font-size < 16px,
  // which triggers iOS Safari to auto-zoom in when an input is focused —
  // the user then has to pinch-zoom back out. The default Expo Web viewport
  // (`width=device-width, initial-scale=1, shrink-to-fit=no`) doesn't block
  // this. Overriding to add `maximum-scale=1, user-scalable=no` while the
  // user is on this page prevents the zoom-on-focus jank. Restore the
  // original tag on unmount so other pages keep normal pinch-zoom.
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

const pageWrapperStyle: React.CSSProperties = {
  // iOS WKWebView scroll fix: react-native-web compiles to a fixed-viewport
  // root (`html, body, #root { height: 100%; overflow: hidden }`), so we
  // make THIS wrapper the scroll container by absolutely positioning it
  // over the root and giving it explicit `overflowY: auto`. This avoids
  // touching root-level styles (which break RN-web layout) while letting
  // the Stripe iframe content scroll naturally inside the wrapper.
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

const headerStyle: React.CSSProperties = {
  padding: "24px 24px 16px",
  textAlign: "center",
  borderBottom: "1px solid #E5E7EB",
  backgroundColor: "#FFFFFF",
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 600,
  margin: 0,
  color: "#0F172A",
};

const mainStyle: React.CSSProperties = {
  // No `flex: 1` — wrapper is plain block layout now (see pageWrapperStyle).
  padding: "24px",
  maxWidth: "780px",
  width: "100%",
  margin: "0 auto",
  boxSizing: "border-box",
};

const footerStyle: React.CSSProperties = {
  padding: "16px 24px",
  borderTop: "1px solid #E5E7EB",
  backgroundColor: "#FFFFFF",
  textAlign: "center",
};

const footerTextStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "#475569",
  margin: 0,
};

const errorCardStyle: React.CSSProperties = {
  maxWidth: "480px",
  margin: "80px auto",
  padding: "32px",
  backgroundColor: "#FFFFFF",
  border: "1px solid #FCA5A5",
  borderRadius: "12px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
};

const errorTitleStyle: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 600,
  margin: "0 0 12px",
  color: "#0F172A",
};

const errorBodyStyle: React.CSSProperties = {
  fontSize: "15px",
  lineHeight: 1.5,
  margin: 0,
  color: "#475569",
};

const loadingCardStyle: React.CSSProperties = {
  maxWidth: "480px",
  margin: "80px auto",
  padding: "32px",
  textAlign: "center",
  color: "#475569",
};
