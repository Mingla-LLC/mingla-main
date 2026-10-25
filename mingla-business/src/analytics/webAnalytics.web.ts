/**
 * webAnalytics.web.ts — Buyer-web (Expo Web) analytics, web-only.
 *   META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 2 (buyer web).
 *   #2331 [privacy bar] — one privacy owner for analytics and ads.
 *
 * This is the WEB resolution of the analytics split (Metro resolves `.web.ts`
 * on web, the sibling `webAnalytics.ts` no-op on native — exact mechanism the
 * mixpanelService.web.ts split already relies on). The native bundle NEVER
 * pulls posthog-js / gtag: this file only ever loads in the web export.
 *
 * I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF (#2331): analytics (PostHog, GA4) and
 * ads (Meta/TikTok/Snap/Reddit pixels) are each ON unless this visitor turned
 * it off, in every country. There is no region mode. The only other signal is
 * Global Privacy Control, which starts ads off (the visitor may turn it on).
 *   - initWebAnalytics(): boots whichever of the two is on.
 *   - savePrivacyChoice(): persists `mingla_privacy_v2`, stops what was turned
 *     off (and clears its cookies) and restarts what was turned on, on the same
 *     page without a reload.
 *   - captureWeb / identifyWeb: capture/identify facades the call sites use.
 *     Each is a no-op while analytics is off.
 *
 * SECURITY (§4.H): session replay masks ALL inputs by default
 * (`maskAllInputs: true`) and masks any element tagged `data-ph-mask` / replaces
 * any element tagged `ph-no-capture`. Buyer-web checkout/payment/PII elements
 * carry those tags at their call sites. A replay capturing a card field or PII
 * = automatic FAIL. Replay only runs while analytics is on.
 *
 * Cost guard (§4.I): session-replay sampleRate is the free-tier protector for
 * the 5K recordings/mo cap; Seth can raise/lower it server-side in PostHog
 * without a deploy. Autocapture is narrowed to click/submit to protect the 1M
 * events/mo cap.
 *
 * posthog-js is loaded via a DYNAMIC import inside the analytics boot, so its
 * bulk never enters the eager chunk.
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

// #2331 — the one saved privacy choice, shared in shape with usemingla.com.
// `mingla_consent_v1` is the legacy key: read once, carried over, removed.
export const PRIVACY_STORAGE_KEY = "mingla_privacy_v2";
export const LEGACY_CONSENT_STORAGE_KEY = "mingla_consent_v1";

/** What a visitor saved. No saved choice means both are on (ads: unless GPC). */
export interface PrivacyChoice {
  analytics: boolean;
  ads: boolean;
  ts: number;
}

/** Live state for the privacy bar: never shows a switch that disagrees with what runs. */
export interface PrivacySnapshot {
  /** True once the visitor saved a choice (the bar stays hidden). */
  saved: boolean;
  analytics: boolean;
  ads: boolean;
  /** The browser sent Global Privacy Control. */
  gpc: boolean;
}

/**
 * #2771 requires one manual PostHog pageview after boot. PostHog decorates
 * that event with the live URL, so remove every path/query-bearing property in
 * `before_send` and retain only the origin. Typed #3176 public pageviews remain
 * the route-level measurement owner.
 */
function sanitizeLegacyPageview(
  event: CaptureResult | null,
): CaptureResult | null {
  if (event === null || event.event !== LEGACY_PAGEVIEW_EVENT) return event;
  const properties = { ...(event.properties ?? {}) } as Record<string, unknown>;
  for (const key of [
    "$current_url",
    "$pathname",
    "$referrer",
    "$referring_domain",
    "$search_engine",
    "$search_engine_keyword",
    "current_url",
    "pathname",
    "url",
  ])
    delete properties[key];
  try {
    const href =
      typeof window.location.href === "string" ? window.location.href : "";
    properties.$current_url = new URL(href).origin;
  } catch {
    // No URL is safer than an unvalidated private route or query string.
  }
  return { ...event, properties };
}

