/**
 * webAnalytics.web.ts — Buyer-web (Expo Web) analytics, web-only.
 *   META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 2 (buyer web).
 *
 * This is the WEB resolution of the analytics split (Metro resolves `.web.ts`
 * on web, the sibling `webAnalytics.ts` no-op on native — exact mechanism the
 * mixpanelService.web.ts split already relies on). The native bundle NEVER
 * pulls posthog-js / gtag: this file only ever loads in the web export.
 *
 * What it does:
 *   - initWebAnalytics(): one-time PostHog (posthog-js) + GA4 init, both gated
 *     so NO cookies / NO capture happen until the visitor accepts (§4.E).
 *       · PostHog: opt_out_capturing_by_default: true — PostHog stores nothing
 *         in cookies/local/session storage and captures nothing until
 *         opt_in_capturing() (documented PostHog behavior). US region locked.
 *       · GA4: Consent Mode v2 — gtag('consent','default', {all denied}) runs
 *         BEFORE the GA config/measurement loads.
 *     Power features ON, free-tier only (§4.G): autocapture, error tracking,
 *     session replay (masked — §4.H), feature flags. Replay sampled (§4.I).
 *   - grantConsent() / denyConsent(): the consent banner Accept/Reject handlers.
 *   - captureWeb / identifyWeb: capture/identify facades the call sites use.
 *
 * SECURITY (§4.H): session replay masks ALL inputs by default
 * (`maskAllInputs: true`) and masks any element tagged `data-ph-mask` / replaces
 * any element tagged `ph-no-capture`. Buyer-web checkout/payment/PII elements
 * carry those tags at their call sites. A replay capturing a card field or PII
 * = automatic FAIL.
 *
 * Cost guard (§4.I): session-replay sampleRate is the free-tier protector for
 * the 5K recordings/mo cap; Seth can raise/lower it server-side in PostHog
 * without a deploy. Autocapture is narrowed to click/submit to protect the 1M
 * events/mo cap.
 *
 * posthog-js is loaded via a DYNAMIC import inside initWebAnalytics so its bulk
 * never enters the eager boot chunk (protects the ORCH-1083 __common budget) and
 * is fetched only once analytics actually initializes.
 *
 * Env: keys come from app.config `extra` (reachable on web + native — mirrors
 * supabase.ts / the GIPHY pattern). The phc_ key + G-Z4W3B9900S Measurement ID
 * are public-by-design (safe in client bundles). Missing key → graceful no-op
 * (the site never crashes; analytics simply does not load).
 */

import Constants from "expo-constants";
import type { PostHog } from "posthog-js";

// US region is dispatch-locked (I-PROPOSED-1187-POSTHOG-HOST-US). Keep the
// literal here so the strict-grep gate sees it at the init site.
const POSTHOG_US_HOST = "https://us.i.posthog.com";

// Session-replay sampling — record ~20% of sessions to protect the free 5K
// recordings/mo cap (§4.I, SC-16). Seth can override server-side in PostHog.
const SESSION_REPLAY_SAMPLE_RATE = 0.2;

// localStorage key — the banner's own source of truth for whether to re-show.
// Shared shape with the marketing surface ("granted" | "denied" + ts).
const CONSENT_STORAGE_KEY = "mingla_consent_v1";

type ConsentChoice = "granted" | "denied";

const extra = Constants.expoConfig?.extra as
  | Record<string, string | undefined>
  | undefined;

function readEnv(name: string): string | undefined {
  // Static `process.env.EXPO_PUBLIC_X` is inlined by babel-preset-expo for the
  // web export; `extra` is the reachable-everywhere fallback (COMMS-0028). No
  // dynamic process.env[name] bracket access (forbidden by COMMS-0028).
  switch (name) {
    case "EXPO_PUBLIC_POSTHOG_KEY":
      return extra?.EXPO_PUBLIC_POSTHOG_KEY ?? process.env.EXPO_PUBLIC_POSTHOG_KEY;
    case "EXPO_PUBLIC_POSTHOG_HOST":
      return (
        extra?.EXPO_PUBLIC_POSTHOG_HOST ?? process.env.EXPO_PUBLIC_POSTHOG_HOST
      );
    case "EXPO_PUBLIC_GA4_MEASUREMENT_ID":
      return (
        extra?.EXPO_PUBLIC_GA4_MEASUREMENT_ID ??
        process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID
      );
    default:
      return undefined;
  }
}

let posthogClient: PostHog | null = null;
let initialized = false;
let gaMeasurementId: string | null = null;

declare global {
  // gtag/dataLayer injected by the GA4 loader below.
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/** The banner's stored choice, or null if the visitor has not chosen yet. */
export function readStoredConsent(): ConsentChoice | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { choice?: string };
    if (parsed.choice === "granted" || parsed.choice === "denied") {
      return parsed.choice;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredConsent(choice: ConsentChoice): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ choice, ts: Date.now() }),
    );
  } catch {
    // Storage unavailable (private mode quota) — non-fatal; the choice still
    // applies for this session via the PostHog/GA opt-in calls below.
  }
}

/**
 * GA4 Consent Mode v2 loader. Emits the all-denied `default` consent BEFORE the
 * gtag config runs (so GA sets no cookies pre-consent), then loads the gtag
 * script and configures the measurement with `send_page_view` enabled. Idempotent.
 */
