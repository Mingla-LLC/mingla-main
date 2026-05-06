/**
 * Cycle 17d §D — Orphan-key safety net for AsyncStorage.
 *
 * Lists AsyncStorage keys at app start, filters to mingla-business namespace,
 * compares against known store whitelist. Logs orphans via console.warn (DEV)
 * + Sentry breadcrumb (production). Does NOT auto-clear in 17d.
 *
 * Operator promotes to auto-clear in a future cycle once log-only telemetry
 * confirms no false-positive orphan detection.
 *
 * Per Cycle 17d §D; D-17d-7.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

const KNOWN_MINGLA_KEYS = new Set<string>([
  "mingla-business.currentBrand.v12",
  "mingla-business.draftEvent.v1",
  "mingla-business.liveEvent.v1",
  "mingla-business.orderStore.v1",
  "mingla-business.guestStore.v1",
  "mingla-business.eventEditLog.v1",
  "mingla-business.notificationPrefsStore.v1",
  "mingla-business.scannerInvitationsStore.v2",
  "mingla-business.doorSalesStore.v1",
  "mingla-business.scanStore.v1",
  "mingla-business.brandTeamStore.v1",
]);

const SUPABASE_AUTH_KEY_PATTERN = /^sb-.+-auth-token$/;

export interface OrphanReapResult {
  orphanCount: number;
  orphanKeys: string[];
}

export const reapOrphanStorageKeys = async (): Promise<OrphanReapResult> => {
  let allKeys: readonly string[];
  try {
    allKeys = await AsyncStorage.getAllKeys();
  } catch (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error("[reapOrphanStorageKeys] getAllKeys failed:", error);
    }
    return { orphanCount: 0, orphanKeys: [] };
  }

  const orphanKeys: string[] = [];

  for (const key of allKeys) {
    // Phase 1: filter to relevant namespaces
    const isMinglaKey = key.startsWith("mingla-business.");
    const isSupabaseAuthKey = SUPABASE_AUTH_KEY_PATTERN.test(key);
    if (!isMinglaKey && !isSupabaseAuthKey) continue;

    // Phase 2: check whitelist
    if (isMinglaKey && !KNOWN_MINGLA_KEYS.has(key)) {
      orphanKeys.push(key);
    }
    // Note: Supabase auth keys are dynamic (project-ref prefix) — accepted as
    // load-bearing even though pattern-matched only.
  }

  if (orphanKeys.length > 0) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        `[reapOrphanStorageKeys] Found ${orphanKeys.length} orphan AsyncStorage key(s):`,
        orphanKeys,
      );
    }
    // Sentry breadcrumb in production for telemetry. Sentry SDK is no-op
    // if init wasn't called per Cycle 16a env-absent guard.
    Sentry.addBreadcrumb({
      category: "storage.orphan",
      level: "warning",
      message: `Orphan AsyncStorage keys: ${orphanKeys.length}`,
      data: { keys: orphanKeys },
    });
  }

  return { orphanCount: orphanKeys.length, orphanKeys };
};
