/**
 * analyticsPrefsStore — META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 3.
 *
 * Persisted client-side preference for the in-app "Analytics" opt-out (§4.F(b)).
 * The business app has no single app-wide store, so this is a small dedicated
 * persisted store (the allowlist permits `mingla-business/src/store/*`). The
 * Settings "Analytics" row (app/account/notifications.tsx) reads/writes it, and
 * postHogService respects it: on opt-out → posthog.optOut(); on opt-in →
 * posthog.optIn(). Default = opted-IN (anonymous product analytics, no IDFA),
 * consistent with the existing Mixpanel/AppsFlyer posture — the toggle lets the
 * user opt OUT.
 *
 * Constitutional notes:
 *   - #2 one owner per truth: the analytics opt-out lives ONLY here.
 *   - #6 logout clears: NOT cleared on logout on purpose — a privacy choice is a
 *     device preference, not session state (mirrors the iOS ATT model). It is
 *     intentionally OMITTED from clearAllStores.
 *   - #14 persisted-state startup: hydration gate (`_hasHydrated`) so the boot
 *     init reads the real value, not the default.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface AnalyticsPrefsState {
  /** True = the user opted OUT of product analytics. Default false (opted in). */
  analyticsOptOut: boolean;
  /** False until the persisted value has rehydrated (Constitution #14). */
  _hasHydrated: boolean;
  setAnalyticsOptOut: (value: boolean) => void;
  setHasHydrated: (value: boolean) => void;
}

export const useAnalyticsPrefsStore = create<AnalyticsPrefsState>()(
  persist(
    (set) => ({
      analyticsOptOut: false,
      _hasHydrated: false,
      setAnalyticsOptOut: (analyticsOptOut) => set({ analyticsOptOut }),
      setHasHydrated: (value) => set({ _hasHydrated: value }),
    }),
    {
      name: "mingla-business-analytics-prefs",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ analyticsOptOut: state.analyticsOptOut }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
