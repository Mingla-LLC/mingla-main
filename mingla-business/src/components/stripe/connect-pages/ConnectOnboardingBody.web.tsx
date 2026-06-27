/**
 * ConnectOnboardingBody — lazily-loaded body of /connect-onboarding.
 *
 * ORCH-1083: extracted verbatim from app/connect-onboarding.web.tsx so the
 * Stripe Connect web SDK (@stripe/connect-js + @stripe/react-connect-js) is the
 * ONLY thing this module statically imports, letting the route shell `React.lazy`
 * it out of the initial web bundle. Stripe calls/params are UNCHANGED (preserves
 * the COMMS-0003 external-API contract). See SPEC §C-1.
 *
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.5.4.
 * ROUTE: business.mingla.com/connect-onboarding?session=...&brand_id=...&return_to=...
 *
 * This is the WEB target of the in-app browser opened by BrandOnboardView via
 * expo-web-browser.openAuthSessionAsync. It loads Stripe's Connect Embedded
 * Components (web SDK) and renders <ConnectAccountOnboarding> with Mingla
 * branding. On completion (onExit), redirects to the deep link or the brand's
 * payments page.
 *
 * Architecture note: this file uses plain DOM elements (<div>) NOT React Native
 * primitives — for Stripe's web Connect components to render correctly we need
 * raw DOM hooks. ORCH-1056 backport: shared layout/zoom helpers live in
 * src/components/stripe/connectEmbeddedPageHelpers.ts.
 */

import React, { useEffect, useMemo, useState } from "react";
import Constants from "expo-constants";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
} from "@stripe/react-connect-js";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { useLocalSearchParams } from "expo-router";
import {
  connectEmbeddedPageStyles,
  useStripeConnectViewportZoomLock,
} from "../../../components/stripe/connectEmbeddedPageHelpers";

const MINGLA_BRAND_COLOR = "#eb7825" as const; // accent.warm per designSystem.ts:147

// META-ORCH-1234 (Bug B): the native "Set up payments" CTA opens this page in a
// SESSIONLESS in-app browser (WebBrowser.openAuthSessionAsync) and asks the edge
// function to append `return_to=mingla-business://onboarding-complete`. Stripe's
// hosted KYC flow performs its OWN intra-flow redirects and can drop Mingla's
// query params (only `session` + `brand_id` survive), so on completion `return_to`
// may be ABSENT. We therefore (1) persist `return_to` to sessionStorage on first
// mount so it survives the param drop, and (2) on exit recover it from the param
// OR sessionStorage and perform a FULL-PAGE navigation. We must NEVER client-side
// `router.replace` into an auth-gated SPA route (`/brand/<id>/payments`) from this
// sessionless browser — the root layout would bounce it to sign-in and strand the
// user on "Redirecting…". See coldLoadAuthGates.ts SELF_AUTHENTICATING_* notes.
const RETURN_TO_STORAGE_KEY =
  "mingla:stripe-connect:onboarding-return-to" as const;
// Native deep link the edge function/native opener uses (BrandOnboardView.tsx:98).
const RETURN_DEEP_LINK = "mingla-business://onboarding-complete" as const;
// Public, SESSIONLESS-safe relay route — on SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES
// (coldLoadAuthGates.ts), so it renders with no Supabase session and itself bounces
// the browser to the native deep link. Used as the last-resort fallback so the user
// is NEVER stranded, WITHOUT weakening the auth gate on /brand/[id]/payments.
const ONBOARDING_RETURN_RELAY = "/stripe-onboarding-return" as const;

function readPersistedReturnTo(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistReturnTo(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RETURN_TO_STORAGE_KEY, value);
  } catch {
    // sessionStorage can be unavailable in hardened browsers — non-fatal.
  }
}

