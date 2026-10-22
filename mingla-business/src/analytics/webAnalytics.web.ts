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
 *   - initWebAnalytics(): reads the canonical consent choice first. PostHog,
 *     GA4, pixels and attribution remain wholly absent until explicit grant.
 *       · PostHog: dynamically imported only after grant; US region locked.
 *       · GA4: denied-default then granted-update are queued after grant and
 *         BEFORE its config/measurement loads.
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
 * posthog-js is loaded via a DYNAMIC import inside the private granted boot, so
 * its bulk never enters the eager chunk or crosses the consent boundary.
 *
 * Env: keys come from app.config `extra` (reachable on web + native — mirrors
 * supabase.ts / the GIPHY pattern). The phc_ key + G-Z4W3B9900S Measurement ID
 * are public-by-design (safe in client bundles). Missing key → graceful no-op
 * (the site never crashes; analytics simply does not load).
 */

import Constants from "expo-constants";
import type { CaptureResult, PostHog } from "posthog-js";
import {
  cleanPageLocation,
  cleanReferrerOrigin,
  sanitizeSearchMeasurement,
  type SearchEventName,
  type SearchMeasurementProperties,
} from "@mingla/search-measurement";

// US region is dispatch-locked (I-PROPOSED-1187-POSTHOG-HOST-US). Keep the
// literal here so the strict-grep gate sees it at the init site.
const POSTHOG_US_HOST = "https://us.i.posthog.com";
const LEGACY_PAGEVIEW_EVENT = "$pageview";

// Session-replay sampling — record ~20% of sessions to protect the free 5K
// recordings/mo cap (§4.I, SC-16). Seth can override server-side in PostHog.
const SESSION_REPLAY_SAMPLE_RATE = 0.2;

// localStorage key — the banner's own source of truth for whether to re-show.
// Shared shape with the marketing surface ("granted" | "denied" + ts).
const CONSENT_STORAGE_KEY = "mingla_consent_v1";

export type ConsentChoice = "granted" | "denied";
export type StoredConsentSnapshot = ConsentChoice | "unresolved";

/**
 * #2771 requires one manual PostHog pageview after consent. PostHog decorates
 * that event with the live URL, so remove every path/query-bearing property in
 * `before_send` and retain only the origin. Typed #3176 public pageviews remain
 * the route-level measurement owner.
 */
function sanitizeLegacyPageview(event: CaptureResult | null): CaptureResult | null {
  if (event === null || event.event !== LEGACY_PAGEVIEW_EVENT) return event;
  const properties = { ...(event.properties ?? {}) } as Record<string, unknown>;
  for (const key of [
    "$current_url", "$pathname", "$referrer", "$referring_domain",
    "$search_engine", "$search_engine_keyword", "current_url", "pathname", "url",
  ]) delete properties[key];
  try {
    const href = typeof window.location.href === "string" ? window.location.href : "";
    properties.$current_url = new URL(href).origin;
  } catch {
    // No URL is safer than an unvalidated private route or query string.
  }
  return { ...event, properties };
}

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
    // ISSUE-865 WP-C — ad-conversion pixel IDs (public-by-design; safe in the
    // client bundle). Missing id → the pixel simply never loads (no-op). Values
    // are set by Seth in app.config `extra` / .env — no VALUES in this repo.
    case "EXPO_PUBLIC_META_PIXEL_ID":
      return extra?.EXPO_PUBLIC_META_PIXEL_ID ?? process.env.EXPO_PUBLIC_META_PIXEL_ID;
    case "EXPO_PUBLIC_TIKTOK_PIXEL_CODE":
      return extra?.EXPO_PUBLIC_TIKTOK_PIXEL_CODE ?? process.env.EXPO_PUBLIC_TIKTOK_PIXEL_CODE;
    case "EXPO_PUBLIC_SNAP_PIXEL_ID":
      return extra?.EXPO_PUBLIC_SNAP_PIXEL_ID ?? process.env.EXPO_PUBLIC_SNAP_PIXEL_ID;
    case "EXPO_PUBLIC_REDDIT_PIXEL_ID":
      return extra?.EXPO_PUBLIC_REDDIT_PIXEL_ID ?? process.env.EXPO_PUBLIC_REDDIT_PIXEL_ID;
    // Reachable-everywhere Supabase endpoint for the fire-and-forget
    // attribution-capture POST (first-party; anon key is public-by-design).
    case "EXPO_PUBLIC_SUPABASE_URL":
      return extra?.EXPO_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
    case "EXPO_PUBLIC_SUPABASE_ANON_KEY":
      return extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    default:
      return undefined;
  }
}

let posthogClient: PostHog | null = null;
let bootPromise: Promise<void> | null = null;
let consentGrantCaptured = false;
let gaMeasurementId: string | null = null;
let pageConsentChoice: ConsentChoice | null | undefined;
const consentSubscribers = new Set<() => void>();

// ISSUE-865 WP-C — ad-conversion pixel state. Resolved in initWebAnalytics;
// bootstrapped ONLY on consent grant. `null` id ⇒ that pixel never loads.
interface AdPixelIds {
  meta: string | null;
  tiktok: string | null;
  snap: string | null;
  reddit: string | null;
}
let adPixelIds: AdPixelIds = { meta: null, tiktok: null, snap: null, reddit: null };
let adPixelsBootstrapped = false;
export type AdPixelConsentMode = "on_arrival" | "opt_in";
let adPixelConsentMode: AdPixelConsentMode | null = null;
let adPixelModePromise: Promise<AdPixelConsentMode> | null = null;
const firedViewContentKeys = new Set<string>();

// First-party storage key for the captured ad click_id (threaded into checkout).
const AD_CLICK_KEY = "mingla_ad_click_v1";
export const AD_CLICK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// De-dupe lifecycle re-entry for the current document only. A real reload gets
// a fresh module and therefore remains a new landing-page view, while a failed
// capture is removed from the in-flight set so the same page can retry.
const capturedLandingTouchKeys = new Set<string>();
const inFlightLandingTouchKeys = new Set<string>();