const extra = Constants.expoConfig?.extra as
  Record<string, string | undefined> | undefined;

function readEnv(name: string): string | undefined {
  // Static `process.env.EXPO_PUBLIC_X` is inlined by babel-preset-expo for the
  // web export; `extra` is the reachable-everywhere fallback (COMMS-0028). No
  // dynamic process.env[name] bracket access (forbidden by COMMS-0028).
  switch (name) {
    case "EXPO_PUBLIC_POSTHOG_KEY":
      return (
        extra?.EXPO_PUBLIC_POSTHOG_KEY ?? process.env.EXPO_PUBLIC_POSTHOG_KEY
      );
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
      return (
        extra?.EXPO_PUBLIC_META_PIXEL_ID ??
        process.env.EXPO_PUBLIC_META_PIXEL_ID
      );
    case "EXPO_PUBLIC_TIKTOK_PIXEL_CODE":
      return (
        extra?.EXPO_PUBLIC_TIKTOK_PIXEL_CODE ??
        process.env.EXPO_PUBLIC_TIKTOK_PIXEL_CODE
      );
    case "EXPO_PUBLIC_SNAP_PIXEL_ID":
      return (
        extra?.EXPO_PUBLIC_SNAP_PIXEL_ID ??
        process.env.EXPO_PUBLIC_SNAP_PIXEL_ID
      );
    case "EXPO_PUBLIC_REDDIT_PIXEL_ID":
      return (
        extra?.EXPO_PUBLIC_REDDIT_PIXEL_ID ??
        process.env.EXPO_PUBLIC_REDDIT_PIXEL_ID
      );
    // Reachable-everywhere Supabase endpoint for the fire-and-forget
    // attribution-capture POST (first-party; anon key is public-by-design).
    case "EXPO_PUBLIC_SUPABASE_URL":
      return (
        extra?.EXPO_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL
      );
    case "EXPO_PUBLIC_SUPABASE_ANON_KEY":
      return (
        extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
      );
    default:
      return undefined;
  }
}
let posthogClient: PostHog | null = null;
let posthogOptedOut = false;
let bootPromise: Promise<void> | null = null;
let gaMeasurementId: string | null = null;
let pageChoice: PrivacyChoice | null | undefined;
let lastSnapshot: PrivacySnapshot | null = null;
const privacySubscribers = new Set<() => void>();

// ISSUE-865 WP-C / #3697 — ad-conversion pixel state. Resolved in
// initWebAnalytics; bootstrapped on arrival unless the visitor turned ads off
// (or Global Privacy Control is on). `null` id ⇒ that pixel never loads.
interface AdPixelIds {
  meta: string | null;
  tiktok: string | null;
  snap: string | null;
  reddit: string | null;
}
let adPixelIds: AdPixelIds = {
  meta: null,
  tiktok: null,
  snap: null,
  reddit: null,
};
let adPixelsBootstrapped = false;

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
  // are injected by their vendor snippets (bootstrapAdPixels).
  interface Window {
    /** Same-document handoff from a server-rendered page (publicAdRuntime). */
    __minglaPrebootPrivacy?: PrivacyChoice;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & {
      callMethod?: (...a: unknown[]) => void;
      queue?: unknown[];
    };
    _fbq?: unknown;
    ttq?: {
      page?: (...a: unknown[]) => void;
      track?: (...a: unknown[]) => void;
      load?: (...a: unknown[]) => void;
      [k: string]: unknown;
    };
    TiktokAnalyticsObject?: string;
    snaptr?: ((...args: unknown[]) => void) & { queue?: unknown[] };
    rdt?: ((...args: unknown[]) => void) & { callQueue?: unknown[] };
    __minglaAdPixelsBootstrapped?: boolean;
    __minglaAdPageViewKeys?: Record<string, true>;
    __minglaAdViewContentKeys?: Record<string, true>;
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
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

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function isPrivacyChoice(value: unknown): value is PrivacyChoice {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<PrivacyChoice>;
  return typeof record.analytics === "boolean" && typeof record.ads === "boolean";
}

function parsePrivacyRecord(raw: string | null): PrivacyChoice | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPrivacyChoice(parsed)) return null;
    return {
      analytics: parsed.analytics,
      ads: parsed.ads,
      ts: typeof parsed.ts === "number" ? parsed.ts : 0,
    };
  } catch {
    return null;
  }
}

