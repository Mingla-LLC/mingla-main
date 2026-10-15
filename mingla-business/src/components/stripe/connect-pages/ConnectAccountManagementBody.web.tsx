/**
 * ConnectAccountManagementBody — lazily-loaded body of /connect-account-management.
 *
 * ORCH-1083: extracted verbatim from app/connect-account-management.web.tsx so the
 * Stripe Connect web SDK is the ONLY thing statically imported here, letting the
 * route shell React.lazy it out of the initial web bundle. Stripe calls/params
 * are UNCHANGED. See SPEC §C-1.
 *
 * Web-only Path B surface. Host web opens it same-tab (#3645); native still
 * uses expo-web-browser. Renders Stripe embedded account management plus
 * notification banner from a short-lived Account Session client_secret.
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
  useStripeConnectViewportZoomLock,
} from "../../../components/stripe/connectEmbeddedPageHelpers";
import { isAllowedAccountManagementReturnTo } from "../../../utils/accountManagementOpen";

const MINGLA_BRAND_COLOR = "#eb7825" as const;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function ConnectAccountManagementBody(): React.ReactElement {
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
        "Payout tools are not configured. Contact support@usemingla.com.",
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
      setInitError(`Couldn't open payout tools: ${message}`);
      return null;
    }
  }, [sessionClientSecret]);

  const handleDone = (): void => {
    // #3645 — Host web Add bank opens this page in the SAME tab with an HTTPS
    // return_to. Honour it with a full-page assign (re-establishes the Host
    // session) the same way connect-onboarding does. Deep links still close
    // the native in-app browser. Never SPA-replace into an auth-gated route
    // from a sessionless Connect window.
    if (
      typeof returnTo === "string" &&
      typeof window !== "undefined" &&
      isAllowedAccountManagementReturnTo(returnTo, window.location.origin)
    ) {
      window.location.assign(returnTo);
      return;
    }
    if (typeof brandId === "string" && brandId.length > 0) {
      if (typeof window !== "undefined") {
        window.location.assign(
          `/brand/${encodeURIComponent(brandId)}/payments`,
        );
        return;
      }
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
      message.length > 0 ? message : "Account management couldn't be loaded.",
    );
  };

  if (typeof sessionClientSecret !== "string") {
    return (
      <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
        <div style={connectEmbeddedPageStyles.errorCardStyle}>
          <h2 style={connectEmbeddedPageStyles.errorTitleStyle}>Invalid management link</h2>
          <p style={connectEmbeddedPageStyles.errorBodyStyle}>
            This link is missing a required parameter. Return to Mingla Host
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
          <h2 style={connectEmbeddedPageStyles.errorTitleStyle}>Couldn&rsquo;t load payout tools</h2>
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
          Your bank details go straight to our payment partner — Mingla never
          sees them.
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