declare global {
  // gtag/dataLayer injected by the GA4 loader below; the four ad-pixel globals
  // are injected by their vendor snippets on consent (bootstrapAdPixels).
  interface Window {
    __minglaPrebootConsentChoice?: ConsentChoice;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue?: unknown[] };
    _fbq?: unknown;
    ttq?: { page?: (...a: unknown[]) => void; track?: (...a: unknown[]) => void; load?: (...a: unknown[]) => void; [k: string]: unknown };
    TiktokAnalyticsObject?: string;
    snaptr?: ((...args: unknown[]) => void) & { queue?: unknown[] };
    rdt?: ((...args: unknown[]) => void) & { callQueue?: unknown[] };
    __minglaAdPixelConsentMode?: AdPixelConsentMode;
    __minglaAdPixelsBootstrapped?: boolean;
    __minglaAdPageViewKeys?: Record<string, true>;
    __minglaAdViewContentKeys?: Record<string, true>;
  }
}

function resolveAdPixelIds(): void {
  adPixelIds = {
    meta: readEnv("EXPO_PUBLIC_META_PIXEL_ID") ?? null,
    tiktok: readEnv("EXPO_PUBLIC_TIKTOK_PIXEL_CODE") ?? null,
    snap: readEnv("EXPO_PUBLIC_SNAP_PIXEL_ID") ?? null,
    reddit: readEnv("EXPO_PUBLIC_REDDIT_PIXEL_ID") ?? null,
  };
}

async function resolveAdPixelConsentMode(): Promise<AdPixelConsentMode> {
  if (adPixelConsentMode !== null) return adPixelConsentMode;
  const injected = window.__minglaAdPixelConsentMode;
  if (injected === "on_arrival" || injected === "opt_in") {
    adPixelConsentMode = injected;
    return injected;
  }
  if (adPixelModePromise === null) {
    adPixelModePromise = fetch("/api/ad-pixel-config", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) return "on_arrival" as const;
        const payload = await response.json() as {
          ad_pixel_consent_mode?: unknown;
        };
        return payload.ad_pixel_consent_mode === "opt_in"
          ? "opt_in" as const
          : "on_arrival" as const;
      })
      .catch(() => "on_arrival" as const)
      .then((mode) => {
        adPixelConsentMode = mode;
        window.__minglaAdPixelConsentMode = mode;
        return mode;
      });
  }
  return adPixelModePromise;
}

function adTrackingAllowed(): boolean {
  const choice = readStoredConsent();
  if (choice === "denied") return false;
  return adPixelConsentMode !== "opt_in" || choice === "granted";
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function parseConsentRecord(raw: string | null): ConsentChoice | null {
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as { choice?: string };
  return parsed.choice === "granted" || parsed.choice === "denied"
    ? parsed.choice
    : null;
}

/** The canonical same-page choice, or null while the visitor has not chosen. */
export function readStoredConsent(): ConsentChoice | null {
  if (!hasWindow()) return null;
  if (pageConsentChoice !== undefined) return pageConsentChoice;
  // Issue #922 preboot keeps precedence for this page lifetime, including when
  // localStorage is unavailable. All later explicit choices update this cache.
  const prebootChoice = window.__minglaPrebootConsentChoice;
  if (prebootChoice === "granted" || prebootChoice === "denied") {
    pageConsentChoice = prebootChoice;
  } else {
    try {
      pageConsentChoice = parseConsentRecord(
        window.localStorage.getItem(CONSENT_STORAGE_KEY),
      );
    } catch {
      pageConsentChoice = null;
    }
  }
  return pageConsentChoice;
}

/** Stable snapshot consumed by React's external-store bridge. */
export function getStoredConsentSnapshot(): StoredConsentSnapshot {
  return readStoredConsent() ?? "unresolved";
}

function notifyConsentSubscribers(): void {
  for (const subscriber of [...consentSubscribers]) subscriber();
}

function reconcileStoredConsent(event: StorageEvent): void {
  if (event.key !== null && event.key !== CONSENT_STORAGE_KEY) return;
  let next: ConsentChoice | null;
  try {
    next = parseConsentRecord(
      event.key === CONSENT_STORAGE_KEY
        ? event.newValue
        : window.localStorage.getItem(CONSENT_STORAGE_KEY),
    );
  } catch {
    next = null;
  }
  if (next === pageConsentChoice) return;
  pageConsentChoice = next;
  notifyConsentSubscribers();
}

/** Subscribe without initializing analytics or changing consent side effects. */
export function subscribeStoredConsent(subscriber: () => void): () => void {
  consentSubscribers.add(subscriber);
  return () => {
    consentSubscribers.delete(subscriber);
  };
}

if (hasWindow() && typeof window.addEventListener === "function") {
  window.addEventListener("storage", reconcileStoredConsent);
}

function writeStoredConsent(choice: ConsentChoice): void {
  if (!hasWindow()) return;
  const previous = readStoredConsent();
  pageConsentChoice = choice;
  // Issue #922 same-document handoff: this remains canonical when persistence
  // is unavailable, and is updated before any analytics boot can begin.
  window.__minglaPrebootConsentChoice = choice;
  try {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ choice, ts: Date.now() }),
    );
  } catch {
    // Storage unavailable (private mode quota) — non-fatal; the choice still
    // applies for this session via the PostHog/GA opt-in calls below.
  }
  if (previous !== choice) notifyConsentSubscribers();
}

/**
 * GA4 Consent Mode v2 loader. Emits the all-denied `default` consent BEFORE the
 * gtag config runs (so GA sets no cookies pre-consent), then loads the gtag
 * script with automatic pageviews disabled. Search pageviews are emitted only
 * through the sanitized manual owner below. Idempotent.
 */