/** v1 carried over: denied → both off, granted → both on. Buyer web wrote `choice`, usemingla.com `value`. */
export function parseLegacyConsentRecord(raw: string | null): PrivacyChoice | null {
  if (raw === null) return null;
  let value: unknown = raw;
  try {
    const parsed = JSON.parse(raw) as { choice?: unknown; value?: unknown; ts?: unknown };
    value = parsed?.choice ?? parsed?.value;
    const on = value === "granted";
    if (!on && value !== "denied") return null;
    return { analytics: on, ads: on, ts: typeof parsed.ts === "number" ? parsed.ts : 0 };
  } catch {
    if (value !== "granted" && value !== "denied") return null;
    const on = value === "granted";
    return { analytics: on, ads: on, ts: 0 };
  }
}

function persistPrivacyChoice(choice: PrivacyChoice): void {
  try {
    window.localStorage.setItem(PRIVACY_STORAGE_KEY, JSON.stringify(choice));
    window.localStorage.removeItem(LEGACY_CONSENT_STORAGE_KEY);
  } catch (err) {
    // Storage unavailable (private mode / quota): the choice still applies for
    // this page through the same-document cache and preboot handoff.
    console.warn("[webAnalytics] privacy choice not persisted:", err);
  }
}

function readPersistedChoice(): PrivacyChoice | null {
  try {
    const current = parsePrivacyRecord(
      window.localStorage.getItem(PRIVACY_STORAGE_KEY),
    );
    if (current !== null) return current;
    const legacy = parseLegacyConsentRecord(
      window.localStorage.getItem(LEGACY_CONSENT_STORAGE_KEY),
    );
    if (legacy !== null) persistPrivacyChoice(legacy);
    return legacy;
  } catch {
    return null;
  }
}

/** The visitor's saved choice, or null while they have not chosen. */
export function readPrivacyChoice(): PrivacyChoice | null {
  if (!hasWindow()) return null;
  if (pageChoice !== undefined) return pageChoice;
  const preboot = window.__minglaPrebootPrivacy;
  pageChoice = isPrivacyChoice(preboot) ? preboot : readPersistedChoice();
  return pageChoice;
}

/** Global Privacy Control: the browser turning ads off on the visitor's behalf. */
export function globalPrivacyControlOn(): boolean {
  return (
    hasWindow() &&
    typeof window.navigator === "object" &&
    window.navigator !== null &&
    window.navigator.globalPrivacyControl === true
  );
}

/** I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF — analytics half. */
export function isAnalyticsOn(): boolean {
  if (!hasWindow()) return false;
  const choice = readPrivacyChoice();
  return choice === null ? true : choice.analytics;
}

/** I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF — ads half (GPC starts it off). */
export function isAdsOn(): boolean {
  if (!hasWindow()) return false;
  const choice = readPrivacyChoice();
  return choice === null ? !globalPrivacyControlOn() : choice.ads;
}

/** Stable snapshot consumed by React's external-store bridge. */
export function getPrivacySnapshot(): PrivacySnapshot {
  const next: PrivacySnapshot = {
    saved: readPrivacyChoice() !== null,
    analytics: isAnalyticsOn(),
    ads: isAdsOn(),
    gpc: globalPrivacyControlOn(),
  };
  if (
    lastSnapshot !== null &&
    lastSnapshot.saved === next.saved &&
    lastSnapshot.analytics === next.analytics &&
    lastSnapshot.ads === next.ads &&
    lastSnapshot.gpc === next.gpc
  ) {
    return lastSnapshot;
  }
  lastSnapshot = next;
  return next;
}

