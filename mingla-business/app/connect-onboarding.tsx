/**
 * /connect-onboarding — Mingla-hosted Stripe Connect Embedded Components page.
 *
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.5.4.
 *
 * ROUTE: business.mingla.com/connect-onboarding?session=...&brand_id=...&return_to=...
 *
 * This page is the WEB target of the in-app browser opened by BrandOnboardView
 * via expo-web-browser.openAuthSessionAsync. It loads Stripe's Connect Embedded
 * Components (web SDK) and renders <ConnectAccountOnboarding> with Mingla
 * branding. On completion (onExit), redirects to the deep link or the brand's
 * payments page.
 *
 * I-PROPOSED-O (DRAFT post-B2a CLOSE): Stripe Connect Embedded Components must
 * be exposed via either Stripe's prescribed native preview SDK (Path A future
 * upgrade) OR Mingla-hosted web page rendering web SDK + opened via
 * expo-web-browser (THIS FILE — Path B current). DIY-wrapping connect-js in
 * react-native-webview is FORBIDDEN — explicitly prohibited by Stripe.
 *
 * Architecture note: this file uses plain DOM elements (<div>) NOT React Native
 * primitives. Expo Web bundle compiles to React DOM via React-Native-Web; for
 * Stripe's web Connect components to render correctly, we need raw DOM hooks
 * (no <View>, <Text>). This is one of the few Expo Web-only files in
 * mingla-business/.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { useLocalSearchParams, useRouter } from "expo-router";

const MINGLA_BRAND_COLOR = "#eb7825" as const; // accent.warm per designSystem.ts:147

export default function ConnectOnboardingPage(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    session: string | string[];
    brand_id: string | string[];
    return_to: string | string[];
  }>();

  const sessionClientSecret = Array.isArray(params.session)
    ? params.session[0]
    : params.session;
  const brandId = Array.isArray(params.brand_id)
    ? params.brand_id[0]
    : params.brand_id;
  const returnTo = Array.isArray(params.return_to)
    ? params.return_to[0]
    : params.return_to;

  const [hasExited, setHasExited] = useState<boolean>(false);
  const [initError, setInitError] = useState<string | null>(null);

  const stripeConnectInstance = useMemo(() => {
    if (typeof sessionClientSecret !== "string") return null;
    const publishableKey =
      process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST;
    if (publishableKey === undefined || publishableKey.length === 0) {
      setInitError(
        "Stripe publishable key is not configured. Contact support@mingla.com.",
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

  const handleExit = (): void => {
    setHasExited(true);
    if (typeof returnTo === "string" && returnTo.startsWith("mingla-business://")) {
      // Native app deep link — redirect via window.location for cross-process navigation
      if (typeof window !== "undefined") {
        window.location.href = returnTo;
      }
    } else if (typeof brandId === "string" && brandId.length > 0) {
      // Web direct completion → navigate to payments page
      router.replace(`/brand/${brandId}/payments` as never);
    } else {
      router.replace("/" as never);
    }
  };

  // Validation guards
  if (typeof sessionClientSecret !== "string") {
    return (
      <div style={pageWrapperStyle}>
        <div style={errorCardStyle}>
          <h2 style={errorTitleStyle}>Invalid onboarding link</h2>
          <p style={errorBodyStyle}>
            This onboarding link is missing a required parameter. Return to
            Mingla Business and tap &ldquo;Set up payments&rdquo; again to start fresh.
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
        <h1 style={headerTitleStyle}>Mingla — Set up payments</h1>
      </header>
      <main style={mainStyle}>
        <ConnectComponentsProvider connectInstance={stripeConnectInstance}>
          <ConnectAccountOnboarding onExit={handleExit} />
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

// Inline styles — this file is Expo Web only; React Native styles don't apply.
// Per `feedback_rn_color_formats.md`: hex/rgb/hsl/hwb only (no oklch/lab/lch).

const pageWrapperStyle: React.CSSProperties = {
  minHeight: "100vh",
  backgroundColor: "#FAFAFA",
  display: "flex",
  flexDirection: "column",
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
  flex: 1,
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
