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

export type ConsentChoice = "granted" | "denied";
export type StoredConsentSnapshot = ConsentChoice | "unresolved";

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

// First-party storage key for the captured ad click_id (threaded into checkout).
const AD_CLICK_STORAGE_KEY = "mingla_ad_click_v1";

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
  }
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
  window.gtag("consent", "update", {
    ad_storage: "granted",
    analytics_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
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
async function bootGrantedAnalytics(): Promise<void> {
  // Issue #2771: vendor opt-out/denied modes can still initialize, persist,
  // load configuration, and transmit. Explicit Mingla grant must dominate the
  // loader itself, including every retry/concurrent entry.
  if (!hasWindow() || readStoredConsent() !== "granted") return;
  const posthogKey = readEnv("EXPO_PUBLIC_POSTHOG_KEY");
  const posthogHost = readEnv("EXPO_PUBLIC_POSTHOG_HOST") ?? POSTHOG_US_HOST;
  gaMeasurementId = readEnv("EXPO_PUBLIC_GA4_MEASUREMENT_ID") ?? null;

  // ISSUE-865 WP-C — resolve the ad-conversion pixel IDs only inside the
  // granted boot. Scripts remain last in the same consent-gated sequence.
  adPixelIds = {
    meta: readEnv("EXPO_PUBLIC_META_PIXEL_ID") ?? null,
    tiktok: readEnv("EXPO_PUBLIC_TIKTOK_PIXEL_CODE") ?? null,
    snap: readEnv("EXPO_PUBLIC_SNAP_PIXEL_ID") ?? null,
    reddit: readEnv("EXPO_PUBLIC_REDDIT_PIXEL_ID") ?? null,
  };

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
      posthog.opt_in_capturing();
      // The init-time pageview was deliberately suppressed by opt-out-default;
      // emit exactly one only after the explicit grant opens capture.
      posthog.capture("$pageview");
      posthogClient = posthog;
    } catch (err) {
      console.warn("[webAnalytics] PostHog init failed (non-fatal):", err);
    }
  }

  // Pixels are last in the binding boot order: consent → GA → PostHog → pixels.
  bootstrapAdPixels();
}

function ensureGrantedAnalyticsBoot(): Promise<void> {
  if (!hasWindow() || readStoredConsent() !== "granted") {
    return Promise.resolve();
  }
  if (bootPromise === null) {
    bootPromise = bootGrantedAnalytics();
  }
  return bootPromise;
}

export async function initWebAnalytics(): Promise<void> {
  if (!hasWindow() || readStoredConsent() !== "granted") return;
  await ensureGrantedAnalyticsBoot();
}

/** Accept handler — opens the PostHog + GA4 gates and persists the choice. */
export async function grantConsent(): Promise<void> {
  writeStoredConsent("granted");
  await ensureGrantedAnalyticsBoot();
  if (readStoredConsent() !== "granted" || consentGrantCaptured) return;
  consentGrantCaptured = true;

  // Consent-rate measurement fires only after the grant-only boot is ready.
  // Deny-rate remains derived as sessions without a grant.
  captureWeb("consent_granted");
  gaEvent("consent_granted");
}

/** Reject handler — keeps both gates closed and persists the choice. */
export function denyConsent(): void {
  writeStoredConsent("denied");
  // Reject is persistence-only. No vendor object, command, event, or client
  // attribution path is invoked.
}

