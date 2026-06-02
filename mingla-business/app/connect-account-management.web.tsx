/**
 * /connect-account-management — Mingla-hosted Stripe Connect management page.
 *
 * Web-only Path B surface opened from mingla-business via expo-web-browser.
 * Renders Stripe embedded account management plus notification banner from a
 * short-lived Account Session client_secret.
 *
 * ORCH-1056 backport: shared layout/zoom helpers now live in
 * src/components/stripe/connectEmbeddedPageHelpers.ts. This file inherits
 * the iOS WKWebView scroll fix (absolute-positioned wrapper) + auto-zoom
 * block (viewport meta override) previously only on the partner pages.
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — web-only Stripe Connect Embedded Components page; renders DOM elements (<div>) via @stripe/react-connect-js, NOT React Native primitives. Does not render natively on iOS/Android — only loads in Expo Web bundle / mobile expo-web-browser session. iOS status bar bleed cannot occur because the page never renders in the native React Native stack. Per ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk].

import React, { useMemo, useState } from "react";
import Constants from "expo-constants";
import {
  ConnectAccountManagement,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
} from "@stripe/react-connect-js";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  connectEmbeddedPageStyles,
  useStripeConnectViewportZoomLock,
} from "../src/components/stripe/connectEmbeddedPageHelpers";

const MINGLA_BRAND_COLOR = "#eb7825" as const;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function ConnectAccountManagementPage(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    session: string | string[];
    brand_id: string | string[];
    return_to: string | string[];
  }>();

  const sessionClientSecret = firstParam(params.session);
  const brandId = firstParam(params.brand_id);
  const returnTo = firstParam(params.return_to);
  const [initError, setInitError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ORCH-1056 — block iOS auto-zoom on input focus.
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
        appearance: {
          variables: {
            colorPrimary: MINGLA_BRAND_COLOR,
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInitError(`Couldn't initialize Stripe: ${message}`);
      return null;
    }
  }, [sessionClientSecret]);

  const handleDone = (): void => {
    if (
      typeof returnTo === "string" && returnTo.startsWith("mingla-business://")
    ) {
      window.location.href = returnTo;
      return;
    }
    if (typeof brandId === "string" && brandId.length > 0) {
      router.replace(`/brand/${brandId}/payments` as never);
      return;
    }
    router.replace("/" as never);
  };

  const handleNotificationsChange = (event: unknown): void => {
    console.info("[connect-account-management] Stripe notifications changed", {
      brandId,
      event,
    });
  };

  const handleLoadError = (event: unknown): void => {
    const message =
      typeof event === "object" && event !== null && "error" in event
        ? String(
          (event as { error?: { message?: unknown } }).error?.message ?? "",
        )
        : "";
    setLoadError(
      message.length > 0 ? message : "Stripe couldn't load account management.",
    );
  };

  if (typeof sessionClientSecret !== "string") {
    return (
      <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
        <div style={connectEmbeddedPageStyles.errorCardStyle}>
          <h2 style={connectEmbeddedPageStyles.errorTitleStyle}>Invalid management link</h2>
          <p style={connectEmbeddedPageStyles.errorBodyStyle}>
            This link is missing a required parameter. Return to Mingla Business
            and tap &ldquo;Manage payouts &amp; tax&rdquo; again.
          </p>
        </div>
      </div>
    );
  }

  if (initError !== null || loadError !== null) {
    return (
      <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
        <div style={connectEmbeddedPageStyles.errorCardStyle}>
          <h2 style={connectEmbeddedPageStyles.errorTitleStyle}>Couldn&rsquo;t load Stripe</h2>
          <p style={connectEmbeddedPageStyles.errorBodyStyle}>{initError ?? loadError}</p>
        </div>
      </div>
    );
  }

  if (stripeConnectInstance === null) {
    return (
      <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
        <div style={connectEmbeddedPageStyles.loadingCardStyle}>
          <p>Initializing account management...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
      <header style={headerStyle}>
        <div style={headerInnerStyle}>
          <h1 style={connectEmbeddedPageStyles.headerTitleStyle}>Mingla — Payouts &amp; tax</h1>
          <button type="button" onClick={handleDone} style={doneButtonStyle}>
            Done
          </button>
        </div>
      </header>
      <main style={connectEmbeddedPageStyles.mainStyle}>
        <ConnectComponentsProvider connectInstance={stripeConnectInstance}>
          <ConnectNotificationBanner
            collectionOptions={{
              fields: "eventually_due",
              futureRequirements: "include",
            }}
            onNotificationsChange={handleNotificationsChange}
            onLoadError={handleLoadError}
          />
          <ConnectAccountManagement
            collectionOptions={{
              fields: "eventually_due",
              futureRequirements: "include",
            }}
            onLoadError={handleLoadError}
          />
        </ConnectComponentsProvider>
      </main>
      <footer style={connectEmbeddedPageStyles.footerStyle}>
        <p style={connectEmbeddedPageStyles.footerTextStyle}>
          Powered by Stripe. Your bank details go directly to Stripe — Mingla
          never sees them.
        </p>
      </footer>
    </div>
  );
}

// Account-management has a distinct header layout (Done button) — keep
// page-local style overrides for the header inner + done button.
const headerStyle: React.CSSProperties = {
  padding: "18px 24px",
  borderBottom: "1px solid #E5E7EB",
  backgroundColor: "#FFFFFF",
};

const headerInnerStyle: React.CSSProperties = {
  maxWidth: "780px",
  margin: "0 auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
};

const doneButtonStyle: React.CSSProperties = {
  minHeight: "44px",
  padding: "0 16px",
  borderRadius: "999px",
  border: "1px solid #E5E7EB",
  backgroundColor: "#FFFFFF",
  color: "#0F172A",
  fontSize: "15px",
  fontWeight: 600,
  cursor: "pointer",
};