export default function ConnectOnboardingBody(): React.ReactElement {
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
  const [loadError, setLoadError] = useState<string | null>(null);

  // ORCH-1056 — block iOS auto-zoom on input focus (Stripe input font-size < 16px).
  useStripeConnectViewportZoomLock();

  // META-ORCH-1234 (Bug B): persist `return_to` on first mount so it survives
  // Stripe's intra-flow param drop and is recoverable in handleExit.
  useEffect(() => {
    if (typeof returnTo === "string" && returnTo.length > 0) {
      persistReturnTo(returnTo);
    }
  }, [returnTo]);

  const stripeConnectInstance = useMemo(() => {
    if (typeof sessionClientSecret !== "string") return null;
    // B2a Path C V3 forensics R-2: was `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` —
    // mismatch with Sub-C wiring which exposes `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`
    // (no _TEST suffix). Read from Constants.expoConfig.extra (native bundle path)
    // first, then process.env (Vercel build path).
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

  const handleExit = (): void => {
    setHasExited(true);

    // META-ORCH-1234 (Bug B): recover `return_to` from the URL param OR the copy
    // we persisted on first mount (Stripe can drop the param mid-flow). We ALWAYS
    // perform a FULL-PAGE navigation (window.location.assign) here — never a
    // client-side router.replace into an auth-gated SPA route — because this page
    // runs in a sessionless in-app browser the root layout would otherwise bounce
    // to sign-in, stranding the user on "Redirecting…".
    const recoveredReturnTo =
      typeof returnTo === "string" && returnTo.length > 0
        ? returnTo
        : readPersistedReturnTo();

    if (typeof window === "undefined") return;

    if (
      typeof recoveredReturnTo === "string" &&
      (recoveredReturnTo.startsWith("mingla-business://") ||
        recoveredReturnTo.startsWith("https://"))
    ) {
      // Native deep link (closes the in-app browser, app handles completion) OR a
      // full authed-web URL (full reload lets the web app re-establish its own
      // persisted Supabase session, rather than an SPA replace the gate intercepts).
      window.location.assign(recoveredReturnTo);
      return;
    }

    // Fallback: no recoverable return_to. Do a FULL-PAGE navigation to the public,
    // sessionless-safe relay route (exempt via SELF_AUTHENTICATING_CONNECT_ROUTE_PREFIXES),
    // which renders without a Supabase session and bounces to the native deep link —
    // so the user is NEVER stranded, and we do NOT weaken the /brand/[id]/payments gate.
    const relayUrl =
      `${ONBOARDING_RETURN_RELAY}?return_to=${
        encodeURIComponent(RETURN_DEEP_LINK)
      }`;
    window.location.assign(relayUrl);
  };

  const handleStepChange = (event: unknown): void => {
    const step = typeof event === "object" && event !== null && "step" in event
      ? String((event as { step?: unknown }).step ?? "unknown")
      : "unknown";
    console.info("[connect-onboarding] Stripe onboarding step changed", {
      brandId,
      step,
    });
    try {
      window.localStorage.setItem(
        "mingla:stripe-connect:last-onboarding-step",
        JSON.stringify({ brandId, step, at: new Date().toISOString() }),
      );
    } catch {
      // LocalStorage can be unavailable in hardened browsers; console breadcrumb remains.
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

  // Validation guards
  if (typeof sessionClientSecret !== "string") {
    return (
      <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
        <div style={connectEmbeddedPageStyles.errorCardStyle}>
          <h2 style={connectEmbeddedPageStyles.errorTitleStyle}>Invalid onboarding link</h2>
          <p style={connectEmbeddedPageStyles.errorBodyStyle}>
            This onboarding link is missing a required parameter. Return to
            Mingla Business and tap &ldquo;Set up payments&rdquo; again to start
            fresh.
          </p>
        </div>
      </div>
    );
  }

  if (initError !== null) {
    return (
      <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
        <div style={connectEmbeddedPageStyles.errorCardStyle}>
          <h2 style={connectEmbeddedPageStyles.errorTitleStyle}>Couldn&rsquo;t start onboarding</h2>
          <p style={connectEmbeddedPageStyles.errorBodyStyle}>{initError}</p>
        </div>
      </div>
    );
  }

  if (loadError !== null) {
    return (
      <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
        <div style={connectEmbeddedPageStyles.errorCardStyle}>
          <h2 style={connectEmbeddedPageStyles.errorTitleStyle}>Couldn&rsquo;t load onboarding</h2>
          <p style={connectEmbeddedPageStyles.errorBodyStyle}>{loadError}</p>
        </div>
      </div>
    );
  }

  if (stripeConnectInstance === null) {
    return (
      <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
        <div style={connectEmbeddedPageStyles.loadingCardStyle}>
          <p>Initializing onboarding…</p>
        </div>
      </div>
    );
  }

  if (hasExited) {
    return (
      <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
        <div style={connectEmbeddedPageStyles.loadingCardStyle}>
          <p>Onboarding session ended. Redirecting…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={connectEmbeddedPageStyles.pageWrapperStyle}>
      <header style={connectEmbeddedPageStyles.headerStyle}>
        <h1 style={connectEmbeddedPageStyles.headerTitleStyle}>Mingla — Set up payments</h1>
      </header>
      <main style={connectEmbeddedPageStyles.mainStyle}>
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
      <footer style={connectEmbeddedPageStyles.footerStyle}>
        <p style={connectEmbeddedPageStyles.footerTextStyle}>
          Powered by Stripe. Your bank details go directly to Stripe — Mingla
          never sees them.
        </p>
      </footer>
    </div>
  );
}
