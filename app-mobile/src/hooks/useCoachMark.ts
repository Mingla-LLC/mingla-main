import { useCallback, useEffect, useRef } from 'react';
import { View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCoachMarkContext } from '../contexts/CoachMarkContext';

interface UseCoachMarkResult {
  /** true if this component is the current coach target */
  isActive: boolean;
  /** Callback ref — attach to the target element's ref prop */
  targetRef: (node: View | null) => void;
}

/**
 * Hook for target components to register their position with the spotlight system.
 * Uses measureInWindow for accurate screen-coordinate measurement.
 *
 * NOTE: Do NOT use this for elements inside ScrollViews (steps 11-12).
 * Those use onLayout + registerTargetScrollOffset instead.
 *
 * Usage:
 *   const coach = useCoachMark(2, 19);
 *   return <View ref={coach.targetRef} style={styles.button} />;
 */
export function useCoachMark(stepId: number, targetRadius: number = 8): UseCoachMarkResult {
  const { currentStep, registerTarget } = useCoachMarkContext();
  const insets = useSafeAreaInsets();
  const nodeRef = useRef<View | null>(null);
  const isActive = currentStep === stepId;

  const measure = useCallback((): void => {
    const node = nodeRef.current;
    if (!node) return;

    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      if (width === 0 && height === 0) return;

      // ORCH-0688: Android Y-correction for coach mark spotlight cutout.
      // The SVG mask in SpotlightOverlay paints in the application-window frame
      // (which extends behind the status bar under edge-to-edge — see app.json
      // `edgeToEdgeEnabled: true` + the translucent <StatusBar> at app/index.tsx).
      // node.measureInWindow on Android returns Y in the application-content
      // frame (excluding the status-bar zone), so the cutout was rendered ~24dp
      // above its target (founder Samsung Galaxy screenshots: step 2 cutout sat on
      // the system clock). On iOS the keyWindow + React root view share one frame,
      // so this branch is a no-op.
      //
      // ORCH-1029 (F-4): the correction SOURCE is now the resolved safe-area top
      // inset (`insets.top`), NOT raw StatusBar.currentHeight. Under Android 15
      // edge-to-edge (Expo SDK 54, edgeToEdgeEnabled:true), measureInWindow already
      // returns Y close to the window frame, so adding the full
      // StatusBar.currentHeight DOUBLE-COUNTS the inset → cutout ~14dp too high into
      // the status bar. `insets.top` is the value WindowInsets actually applied:
      // edge-to-edge-correct on Android 15 AND equal to the status-bar height on
      // legacy/pre-edge-to-edge Android, so the ORCH-0688 case stays corrected (no
      // regression). Keep this a POSITIVE Android correction — do NOT remove it and
      // do NOT revert to StatusBar.currentHeight.
      // Refs: https://developer.android.com/about/versions/15/behavior-changes-15#edge-to-edge
      //       https://github.com/th3rdwave/react-native-safe-area-context#usesafeareainsets
      // Do NOT remove without re-reading SPEC_ORCH-0688_COACH_MARK_ANDROID_OFFSET.md.
      const correctedY = Platform.OS === 'android' ? y + insets.top : y;

      registerTarget(stepId, { x, y: correctedY, width, height, radius: targetRadius });
    });
  }, [stepId, targetRadius, registerTarget, insets.top]);

  const targetRef = useCallback((node: View | null): void => {
    nodeRef.current = node;
    if (node) {
      requestAnimationFrame(() => measure());
    }
  }, [measure]);

  // Re-measure when this step becomes active
  useEffect(() => {
    if (isActive && nodeRef.current) {
      const timer = setTimeout(() => measure(), 100);
      return () => clearTimeout(timer);
    }
  }, [isActive, measure]);

  // ORCH-0635: dev-time warning when a step's targetRef is never attached.
  // Catches refactor-orphan regressions at dev time instead of in production.
  useEffect(() => {
    if (!__DEV__) return;
    const t = setTimeout(() => {
      if (!nodeRef.current) {
        console.warn(
          `[CoachMark] Step ${stepId} targetRef never attached — coach mark will ` +
          `show centered-bubble fallback. Did a refactor orphan this step's target ` +
          `element?`,
        );
      }
    }, 500);
    return () => clearTimeout(t);
  }, [stepId]);

  return { isActive, targetRef };
}