function loadGa4(measurementId: string): void {
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
  window.gtag("consent", "update", {
    ad_storage: "granted",
    analytics_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
  });
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: false });

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
async function bootGrantedAnalytics(): Promise<void> {
  // Issue #2771: vendor opt-out/denied modes can still initialize, persist,
  // load configuration, and transmit. Explicit Mingla grant must dominate the
  // loader itself, including every retry/concurrent entry.
  if (readStoredConsent() !== "granted") return;
  const posthogKey = readEnv("EXPO_PUBLIC_POSTHOG_KEY");
  const posthogHost = readEnv("EXPO_PUBLIC_POSTHOG_HOST") ?? POSTHOG_US_HOST;
  gaMeasurementId = readEnv("EXPO_PUBLIC_GA4_MEASUREMENT_ID") ?? null;

  resolveAdPixelIds();

  // GA4 first, with denied-default then granted-update queued before config.
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
        // Issue #2795: consent is origin-local. Never let a granted public
        // alias persist PostHog identity onto sibling *.usemingla.com hosts.
        cross_subdomain_cookie: false,
        person_profiles: "identified_only",
        // #3176 — public URLs can carry tokens and attribution parameters.
        // Automatic lifecycle events include the raw browser URL, so every
        // search pageview is owned by the sanitized manual contract below.
        capture_pageview: false,
        capture_pageleave: false,
        before_send: sanitizeLegacyPageview,
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
      posthog.opt_in_capturing();
      // Manual compatibility event: automatic pageviews remain disabled, and
      // before_send reduces this event to origin-only before transport.
      posthog.capture(LEGACY_PAGEVIEW_EVENT);
      posthogClient = posthog;
    } catch (err) {
      console.warn("[webAnalytics] PostHog init failed (non-fatal):", err);
    }
  }

  // Pixels are last in the binding boot order: consent → GA → PostHog → pixels.
  bootstrapAdPixels();
}

function ensureGrantedAnalyticsBoot(): Promise<void> {
  if (readStoredConsent() !== "granted") {
    return Promise.resolve();
  }
  if (bootPromise === null) {
    bootPromise = bootGrantedAnalytics();
  }
  return bootPromise;
}

export async function initWebAnalytics(): Promise<void> {
  if (!hasWindow()) return;
  resolveAdPixelIds();
  await resolveAdPixelConsentMode();
  if (window.__minglaAdPixelsBootstrapped === true) {
    adPixelsBootstrapped = true;
  }
  if (adTrackingAllowed()) bootstrapAdPixels();
  if (readStoredConsent() === "granted") await ensureGrantedAnalyticsBoot();
}

/** Accept handler — opens the PostHog + GA4 gates and persists the choice. */
export async function grantConsent(): Promise<void> {
  writeStoredConsent("granted");
  resolveAdPixelIds();
  bootstrapAdPixels();
  await ensureGrantedAnalyticsBoot();
  if (readStoredConsent() !== "granted" || consentGrantCaptured) return;
  consentGrantCaptured = true;

  // Consent-rate measurement fires only after the grant-only boot is ready.
  // Deny-rate remains derived as sessions without a grant.
  captureWeb("consent_granted");
  gaEvent("consent_granted");
  captureHostPublicSearchPageView(window.location.pathname);
  // toward #3697 F-1: stamp Accept on the existing first-party touch only —
  // do not insert a second touch (first-touch-wins + visit inflation).
  void postAttributionConsent("granted");
}

/** Reject handler — keeps vendor gates closed; stamps Reject on first-party touch. */
export function denyConsent(): void {
  writeStoredConsent("denied");
  stopAdPixels();
  // toward #3697 / #3703: stamp Reject; keep click_id for checkout threading so
  // the server can count locally with shared_with_platforms=false.
  void postAttributionConsent("rejected");
}

/** Fire a custom PostHog event + (optionally) a GA4 event. No-op if gated. */
export function captureWeb(
  name: string,
  props?: Record<string, unknown>,
): void {
  if (readStoredConsent() !== "granted" || posthogClient === null) return;
  try {
    // `rsvp_acknowledgement_viewed` is emitted only after the public RSVP RPC
    // succeeds. Mirror its going/waitlisted states into the privacy-safe search
    // outcome here so the event page keeps its established analytics owner.
    if (
      name === "rsvp_acknowledgement_viewed" &&
      (props?.status === "going" || props?.status === "waitlisted")
    ) {
      captureWebSearchOutcome("generate_lead", {
        audience: "host",
        page_family: "public_inventory",
        icp: "event_promoter",
        action_state: "succeeded",
        content_kind: "event",
      });
    }
    posthogClient?.capture(name, props);
  } catch (err) {
    console.warn(`[webAnalytics] capture("${name}") failed:`, err);
  }
}

/** Fire a GA4 event (e.g. purchase / begin_checkout) for the Ads conversion link. */
export function gaEvent(name: string, params?: Record<string, unknown>): void {
  if (readStoredConsent() === "granted" && hasWindow() && window.gtag) {
    try {
      window.gtag("event", name, params ?? {});
    } catch (err) {
      console.warn(`[webAnalytics] gaEvent("${name}") failed:`, err);
    }
  }
}

/**
 * Fan one already-sanitized search event to both consented web sinks. Existing
 * product analytics keep their established owners; this is the only entry
 * point for the low-cardinality search/outcome contract.
 */
export function captureWebSearchOutcome(
  event: SearchEventName,
  properties: SearchMeasurementProperties,
): void {
  const safe = sanitizeSearchMeasurement(event, properties);
  if (safe === null) return;
  captureWeb(safe.event, safe.properties);
  gaEvent(safe.event, safe.properties);
}

