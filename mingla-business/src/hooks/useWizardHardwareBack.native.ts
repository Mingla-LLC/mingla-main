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
// - The soft keyboard does NOT go first for free, and the platform does not
//   tell us which way a given press went. Two routes are both real, both
//   captured on emulator-5564 (Android 15, gesture nav), and nothing in JS can
//   observe the choice before the fact:
//     Route A, the dominant one. The IME window consumes KEYCODE_BACK and
//       hides itself (logcat: ORIGIN_IME, HIDE_SOFT_INPUT_BY_BACK_KEY). The
//       activity never gets onBackPressed, so this listener NEVER RUNS for
//       that press. Any bookkeeping of the form "we asked for this dismissal"
//       is inert on this route — that is what shipped, and it left the next
//       press dead for 0.2-1.8 s.
//     Route B. The press reaches JS with the keyboard up. We dismiss it
//       ourselves and stop; no owner runs and the latch is untouched.
//   So the rule cannot ask "was this hide caused by a back press?" — the
//   platform never answers that (getEventParams carries height, duration,
//   timestamp, target, type, appearance; no cause). It asks the one question
//   that IS answerable at press time: is the IME up right now?
// - That answer comes from isImeUp() (wrappers/imeUpTracker.native.ts), a
//   module-scope flag driven by the keyboard's ONSET events, measured at
//   +124 ms after the press against +522 ms for keyboardDidHide and later
//   still for the React commit that the retired model read. It is read
//   synchronously inside onPress and never during render.
// - On a dismissal we set the flag down at the same instant we call
//   Keyboard.dismiss(), so the very next press acts — even 40 ms later, and
//   without waiting for any event. There is NO clock anywhere on this path:
//   the routing module is not handed one, so a future deadline is a type error
//   rather than a judgement call.
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
// - No console, no timers, no clock, no beforeRemove / usePreventRemove.
//   beforeRemove would also intercept the wizards' own router.replace exits.
//
// Invariant: I-3446-WIZARD-ANDROID-BACK-IS-STEP-BACK (docs/INVARIANT_REGISTRY.md).

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { BackHandler, Keyboard, Platform } from "react-native";
import { useFocusEffect } from "expo-router";

import { isImeUp, noteImeDismissRequested } from "../wrappers/imeUpTracker";
import {
  dispatchWizardHardwareBackPress,
  type WizardHardwareBackConfig,
  type WizardHardwareBackLatch,
} from "./wizardHardwareBackRouting";

export function useWizardHardwareBack(config: WizardHardwareBackConfig): void {
  const configRef = useRef<WizardHardwareBackConfig>(config);
  const latchRef = useRef<WizardHardwareBackLatch>("idle");

  useLayoutEffect(() => {
    configRef.current = config;
  });

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;
      latchRef.current = "idle";
      const onPress = (): boolean => {
        const decision = dispatchWizardHardwareBackPress(
          latchRef.current,
          configRef.current,
          // Read at the instant of the press, from the IME's onset events.
          // Never from React state: a press must not be judged against a
          // value that describes the world before the previous press.
          { imeUp: isImeUp() },
        );
        latchRef.current = decision.nextLatch;
        if (decision.action === "dismiss_keyboard") {
          // Flag down FIRST, at the same instant as the request. The next
          // press acts immediately instead of waiting on keyboardWillHide.
          noteImeDismissRequested();
          Keyboard.dismiss();
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
