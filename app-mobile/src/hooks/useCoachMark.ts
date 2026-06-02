import { useCallback, useEffect, useRef } from 'react';
import { View, Platform, InteractionManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCoachMarkContext } from '../contexts/CoachMarkContext';
import type { TargetRect } from '../contexts/CoachMarkContext';

interface UseCoachMarkResult {
  /** true if this component is the current coach target */
  isActive: boolean;
  /** Callback ref — attach to the target element's ref prop */
  targetRef: (node: View | null) => void;
}

// ── ORCH-1037 stable-measure tuning (SPEC §3.2) ──────────────────────────────
// A rect is "stable" when two consecutive measureInWindow reads agree within
// STABLE_EPSILON_PX on every axis. Sub-pixel measure jitter is tolerated; the
// step-2 GlassTopBar 16px entrance drift (translateY 16→0, 260ms native-driver)
// is NOT — that is the exact non-determinism this loop kills.
export const STABLE_EPSILON_PX = 1;
// Poll interval between reads (SPEC §3.2: ≤ 60ms).
export const STABLE_POLL_MS = 50;
// Bounded best-effort timeout (SPEC §3.2: 1000–1500ms; ≥ 1000 to outlast the
// 260ms entrance + a slow device, ≤ 1500 so a genuinely-unmeasurable target
// degrades fast). Exported so the regression test asserts against the real value.
export const STABLE_TIMEOUT_MS = 1200;

/** Two rects are equal within STABLE_EPSILON_PX on every axis. */
export function rectsStableEqual(a: TargetRect | null, b: TargetRect | null): boolean {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) <= STABLE_EPSILON_PX &&
    Math.abs(a.y - b.y) <= STABLE_EPSILON_PX &&
    Math.abs(a.width - b.width) <= STABLE_EPSILON_PX &&
    Math.abs(a.height - b.height) <= STABLE_EPSILON_PX
  );
}

/**
 * Hook for target components to register their position with the spotlight system.
 * Uses measureInWindow for accurate screen-coordinate measurement.
 *
 * ORCH-1037 [Coach-mark exact-target determinism]: the measurement is now a
 * settle-gated, measure-until-stable loop (NOT the old two-shot rAF + 100ms
 * timer). When a step becomes active we (1) wait out running interactions via
 * InteractionManager.runAfterInteractions — this outlasts the GlassTopBar
 * translateY 16→0 native-driver entrance that caused step 2 to register at
 * y≈36 then self-heal to y≈52 — then (2) poll measureInWindow until two
 * consecutive reads agree within STABLE_EPSILON_PX, registering only the stable
 * rect. Bounded by STABLE_TIMEOUT_MS (best-effort: last non-zero rect on
 * timeout). Re-arms on every isActive→true transition (forward AND Back) and on
 * callback-ref re-attach. This makes every NON-scroll step deterministic; the
 * Profile scroll steps run the same two-consecutive-match logic in
 * CoachMarkContext.scrollToKnownPosition after the programmatic scroll settles.
 *
 * NOTE: Do NOT use this for elements inside ScrollViews (the Profile steps).
 * Those use onLayout + registerTargetScrollOffset + a post-scroll measure.
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

  // Live handles for the in-flight stable-measure loop so we can cancel cleanly
  // on unmount / isActive→false and never leave a timer running.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactionHandleRef = useRef<{ cancel: () => void } | null>(null);

  const cancelLoop = useCallback((): void => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (deadlineTimerRef.current) {
      clearTimeout(deadlineTimerRef.current);
      deadlineTimerRef.current = null;
    }
    if (interactionHandleRef.current) {
      interactionHandleRef.current.cancel();
      interactionHandleRef.current = null;
    }
  }, []);

  /** Apply the ORCH-0688 Android window-frame Y-correction to a raw measure. */
  const correctRect = useCallback(
    (x: number, y: number, width: number, height: number): TargetRect => {
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
      // ORCH-1029 (F-4): the correction SOURCE is the resolved safe-area top
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
      return { x, y: correctedY, width, height, radius: targetRadius };
    },
    [insets.top, targetRadius],
  );

  // ── ORCH-1037: settle-gated measure-until-stable loop (SPEC §3.2) ──────────
  // Polls measureInWindow until two consecutive reads agree within
  // STABLE_EPSILON_PX, then registers the stable rect and stops. A 0×0 read is
  // "not ready" — it does NOT count toward the consecutive-match pair (the
  // element hasn't laid out yet). On STABLE_TIMEOUT_MS with no stable pair, the
  // last non-zero rect is registered best-effort so the step still shows a
  // cutout rather than hanging on the centered-bubble fallback; if NO non-zero
  // rect was ever obtained, nothing is registered (the orphan-warning path +
  // SpotlightOverlay centered fallback handle it).
  const startStableMeasureLoop = useCallback((): void => {
    const startedAt = Date.now();
    let prevRect: TargetRect | null = null;
    let lastNonZeroRect: TargetRect | null = null;

    const tick = (): void => {
      const node = nodeRef.current;
      if (!node) return; // ref detached — loop will re-arm on re-attach.

      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        // Re-check liveness inside the async callback (node may have detached).
        if (!nodeRef.current) return;

        const elapsed = Date.now() - startedAt;

        if (width === 0 && height === 0) {
          // Not laid out yet — does NOT count toward the consecutive-match pair.
          if (elapsed < STABLE_TIMEOUT_MS) {
            pollTimerRef.current = setTimeout(tick, STABLE_POLL_MS);
          } else if (lastNonZeroRect) {
            registerTarget(stepId, lastNonZeroRect);
          }
          return;
        }

        const rect = correctRect(x, y, width, height);
        lastNonZeroRect = rect;

        if (rectsStableEqual(prevRect, rect)) {
          // Two consecutive matching reads → the rect has settled. Register it.
          registerTarget(stepId, rect);
          return;
        }

        prevRect = rect;
        if (elapsed < STABLE_TIMEOUT_MS) {
          pollTimerRef.current = setTimeout(tick, STABLE_POLL_MS);
        } else {
          // Timed out without a stable pair — best-effort register the last rect.
          registerTarget(stepId, rect);
        }
      });
    };

    tick();
  }, [stepId, registerTarget, correctRect]);

  // Arm the loop: settle-gate first (waits out running Animated interactions —
  // notably the GlassTopBar entrance), then run the measure-until-stable loop.
  const armMeasure = useCallback((): void => {
    cancelLoop();
    interactionHandleRef.current = InteractionManager.runAfterInteractions(() => {
      interactionHandleRef.current = null;
      startStableMeasureLoop();
    });
  }, [cancelLoop, startStableMeasureLoop]);

  const targetRef = useCallback((node: View | null): void => {
    nodeRef.current = node;
    if (node && isActive) {
      // Ref attached while this step is active → measure now.
      armMeasure();
    }
  }, [armMeasure, isActive]);

  // Re-arm the stable loop whenever this step becomes active (forward AND Back
  // navigation). First-show and post-Back are therefore identical.
  useEffect(() => {
    if (isActive && nodeRef.current) {
      armMeasure();
    }
    return () => cancelLoop();
  }, [isActive, armMeasure, cancelLoop]);

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