function notifyPrivacySubscribers(): void {
  for (const subscriber of [...privacySubscribers]) subscriber();
}

/** Subscribe without initializing analytics or changing any vendor state. */
export function subscribePrivacy(subscriber: () => void): () => void {
  privacySubscribers.add(subscriber);
  return () => {
    privacySubscribers.delete(subscriber);
  };
}

/** Another tab saved a choice: apply it here too (start/stop, no reload). */
function reconcileStoredPrivacy(event: StorageEvent): void {
  if (
    event.key !== null &&
    event.key !== PRIVACY_STORAGE_KEY &&
    event.key !== LEGACY_CONSENT_STORAGE_KEY
  ) {
    return;
  }
  const before = { analytics: isAnalyticsOn(), ads: isAdsOn() };
  pageChoice = undefined;
  window.__minglaPrebootPrivacy = undefined;
  const after = readPrivacyChoice();
  if (after !== null) window.__minglaPrebootPrivacy = after;
  void applyPrivacyTransition(before);
  notifyPrivacySubscribers();
}

if (hasWindow() && typeof window.addEventListener === "function") {
  window.addEventListener("storage", reconcileStoredPrivacy);
}

/**
 * Save the visitor's choice (OK, Save, Turn off all). Whatever was turned off
 * stops now and its cookies are removed; whatever was turned on starts again
 * on this page. Returns once both vendors reflect the saved state.
 */
export async function savePrivacyChoice(input: {
  analytics: boolean;
  ads: boolean;
}): Promise<void> {
  if (!hasWindow()) return;
  const before = { analytics: isAnalyticsOn(), ads: isAdsOn() };
  const choice: PrivacyChoice = {
    analytics: input.analytics,
    ads: input.ads,
    ts: Date.now(),
  };
  pageChoice = choice;
  // Same-document handoff for any server-rendered runtime on this page.
  window.__minglaPrebootPrivacy = choice;
  persistPrivacyChoice(choice);
  notifyPrivacySubscribers();
  await applyPrivacyTransition(before);
  if (before.ads !== choice.ads) {
    // toward #3697: stamp the change on the existing first-party touch only.
    void postAttributionConsent(choice.ads ? "granted" : "rejected");
  }
}

async function applyPrivacyTransition(before: {
  analytics: boolean;
  ads: boolean;
}): Promise<void> {
  const analyticsOn = isAnalyticsOn();
  const adsOn = isAdsOn();
  if (!adsOn) stopAdPixels();
  if (!analyticsOn) stopAnalytics();
  if (adsOn && !before.ads) {
    resolveAdPixelIds();
    await bootstrapAdPixels();
  }
  if (analyticsOn && !before.analytics) {
    await ensureAnalyticsBoot();
    const pathname = (window as unknown as { location?: { pathname?: unknown } })
      .location?.pathname;
    if (typeof pathname === "string") captureHostPublicSearchPageView(pathname);
  }
}

/**
 * GA4 Consent Mode v2 loader. Queues the all-denied `default` then the granted
 * `update` before the gtag config runs, then loads the gtag script with
 * automatic pageviews disabled. Search pageviews are emitted only through the
 * sanitized manual owner below. Idempotent.
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

  // Consent Mode v2 — DEFAULT DENIED before any measurement, then granted
  // because analytics is on for this visitor (I-PROPOSED-1187 ordering).
  window.gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  window.gtag("consent", "update", {
    ad_storage: isAdsOn() ? "granted" : "denied",
    analytics_storage: "granted",
    ad_user_data: isAdsOn() ? "granted" : "denied",
    ad_personalization: isAdsOn() ? "granted" : "denied",
  });
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: false });

  // Load the gtag script AFTER the consent default + config are queued on
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

/** Expire a first-party cookie on this host and on the shared parent domain. */
function expireCookie(name: string): void {
  if (!window.document) return;
  const expires = "Thu, 01 Jan 1970 00:00:00 GMT";
  for (const domain of ["", "; domain=.usemingla.com"]) {
    window.document.cookie = `${name}=; expires=${expires}; path=/${domain}; SameSite=Lax`;
  }
}