/** Only public event/trip/experience/brand/venue pages are search inventory. */
export function isHostPublicInventoryPathname(pathname: unknown): pathname is string {
  if (typeof pathname !== "string") return false;
  const segments = pathname.split("/").filter(Boolean);
  if (["e", "t", "exp"].includes(segments[0] ?? "")) {
    return segments.length === 3;
  }
  if (segments[0] !== "b") return false;
  return segments.length === 2 ||
    (segments.length === 4 && segments[2] === "v");
}

/**
 * Manual Host public-inventory pageview. Query/fragment data is never accepted;
 * referrer is reduced to its origin before the typed contract sees it.
 */
export function captureHostPublicSearchPageView(pathname: string): void {
  if (
    !hasWindow() ||
    !isHostPublicInventoryPathname(pathname) ||
    readStoredConsent() !== "granted"
  ) {
    return;
  }
  const pageLocation = cleanPageLocation(
    new URL(pathname, window.location.origin).toString(),
  );
  if (pageLocation === null) return;
  const referrerOrigin = cleanReferrerOrigin(window.document.referrer);
  captureWebSearchOutcome("page_view", {
    audience: "explorer",
    page_family: "public_inventory",
    page_location: pageLocation,
    source_kind: referrerOrigin === null ? "direct" : "referrer",
    ...(referrerOrigin === null
      ? {}
      : { page_referrer_origin: referrerOrigin }),
  });
}

/** Bind identity (Supabase user.id). No-op if PostHog is gated/absent. */
export function identifyWeb(
  distinctId: string,
  props?: Record<string, unknown>,
): void {
  if (readStoredConsent() !== "granted" || posthogClient === null) return;
  try {
    posthogClient?.identify(distinctId, props);
  } catch (err) {
    console.warn("[webAnalytics] identify failed:", err);
  }
}

/** Read a feature flag (free-tier power feature, §4.G). Default-safe. */
export function getFeatureFlagWeb(key: string): boolean | string | undefined {
  if (readStoredConsent() !== "granted" || posthogClient === null) return undefined;
  try {
    return posthogClient?.getFeatureFlag(key);
  } catch {
    return undefined;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ISSUE-865 WP-C — ad-conversion pixels + click-id capture (LIVE web surfaces)
//
// The four browser pixels (Meta fbq / TikTok ttq / Snapchat snaptr / Reddit rdt)
// mirror the existing GA4 loader idiom: injected via a <script> tag, wrapped so
// ANY failure (adblock, CSP, 404, slow CDN) is a SILENT NO-OP that never blocks
// render, the Reserve/Pay tap, or navigation. Issue #3697 boots them on arrival
// by default in every market; a remembered opt-out or a region switched to
// opt_in keeps them dark. Every pixel Purchase carries the
// SHARED event_id (the Mingla order id) so browser + server CAPI (WP-B) dedup the
// exact pair (A2-5 / SC-15). NOTHING here is on the tap→pay critical path.
// ═════════════════════════════════════════════════════════════════════════════

const ATTR_TIMEOUT_MS = 4000;

function injectPixelScriptOnce(src: string, marker: string): void {
  if (window.document.querySelector(`script[data-mingla-pixel="${marker}"]`)) return;
  const s = window.document.createElement("script");
  s.async = true;
  s.src = src;
  s.setAttribute("data-mingla-pixel", marker);
  window.document.head.appendChild(s);
}

/** Wrap a single pixel call so its failure is a silent no-op (never blocks the page). */
function safePixel(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn("[webAnalytics] pixel call failed (non-fatal):", err);
  }
}

function currentAdPageViewKey(): string {
  return window.location.href.split("#", 1)[0];
}

function markAdPageViewFired(): void {
  const keys = window.__minglaAdPageViewKeys ??= {};
  keys[currentAdPageViewKey()] = true;
}

function definedProps(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  }
  return out;
}

type QueuedPixel = ((...args: unknown[]) => void) & Record<string, unknown>;

/** Build the common vendor queue shim while preserving each vendor's handoff key. */
function createQueuedPixel(handlerKey: string, queueKey: string): QueuedPixel {
  const pixel = function queuedPixel(...args: unknown[]): void {
    const handler = pixel[handlerKey];
    if (typeof handler === "function") handler(...args);
    else (pixel[queueKey] as unknown[][]).push(args);
  } as QueuedPixel;
  pixel[queueKey] = [];
  return pixel;
}

function bootstrapMetaPixel(pixelId: string): void {
  if (window.fbq === undefined) {
    // Canonical fbq stub — queues calls until fbevents.js loads + sets callMethod.
    const n = createQueuedPixel("callMethod", "queue");
    const stub = n as unknown as { push: unknown; loaded: boolean; version: string; queue: unknown[] };
    stub.push = n;
    stub.loaded = true;
    stub.version = "2.0";
    stub.queue = [];
    window.fbq = n as unknown as Window["fbq"];
    window._fbq = window.fbq;
  }
  injectPixelScriptOnce("https://connect.facebook.net/en_US/fbevents.js", "meta");
  window.fbq?.("init", pixelId);
  window.fbq?.("track", "PageView");
}

