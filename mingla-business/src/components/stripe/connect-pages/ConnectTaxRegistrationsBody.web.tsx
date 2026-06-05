/**
 * ConnectTaxRegistrationsBody — lazily-loaded body of /connect-tax-registrations.
 *
 * ORCH-1083: extracted verbatim from app/connect-tax-registrations/index.web.tsx
 * so the Stripe Connect web SDK is the ONLY thing statically imported here,
 * letting the route shell React.lazy it out of the initial web bundle. Stripe
 * calls/params are UNCHANGED. See SPEC §C-1.
 *
 * Mounts the embedded <ConnectTaxRegistrations> + <ConnectTaxSettings>
 * (ORCH-0955 replacement for the decommissioned tax-dashboard-link).
 */

import React, { useMemo, useState } from "react";
import Constants from "expo-constants";
import {
  ConnectComponentsProvider,
  ConnectTaxRegistrations,
  ConnectTaxSettings,
} from "@stripe/react-connect-js";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { useLocalSearchParams } from "expo-router";

const MINGLA_BRAND_COLOR = "#eb7825" as const;

export default function ConnectTaxRegistrationsBody(): React.ReactElement {
  const params = useLocalSearchParams<{
    clientSecret: string | string[];
    brandStripeAccountId: string | string[];
  }>();
  const clientSecret = Array.isArray(params.clientSecret)
    ? params.clientSecret[0]
    : params.clientSecret;
  const [initError, setInitError] = useState<string | null>(null);
  const [embeddedLoadError, setEmbeddedLoadError] = useState(false);

  const stripeConnectInstance = useMemo(() => {
    if (typeof clientSecret !== "string" || clientSecret.length === 0) {
      return null;
    }
    const fromExtra = (Constants.expoConfig?.extra as
      | Record<string, string>
      | undefined)?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const publishableKey = fromExtra ??
      process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      setInitError("Stripe publishable key is not configured.");
      return null;
    }
    try {
      return loadConnectAndInitialize({
        publishableKey,
        fetchClientSecret: async () => clientSecret,
        appearance: {
          variables: {
            colorPrimary: MINGLA_BRAND_COLOR,
          },
        },
      });
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [clientSecret]);

  if (typeof clientSecret !== "string" || clientSecret.length === 0) {
    return (
      <ErrorShell
        title="Invalid tax tools link"
        body="Close this window and try again from the app."
      />
    );
  }

  if (initError !== null) {
    return (
      <ErrorShell
        title="Tax tools temporarily unavailable"
        body="Close this window and try again from the app."
      />
    );
  }

  if (embeddedLoadError) {
    return (
      <ErrorShell
        title="Tax tools temporarily unavailable"
        body="Close this window and try again from the app."
      />
    );
  }

  if (stripeConnectInstance === null) {
    return (
      <div style={pageWrapperStyle}>
        <div style={loadingStyle}>Loading tax tools...</div>
      </div>
    );
  }

  return (
    <div style={pageWrapperStyle}>
      <header style={headerStyle}>
        <h1 style={headerTitleStyle}>Mingla Tax Tools</h1>
      </header>
      <main style={mainStyle}>
        <ConnectComponentsProvider connectInstance={stripeConnectInstance}>
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Tax registrations</h2>
            <ConnectTaxRegistrations
              onLoadError={() => setEmbeddedLoadError(true)}
            />
          </section>
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Tax settings</h2>
            <ConnectTaxSettings
              onLoadError={() => setEmbeddedLoadError(true)}
            />
          </section>
        </ConnectComponentsProvider>
      </main>
    </div>
  );
}

function ErrorShell(
  props: { title: string; body: string },
): React.ReactElement {
  return (
    <div style={pageWrapperStyle}>
      <div style={errorCardStyle}>
        <h2 style={errorTitleStyle}>{props.title}</h2>
        <p style={errorBodyStyle}>{props.body}</p>
      </div>
    </div>
  );
}

const pageWrapperStyle: React.CSSProperties = {
  minHeight: "100vh",
  backgroundColor: "#FAFAFA",
  color: "#0F172A",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const headerStyle: React.CSSProperties = {
  padding: "24px",
  backgroundColor: "#FFFFFF",
  borderBottom: "1px solid #E5E7EB",
};

const headerTitleStyle: React.CSSProperties = {
  maxWidth: "880px",
  margin: "0 auto",
  fontSize: "22px",
  fontWeight: 700,
};

const mainStyle: React.CSSProperties = {
  maxWidth: "880px",
  margin: "0 auto",
  padding: "24px",
};

const sectionStyle: React.CSSProperties = {
  marginBottom: "28px",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "16px",
  margin: "0 0 12px",
};

const loadingStyle: React.CSSProperties = {
  padding: "32px",
  textAlign: "center",
};

const errorCardStyle: React.CSSProperties = {
  maxWidth: "560px",
  margin: "72px auto",
  padding: "24px",
  backgroundColor: "#FFFFFF",
  border: "1px solid #E5E7EB",
  borderRadius: "12px",
};

const errorTitleStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: "20px",
};

const errorBodyStyle: React.CSSProperties = {
  margin: 0,
  color: "#475569",
};
