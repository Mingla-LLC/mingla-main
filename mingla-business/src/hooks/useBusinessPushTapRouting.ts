import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import type { useRouter } from "expo-router";

import {
  onNotificationClicked,
  type OneSignalNotificationData,
} from "../services/oneSignalService";
import {
  processBusinessNotification,
  resolveBusinessNavTarget,
  type BusinessNavTarget,
} from "../services/businessNotificationRouting";

// Keep the v1 key so a target stashed by an older OTA still replays after the
// repair loads. New records also retain the provider data so the eventual
// click can mark the matching bell row read and preserve analytics.
const DEFERRED_PUSH_TARGET_KEY = "mingla-business.deferredPushTarget.v1";
const MAX_DEFERRED_PUSH_AGE_MS = 24 * 60 * 60 * 1000;

interface PushNavigationReadiness {
  loading: boolean;
  userId: string | null;
  pathname: string;
}

interface DeferredPushRecord {
  data?: OneSignalNotificationData;
  target?: BusinessNavTarget;
  ts?: number;
}

type ExpoRouter = ReturnType<typeof useRouter>;

export interface UseBusinessPushTapRoutingInput
  extends PushNavigationReadiness {
  router: Pick<ExpoRouter, "push">;
}

/**
 * A cold notification tap is not routable while the root index still owns `/`.
 * The authenticated index replaces `/` with Home during startup; navigating
 * before that replacement lets Home overwrite the push destination.
 */
export function isBusinessPushNavigationReady(
  input: PushNavigationReadiness,
): boolean {
  return !input.loading && input.userId !== null && input.pathname !== "/";
}

function parseDeferredPushRecord(raw: string | null): DeferredPushRecord | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as DeferredPushRecord;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      typeof parsed.ts === "number" &&
      Date.now() - parsed.ts > MAX_DEFERRED_PUSH_AGE_MS
    ) {
      return null;
    }
    const hasData =
      parsed.data !== null &&
      typeof parsed.data === "object" &&
      typeof parsed.data?.type === "string";
    const hasLegacyTarget =
      typeof parsed.target === "string" && parsed.target.length > 0;
    return hasData || hasLegacyTarget ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Own the complete native push-tap handoff: capture immediately, persist for
 * auth recovery, then consume exactly once only after auth and the initial
 * index redirect have settled.
 */
export function useBusinessPushTapRouting({
  loading,
  pathname,
  router,
  userId,
}: UseBusinessPushTapRoutingInput): void {
  const pendingDataRef = useRef<OneSignalNotificationData | null>(null);
  const latestPersistRef = useRef<Promise<void>>(Promise.resolve());
  const replayingRef = useRef(false);
  const readinessRef = useRef<PushNavigationReadiness>({
    loading,
    pathname,
    userId,
  });
  const [pendingVersion, setPendingVersion] = useState(0);

  readinessRef.current = { loading, pathname, userId };

  const queueClick = useCallback((data: OneSignalNotificationData): void => {
    if (typeof data.type !== "string") return;

    pendingDataRef.current = data;
    const record: DeferredPushRecord = {
      data,
      target: resolveBusinessNavTarget(data),
      ts: Date.now(),
    };
    latestPersistRef.current = AsyncStorage.setItem(
      DEFERRED_PUSH_TARGET_KEY,
      JSON.stringify(record),
    ).catch((error: unknown) => {
      console.warn("[businessPushTap] deferred click persist failed:", error);
    });
    setPendingVersion((version) => version + 1);
  }, []);

  useEffect(() => onNotificationClicked(queueClick), [queueClick]);

  const ready = isBusinessPushNavigationReady({ loading, pathname, userId });
  useEffect(() => {
    if (!ready || replayingRef.current) return;
    replayingRef.current = true;

    void (async (): Promise<void> => {
      try {
        // A click and the `/` -> Home transition can happen in the same frame.
        // Await the corresponding write before consulting storage so that race
        // cannot turn a real tap into a null read.
        await latestPersistRef.current;
        if (!isBusinessPushNavigationReady(readinessRef.current)) return;

        const raw = await AsyncStorage.getItem(DEFERRED_PUSH_TARGET_KEY);
        if (!isBusinessPushNavigationReady(readinessRef.current)) return;
        const stored = parseDeferredPushRecord(raw);
        const data = pendingDataRef.current ?? stored?.data ?? null;
        const target = stored?.target ?? null;
        if (data === null && target === null) return;

        pendingDataRef.current = null;
        try {
          await AsyncStorage.removeItem(DEFERRED_PUSH_TARGET_KEY);
        } catch (error) {
          // The live tap must still navigate; surface the persistence cleanup
          // failure rather than silently discarding the user's action.
          console.warn("[businessPushTap] deferred click cleanup failed:", error);
        }

        if (!isBusinessPushNavigationReady(readinessRef.current)) {
          // Auth changed while cleanup was in flight. Restore the in-memory
          // record so the next ready transition can consume it.
          if (data !== null) pendingDataRef.current = data;
          return;
        }

        if (data !== null && typeof data.type === "string") {
          processBusinessNotification(data, {
            router,
            isAuthenticated: true,
            stashDeferred: () => {
              // The readiness guard above makes this branch unreachable.
            },
          });
          return;
        }

        // Backward compatibility for a v1 record containing only `target`.
        if (typeof target === "string" && target.length > 0) {
          router.push(target as never);
        }
      } catch (error) {
        console.warn("[businessPushTap] deferred click replay failed:", error);
      } finally {
        replayingRef.current = false;
        // A live click can arrive while the initial storage probe is in flight.
        // Its version render may have observed `replayingRef=true`; kick one
        // more pass after this probe releases so that click cannot strand.
        if (pendingDataRef.current !== null) {
          setPendingVersion((version) => version + 1);
        }
      }
    })();
  }, [pendingVersion, ready, router]);
}
