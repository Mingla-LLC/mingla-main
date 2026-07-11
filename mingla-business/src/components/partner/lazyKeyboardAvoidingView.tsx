/**
 * useLazyKeyboardAvoidingView — ORCH-1331 CI conformance (ORCH-1296 gate).
 *
 * `react-native-keyboard-controller` is a BOOT-FRAGILE native module
 * (COMMS-0051/0052 lineage): a top-level static import inside an Expo Router
 * route file is evaluated during eager boot-time route loading, and on an OTA
 * bundle running against a binary without the native module it bricks the
 * splash. The ORCH-1296 strict-grep gate therefore forbids top-level static
 * imports of it in NEW files.
 *
 * This hook is the sanctioned lazy pattern (mirrors
 * PostHogAnalyticsProvider.tsx): resolve the library's KeyboardAvoidingView
 * via a guarded `await import(...)` AFTER mount, hold it in state, and render
 * react-native's own KeyboardAvoidingView until (or unless) it lands —
 * prop-compatible (behavior / keyboardVerticalOffset / style), so the
 * keyboard-never-covers-input contract holds through the swap:
 *   - iOS native: RN KAV padding for the first frame(s), then the
 *     frame-perfect library KAV (ORCH-0892 behavior preserved).
 *   - Android: `behavior={undefined}` at both call sites → adjustResize owns
 *     avoidance either way.
 *   - Web: KAV is inert by design (design §11); the library import never runs.
 *   - OTA on a pre-library binary: the import rejects → RN fallback forever,
 *     app never crashes.
 */

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import {
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Platform,
} from "react-native";
import type { KeyboardAvoidingViewProps } from "react-native";

export type KeyboardAvoidingViewComponent = ComponentType<
  KeyboardAvoidingViewProps
>;

export function useLazyKeyboardAvoidingView(): KeyboardAvoidingViewComponent {
  const [LibKav, setLibKav] = useState<KeyboardAvoidingViewComponent | null>(
    null,
  );

  useEffect(() => {
    // Web renders never need the native library (KAV inert on web).
    if (Platform.OS === "web") return;
    let cancelled = false;
    void (async () => {
      try {
        // Guarded lazy import — evaluated only after this screen mounts,
        // never during Expo Router's eager boot-time route load (ORCH-1296).
        const mod = await import("react-native-keyboard-controller");
        if (cancelled) return;
        setLibKav(
          () => mod.KeyboardAvoidingView as KeyboardAvoidingViewComponent,
        );
      } catch (error) {
        // Native module absent (e.g. OTA on a pre-library binary): keep the
        // RN fallback — degraded but functional, never a crash.
        if (typeof __DEV__ !== "undefined" && __DEV__) {
          console.warn(
            "[lazyKeyboardAvoidingView] keyboard-controller unavailable; using RN fallback:",
            error,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return LibKav ?? RNKeyboardAvoidingView;
}