/** Fire a custom PostHog event + (optionally) a GA4 event. No-op if gated. */
export function captureWeb(
  name: string,
  props?: Record<string, unknown>,
): void {
  if (readStoredConsent() !== "granted" || posthogClient === null) return;
  try {
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
// render, the Reserve/Pay tap, or navigation. They bootstrap ONLY on consent
// grant (bootstrapAdPixels ← grantConsent) — never before, so EEA/London traffic
// is not tracked pre-consent (SC-8 / RT-3). Every pixel Purchase carries the
// SHARED event_id (the Mingla order id) so browser + server CAPI (WP-B) dedup the
// exact pair (A2-5 / SC-15). NOTHING here is on the tap→pay critical path.
// ═════════════════════════════════════════════════════════════════════════════

const ATTR_POST_TIMEOUT_MS = 4000;

function injectPixelScriptOnce(src: string, marker: string): void {
  if (!hasWindow()) return;
  if (window.document.querySelector(`script[data-mingla-pixel="${marker}"]`) !== null) return;
  const s = window.document.createElement("script");
  s.async = true;
  s.src = src;
  s.setAttribute("data-mingla-pixel", marker);
  window.document.head.appendChild(s);
}

/** Wrap a single pixel call so its failure is a silent no-op (never blocks the page). */
function safePixel(fn: () => void): void {
  if (!hasWindow()) return;
  try {
    fn();
  } catch (err) {
    console.warn("[webAnalytics] pixel call failed (non-fatal):", err);
  }
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
  if (!hasWindow()) return;
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
  if (!hasWindow()) return;
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
  if (!hasWindow()) return;
  if (window.snaptr === undefined) {
    window.snaptr = createQueuedPixel("handleRequest", "queue") as Window["snaptr"];
  }
  injectPixelScriptOnce("https://sc-static.net/scevent.min.js", "snap");
  window.snaptr?.("init", pixelId);
  window.snaptr?.("track", "PAGE_VIEW");
}

function bootstrapRedditPixel(pixelId: string): void {
  if (!hasWindow()) return;
  if (window.rdt === undefined) {
    window.rdt = createQueuedPixel("sendEvent", "callQueue") as Window["rdt"];
  }
  injectPixelScriptOnce("https://www.redditstatic.com/ads/pixel.js", "reddit");
  window.rdt?.("init", pixelId);
  window.rdt?.("track", "PageVisit");
}

/**
 * Bootstrap the four ad pixels — called ONLY from grantConsent (consent-gated).
 * Each pixel is isolated in its own try/catch so one broken loader can neither
 * block the page nor prevent the others from loading. Idempotent.
 */
function bootstrapAdPixels(): void {
  if (!hasWindow() || readStoredConsent() !== "granted" || adPixelsBootstrapped) return;
  adPixelsBootstrapped = true; // set first so a throw can't cause a re-bootstrap loop
  if (adPixelIds.meta) safePixel(() => bootstrapMetaPixel(adPixelIds.meta as string));
  if (adPixelIds.tiktok) safePixel(() => bootstrapTikTokPixel(adPixelIds.tiktok as string));
  if (adPixelIds.snap) safePixel(() => bootstrapSnapPixel(adPixelIds.snap as string));
  if (adPixelIds.reddit) safePixel(() => bootstrapRedditPixel(adPixelIds.reddit as string));
}

/** True only after consent granted AND at least one pixel could bootstrap. */
export function adPixelsReady(): boolean {
  return readStoredConsent() === "granted" && adPixelsBootstrapped;
}

// ── Browser pixel fires (all no-op pre-consent / when no pixel loaded) ────────

/** Public-page view — PageView across the four pixels. No-op until bootstrapped. */
export function fireAdPageView(): void {
  if (readStoredConsent() !== "granted" || !adPixelsBootstrapped) return;
  safePixel(() => window.fbq?.("track", "PageView"));
  safePixel(() => window.ttq?.page?.());
  safePixel(() => window.snaptr?.("track", "PAGE_VIEW"));
  safePixel(() => window.rdt?.("track", "PageVisit"));
}

/** Offering view — ViewContent across the four pixels. No-op until bootstrapped. */
export function fireAdViewContent(props?: {
  value?: number;
  currency?: string;
  contentId?: string;
}): void {
  if (readStoredConsent() !== "granted" || !adPixelsBootstrapped) return;
  const value = props?.value;
  const currency = props?.currency;
  const contentId = props?.contentId;
  safePixel(() =>
    window.fbq?.("track", "ViewContent", definedProps({
      value,
      currency,
      content_type: "product",
      content_ids: contentId ? [contentId] : undefined,
    }))
  );
  safePixel(() => window.ttq?.track?.("ViewContent", definedProps({ value, currency, content_id: contentId })));
  safePixel(() => window.snaptr?.("track", "VIEW_CONTENT", definedProps({ price: value, currency })));
  safePixel(() => window.rdt?.("track", "ViewContent", definedProps({ value, currency })));
}

/**
 * Purchase fire — the DEDUP fire. `eventId` MUST be the Mingla order id (the
 * shared event_id): Meta's eventID (4th arg) + event name 'Purchase' must match
 * the server CAPI's event_id + event_name exactly (A2-5). No-op pre-consent.
 */
export function fireAdPurchase(
  eventId: string,
  props: { value?: number; currency?: string },
): void {
  if (readStoredConsent() !== "granted") return;
  fireAdConversion(eventId, props, true);
}

function fireAdConversion(
  eventId: string,
  props: { value?: number; currency?: string },
  purchase: boolean,
): void {
  if (readStoredConsent() !== "granted" || !adPixelsBootstrapped || !eventId) return;
  const value = props.value;
  const currency = props.currency;
  safePixel(() =>
    window.fbq?.("track", purchase ? "Purchase" : "Schedule", definedProps({ value, currency }), { eventID: eventId })
  );
  safePixel(() =>
    window.ttq?.track?.(
      purchase ? "CompletePayment" : "CompleteRegistration",
      definedProps({ value, currency, content_type: "product" }),
      { event_id: eventId },
    )
  );
  safePixel(() =>
    window.snaptr?.("track", purchase ? "PURCHASE" : "SAVE", definedProps({
      price: value,
      currency,
      transaction_id: eventId,
      client_dedup_id: eventId,
    }))
  );
  safePixel(() =>
    window.rdt?.("track", purchase ? "Purchase" : "Lead", definedProps({ value, currency, conversion_id: eventId }))
  );
}

/**
 * ISSUE-865 PR1 WP-2 — Reservation fire (the LEAD-type twin of fireAdPurchase).
 * The founder-locked two-tier: a FREE RSVP is a lead-type event, NOT a value'd
 * Purchase — Meta 'Schedule' / TikTok 'CompleteRegistration' / Snap 'SAVE' /
 * Reddit 'Lead'. `eventId` MUST be the Mingla reservation id (the shared
 * event_id) so it dedups the exact pair with the server CAPI lead send. Value is
 * optional and defaults to £0 (a free RSVP carries no revenue). No-op pre-consent
 * (consent-gated on adPixelsBootstrapped) / when no pixel loaded; never throws.
 */
export function fireAdReservation(
  eventId: string,
  props: { value?: number; currency?: string } = {},
): void {
  if (readStoredConsent() !== "granted") return;
  fireAdConversion(eventId, props, false);
}

// ── Click-id capture + first-party threading storage ──────────────────────────

interface StoredAdClick {
  clickId: string | null;
}

/** The click_id captured on landing, for threading into checkout-create. */
export function getStoredClickAttribution(): StoredAdClick {
  if (!hasWindow() || readStoredConsent() !== "granted") return { clickId: null };
  try {
    const raw = window.sessionStorage.getItem(AD_CLICK_STORAGE_KEY);
    if (raw === null) return { clickId: null };
    const parsed = JSON.parse(raw) as { clickId?: string };
    return { clickId: typeof parsed.clickId === "string" ? parsed.clickId : null };
  } catch {
    return { clickId: null };
  }
}

const SITE_ATTRIBUTION_KEY = "mingla_site_attribution_v1";
const SITE_ATTRIBUTION_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * #2830 — preserve the opaque Mingla Sites handoff only for this browser tab.
 * The source site mints it only after analytics consent; it contains no buyer
 * data and expires server-side after 30 minutes. Native deliberately has no
 * equivalent source, so the sibling module returns null.
 */
export function getStoredSiteAttribution(): string | null {
  if (!hasWindow()) return null;
  try {
    const fromUrl = new URL(window.location.href).searchParams.get(
      "site_attribution",
    );
    if (fromUrl && SITE_ATTRIBUTION_RE.test(fromUrl)) {
      window.sessionStorage.setItem(
        SITE_ATTRIBUTION_KEY,
        JSON.stringify({ token: fromUrl, capturedAt: Date.now() }),
      );
      return fromUrl;
    }
    const stored = window.sessionStorage.getItem(SITE_ATTRIBUTION_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { token?: unknown; capturedAt?: unknown };
    if (
      typeof parsed.token !== "string" ||
      !SITE_ATTRIBUTION_RE.test(parsed.token) ||
      typeof parsed.capturedAt !== "number" ||
      Date.now() - parsed.capturedAt > 30 * 60_000
    ) {
      window.sessionStorage.removeItem(SITE_ATTRIBUTION_KEY);
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

function storeClickId(clickId: string): void {
  if (!hasWindow() || readStoredConsent() !== "granted") return;
  try {
    window.sessionStorage.setItem(AD_CLICK_STORAGE_KEY, JSON.stringify({ clickId, ts: Date.now() }));
  } catch {
    // sessionStorage unavailable (private mode) — non-fatal; threading is skipped.
  }
}

function postAttribution(
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
  pageType?: "event" | "trip" | "brand" | "venue";
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
 */
export function captureAdClickIds(dest?: CaptureAdClickDest): void {
  // Issue #2771: a first-party endpoint is still analytics. Explicit grant must
  // dominate URL/referrer parsing, network, and attribution storage.
  if (!hasWindow() || readStoredConsent() !== "granted") return;
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
    const utm: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
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
    // ISSUE-855 PR-2 — the referrer HOST (host only; strips path/query/fragment,
    // so no PII leaves the browser). Lets the server classify search / social /
    // organic / direct beyond ad-vs-organic.
    const refHost = readReferrerHost();
    // Record a touch when there is SOMETHING to attribute: an ad signal, a UTM,
    // OR a referrer host. A truly bare visit (no ad param, no utm, no referrer)
    // stays a byte-identical no-op.
    if (
      external === null && afCId === null && mcId === null &&
      Object.keys(utm).length === 0 && refHost === null
    ) {
      return;
    }
    void postAttributionTouch({ network, externalClickId: external, afCId, mcId, utm, dest, referrer: refHost })
      .then((clickId) => {
        // FIRST-TOUCH-WINS: keep the click_id of the FIRST attributable touch this
        // session so a later internal navigation (referrer = a Mingla host →
        // organic) can never clobber the ad click that actually drove the visit.
        if (clickId !== null && getStoredClickAttribution().clickId === null) {
          storeClickId(clickId);
        }
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
  if (!hasWindow() || readStoredConsent() !== "granted") return null;
  try {
    const ref = (window.document as { referrer?: string } | undefined)?.referrer;
    if (typeof ref !== "string" || ref.length === 0) return null;
    let host = new URL(ref).hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

interface PostTouchInput {
  network: string;
  externalClickId: string | null;
  afCId: string | null;
  mcId?: string | null;
  utm: Record<string, string>;
  dest?: CaptureAdClickDest;
  // ISSUE-855 PR-2 — referrer host only (no PII); forwarded for entry_source.
  referrer?: string | null;
}

/** POST a touch to attribution-capture; returns the server click_id (or null). */
export async function postAttributionTouch(input: PostTouchInput): Promise<string | null> {
  if (!hasWindow() || readStoredConsent() !== "granted") return null;
  const base = readEnv("EXPO_PUBLIC_SUPABASE_URL");
  const anon = readEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  if (base === undefined || anon === undefined) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTR_POST_TIMEOUT_MS);
  try {
    const res = await postAttribution(
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
        referrer: input.referrer ?? null,
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
      controller.signal,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { click_id?: string };
    return typeof data.click_id === "string" ? data.click_id : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST a conversion to attribution-capture at checkout success — an early,
 * idempotent record (deduped server-side on event_id). NO email/phone leaves the
 * browser (SC-9); the server fire helper (WP-B) hashes PII from the order and
 * does the authoritative CAPI send. Fire-and-forget — never on the tap→pay path.
 */
export function postAttributionConversion(input: {
  eventId: string;
  valueCents?: number | null;
  currency?: string | null;
  eventSourceUrl?: string | null;
}): void {
  if (!hasWindow() || readStoredConsent() !== "granted" || input.eventId.length === 0) return;
  const base = readEnv("EXPO_PUBLIC_SUPABASE_URL");
  const anon = readEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  if (base === undefined || anon === undefined) return;
  const clickId = getStoredClickAttribution().clickId;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTR_POST_TIMEOUT_MS);
  try {
    void postAttribution(
      base,
      anon,
      {
        kind: "conversion",
        surface: "web",
        lane: "consumer",
        event_id: input.eventId,
        event_type: "purchase",
        event_name: "Purchase",
        value_cents: input.valueCents ?? null,
        currency: input.currency ?? null,
        click_id: clickId,
        event_source_url: input.eventSourceUrl ?? window.location.href,
      },
      controller.signal,
    )
      .catch(() => {
        // Fire-and-forget: a failed early record is harmless — the server fire
        // helper (WP-B) writes the authoritative conversion post-finalize.
      })
      .finally(() => clearTimeout(timer));
  } catch {
    clearTimeout(timer);
  }
}
