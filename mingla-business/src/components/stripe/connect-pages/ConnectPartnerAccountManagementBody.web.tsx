/**
 * ConnectPartnerAccountManagementBody — lazily-loaded body of
 * /connect-partner-account-management.
 *
 * ORCH-1083: extracted verbatim from app/connect-partner-account-management.web.tsx
 * so the Stripe Connect web SDK is the ONLY thing statically imported here,
 * letting the route shell React.lazy it out of the initial web bundle. Stripe
 * calls/params are UNCHANGED. See SPEC §C-1.
 *
 * PARTNER (account-level) Stripe management (ORCH-1052 follow-up). Mirrors the
 * brand-level page but for partner identity: query param `account_id`.
 */

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
  pageWrapperStyle,
  useStripeConnectViewportZoomLock,
} from "../../../components/stripe/connectEmbeddedPageHelpers";

const MINGLA_BRAND_COLOR = "#eb7825" as const;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function ConnectPartnerAccountManagementBody(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    session: string | string[];
    account_id: string | string[];
    return_to: string | string[];
  }>();

  const sessionClientSecret = firstParam(params.session);
  const accountId = firstParam(params.account_id);
  const returnTo = firstParam(params.return_to);
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

  const handleDone = (): void => {
    if (
      typeof returnTo === "string" && returnTo.startsWith("mingla-business://")
    ) {
      window.location.href = returnTo;
      return;
    }
    router.replace("/partner/earnings" as never);
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
      <div style={pageWrapperStyle}>
        <div style={errorCardStyle}>
          <h2 style={errorTitleStyle}>Invalid management link</h2>
          <p style={errorBodyStyle}>
            This link is missing a required parameter. Return to Mingla and tap
            &ldquo;Manage Stripe account&rdquo; again.
          </p>
        </div>
      </div>
    );
  }

  if (initError !== null || loadError !== null) {
    return (
      <div style={pageWrapperStyle}>
        <div style={errorCardStyle}>
          <h2 style={errorTitleStyle}>Couldn&rsquo;t load Stripe</h2>
          <p style={errorBodyStyle}>{initError ?? loadError}</p>
        </div>
      </div>
    );
  }

  if (stripeConnectInstance === null) {
    return (
      <div style={pageWrapperStyle}>
        <div style={loadingCardStyle}>
          <p>Initializing account management…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageWrapperStyle}>
      <header style={headerStyle}>
        <div style={headerInnerStyle}>
          <h1 style={headerTitleStyle}>Mingla — Partner payouts</h1>
          <button type="button" onClick={handleDone} style={doneButtonStyle}>
            Done
          </button>
        </div>
      </header>
      <main style={mainStyle}>
        <ConnectComponentsProvider connectInstance={stripeConnectInstance}>
          <ConnectNotificationBanner
            collectionOptions={{
              fields: "eventually_due",
              futureRequirements: "include",
            }}
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
      <footer style={footerStyle}>
        <p style={footerTextStyle}>
          Powered by Stripe. Your bank details go directly to Stripe — Mingla
          never sees them.
        </p>
      </footer>
    </div>
  );
}

// ORCH-1056: shared base styles via connectEmbeddedPageHelpers.
const mainStyle = connectEmbeddedPageStyles.mainStyle;
const footerStyle = connectEmbeddedPageStyles.footerStyle;
const footerTextStyle = connectEmbeddedPageStyles.footerTextStyle;
const errorCardStyle = connectEmbeddedPageStyles.errorCardStyle;
const errorTitleStyle = connectEmbeddedPageStyles.errorTitleStyle;
const errorBodyStyle = connectEmbeddedPageStyles.errorBodyStyle;
const loadingCardStyle = connectEmbeddedPageStyles.loadingCardStyle;

// Page-local: account-management header (Done button + alignment) — distinct
// from the centered-title onboarding header so kept inline.
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

const headerTitleStyle: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: 600,
  margin: 0,
  color: "#0F172A",
};

const doneButtonStyle: React.CSSProperties = {
  border: "1px solid #E5E7EB",
  background: "#FFFFFF",
  color: "#0F172A",
  padding: "8px 14px",
  borderRadius: "9999px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};
