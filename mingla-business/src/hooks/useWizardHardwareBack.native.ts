// #3446: useWizardHardwareBack, the native variant (Metro resolves it on
// iOS and Android). The web variant and jest's variant are in
// useWizardHardwareBack.ts.
//
// On Android, while a Business creation wizard is focused, hardware back and
// the system back gesture do what the wizard's own on-screen controls do.
// On a later step they run the wizard's own Back owner. On step 1 they run
// its own close/cancel owner. The press never falls through to the
// navigator's goBack, which would pop the whole wizard route.
//
// Why it is built this way:
// - Native overlays go first for free. Every RN <Modal> (ConfirmDialog, Sheet,
//   Toast, the people picker) consumes KEYCODE_BACK inside its native Dialog
//   and calls onRequestClose. JS hardwareBackPress listeners do not fire while
//   one is mounted.
// - The soft keyboard does NOT go first for free. With the keyboard up, one
//   press hides the IME AND reaches this listener (runtime-proven, #3446
//   SC-7). So a press while the keyboard owner (useKeyboardIsVisible) says
//   visible, or just after a hide no press has claimed, only dismisses the
//   keyboard: no owner runs and the latch is untouched. Android can deliver
//   the hide and the press in either order; the window and the claim rule
//   live in wizardHardwareBackRouting.ts (WIZARD_KEYBOARD_BACK_WINDOW_MS).
//   The keyboard owner's flag is BEHIND the dismissal it is reporting — the
//   library flips it only on keyboardDidHide, emitted from the IME inset
//   animation's onEnd — so this hook also records the dismissal it asked for
//   and stops reading `visible` until a visibility change settles it. Without
//   that, a second press inside the lag was swallowed as another keyboard
//   dismissal and the wizard did not move. The record is settled by the truth
//   and by nothing else: no timer expires it, because the lag is set by
//   main-thread load and the #3462 device round measured it past 3 s, so any
//   deadline just re-opens the dead window (see hasOutstandingDismissRequest
//   in wizardHardwareBackRouting.ts).
// - Subscribe ONCE per focus (useFocusEffect with EMPTY deps). BackHandler
//   runs listeners newest-first. Re-subscribing on every render would push
//   this listener ahead of any overlay listener registered later in the tree
//   (e.g. TopSheet). Removing it on blur means a screen pushed on top
//   (Preview, payments onboarding, pricing defaults) keeps its own back press.
// - Read the LATEST config through a ref refreshed in useLayoutEffect.
//   A press between commit and passive effects must never act on the
//   previous step.
// - Always return true. Every exit goes through the wizard's own owner,
//   which carries the discard confirm, the autosave and the destination.
// - Two latches. "stepping" holds while an async Back (Trip saves first) is
//   in flight, so a fast second press can never skip a step. "exiting" holds
//   after the close owner ran, so a second press can never run the exit path
//   twice (double discard, double router.back). It is released when the exit
//   surfaced UI (a discard dialog or failure toast) and on blur.
// - Android only. BackHandler is a no-op on iOS, and nothing is registered
//   there.
// - No console, no timers, no beforeRemove / usePreventRemove.
//   beforeRemove would also intercept the wizards' own router.replace exits.
//   The keyboard rule compares timestamps; it never schedules anything.
//
// Invariant: I-3446-WIZARD-ANDROID-BACK-IS-STEP-BACK (docs/INVARIANT_REGISTRY.md).

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { BackHandler, Keyboard, Platform } from "react-native";
import { useFocusEffect } from "expo-router";

import { useKeyboardIsVisible } from "../wrappers/useKeyboardIsVisible";
import {
  dispatchWizardHardwareBackPress,
  type WizardHardwareBackConfig,
  type WizardHardwareBackLatch,
} from "./wizardHardwareBackRouting";

interface KeyboardTrack {
  /** useKeyboardIsVisible as of the last commit. */
  visible: boolean;
  /** When it last hid, unless a back press claimed that hide. */
  unclaimedHideAt: number | null;
  /** A back press was swallowed while visible; the coming hide is its own. */
  claimed: boolean;
  /**
   * When we last called Keyboard.dismiss() with no visibility change since.
   * The keyboard owner's flag flips only at the end of the IME hide animation,
   * so between the two `visible` is stale and must not be read as authoritative
   * (see hasOutstandingDismissRequest in wizardHardwareBackRouting.ts). The
   * stamp is the ordering record; only a visibility change clears it.
   */
  dismissRequestedAt: number | null;
}

export function useWizardHardwareBack(config: WizardHardwareBackConfig): void {
  const configRef = useRef<WizardHardwareBackConfig>(config);
  const latchRef = useRef<WizardHardwareBackLatch>("idle");
  const keyboardVisible = useKeyboardIsVisible();
  const keyboardRef = useRef<KeyboardTrack>({
    visible: keyboardVisible,
    unclaimedHideAt: null,
    claimed: false,
    dismissRequestedAt: null,
  });

  useLayoutEffect(() => {
    configRef.current = config;
  });

  // Same-commit refresh as the config, for the same reason: a press queued
  // right behind the keyboard update must see it.
  useLayoutEffect(() => {
    const keyboard = keyboardRef.current;
    if (keyboard.visible === keyboardVisible) return;
    keyboard.visible = keyboardVisible;
    keyboard.unclaimedHideAt =
      !keyboardVisible && !keyboard.claimed ? Date.now() : null;
    keyboard.claimed = false;
    // Any visibility change settles an outstanding dismissal request, in both
    // directions: a hide is the confirmation we were waiting for, and a show
    // means the keyboard is genuinely up again, so `visible` is authoritative
    // once more. Either way we stop distrusting it.
    keyboard.dismissRequestedAt = null;
  }, [keyboardVisible]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;
      latchRef.current = "idle";
      const onPress = (): boolean => {
        const keyboard = keyboardRef.current;
        const now = Date.now();
        const decision = dispatchWizardHardwareBackPress(
          latchRef.current,
          configRef.current,
          {
            visible: keyboard.visible,
            unclaimedHideAt: keyboard.unclaimedHideAt,
            now,
            dismissRequestedAt: keyboard.dismissRequestedAt,
          },
        );
        latchRef.current = decision.nextLatch;
        if (decision.action === "dismiss_keyboard") {
          // One hide swallows at most one press.
          keyboard.unclaimedHideAt = null;
          if (keyboard.visible) {
            keyboard.claimed = true;
            // Record the dismissal we are asking for. Until the keyboard owner
            // reports a change, `visible` is our own stale value and rule 0
            // must not act on it, so the NEXT press steps back (or exits on
            // step 1) instead of being swallowed as a second dismissal.
            keyboard.dismissRequestedAt = now;
            Keyboard.dismiss();
          }
        }
        if (decision.pending !== null) {
          const clear = (): void => {
            if (latchRef.current === "stepping") latchRef.current = "idle";
          };
          decision.pending.then(clear, clear);
        }
        return true;
      };
      const sub = BackHandler.addEventListener("hardwareBackPress", onPress);
      return (): void => {
        sub.remove();
        latchRef.current = "idle";
      };
    }, []),
  );

  useEffect(() => {
    if (config.exitSurfaced && latchRef.current === "exiting") {
      latchRef.current = "idle";
    }
  }, [config.exitSurfaced]);
}
