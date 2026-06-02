/**
 * /connect-partner-account-management — Mingla-hosted Stripe Connect
 * Embedded Components page for PARTNER (account-level) Stripe management.
 * ORCH-1052 follow-up.
 *
 * Mirrors /connect-account-management (the brand-level page) verbatim, but
 * for partner identity: query param `account_id` (the partner's
 * creator_accounts.id / auth.uid()) instead of `brand_id`. Opened from
 * mingla-business via WebBrowser.openAuthSessionAsync.
 *
 * Includes the same iOS WKWebView fixes shipped for the partner-onboarding
 * page: absolute-positioned scroll wrapper + viewport meta tag override
 * blocking auto-zoom on input focus.
 *
 * ROUTE: business.usemingla.com/connect-partner-account-management?session=...&account_id=...&return_to=...
 */

// orch-strict-grep-allow safearea-on-fullscreen-routes — web-only Stripe Connect Embedded Components page; renders DOM elements (<div>) via @stripe/react-connect-js, NOT React Native primitives. Mirrors connect-account-management.web.tsx per I-PROPOSED-O.

import React, { useEffect, useMemo, useState } from "react";
import Constants from "expo-constants";
import {
  ConnectAccountManagement,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
} from "@stripe/react-connect-js";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { useLocalSearchParams, useRouter } from "expo-router";

const MINGLA_BRAND_COLOR = "#eb7825" as const;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function ConnectPartnerAccountManagementPage(): React.ReactElement {
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

  // iOS auto-zoom fix — same as connect-partner-onboarding.web.tsx.
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

const pageWrapperStyle: React.CSSProperties = {
  // iOS WKWebView scroll fix — same as connect-partner-onboarding.web.tsx.
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

const mainStyle: React.CSSProperties = {
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