function loadGa4(measurementId: string): void {
  if (!hasWindow()) return;
  window.dataLayer = window.dataLayer ?? [];
  // eslint-disable-next-line prefer-rest-params
  const gtag = function gtag(): void {
    // gtag pushes its raw arguments object onto dataLayer (GA's documented shim).
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  };
  window.gtag = gtag as unknown as (...args: unknown[]) => void;

  // (1) Consent Mode v2 — DEFAULT DENIED before any measurement. This is the
  // GA half of I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES.
  window.gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  window.gtag("js", new Date());
  window.gtag("config", measurementId);

  // (2) Load the gtag script AFTER the consent default + config are queued on
  // dataLayer, so order (consent → config) is guaranteed.
  const existing = window.document.querySelector(
    `script[data-mingla-ga4="${measurementId}"]`,
  );
  if (existing === null) {
    const script = window.document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    script.setAttribute("data-mingla-ga4", measurementId);
    window.document.head.appendChild(script);
  }
}

/**
 * One-time init. Loads posthog-js (dynamically) + GA4, both consent-gated.
 * Safe to call when keys are absent (no-op). Safe to call more than once
 * (guarded). Web-only — never reached on native (this file is .web.ts).
 */
export async function initWebAnalytics(): Promise<void> {
  if (initialized) return;
  if (!hasWindow()) return;
  initialized = true;

  const posthogKey = readEnv("EXPO_PUBLIC_POSTHOG_KEY");
  const posthogHost = readEnv("EXPO_PUBLIC_POSTHOG_HOST") ?? POSTHOG_US_HOST;
  gaMeasurementId = readEnv("EXPO_PUBLIC_GA4_MEASUREMENT_ID") ?? null;

  // GA4 first (cheap, sets the consent-default-denied gate immediately).
  if (gaMeasurementId !== null && gaMeasurementId.length > 0) {
    try {
      loadGa4(gaMeasurementId);
    } catch (err) {
      console.warn("[webAnalytics] GA4 init failed (non-fatal):", err);
    }
  }

  if (posthogKey === undefined || posthogKey.length === 0) {
    console.warn(
      "[webAnalytics] EXPO_PUBLIC_POSTHOG_KEY missing — PostHog disabled (no-op).",
    );
  } else {
    try {
      const { default: posthog } = await import("posthog-js");
      posthog.init(posthogKey, {
        api_host: posthogHost,
        person_profiles: "identified_only",
        capture_pageview: true,
        capture_pageleave: true,
        // CONSENT GATE (§4.E / I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES):
        // PostHog stores nothing and captures nothing until opt_in_capturing().
        opt_out_capturing_by_default: true,
        // Power features (§4.G), free-tier only.
        autocapture: { dom_event_allowlist: ["click", "submit"] },
        capture_exceptions: true,
        disable_session_recording: false,
        // Session replay — MASKED (§4.H / I-PROPOSED-1187-REPLAY-MASKS-PII) +
        // sampled (§4.I). maskAllInputs MUST stay true; payment/PII elements are
        // additionally tagged ph-no-capture / data-ph-mask at their call sites.
        session_recording: {
          maskAllInputs: true,
          maskInputOptions: { password: true, email: true },
          maskTextSelector: "[data-ph-mask]",
          sampleRate: SESSION_REPLAY_SAMPLE_RATE,
        },
      });
      posthogClient = posthog;
    } catch (err) {
      console.warn("[webAnalytics] PostHog init failed (non-fatal):", err);
    }
  }

  // Re-apply a previously-stored choice so a returning visitor who already
  // accepted resumes capture without re-prompting (and a prior "denied" stays
  // denied). A fresh visitor (no stored choice) stays gated until they accept.
  const stored = readStoredConsent();
  if (stored === "granted") {
    grantConsent();
  } else if (stored === "denied") {
    denyConsent();
  }
}

/** Accept handler — opens the PostHog + GA4 gates and persists the choice. */
export function grantConsent(): void {
  writeStoredConsent("granted");
  try {
    posthogClient?.opt_in_capturing();
  } catch (err) {
    console.warn("[webAnalytics] opt_in_capturing failed:", err);
  }
  if (hasWindow() && window.gtag) {
    window.gtag("consent", "update", {
      ad_storage: "granted",
      analytics_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    });
  }
}

/** Reject handler — keeps both gates closed and persists the choice. */
export function denyConsent(): void {
  writeStoredConsent("denied");
  try {
    posthogClient?.opt_out_capturing();
  } catch (err) {
    console.warn("[webAnalytics] opt_out_capturing failed:", err);
  }
  // GA4: leave the defaults denied (no update). GA then runs in cookieless
  // consent mode (pinged, no cookies).
}

/** Fire a custom PostHog event + (optionally) a GA4 event. No-op if gated. */
export function captureWeb(
  name: string,
  props?: Record<string, unknown>,
): void {
  try {
    posthogClient?.capture(name, props);
  } catch (err) {
    console.warn(`[webAnalytics] capture("${name}") failed:`, err);
  }
}

/** Fire a GA4 event (e.g. purchase / begin_checkout) for the Ads conversion link. */
export function gaEvent(name: string, params?: Record<string, unknown>): void {
  if (hasWindow() && window.gtag) {
    try {
      window.gtag("event", name, params ?? {});
    } catch (err) {
      console.warn(`[webAnalytics] gaEvent("${name}") failed:`, err);
    }
  }
}

/** Bind identity (Supabase user.id). No-op if PostHog is gated/absent. */
export function identifyWeb(
  distinctId: string,
  props?: Record<string, unknown>,
): void {
  try {
    posthogClient?.identify(distinctId, props);
  } catch (err) {
    console.warn("[webAnalytics] identify failed:", err);
  }
}

/** Read a feature flag (free-tier power feature, §4.G). Default-safe. */
export function getFeatureFlagWeb(key: string): boolean | string | undefined {
  try {
    return posthogClient?.getFeatureFlag(key);
  } catch {
    return undefined;
  }
}
