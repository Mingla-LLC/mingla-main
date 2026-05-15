/**
 * Mixpanel integration for Mingla Business (ORCH-0808-FOLLOWUP).
 *
 * Mirrors the consumer-side service shape (app-mobile/src/services/mixpanelService.ts)
 * but slimmed to the core surface — business-specific tracking helpers will be
 * added per-feature in follow-up ORCHs rather than pre-built here.
 *
 * Public surface:
 *   - mixpanelService.initialize()                 — call once at root mount
 *   - mixpanelService.identify(userId)             — call after SIGNED_IN
 *   - mixpanelService.reset()                      — call on signOut (Constitution #6)
 *   - mixpanelService.track(name, properties?)     — fire a custom event
 *   - mixpanelService.setUserProperties(props)     — set People profile attrs
 *   - mixpanelService.setUserPropertyOnce(props)   — set People profile attrs only if unset
 *   - mixpanelService.incrementUserProperty(k, n)  — bump a numeric attr
 *   - mixpanelService.registerSuperProperties(p)   — attach to every future event
 *   - mixpanelService.timeEvent(name)              — start a timer for a future track()
 *   - mixpanelService.trackLogin(user)             — bundled login convenience
 *   - mixpanelService.trackLogout()                — bundled logout convenience
 *
 * Env-driven: no-op (with single warn) if EXPO_PUBLIC_MIXPANEL_TOKEN is missing.
 * TRANSITIONAL until operator sets the EAS Secret. Exit condition: secret set.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";

// Defer the mixpanel-react-native require so web bundles don't blow up at
// module-load. The package imports a native module that resolves to
// `undefined.v1` on web (TypeError: Cannot read properties of undefined
// (reading 'v1')), failing the Vercel `npx expo export -p web` build for
// mingla-business. Loading via require() inside a Platform.OS guard
// short-circuits the import on web without altering native behaviour.
// Type kept as `any` here because the package's TS surface ships with the
// require; pulling it in via `import type` still resolves the runtime
// module on web, which is the failure we're avoiding.
// Invariant: Mingla-business web export MUST tolerate native-only deps via
// Platform.OS guard (paired with I-PROPOSED-X web-export deprecation parser).
type MixpanelLike = {
  init: () => Promise<void>;
  identify: (id: string) => void;
  reset: () => void;
  track: (name: string, props?: Record<string, unknown>) => void;
  getPeople: () => {
    set: (p: Record<string, unknown>) => void;
    setOnce: (p: Record<string, unknown>) => void;
    increment: (k: string, by: number) => void;
  };
  registerSuperProperties: (p: Record<string, unknown>) => void;
  timeEvent: (name: string) => void;
};

let MixpanelCtor: (new (token: string, trackAutomatic: boolean) => MixpanelLike) | null = null;
if (Platform.OS !== "web") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    MixpanelCtor = (require("mixpanel-react-native") as { Mixpanel: typeof MixpanelCtor }).Mixpanel;
  } catch (err) {
    console.warn("[Mixpanel] native module unavailable; analytics disabled:", err);
  }
}

const MIXPANEL_TOKEN = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;

class MixpanelService {
  private static instance: MixpanelService;
  private mixpanel: MixpanelLike | null = null;
  private initialized = false;
  private readonly enabled: boolean;

  private constructor() {
    this.enabled =
      typeof MIXPANEL_TOKEN === "string" &&
      MIXPANEL_TOKEN.length > 0 &&
      MixpanelCtor !== null;
    if (this.enabled && MixpanelCtor !== null) {
      // Second arg = trackAutomaticEvents: true. Matches consumer pattern.
      this.mixpanel = new MixpanelCtor(MIXPANEL_TOKEN!, true);
    } else if (Platform.OS === "web") {
      // Silent on web — analytics intentionally disabled for the web bundle.
    } else {
      console.warn(
        "[Mixpanel] env missing — analytics disabled. Set EXPO_PUBLIC_MIXPANEL_TOKEN as an EAS Secret to enable.",
      );
    }
  }

  static getInstance(): MixpanelService {
    if (!MixpanelService.instance) {
      MixpanelService.instance = new MixpanelService();
    }
    return MixpanelService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized || !this.enabled || !this.mixpanel) return;
    try {
      await this.mixpanel.init();
      this.initialized = true;
      if (__DEV__) console.log("[Mixpanel] initialized");
    } catch (error) {
      console.warn("[Mixpanel] init failed:", error);
    }
  }

  identify(userId: string): void {
    if (!this.initialized || !this.mixpanel) return;
    try {
      this.mixpanel.identify(userId);
      if (__DEV__) console.log("[Mixpanel] identified:", userId);
    } catch (e) {
      console.warn("[Mixpanel] identify failed:", e);
    }
  }

  reset(): void {
    if (!this.initialized || !this.mixpanel) return;
    try {
      this.mixpanel.reset();
      if (__DEV__) console.log("[Mixpanel] reset");
    } catch (e) {
      console.warn("[Mixpanel] reset failed:", e);
    }
  }

  track(
    eventName: string,
    properties?: Record<string, unknown>,
  ): void {
    if (!this.initialized || !this.mixpanel) return;
    try {
      this.mixpanel.track(eventName, properties);
    } catch (e) {
      console.warn(`[Mixpanel] track(${eventName}) failed:`, e);
    }
  }

  setUserProperties(properties: Record<string, unknown>): void {
    if (!this.initialized || !this.mixpanel) return;
    try {
      this.mixpanel.getPeople().set(properties);
    } catch (e) {
      console.warn("[Mixpanel] setUserProperties failed:", e);
    }
  }

  setUserPropertyOnce(properties: Record<string, unknown>): void {
    if (!this.initialized || !this.mixpanel) return;
    try {
      this.mixpanel.getPeople().setOnce(properties);
    } catch (e) {
      console.warn("[Mixpanel] setUserPropertyOnce failed:", e);
    }
  }

  incrementUserProperty(property: string, by: number = 1): void {
    if (!this.initialized || !this.mixpanel) return;
    try {
      this.mixpanel.getPeople().increment(property, by);
    } catch (e) {
      console.warn("[Mixpanel] incrementUserProperty failed:", e);
    }
  }

  registerSuperProperties(properties: Record<string, unknown>): void {
    if (!this.initialized || !this.mixpanel) return;
    try {
      this.mixpanel.registerSuperProperties(properties);
    } catch (e) {
      console.warn("[Mixpanel] registerSuperProperties failed:", e);
    }
  }

  timeEvent(eventName: string): void {
    if (!this.initialized || !this.mixpanel) return;
    try {
      this.mixpanel.timeEvent(eventName);
    } catch (e) {
      console.warn(`[Mixpanel] timeEvent(${eventName}) failed:`, e);
    }
  }

  // ─── Bundled convenience helpers ──────────────────────────────────

  /**
   * Identify the user and register baseline profile + super properties.
   * Call after a successful SIGNED_IN. Idempotent — safe to call multiple times.
   */
  trackLogin(user: {
    id: string;
    email?: string | null;
    provider?: string;
    displayName?: string | null;
    isFirstTime?: boolean;
  }): void {
    if (!this.initialized) return;

    this.identify(user.id);

    const platform = Platform.OS;
    const appVersion = Constants.expoConfig?.version ?? "unknown";

    this.setUserProperties({
      $email: user.email ?? undefined,
      $name: user.displayName ?? undefined,
      user_id: user.id,
      login_provider: user.provider ?? "email",
      platform,
      app_version: appVersion,
      app_surface: "mingla-business",
      last_login: new Date().toISOString(),
    });

    // $created — only set on first login, never overwritten.
    this.setUserPropertyOnce({
      $created: new Date().toISOString(),
    });

    this.registerSuperProperties({
      app_surface: "mingla-business",
      platform,
      app_version: appVersion,
    });

    if (user.isFirstTime) {
      this.track("Signup Completed", { method: user.provider ?? "email" });
    } else {
      this.track("Login", { method: user.provider ?? "email" });
    }
  }

  trackLogout(): void {
    this.track("Logout");
    this.reset();
  }
}

export const mixpanelService = MixpanelService.getInstance();
