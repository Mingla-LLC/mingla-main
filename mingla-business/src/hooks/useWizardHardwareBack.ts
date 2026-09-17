// #3446: useWizardHardwareBack, the web variant. It does nothing.
//
// Web has no hardware back button. Browser back is a separate history path and
// stays unchanged. react-native-web's BackHandler.addEventListener only logs
// "BackHandler is not supported on web", so this variant imports nothing:
// no react-native, no expo-router, no react.
//
// This is also the variant jest's default node/ts-jest config resolves, so
// suites that mount a wizard need no BackHandler or useFocusEffect mock.
// The iOS/Android implementation lives in useWizardHardwareBack.native.ts
// (Metro picks it on native), and it registers nothing on iOS.
//
// Invariant: I-3446-WIZARD-ANDROID-BACK-IS-STEP-BACK (docs/INVARIANT_REGISTRY.md).

import type { WizardHardwareBackConfig } from "./wizardHardwareBackRouting";

export function useWizardHardwareBack(_config: WizardHardwareBackConfig): void {}
