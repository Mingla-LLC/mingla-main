/**
 * RevenueCat integration for Mingla Business (ORCH-0808-FOLLOWUP).
 *
 * Scope (operator-confirmed 2026-05-12): install-only.
 * - No products configured yet
 * - No paywall UI (react-native-purchases-ui NOT installed)
 * - No offering fetch helpers
 * - No purchase flow
 * - Future ORCH adds products + paywall + customer center when there's
 *   something to actually sell to organisers.
 *
 * Public surface (minimum to keep SDK identified to the right Supabase user):
 *   - revenueCatService.initialize()         — call once at root mount
 *   - revenueCatService.identify(userId)     — call after SIGNED_IN
 *   - revenueCatService.logOut()             — call on signOut (Constitution #6)
 *
 * Env-driven: no-op (with single warn) if EXPO_PUBLIC_REVENUECAT_API_KEY missing.
 * TRANSITIONAL until operator sets the EAS Secret. Exit condition: secret set.
 *
 * Uses RevenueCat V2 single-key format — same key for iOS + Android, SDK
 * auto-detects platform at runtime.
 */

import Purchases, { LOG_LEVEL } from "react-native-purchases";

const REVENUECAT_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;

class RevenueCatService {
  private static instance: RevenueCatService;
  private initialized = false;
  private readonly enabled: boolean;

  private constructor() {
    this.enabled =
      typeof REVENUECAT_API_KEY === "string" && REVENUECAT_API_KEY.length > 0;
    if (!this.enabled) {
      console.warn(
        "[RevenueCat] env missing — SDK disabled. Set EXPO_PUBLIC_REVENUECAT_API_KEY as an EAS Secret to enable.",
      );
    }
  }

  static getInstance(): RevenueCatService {
    if (!RevenueCatService.instance) {
      RevenueCatService.instance = new RevenueCatService();
    }
    return RevenueCatService.instance;
  }

  /**
   * Configure the SDK. Idempotent — safe to call multiple times.
   * Per RevenueCat docs: configure() must be called once before any other
   * SDK method. The SDK creates an anonymous appUserID on first launch;
   * identify() later links that anon ID to the Supabase user.
   */
  initialize(): void {
    if (this.initialized || !this.enabled) return;
    try {
      if (__DEV__) {
        Purchases.setLogLevel(LOG_LEVEL.WARN);
      }
      Purchases.configure({ apiKey: REVENUECAT_API_KEY! });
      this.initialized = true;
      if (__DEV__) console.log("[RevenueCat] configured");
    } catch (e) {
      console.warn("[RevenueCat] configure failed:", e);
    }
  }

  /**
   * Link the anonymous device install to a Supabase user.
   * Fire-and-forget — never blocks auth flow.
   * Subsequent identify() calls with a different userId are safe (RevenueCat
   * handles the alias chain internally).
   */
  identify(userId: string): void {
    if (!this.initialized) return;
    void Purchases.logIn(userId)
      .then(() => {
        if (__DEV__) console.log("[RevenueCat] identified:", userId);
      })
      .catch((e) => {
        console.warn("[RevenueCat] logIn failed:", e);
      });
  }

  /**
   * Reset to an anonymous appUserID. Call on signOut so the next signed-in
   * user is not attributed to the prior user's customer profile.
   * Fire-and-forget.
   *
   * Constitution #6 — logout clears everything including third-party identity
   * caches that survive Supabase signOut by default.
   */
  logOut(): void {
    if (!this.initialized) return;
    void Purchases.logOut()
      .then(() => {
        if (__DEV__) console.log("[RevenueCat] logged out");
      })
      .catch((e) => {
        // RevenueCat logOut throws if the user is already anonymous.
        // That's the "already-cleared" case — safe to ignore.
        if (__DEV__) {
          console.log("[RevenueCat] logOut warning (likely already anon):", e);
        }
      });
  }
}

export const revenueCatService = RevenueCatService.getInstance();
