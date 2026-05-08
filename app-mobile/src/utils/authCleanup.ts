import AsyncStorage from "@react-native-async-storage/async-storage";
import { queryClient } from "../config/queryClient";
import { useAppStore } from "../store/appStore";
import { supabase } from "../services/supabase";
import { shouldRemoveForAuthChange } from "./queryPersistence";

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
  }

  try {
    const { realtimeService } = await import("../services/realtimeService");
    realtimeService.clearQueue();
  } catch (error) {
    console.warn(`[AUTH_CLEANUP] realtime queue cleanup failed (${reason}):`, error);
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