function cookieNames(): string[] {
  try {
    return (window.document.cookie ?? "")
      .split(";")
      .map((part) => part.split("=", 1)[0]?.trim() ?? "")
      .filter((name) => name.length > 0);
  } catch {
    return [];
  }
}

/** PostHog and GA4 cookies/storage this site writes. */
function isAnalyticsStorageName(name: string): boolean {
  return (
    /^ph_.+_posthog$/.test(name) ||
    name === "_ga" ||
    name.startsWith("_ga_") ||
    name === "_gid" ||
    name === "_gat"
  );
}

/** Analytics turned off: stop PostHog + GA4 now and remove their cookies. */
function stopAnalytics(): void {
  if (posthogClient !== null && !posthogOptedOut) {
    try {
      posthogClient.opt_out_capturing();
      posthogClient.stopSessionRecording();
      posthogClient.set_config({ disable_persistence: true });
      posthogOptedOut = true;
    } catch (err) {
      console.warn("[webAnalytics] PostHog stop failed (non-fatal):", err);
    }
  }
  try {
    window.gtag?.("consent", "update", {
      ad_storage: "denied",
      analytics_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  } catch (err) {
    console.warn("[webAnalytics] GA4 stop failed (non-fatal):", err);
  }
  if (gaMeasurementId !== null) {
    // GA's documented kill switch: no further hits from this page.
    (window as unknown as Record<string, unknown>)[`ga-disable-${gaMeasurementId}`] = true;
  }
  window.gtag = undefined;
  if (typeof window.document?.querySelectorAll === "function") {
    for (const script of Array.from(
      window.document.querySelectorAll("script[data-mingla-ga4]"),
    )) {
      script.remove();
    }
  }
  for (const name of cookieNames()) {
    if (isAnalyticsStorageName(name)) expireCookie(name);
  }
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key !== null && isAnalyticsStorageName(key)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage unavailable: nothing was persisted there either.
  }
  // A later turn-on starts a fresh boot on this page.
  bootPromise = null;
}

/**
 * Analytics boot (GA4, then PostHog, then nothing else). Re-checks the choice
 * at every await so a turn-off that lands mid-boot wins. Safe to call more
 * than once (single flight). Web-only — never reached on native.
 */
async function bootAnalytics(): Promise<void> {
  if (!isAnalyticsOn()) return;
  const posthogKey = readEnv("EXPO_PUBLIC_POSTHOG_KEY");
  const posthogHost = readEnv("EXPO_PUBLIC_POSTHOG_HOST") ?? POSTHOG_US_HOST;
  gaMeasurementId = readEnv("EXPO_PUBLIC_GA4_MEASUREMENT_ID") ?? null;

  if (gaMeasurementId !== null && gaMeasurementId.length > 0) {
    try {
      (window as unknown as Record<string, unknown>)[`ga-disable-${gaMeasurementId}`] = false;
      loadGa4(gaMeasurementId);
    } catch (err) {
      console.warn("[webAnalytics] GA4 init failed (non-fatal):", err);
    }
  }

  if (posthogKey === undefined || posthogKey.length === 0) {
    console.warn(
      "[webAnalytics] EXPO_PUBLIC_POSTHOG_KEY missing — PostHog disabled (no-op).",
    );
    return;
  }
  if (posthogClient !== null) {
    // Turned back on after a turn-off on this page: resume the same client.
    try {
      posthogClient.set_config({ disable_persistence: false });
      posthogClient.opt_in_capturing();
      posthogOptedOut = false;
    } catch (err) {
      console.warn("[webAnalytics] PostHog resume failed (non-fatal):", err);
    }
    return;
  }
  try {
    const { default: posthog } = await import("posthog-js");
    if (!isAnalyticsOn()) return;
    posthog.init(posthogKey, {
      api_host: posthogHost,
      // Issue #2795: privacy choices are origin-local. Never let a public
      // alias persist PostHog identity onto sibling *.usemingla.com hosts.
      cross_subdomain_cookie: false,
      person_profiles: "identified_only",
      // #3176 — public URLs can carry tokens and attribution parameters.
      // Automatic lifecycle events include the raw browser URL, so every
      // search pageview is owned by the sanitized manual contract below.
      capture_pageview: false,
      capture_pageleave: false,
      before_send: sanitizeLegacyPageview,
      // I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES: PostHog stores nothing and
      // captures nothing until opt_in_capturing() below, which runs only while
      // analytics is on for this visitor.
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
    if (!isAnalyticsOn()) {
      posthogClient = posthog;
      posthogOptedOut = false;
      stopAnalytics();
      return;
    }
    posthog.opt_in_capturing();
    // Manual compatibility event: automatic pageviews remain disabled, and
    // before_send reduces this event to origin-only before transport.
    posthog.capture(LEGACY_PAGEVIEW_EVENT);
    posthogClient = posthog;
    posthogOptedOut = false;
  } catch (err) {
    console.warn("[webAnalytics] PostHog init failed (non-fatal):", err);
  }
}

function ensureAnalyticsBoot(): Promise<void> {
  if (!isAnalyticsOn()) return Promise.resolve();
  if (bootPromise === null) {
    bootPromise = bootAnalytics();
  }
  return bootPromise;
}

export async function initWebAnalytics(): Promise<void> {
  if (!hasWindow()) return;
  resolveAdPixelIds();
  if (window.__minglaAdPixelsBootstrapped === true) {
    adPixelsBootstrapped = true;
  }
  if (isAdsOn()) await bootstrapAdPixels();
  if (isAnalyticsOn()) await ensureAnalyticsBoot();
}

/** Fire a custom PostHog event + (optionally) a GA4 event. No-op if gated. */
export function captureWeb(
  name: string,
  props?: Record<string, unknown>,
): void {
  if (!isAnalyticsOn() || posthogClient === null) return;
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
  if (isAnalyticsOn() && hasWindow() && window.gtag) {
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
export function isHostPublicInventoryPathname(
  pathname: unknown,
): pathname is string {
  if (typeof pathname !== "string") return false;
  const segments = pathname.split("/").filter(Boolean);
  if (["e", "t", "exp"].includes(segments[0] ?? "")) {
    return segments.length === 3;
  }
  if (segments[0] !== "b") return false;
  return (
    segments.length === 2 || (segments.length === 4 && segments[2] === "v")
  );
}

/**
 * Manual Host public-inventory pageview. Query/fragment data is never accepted;
 * referrer is reduced to its origin before the typed contract sees it.
 */
export function captureHostPublicSearchPageView(pathname: string): void {
  if (
    !hasWindow() ||
    !isHostPublicInventoryPathname(pathname) ||
    !isAnalyticsOn()
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
  if (!isAnalyticsOn() || posthogClient === null) return;
  try {
    posthogClient?.identify(distinctId, props);
  } catch (err) {
    console.warn("[webAnalytics] identify failed:", err);
  }
}

/** Read a feature flag (free-tier power feature, §4.G). Default-safe. */
export function getFeatureFlagWeb(key: string): boolean | string | undefined {
  if (!isAnalyticsOn() || posthogClient === null)
    return undefined;
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
// render, the Reserve/Pay tap, or navigation. #2331: they boot on arrival in
// every country unless this visitor turned ads off (or GPC is on, until the
// visitor turns ads on). Every pixel Purchase carries the
// SHARED event_id (the Mingla order id) so browser + server CAPI (WP-B) dedup the
// exact pair (A2-5 / SC-15). NOTHING here is on the tap→pay critical path.
// ═════════════════════════════════════════════════════════════════════════════

const ATTR_TIMEOUT_MS = 4000;

/** Wrap a single pixel call so its failure is a silent no-op (never blocks the page). */
function safePixel(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn("[webAnalytics] pixel call failed (non-fatal):", err);
  }
}

let adPixelRuntimePromise: Promise<
  typeof import("./adPixelRuntime.web")
> | null = null;
let adPixelRuntime: typeof import("./adPixelRuntime.web") | null = null;

/** Load the provider shims on arrival without placing them in the eager chunk. */
async function bootstrapAdPixels(): Promise<void> {
  // Jest/SSR can execute consent actions without a browser global. Keep the
  // web-only runtime out of that path just as initWebAnalytics already does.
  if (!hasWindow() || !isAdsOn() || adPixelsBootstrapped) return;
  adPixelRuntimePromise ??= import("./adPixelRuntime.web");
  const runtime = await adPixelRuntimePromise;
  adPixelRuntime = runtime;
  // A visitor can turn ads off, or an SSR/test browser shim can disappear,
  // while the small runtime chunk is loading.
  if (!hasWindow() || !isAdsOn() || adPixelsBootstrapped) return;
  runtime.bootstrapAdPixels(adPixelIds);
  adPixelsBootstrapped = window.__minglaAdPixelsBootstrapped === true;
}

/** True while ads are on and the arrival-time pixel boot ran. */
export function adPixelsReady(): boolean {
  return isAdsOn() && adPixelsBootstrapped;
}

/** Ads turned off: stop future pixel calls and discard browser match cookies. */
function stopAdPixels(): void {
  safePixel(() => window.fbq?.("consent", "revoke"));
  safePixel(() => {
    const revoke = window.ttq?.revokeConsent;
    if (typeof revoke === "function") revoke();
  });
  if (typeof window.document?.querySelectorAll === "function") {
    for (const script of Array.from(
      window.document.querySelectorAll("script[data-mingla-pixel]"),
    )) {
      script.remove();
    }
  }
  for (const name of ["_fbp", "_fbc", "_ttp", "_scid", "_rdt_uuid"]) {
    expireCookie(name);
  }
  window.fbq = undefined;
  window._fbq = undefined;
  window.ttq = undefined;
  window.snaptr = undefined;
  window.rdt = undefined;
  adPixelsBootstrapped = false;
  window.__minglaAdPixelsBootstrapped = false;
}

// ── Browser pixel fires (all no-op while ads are off / no pixel loaded) ─────

/** Public-page view — PageView across the four pixels. No-op until bootstrapped. */
export function fireAdPageView(): void {
  if (!isAdsOn() || !adPixelsBootstrapped) return;
  adPixelRuntime?.fireAdPageView();
}

export interface AdCommerceEventProps {
  value?: number;
  currency?: string;
  contentId?: string;
  brandId?: string;
}

/** Offering view — one deduplicated ViewContent across the four pixels. */
export function fireAdViewContent(
  props?: AdCommerceEventProps & {
    eventId?: string;
  },
): void {
  if (!isAdsOn() || !adPixelsBootstrapped) return;
  adPixelRuntime?.fireAdViewContent(props);
}

/**
 * Purchase fire — the DEDUP fire. `eventId` MUST be the Mingla order id (the
 * shared event_id): Meta's eventID (4th arg) + event name 'Purchase' must match
 * the server CAPI's event_id + event_name exactly (A2-5). No-op while ads are
 * off or the pixel runtime is unavailable.
 */
export function fireAdPurchase(
  eventId: string,
  props: AdCommerceEventProps,
): void {
  if (!isAdsOn() || !adPixelsBootstrapped) return;
  adPixelRuntime?.fireAdPurchase(eventId, props);
}

/**
 * ISSUE-865 PR1 WP-2 — Reservation fire (sign-up twin of fireAdPurchase).
 * toward #3697 F-4: FREE RSVP = CompleteRegistration / SIGN_UP / SignUp — not
 * a value'd Purchase. `eventId` MUST be the Mingla reservation id so it dedups
 * the server CAPI pair. Value defaults to £0. No-op while ads are off or the
 * pixel runtime is unavailable; never throws.
 */
export function fireAdReservation(
  eventId: string,
  props: AdCommerceEventProps = {},
): void {
  if (!isAdsOn() || !adPixelsBootstrapped) return;
  adPixelRuntime?.fireAdReservation(eventId, props);
}

/** Checkout-start dedup pair: browser pixels share the checkout session id. */
export function fireAdInitiateCheckout(
  eventId: string,
  props: AdCommerceEventProps = {},
): void {
  if (!isAdsOn() || !adPixelsBootstrapped) return;
  adPixelRuntime?.fireAdInitiateCheckout(eventId, props);
}

/** TikTok Advanced Matching; raw buyer PII never leaves this function. */
export async function identifyAdBuyer(input: {
  email?: string | null;
  phone?: string | null;
}): Promise<void> {
  if (!isAdsOn() || !adPixelsBootstrapped) return;
  await adPixelRuntime?.identifyAdBuyer(input);
}

// ── Click-id capture + first-party threading storage ──────────────────────────

interface StoredAdClick {
  clickId: string | null;
}

/** The click_id captured on landing, for threading into checkout-create. */
export function getStoredClickAttribution(): StoredAdClick {
  let clickId: unknown;
  try {
    // toward #3697: keep click_id readable after ads are turned off so checkout
    // can thread it (server then sets shared_with_platforms=false).
    const stored = JSON.parse(
      window.localStorage.getItem(AD_CLICK_KEY) ?? "{}",
    ) as { clickId?: unknown; expiresAt?: unknown };
    if (
      typeof stored.expiresAt !== "number" ||
      stored.expiresAt <= Date.now()
    ) {
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
  // toward #3697: a turn-off blocks new ids but does not clear an
  // already-stored one (checkout still needs it).
  if (!isAdsOn()) return;
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

/** Ads-gated browser match data persisted on checkout for server events. */
export function getStoredAdMatchData(): StoredAdMatchData {
  const trackingOptOut = hasWindow() && !isAdsOn();
  if (!hasWindow() || !isAdsOn()) {
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
    clientUserAgent:
      typeof window.navigator.userAgent === "string"
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anon}`,
      apikey: anon,
    },
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
 * #2331: ads are on unless this visitor turned them off, so the touch records
 * as granted from the first page. A turn-off (or GPC) blocks further capture.
 */
export function captureAdClickIds(dest?: CaptureAdClickDest): void {
  if (!hasWindow() || !isAdsOn()) return;
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
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
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
    // Referrer host enriches entry_source while analytics is on (ISSUE-855 PR-2).
    const refHost = readReferrerHost();
    const hasAdSignal =
      external !== null ||
      afCId !== null ||
      mcId !== null ||
      Object.keys(utm).length > 0;
    // First-touch storage and raw landing measurement are separate concerns.
    // Keep the original click_id for checkout attribution, but record every
    // later URL carrying an explicit ad/campaign signal so Meta LPVs are not
    // silently reduced to one touch per seven-day browser window.
    if (existing !== null && !hasAdSignal) {
      if (readPrivacyChoice()?.ads === true) {
        void postAttributionConsent("granted", existing);
      }
      return;
    }
    if (!hasAdSignal && refHost === null) {
      return;
    }
    const consentState = "granted";
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
  if (!isAnalyticsOn()) return null;
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
export async function postAttributionTouch(
  input: PostTouchInput,
): Promise<string | null> {
  // #2331: first-party touch runs while ads are on; a turn-off blocks it.
  if (!isAdsOn()) return null;
  const base = readEnv("EXPO_PUBLIC_SUPABASE_URL");
  const anon = readEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  if (base === undefined || anon === undefined) return null;
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), ATTR_TIMEOUT_MS);
  try {
    const consentState = input.consentState ?? "granted";
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

/** toward #3697: stamp an ads turn-on/turn-off onto the stored first-party click_id. */
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
