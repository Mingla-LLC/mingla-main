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
 * #4549 H8: the one-shot flag used to be written BEFORE checking whether the
 * SDK could prompt. On a cold start with a saved session the brand appears
 * before the deferred SDK start, so canRequestPushPermission() answered false,
 * the flag was already written, and that install was never asked. Now the hook
 * waits for the SDK (bounded) and writes the flag only after
 * canRequestPushPermission() was evaluated on a ready SDK; if the SDK never
 * comes up the flag stays unwritten and the next launch tries again.
 *
 * Web + missing-OneSignal: guarded no-op (whenOneSignalReady resolves false;
 * on web the SDK never initializes).
 */

import { useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  requestPushPermission,
  canRequestPushPermission,
  whenOneSignalReady,
} from "../services/oneSignalService";
import { reportNonFatal } from "../diagnostics/reportNonFatal";

const PROMPTED_FLAG_KEY = "mingla-business.pushPermissionPrompted.v1";
const SDK_READY_TIMEOUT_MS = 15_000;

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
        // #4549 H8: never decide (or stamp the flag) before the SDK is up.
        if (!(await whenOneSignalReady(SDK_READY_TIMEOUT_MS))) {
          reportNonFatal(
            "push.permission_moment",
            new Error("sdk_not_ready"),
          );
          return;
        }
        if (cancelled) return;
        // ORCH-1250 (consumer ORCH-1244 parity): only surface the OS dialog on a
        // device that has NOT yet been asked. Once the user has answered (allow
        // OR deny), canRequestPushPermission() is false and we must never
        // re-surface it: re-prompting a decliner is the 4.5.4 / false
        // "notifications off" trigger.
        if (!(await canRequestPushPermission())) {
          // The OS already has this person's answer: record it, never ask.
          await AsyncStorage.setItem(PROMPTED_FLAG_KEY, "1");
          return;
        }
        if (cancelled) return;
        // The flag is written only once the OS question was actually shown
        // and answered. firedRef keeps this mount from asking twice, and iOS
        // shows its dialog once per install anyway.
        await requestPushPermission();
        await AsyncStorage.setItem(PROMPTED_FLAG_KEY, "1");
      } catch (err) {
        reportNonFatal("push.permission_moment", err);
      }
    })();

    return (): void => {
      cancelled = true;
    };
  }, [isAuthenticated, currentBrandId]);
}
