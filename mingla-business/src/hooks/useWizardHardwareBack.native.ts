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
//   one is mounted. The soft keyboard is dismissed by the IME first too.
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
//
// Invariant: I-3446-WIZARD-ANDROID-BACK-IS-STEP-BACK (docs/INVARIANT_REGISTRY.md).

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { BackHandler, Platform } from "react-native";
import { useFocusEffect } from "expo-router";

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
        );
        latchRef.current = decision.nextLatch;
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
