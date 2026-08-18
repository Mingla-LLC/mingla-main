import AsyncStorage from "@react-native-async-storage/async-storage";
import { queryClient } from "../config/queryClient";
import { useAppStore } from "../store/appStore";
import { supabase } from "../services/supabase";
import { shouldRemoveForAuthChange } from "./queryPersistence";
// ORCH-1313 (§4.B) — AppsFlyer is a plain static module (native-only consumer
// app); import synchronously (not a lazy dynamic import) so logout clears its
// identity + device-dedup cache alongside the other integrations.
import {
  clearAppsFlyerUserId,
  resetAppsFlyerDeviceCache,
} from "../services/appsFlyerService";
import { clearNativeAdAttribution } from "../services/nativeAdAttributionService";

type CleanupOptions = {
  reason: string;
  currentUserId?: string | null;
  previousUserId?: string | null;
  includeIntegrations?: boolean;
};

const REACT_QUERY_PERSIST_KEY = "REACT_QUERY_OFFLINE_CACHE";

function isPrivateAsyncStorageKey(key: string): boolean {
  if (key === REACT_QUERY_PERSIST_KEY) return true;
  if (key.startsWith("mingla_")) return true;
  if (key.startsWith("mingla:")) return true;
  if (key.startsWith("@mingla")) return true;
  if (key.startsWith("board_cache_")) return true;
  if (key.startsWith("dismissed_cards_")) return true;
  if (key.startsWith("debug_logs_")) return true;
  if (key === "offline_data") return true;
  if (key === "pending_actions") return true;
  if (key === "realtime_offline_queue") return true;
  if (key === "recommendation_cache") return true;
  return false;
}

export async function performPrivateAuthCleanup(options: CleanupOptions): Promise<void> {
  const { reason, currentUserId = null, includeIntegrations = true } = options;

  const store = useAppStore.getState();
  store.clearUserData();

  queryClient.cancelQueries({
    predicate: (query) => shouldRemoveForAuthChange(query.queryKey, currentUserId),
  }).catch((error) => {
    console.warn(`[AUTH_CLEANUP] cancelQueries failed (${reason}):`, error);
  });

  queryClient.removeQueries({
    predicate: (query) => shouldRemoveForAuthChange(query.queryKey, currentUserId),
  });

  if (!currentUserId) {
    queryClient.clear();
  }

  if (includeIntegrations) {
    try {
      const { logoutOneSignal } = await import("../services/oneSignalService");
      logoutOneSignal();
    } catch (error) {
      console.warn(`[AUTH_CLEANUP] OneSignal logout failed (${reason}):`, error);
    }

    import("../services/revenueCatService").then(({ logoutRevenueCatIfIdentified }) => {
      logoutRevenueCatIfIdentified().catch((error: unknown) =>
        console.warn(`[AUTH_CLEANUP] RevenueCat logout failed (${reason}):`, error)
      );
    }).catch(() => {});

    import("../services/mixpanelService").then(({ mixpanelService }) => {
      try { mixpanelService.trackLogout(); } catch (error) {
        console.warn(`[AUTH_CLEANUP] Mixpanel reset failed (${reason}):`, error);
      }
    }).catch(() => {});

    // ORCH-1313 (§4.B) — Constitution #6: clear AppsFlyer identity + device-dedup
    // cache on logout / account-switch / JWT-expiry (all route through here), so a
    // subsequent different sign-in registers fresh and does not inherit the prior
    // user's customer_user_id. Both calls are idempotent (no-op if AF not init /
    // Set already empty), so this is safe on every cleanup.
    try {
      clearAppsFlyerUserId();
      resetAppsFlyerDeviceCache();
      void clearNativeAdAttribution();
    } catch (error) {
      console.warn(`[AUTH_CLEANUP] AppsFlyer clear failed (${reason}):`, error);
    }
  }

  try {
    const { realtimeService } = await import("../services/realtimeService");
    realtimeService.clearQueue();
  } catch (error) {
    console.warn(`[AUTH_CLEANUP] realtime queue cleanup failed (${reason}):`, error);
  }

  // issue #2227 QA F-3 — Constitution #6: the native checkout holds the buyer's
  // own Paystack authorization URL in memory so a second tap on the SAME cart
  // re-opens the page they were already given. That URL is a bearer capability
  // to a live payment page and it is scoped to ONE buyer, so it must not
  // survive a sign-out, an account switch or a JWT expiry — all of which route
  // through here. Runs on EVERY cleanup, not only the `includeIntegrations`
  // ones: a private-data clear that skips it is not a private-data clear.
  //
  // LAZY `require`, not a static import and not `await import(...)`:
  //   - static would hoist the Stripe / expo-web-browser graph the flow pulls in
  //     into the auth path at app start (this file is reached from the auth
  //     context on every cold launch) and would land AHEAD of the ORCH-0896
  //     forwardRef silencer in the evaluation order that file depends on;
  //   - `await import(...)` is invisible to jest's CJS runtime (it needs
  //     --experimental-vm-modules), so a test that signs out could never observe
  //     this line running — a clear nothing can falsify is not a clear.
  // Same lazy-require shape as useAuthSimple.ts and queryClient.ts already use.
  try {
    const { clearAllHeldHandoffs } =
      require("../payments/nativeCheckoutFlow") as typeof import("../payments/nativeCheckoutFlow");
    clearAllHeldHandoffs();
  } catch (error) {
    console.warn(`[AUTH_CLEANUP] held payment hand-off clear failed (${reason}):`, error);
  }

  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const privateKeys = allKeys.filter(isPrivateAsyncStorageKey);
    if (privateKeys.length > 0) {
      await AsyncStorage.multiRemove(privateKeys);
    }
  } catch (error) {
    console.error(`[AUTH_CLEANUP] AsyncStorage cleanup failed (${reason}):`, error);
  }
}

export async function signOutWithPrivateCleanup(reason: string, previousUserId?: string | null): Promise<{ error: Error | null }> {
  try {
    await performPrivateAuthCleanup({ reason, previousUserId, currentUserId: null });
    return await signOutWithoutPrivateCleanup();
  } catch (error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export async function signOutWithoutPrivateCleanup(): Promise<{ error: Error | null }> {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { error: null };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}
