/**
 * usePushPermissionMoment — fire the OS push-permission prompt at a moment of
 * demonstrated value, NOT on app boot (META-ORCH-1074 Sub-B §4.B.2).
 *
 * Value moment (LOCKED): the user is authenticated AND has a current brand —
 * i.e. "you have something worth being notified about" (a sale, a payout, a
 * dispute can now happen against this brand). This deliberately excludes
 * cold-boot and the account/settings screen alone; the effect is hosted in
 * the root layout but only fires once a brand exists.
 *
 * One-shot: a persisted AsyncStorage flag guarantees the OS prompt is
 * requested at most once per install (iOS only shows its dialog once anyway;
 * re-requesting after a deny is silent + risks prompt-spam — SC-B2 / T-B-ADV).
 *
 * ORCH-1250 (consumer ORCH-1244 parity): the request is additionally gated
 * behind canRequestPushPermission(), so a device that has already answered the
 * OS dialog (allow OR deny) is never re-prompted — the fallbackToSettings=false
 * change + this gate together kill the false "Open Settings / notifications off"
 * popup on a device where notifications are actually ON.
 *
 * Web + missing-OneSignal: guarded no-op (requestPushPermission self-guards
 * on `_initialized`; on web the SDK never initializes).
 */

import { useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  requestPushPermission,
  canRequestPushPermission,
} from "../services/oneSignalService";

const PROMPTED_FLAG_KEY = "mingla-business.pushPermissionPrompted.v1";

export function usePushPermissionMoment(
  isAuthenticated: boolean,
  currentBrandId: string | null,
): void {
  const firedRef = useRef(false);

  useEffect(() => {
    // Gate: authenticated + a brand exists (the value moment). Not on boot,
    // not on the account screen alone — a brand must be present.
    if (!isAuthenticated || currentBrandId === null) return;
    if (firedRef.current) return;
    firedRef.current = true;

    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const already = await AsyncStorage.getItem(PROMPTED_FLAG_KEY);
        if (already === "1" || cancelled) return;
        // ORCH-1250 (consumer ORCH-1244 parity): only surface the OS dialog on a
        // device that has NOT yet been asked. Once the user has answered (allow
        // OR deny), canRequestPushPermission() is false and we must never
        // re-surface it — re-prompting a decliner is the 4.5.4 / false
        // "notifications off" trigger. We still stamp the one-shot flag so we
        // don't re-check every value moment.
        await AsyncStorage.setItem(PROMPTED_FLAG_KEY, "1");
        if (cancelled) return;
        if (!(await canRequestPushPermission())) return;
        // Mark BEFORE requesting so a mid-flight unmount can't double-prompt.
        await requestPushPermission();
      } catch (err) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn("[usePushPermissionMoment] failed:", err);
        }
      }
    })();

    return (): void => {
      cancelled = true;
    };
  }, [isAuthenticated, currentBrandId]);
}