function bootstrapTikTokPixel(pixelCode: string): void {
  window.TiktokAnalyticsObject = "ttq";
  const ttq = (window.ttq = window.ttq ?? {}) as unknown as {
    methods: string[];
    setAndDefer: (obj: Record<string, unknown>, method: string) => void;
    load: (id: string) => void;
    page: () => void;
    push: (a: unknown) => void;
    _i?: Record<string, unknown[]>;
    _t?: Record<string, number>;
    _o?: Record<string, unknown>;
    [k: string]: unknown;
  };
  ttq.push = ttq.push ?? ((a: unknown): void => {
    ((ttq as unknown as { _q?: unknown[] })._q = (ttq as unknown as { _q?: unknown[] })._q ?? []).push(a);
  });
  ttq.methods = [
    "page", "track", "identify", "instances", "debug", "on", "off", "once",
    "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent",
    "revokeConsent", "grantConsent",
  ];
  ttq.setAndDefer = function (obj: Record<string, unknown>, method: string): void {
    obj[method] = function (): void {
      // eslint-disable-next-line prefer-rest-params
      const args = Array.prototype.slice.call(arguments) as unknown[];
      (obj as unknown as { push: (a: unknown) => void }).push([method, ...args]);
    };
  };
  for (const m of ttq.methods) ttq.setAndDefer(ttq as unknown as Record<string, unknown>, m);
  ttq.load = function (id: string): void {
    ttq._i = ttq._i ?? {};
    ttq._i[id] = [];
    ttq._t = ttq._t ?? {};
    ttq._t[id] = Number(new Date());
    ttq._o = ttq._o ?? {};
    ttq._o[id] = {};
    injectPixelScriptOnce(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${id}&lib=ttq`, "tiktok");
  };
  ttq.load(pixelCode);
  ttq.page();
}

function bootstrapSnapPixel(pixelId: string): void {
  if (window.snaptr === undefined) {
    window.snaptr = createQueuedPixel("handleRequest", "queue") as Window["snaptr"];
  }
  injectPixelScriptOnce("https://sc-static.net/scevent.min.js", "snap");
  window.snaptr?.("init", pixelId);
  window.snaptr?.("track", "PAGE_VIEW");
}

function bootstrapRedditPixel(pixelId: string): void {
  if (window.rdt === undefined) {
    window.rdt = createQueuedPixel("sendEvent", "callQueue") as Window["rdt"];
  }
  injectPixelScriptOnce("https://www.redditstatic.com/ads/pixel.js", "reddit");
  window.rdt?.("init", pixelId);
  window.rdt?.("track", "PageVisit");
}

/**
 * Bootstrap the four ad pixels at the configured consent boundary. Each pixel
 * is isolated in its own try/catch so one broken loader can neither block the
 * page nor prevent the others from loading. Idempotent.
 */
function bootstrapAdPixels(): void {
  if (!adTrackingAllowed() || adPixelsBootstrapped) return;
  adPixelsBootstrapped = true; // set first so a throw can't cause a re-bootstrap loop
  window.__minglaAdPixelsBootstrapped = true;
  if (adPixelIds.meta) safePixel(() => bootstrapMetaPixel(adPixelIds.meta as string));
  if (adPixelIds.tiktok) safePixel(() => bootstrapTikTokPixel(adPixelIds.tiktok as string));
  if (adPixelIds.snap) safePixel(() => bootstrapSnapPixel(adPixelIds.snap as string));
  if (adPixelIds.reddit) safePixel(() => bootstrapRedditPixel(adPixelIds.reddit as string));
  // Every provider bootstrap above emits its page-view event. Mark this exact
  // browser URL so the hydrated route effect cannot count the same landing a
  // second time. A later SPA navigation has a different href and still fires.
  markAdPageViewFired();
}

/** True while tracking is allowed and the arrival-time pixel boot ran. */
export function adPixelsReady(): boolean {
  return adTrackingAllowed() && adPixelsBootstrapped;
}

function expireAdCookie(name: string): void {
  if (!window.document) return;
  const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
  for (const domain of ["", "; domain=.usemingla.com"]) {
    window.document.cookie =
      `${name}=; expires=${expires}; path=/${domain}; SameSite=Lax`;
  }
}

/** Immediately stop future pixel calls and discard browser match cookies. */
function stopAdPixels(): void {
  safePixel(() => window.fbq?.("consent", "revoke"));
  safePixel(() => {
    const revoke = window.ttq?.revokeConsent;
    if (typeof revoke === "function") revoke();
  });
  if (typeof window.document?.querySelectorAll === "function") {
    for (
      const script of Array.from(
        window.document.querySelectorAll('script[data-mingla-pixel]'),
      )
    ) {
      script.remove();
    }
  }
  for (const name of ["_fbp", "_fbc", "_ttp", "_scid"]) expireAdCookie(name);
  window.fbq = undefined;
  window._fbq = undefined;
  window.ttq = undefined;
  window.snaptr = undefined;
  adPixelsBootstrapped = false;
  window.__minglaAdPixelsBootstrapped = false;
}

// ── Browser pixel fires (all no-op after opt-out / when no pixel loaded) ─────

/** Public-page view — PageView across the four pixels. No-op until bootstrapped. */
export function fireAdPageView(): void {
  if (!adTrackingAllowed() || !adPixelsBootstrapped) return;
  const keys = window.__minglaAdPageViewKeys ??= {};
  const key = currentAdPageViewKey();
  if (keys[key]) return;
  keys[key] = true;
  safePixel(() => window.fbq?.("track", "PageView"));
  safePixel(() => window.ttq?.page?.());
  safePixel(() => window.snaptr?.("track", "PAGE_VIEW"));
  safePixel(() => window.rdt?.("track", "PageVisit"));
}

export interface AdCommerceEventProps {
  value?: number;
  currency?: string;
  contentId?: string;
  brandId?: string;
}

/** Offering view — one deduplicated ViewContent across the four pixels. */
export function fireAdViewContent(props?: AdCommerceEventProps & {
  eventId?: string;
}): void {
  if (!adTrackingAllowed() || !adPixelsBootstrapped) return;
  const value = props?.value;
  const currency = props?.currency;
  const contentId = props?.contentId;
  if (!contentId) return;
  const brandId = props?.brandId;
  const serverKeys = window.__minglaAdViewContentKeys ??= {};
  if (serverKeys[contentId]) return;
  const eventId = props?.eventId ?? globalThis.crypto?.randomUUID?.() ??
    `view-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const viewKey = contentId;
  if (firedViewContentKeys.has(viewKey)) return;
  firedViewContentKeys.add(viewKey);
  serverKeys[contentId] = true;
  safePixel(() =>
    window.fbq?.("track", "ViewContent", definedProps({
      value,
      currency,
      content_type: "product",
      content_ids: [contentId],
      brand_id: brandId,
    }), { eventID: eventId })
  );
  safePixel(() =>
    window.ttq?.track?.("ViewContent", definedProps({
      value,
      currency,
      content_type: "product",
      content_id: contentId,
      brand_id: brandId,
    }), { event_id: eventId })
  );
  safePixel(() =>
    window.snaptr?.("track", "VIEW_CONTENT", definedProps({
      price: value,
      currency,
      item_ids: [contentId],
      brand_id: brandId,
      transaction_id: eventId,
      client_dedup_id: eventId,
    }))
  );
  safePixel(() => window.rdt?.("track", "ViewContent", definedProps({ value, currency })));
}

/**
 * Purchase fire — the DEDUP fire. `eventId` MUST be the Mingla order id (the
 * shared event_id): Meta's eventID (4th arg) + event name 'Purchase' must match
 * the server CAPI's event_id + event_name exactly (A2-5). No-op pre-consent.
 */
export function fireAdPurchase(
  eventId: string,
  props: AdCommerceEventProps,
): void {
  if (!adTrackingAllowed()) return;
  // toward #3697 F-4: free tickets ($0) must match server sign-up events.
  const isPaidPurchase = !(typeof props.value === "number" && props.value <= 0);
  fireAdConversion(eventId, props, isPaidPurchase);
}

function fireAdConversion(
  eventId: string,
  props: AdCommerceEventProps,
  purchase: boolean,
): void {
  if (!adTrackingAllowed() || !adPixelsBootstrapped || !eventId) return;
  const value = props.value;
  const currency = props.currency;
  safePixel(() =>
    // toward #3697 F-4: free/RSVP = CompleteRegistration (must match server CAPI).
    window.fbq?.("track", purchase ? "Purchase" : "CompleteRegistration", definedProps({
      value,
      currency,
      content_type: "product",
      content_ids: props.contentId ? [props.contentId] : undefined,
      brand_id: props.brandId,
    }), { eventID: eventId })
  );
  safePixel(() =>
    window.ttq?.track?.(
      purchase ? "CompletePayment" : "CompleteRegistration",
      definedProps({
        value,
        currency,
        content_type: "product",
        content_id: props.contentId,
        brand_id: props.brandId,
      }),
      { event_id: eventId },
    )
  );
  safePixel(() =>
    window.snaptr?.("track", purchase ? "PURCHASE" : "SIGN_UP", definedProps({
      price: value,
      currency,
      item_ids: props.contentId ? [props.contentId] : undefined,
      brand_id: props.brandId,
      transaction_id: eventId,
      client_dedup_id: eventId,
    }))
  );
  safePixel(() =>
    window.rdt?.("track", purchase ? "Purchase" : "SignUp", definedProps({ value, currency, conversion_id: eventId }))
  );
}

/**
 * ISSUE-865 PR1 WP-2 — Reservation fire (sign-up twin of fireAdPurchase).
 * toward #3697 F-4: FREE RSVP = CompleteRegistration / SIGN_UP / SignUp — not
 * a value'd Purchase. `eventId` MUST be the Mingla reservation id so it dedups
 * the server CAPI pair. Value defaults to £0. No-op pre-consent; never throws.
 */
export function fireAdReservation(
  eventId: string,
  props: AdCommerceEventProps = {},
): void {
  if (!adTrackingAllowed()) return;
  fireAdConversion(eventId, props, false);
}

/** Checkout-start dedup pair: browser pixels share the checkout session id. */
export function fireAdInitiateCheckout(
  eventId: string,
  props: AdCommerceEventProps = {},
): void {
  if (!adTrackingAllowed() || !adPixelsBootstrapped || !eventId) return;
  safePixel(() =>
    window.fbq?.(
      "track",
      "InitiateCheckout",
      definedProps({
        value: props.value,
        currency: props.currency,
        content_type: "product",
        content_ids: props.contentId ? [props.contentId] : undefined,
        brand_id: props.brandId,
      }),
      { eventID: eventId },
    )
  );
  safePixel(() =>
    window.ttq?.track?.("InitiateCheckout", definedProps({
      value: props.value,
      currency: props.currency,
      content_type: "product",
      content_id: props.contentId,
      brand_id: props.brandId,
    }), { event_id: eventId })
  );
  safePixel(() =>
    window.snaptr?.("track", "START_CHECKOUT", definedProps({
      price: props.value,
      currency: props.currency,
      item_ids: props.contentId ? [props.contentId] : undefined,
      brand_id: props.brandId,
      transaction_id: eventId,
      client_dedup_id: eventId,
    }))
  );
}

async function sha256Browser(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** TikTok Advanced Matching; raw buyer PII never leaves this function. */
export async function identifyAdBuyer(input: {
  email?: string | null;
  phone?: string | null;
}): Promise<void> {
  if (!adTrackingAllowed() || !adPixelsBootstrapped) return;
  const identify = window.ttq?.identify;
  if (typeof identify !== "function") return;
  const email = input.email?.trim().toLowerCase() ?? "";
  const phone = input.phone?.replace(/[^0-9]/g, "") ?? "";
  const payload = definedProps({
    email: email ? await sha256Browser(email) : undefined,
    phone_number: phone ? await sha256Browser(phone) : undefined,
  });
  if (Object.keys(payload).length > 0) safePixel(() => identify(payload));
}

// ── Click-id capture + first-party threading storage ──────────────────────────

interface StoredAdClick {
  clickId: string | null;
}

/** The click_id captured on landing, for threading into checkout-create. */
export function getStoredClickAttribution(): StoredAdClick {
  let clickId: unknown;
  try {
    // toward #3697: keep click_id readable after Reject so checkout can thread it
    // (server then sets shared_with_platforms=false). Vendor pixels stay grant-gated.
    const stored = JSON.parse(
      window.localStorage.getItem(AD_CLICK_KEY) ?? "{}",
    ) as { clickId?: unknown; expiresAt?: unknown };
    if (typeof stored.expiresAt !== "number" || stored.expiresAt <= Date.now()) {
      window.localStorage.removeItem(AD_CLICK_KEY);
      return { clickId: null };
    }
    clickId = stored.clickId;
  } catch {
    // Storage and malformed data remain optional attribution failures.
  }
  return { clickId: typeof clickId === "string" ? clickId : null };
}

function storeClickId(clickId: string): void {
  // toward #3697: persist first-party click_id even pre-consent; Reject does not
  // clear an already-stored id (checkout still needs it).
  if (readStoredConsent() === "denied") return;
  try {
    window.localStorage.setItem(
      AD_CLICK_KEY,
      JSON.stringify({ clickId, expiresAt: Date.now() + AD_CLICK_TTL_MS }),
    );
  } catch {
    // localStorage unavailable (private mode) — non-fatal; threading is skipped.
  }
}

export interface StoredAdMatchData {
  fbp: string | null;
  fbc: string | null;
  scid: string | null;
  ttp: string | null;
  clientUserAgent: string | null;
  trackingOptOut: boolean;
}

function cookieValue(name: string): string | null {
  try {
    const prefix = `${encodeURIComponent(name)}=`;
    for (const part of (window.document.cookie ?? "").split(";")) {
      const trimmed = part.trim();
      if (!trimmed.startsWith(prefix)) continue;
      const value = decodeURIComponent(trimmed.slice(prefix.length)).trim();
      return value ? value.slice(0, 512) : null;
    }
  } catch {
    // A malformed third-party cookie must never stop checkout creation.
  }
  return null;
}

/** Consent-gated browser match data persisted on checkout for server events. */
export function getStoredAdMatchData(): StoredAdMatchData {
  const trackingOptOut = hasWindow() && readStoredConsent() === "denied";
  if (!hasWindow() || !adTrackingAllowed()) {
    return {
      fbp: null,
      fbc: null,
      scid: null,
      ttp: null,
      clientUserAgent: null,
      trackingOptOut,
    };
  }
  return {
    fbp: cookieValue("_fbp"),
    fbc: cookieValue("_fbc"),
    scid: cookieValue("_scid"),
    ttp: cookieValue("_ttp"),
    clientUserAgent: typeof window.navigator.userAgent === "string"
      ? window.navigator.userAgent.slice(0, 1024)
      : null,
    trackingOptOut: false,
  };
}

function postAttr(
  base: string,
  anon: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${base}/functions/v1/attribution-capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}`, apikey: anon },
    body: JSON.stringify(body),
    signal,
  });
}

export interface CaptureAdClickDest {
  pageType?: "event" | "trip" | "brand" | "venue" | "experience";
  brandSlug?: string | null;
  entitySlug?: string | null;
  eventId?: string | null;
}

/**
 * Parse the ad click-ids / UTMs off the landing URL and record a first-party
 * touch (server-side, via attribution-capture) — returns nothing; the click_id
 * is stored for checkout threading. First-party measurement: it forwards the
 * click id / UTM ONLY (never email/phone), so no PII leaves the browser (SC-8).
 * Fire-and-forget, timeout-bounded — never delays the landing render.
 *
 * toward #3697 / #3699 (TEST-MOD #2771): first-party touch may run before the
 * cookie banner (consent_state=pending). Reject blocks further capture. Vendor
 * pixels stay grant-gated.
 */
export function captureAdClickIds(dest?: CaptureAdClickDest): void {
  if (!hasWindow() || readStoredConsent() === "denied") return;
  const existing = getStoredClickAttribution().clickId;
  try {
    const params = new URLSearchParams(window.location.search);
    const fbclid = params.get("fbclid");
    const ttclid = params.get("ttclid");
    const sccid = params.get("sccid") ?? params.get("ScCid");
    const gclid = params.get("gclid");
    const rdtCid = params.get("rdt_cid");
    const afCId = params.get("af_c_id") ?? params.get("c_id");
    // ISSUE-865 PR1 WP-1 — first-party campaign param. Forwarded to
    // attribution-capture, which resolves mc_id/af_c_id → ad_campaigns → the
    // touch's campaign_id + brand_id (per-campaign ROI).
    const mcId = params.get("mc_id");
    const adSetId = params.get("adset_id") ?? params.get("ad_squad_id");
    const adId = params.get("ad_id");
    const utm: Record<string, string> = {};
    for (const k of [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      // Meta expands this macro from META_URL_TAGS. Keep it first-party so a
      // live delivery audit can reconcile touches by placement.
      "placement",
    ]) {
      const v = params.get(k);
      if (v !== null && v.length > 0) utm[k] = v;
    }
    const external = fbclid ?? ttclid ?? sccid ?? gclid ?? rdtCid ?? null;
    const utmSource = (utm.utm_source ?? "").toLowerCase();
    const network = fbclid
      ? "meta"
      : ttclid
      ? "tiktok"
      : sccid
      ? "snapchat"
      : rdtCid
      ? "reddit"
      : gclid
      ? "google"
      : utmSource === "facebook" || utmSource === "meta"
      ? "meta"
      : utmSource === "tiktok"
      ? "tiktok"
      : utmSource === "snapchat" || utmSource === "snap"
      ? "snapchat"
      : utmSource === "reddit"
      ? "reddit"
      : utmSource === "google"
      ? "google"
      : "other";
    // Pre-consent: only ad / campaign signals (no organic referrer scraping).
    // After Accept: referrer host may enrich entry_source (ISSUE-855 PR-2).
    const consent = readStoredConsent();
    const refHost = consent === "granted" ? readReferrerHost() : null;
    const hasAdSignal =
      external !== null || afCId !== null || mcId !== null ||
      Object.keys(utm).length > 0;
    // First-touch storage and raw landing measurement are separate concerns.
    // Keep the original click_id for checkout attribution, but record every
    // later URL carrying an explicit ad/campaign signal so Meta LPVs are not
    // silently reduced to one touch per seven-day browser window.
    if (existing !== null && !hasAdSignal) {
      if (consent === "granted") {
        void postAttributionConsent("granted", existing);
      }
      return;
    }
    if (!hasAdSignal && refHost === null) {
      return;
    }
    // Pre-consent bare referrer-only visits stay dark (vendor + first-party).
    if (consent !== "granted" && !hasAdSignal) {
      return;
    }
    const consentState = consent === "granted"
      ? "granted"
      : consent === "denied"
      ? "rejected"
      : "pending";
    const landingTouchKey = JSON.stringify({
      search: window.location.search,
      pageType: dest?.pageType ?? null,
      brandSlug: dest?.brandSlug ?? null,
      entitySlug: dest?.entitySlug ?? null,
      eventId: dest?.eventId ?? null,
      source: hasAdSignal ? "ad" : refHost,
    });
    if (
      capturedLandingTouchKeys.has(landingTouchKey) ||
      inFlightLandingTouchKeys.has(landingTouchKey)
    ) {
      return;
    }
    inFlightLandingTouchKeys.add(landingTouchKey);
    void postAttributionTouch({
      network,
      externalClickId: external,
      afCId,
      mcId,
      adSetId,
      adId,
      utm,
      dest,
      referrer: refHost,
      consentState,
    })
      .then((clickId) => {
        if (clickId !== null) {
          capturedLandingTouchKeys.add(landingTouchKey);
        }
        // FIRST-TOUCH-WINS: keep the click_id of the first attributable touch
        // for checkout threading. Later ad landings are still measured above.
        if (clickId !== null && getStoredClickAttribution().clickId === null) {
          storeClickId(clickId);
        }
      })
      .finally(() => {
        inFlightLandingTouchKeys.delete(landingTouchKey);
      });
  } catch (err) {
    console.warn("[webAnalytics] captureAdClickIds failed (non-fatal):", err);
  }
}

// ── attribution-capture POSTs (first-party, fire-and-forget, no PII egress) ───

/**
 * ISSUE-855 PR-2 — the HOST of document.referrer ONLY (never the path/query/
 * fragment, so no PII leaves the browser). Returns null for a direct visit (empty
 * referrer), an app webview with no referrer, or any unparseable value. The server
 * (attribution-capture) turns this host into entry_source.
 */
export function readReferrerHost(): string | null {
  if (readStoredConsent() !== "granted") return null;
  try {
    const host = new URL(window.document.referrer).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

interface PostTouchInput {
  network: string;
  externalClickId: string | null;
  afCId: string | null;
  mcId?: string | null;
  adSetId?: string | null;
  adId?: string | null;
  utm: Record<string, string>;
  dest?: CaptureAdClickDest;
  // ISSUE-855 PR-2 — referrer host only (no PII); forwarded for entry_source.
  referrer?: string | null;
  consentState?: "pending" | "granted" | "rejected";
}

/** POST a touch to attribution-capture; returns the server click_id (or null). */
export async function postAttributionTouch(input: PostTouchInput): Promise<string | null> {
  // toward #3697: first-party touch allowed pre-consent; Reject stops it.
  if (readStoredConsent() === "denied") return null;
  const base = readEnv("EXPO_PUBLIC_SUPABASE_URL");
  const anon = readEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  if (base === undefined || anon === undefined) return null;
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), ATTR_TIMEOUT_MS);
  try {
    const consent = readStoredConsent();
    const consentState = input.consentState ??
      (consent === "granted"
        ? "granted"
        : consent === "denied"
        ? "rejected"
        : "pending");
    const res = await postAttr(
      base,
      anon,
      {
        kind: "touch",
        surface: "web",
        lane: "consumer",
        network: input.network,
        external_click_id: input.externalClickId,
        af_c_id: input.afCId,
        mc_id: input.mcId ?? null,
        ad_set_id: input.adSetId ?? null,
        ad_id: input.adId ?? null,
        referrer: input.referrer ?? null,
        consent_state: consentState,
        utm: input.utm,
        dest: input.dest
          ? {
            page_type: input.dest.pageType,
            brand_slug: input.dest.brandSlug ?? undefined,
            entity_slug: input.dest.entitySlug ?? undefined,
            event_id: input.dest.eventId ?? undefined,
          }
          : undefined,
      },
      aborter.signal,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; click_id?: string };
    // attribution-capture deliberately returns HTTP 200 for soft failures.
    // Never persist the echoed click_id unless the touch row really landed;
    // otherwise a soft error suppresses later first-touch retries for 7 days.
    return data.ok === true && typeof data.click_id === "string"
      ? data.click_id
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** toward #3697: stamp Accept/Reject onto the stored first-party click_id. */
async function postAttributionConsent(
  consentState: "granted" | "rejected",
  clickIdOverride?: string | null,
): Promise<void> {
  const clickId = clickIdOverride ?? getStoredClickAttribution().clickId;
  if (clickId === null || clickId === undefined) return;
  const base = readEnv("EXPO_PUBLIC_SUPABASE_URL");
  const anon = readEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  if (base === undefined || anon === undefined) return;
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), ATTR_TIMEOUT_MS);
  try {
    await postAttr(
      base,
      anon,
      {
        kind: "consent",
        click_id: clickId,
        consent_state: consentState,
        surface: "web",
        lane: "consumer",
      },
      aborter.signal,
    );
  } catch {
    // Fire-and-forget.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * toward #3697 Wave 0d / #3702: browser must not write ad_conversions.
 * Authoritative row + CAPI fan-out live in adConversionFire (post-finalize).
 * Kept as a no-op so call sites stay compile-stable.
 */
export function postAttributionConversion(_input: {
  eventId: string;
  valueCents?: number | null;
  currency?: string | null;
  eventSourceUrl?: string | null;
}): void {
  // Intentionally empty — trusted server path only.
}
