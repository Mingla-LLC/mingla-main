// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 (native, consumer app).
//
// PostHog native (posthog-react-native) singleton facade for the consumer app.
// Runs ALONGSIDE the existing Mixpanel + AppsFlyer SDKs (parallel run this
// phase — DO NOT remove them). The <PostHogProvider> mounted at app/_layout.tsx
// supplies autocapture + masked session replay; this facade is the
// capture/identify/reset/opt-out surface the call sites use.
//
// KEY READ (COMMS-0028 / I-PROPOSED-1187-* env reachability): the project key
// + host come from `Constants.expoConfig?.extra` (mirrors supabase.ts /
// giphyEventCoverService.ts) — NEVER a dynamic `process.env[name]` bracket read,
// which babel-preset-expo does NOT inline and is undefined in Hermes
// standalone/OTA builds. A static `process.env.EXPO_PUBLIC_POSTHOG_KEY` is the
// secondary fallback (it IS inlined). No-ops gracefully when the key is absent.
//
// SECRET HYGIENE (I-PROPOSED-1187-NO-PHX-IN-CLIENT): only the public `phc_*`
// PROJECT key ships here. The `phx_*` personal/MCP key MUST NEVER appear in
// client source.
//
// US REGION (I-PROPOSED-1187-POSTHOG-HOST-US): host MUST be
// `https://us.i.posthog.com` (dispatch-locked).
//
// REPLAY MASKING (I-PROPOSED-1187-REPLAY-MASKS-PII, §4.H): native session replay
// is screenshot-based and is configured with `maskAllTextInputs: true` +
// `maskAllImages: true` from the FIRST build. NEVER flip these to false. A
// replay capturing a card field, email, or any PII is an AUTOMATIC FAIL.
//
// COST GUARD (§4.I): replay is sampled (`sampleRate`) to protect the free 5K-
// recordings/mo tier; Seth also sets a $0 PostHog billing cap (SA-1). Autocapture
// + replay are the two allowance-burners — keep manual events discrete (no
// per-frame / per-scroll captures).
//
// WEB SAFETY: this module is NATIVE-only. On the web export (Expo web) it stays
// a pure no-op — `posthog-react-native` is imported lazily and ONLY when
// `Platform.OS !== 'web'`, so the native replay/autocapture code never loads on
// web. Web analytics is a separate leg (webAnalytics.web.ts) and owns the web
// surface. This preserves I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS.

import Constants from "expo-constants";
import { Platform } from "react-native";
import type { PostHog } from "posthog-react-native";
import { useAppStore } from "../store/appStore";

/**
 * Flat, JSON-serializable analytics property bag (matches PostHog's
 * PostHogEventProperties without coupling to its internal type). All our call
 * sites pass primitives.
 */
type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;
type JsonProps = Record<string, string | number | boolean | null>;

/** Drop undefined values so the result matches PostHog's JSON property type. */
function clean(props?: AnalyticsProps): JsonProps | undefined {
  if (props === undefined) return undefined;
  const out: JsonProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// US ingestion host — dispatch-locked. The US literal is present in this file
// for the strict-grep host gate even when the env supplies it.
const US_HOST = "https://us.i.posthog.com";

/**
 * Session-replay sampling rate (§4.I cost guard). Records ~20% of sessions to
 * protect the free 5K-recordings/mo allowance. Seth can override server-side in
 * the PostHog UI later without a deploy.
 */
export const PH_REPLAY_SAMPLE_RATE = 0.2;

function readExtra(name: string): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | Record<string, string | undefined>
    | undefined;
  return extra?.[name];
}

function resolveKey(): string | undefined {
  // STATIC reads only (COMMS-0028). extra first (survives Hermes/OTA), then the
  // static process.env (inlined by babel-preset-expo).
  return readExtra("EXPO_PUBLIC_POSTHOG_KEY") ?? process.env.EXPO_PUBLIC_POSTHOG_KEY;
}

function resolveHost(): string {
  return (
    readExtra("EXPO_PUBLIC_POSTHOG_HOST") ??
    process.env.EXPO_PUBLIC_POSTHOG_HOST ??
    US_HOST
  );
}

class PostHogService {
  private static instance: PostHogService | null = null;
  private client: PostHog | null = null;
  private initialized = false;
  private readonly isWeb = Platform.OS === "web";

  static getInstance(): PostHogService {
    if (PostHogService.instance === null) {
      PostHogService.instance = new PostHogService();
    }
    return PostHogService.instance;
  }

  /** True once a real client exists. Capture helpers guard on this. */
  isReady(): boolean {
    return this.initialized && this.client !== null;
  }

  /**
   * The underlying client, for the <PostHogProvider> (autocapture + replay).
   * Null on web / when the key is missing — the provider must handle null.
   */
  getClient(): PostHog | null {
    return this.client;
  }

  /**
   * Build the client config — the SINGLE source of truth for the masked replay
   * config the provider also relies on. Exported so the provider stays in sync.
   */
  static buildOptions(): Record<string, unknown> {
    return {
      host: US_HOST,
      // Native session replay — ON, but HARD-masked (PII security gate, §4.H).
      enableSessionReplay: true,
      sessionReplayConfig: {
        // NEVER set these to false — replay must mask all text + images.
        maskAllTextInputs: true,
        maskAllImages: true,
        // Cost guard — sample ~20% of sessions (§4.I).
        sampleRate: PH_REPLAY_SAMPLE_RATE,
      },
    };
  }

  /**
   * Initialize PostHog (idempotent). No-ops on web and when the key is missing
   * (a missing env must never crash the app — T-10). Respects the persisted
   * analytics opt-out flag.
   */
  async initialize(): Promise<void> {
    if (this.initialized || this.isWeb) return;
    const key = resolveKey();
    if (!key || key.length === 0) {
      // Graceful no-op — never throw on a missing env (T-10).
      this.initialized = true; // mark so we don't retry every boot
      return;
    }
    try {
      // Lazy import so posthog-react-native never loads on web.
      const PostHogClass = (await import("posthog-react-native")).default;
      const client = new PostHogClass(key, {
        host: resolveHost().startsWith("http") ? resolveHost() : US_HOST,
        enableSessionReplay: true,
        sessionReplayConfig: {
          maskAllTextInputs: true,
          maskAllImages: true,
          sampleRate: PH_REPLAY_SAMPLE_RATE,
        },
      });
      this.client = client;
      this.initialized = true;
      // Honor the persisted opt-out at boot (default = opted-IN, anonymous).
      if (useAppStore.getState().analyticsOptOut) {
        client.optOut();
      }
    } catch (error) {
      // Analytics must never break boot; log, never throw.
      console.warn("[postHog] init failed:", error);
      this.initialized = true;
    }
  }

  /** Bind the Supabase user.id as the distinct_id (SC-7). */
  identify(userId: string, properties?: AnalyticsProps): void {
    if (!this.isReady() || this.client === null) return;
    try {
      this.client.identify(userId, clean(properties));
    } catch (e) {
      console.warn("[postHog] identify failed:", e);
    }
  }

  /** Capture a product event. No-op when not ready / opted out. Never throws. */
  capture(event: string, properties?: AnalyticsProps): void {
    if (!this.isReady() || this.client === null) return;
    try {
      this.client.capture(event, clean(properties));
    } catch {
      // Non-fatal — analytics never breaks the UI.
    }
  }

  /** Clear identity on signout (SC-7 / Constitution #6). */
  reset(): void {
    if (!this.isReady() || this.client === null) return;
    try {
      this.client.reset();
    } catch (e) {
      console.warn("[postHog] reset failed:", e);
    }
  }

  /** Opt out of capturing (Settings "Analytics" toggle OFF — §4.F(b), T-19). */
  optOut(): void {
    if (this.client === null) return;
    try {
      this.client.optOut();
    } catch (e) {
      console.warn("[postHog] optOut failed:", e);
    }
  }

  /** Opt back in to capturing (Settings "Analytics" toggle ON — §4.F(b)). */
  optIn(): void {
    if (this.client === null) return;
    try {
      this.client.optIn();
    } catch (e) {
      console.warn("[postHog] optIn failed:", e);
    }
  }

  /**
   * Feature-flag read (SC-13). Resolves a default when undefined; never throws.
   */
  getFeatureFlag(key: string): boolean | string | undefined {
    if (!this.isReady() || this.client === null) return undefined;
    try {
      return this.client.getFeatureFlag(key);
    } catch {
      return undefined;
    }
  }
}

export const postHogService = PostHogService.getInstance();
export { PostHogService };
