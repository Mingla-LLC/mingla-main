import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { spacing } from '../../constants/designSystem';
import {
  SWIPE_COMMIT_DISTANCE,
  SWIPE_COMMIT_MIN_DX,
  shouldCommitSwipe,
} from '../../utils/swipeCommit';
import {
  canAdmitDeckInput,
  canFastForwardDeckExit,
  DeckSwipeCommitToken,
  DeckCommitSettlement,
  DeckSwipeDirection,
  DeckSwipePhase,
  deckCommitTokenKey,
  isCurrentDeckCompletion,
  nextDeckGestureEpoch,
} from './deckSwipeLifecycle';

export const DECK_EXIT_MS = 200;
export const DECK_SNAP_MS = 240;
export const DECK_REDUCED_MS = 0;
export const DECK_EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

type DeckSwipeAnomalyReason =
  | 'watchdog_recovery'
  | 'stale_completion_ignored'
  | 'duplicate_commit_blocked'
  | 'transition_duration';

export interface DeckSwipeAnomaly {
  reason: DeckSwipeAnomalyReason;
  phase: DeckSwipePhase;
  durationMs: number;
}

export interface UseDeckSwipeControllerOptions {
  activeCardId: string | null;
  screenWidth: number;
  reducedMotion: boolean;
  onSwipeValidated: (token: DeckSwipeCommitToken) => boolean;
  onSwipeRejectedCentered: (token: DeckSwipeCommitToken) => void;
  onCommitRequested: (token: DeckSwipeCommitToken) => DeckCommitSettlement | null;
  onCommitSettled: (token: DeckSwipeCommitToken, settlement: DeckCommitSettlement) => void;
  onPhaseChanged: (phase: DeckSwipePhase) => void;
  onExpandValidated: () => boolean;
  onExpandRequested: () => void;
  onTransitionRejected: (phase: DeckSwipePhase) => void;
  onAnomaly: (anomaly: DeckSwipeAnomaly) => void;
  onInvalidated: (reason: string) => void;
}

interface DeckSwipeCounters {
  admitted: number;
  rejected: number;
  committed: number;
  stale: number;
  watchdog: number;
}

export interface DeckSwipeController {
  currentCardStyle: ReturnType<typeof useAnimatedStyle>;
  previewCardStyle: ReturnType<typeof useAnimatedStyle>;
  likeIndicatorStyle: ReturnType<typeof useAnimatedStyle>;
  passIndicatorStyle: ReturnType<typeof useAnimatedStyle>;
  isTransitionDelayed: boolean;
  gesture: ReturnType<typeof Gesture.Pan>;
  requestSwipe: (direction: DeckSwipeDirection) => boolean;
  requestTapExpand: () => boolean;
  isIdle: () => boolean;
  invalidate: (reason: string) => void;
  getCounters: () => DeckSwipeCounters;
}

export function useDeckSwipeController(
  options: UseDeckSwipeControllerOptions,
): DeckSwipeController {
  const positionX = useSharedValue(0);
  const positionY = useSharedValue(0);
  const [isTransitionDelayed, setIsTransitionDelayed] = useState(false);
  const phaseRef = useRef<DeckSwipePhase>('IDLE');
  const epochRef = useRef(0);
  const activeCardIdRef = useRef<string | null>(options.activeCardId);
  const mountedRef = useRef(true);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionStartedAtRef = useRef(0);
  const pendingCommitRef = useRef<DeckSwipeCommitToken | null>(null);
  const afterCenterRef = useRef<(() => void) | null>(null);
  const latestEndYRef = useRef(0);
  // One slot is sufficient because every admission gets a fresh epoch and
  // completion validity is checked before replay detection.
  const lastRequestedCommitKeyRef = useRef<string | null>(null);
  const countersRef = useRef<DeckSwipeCounters>({
    admitted: 0,
    rejected: 0,
    committed: 0,
    stale: 0,
    watchdog: 0,
  });
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const setPhase = useCallback((next: DeckSwipePhase): void => {
    phaseRef.current = next;
    optionsRef.current.onPhaseChanged(next);
  }, []);

  const clearTransitionTimers = useCallback((): void => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    if (delayedRef.current) clearTimeout(delayedRef.current);
    watchdogRef.current = null;
    delayedRef.current = null;
    if (mountedRef.current) setIsTransitionDelayed(false);
  }, []);

  const resetPresentation = useCallback((): void => {
    cancelAnimation(positionX);
    cancelAnimation(positionY);
    positionX.value = 0;
    positionY.value = 0;
  }, [positionX, positionY]);

  const recoverCurrentEpoch = useCallback((reason: DeckSwipeAnomalyReason): void => {
    const recoveryPhase = phaseRef.current;
    const durationMs = Math.max(0, Date.now() - transitionStartedAtRef.current);
    epochRef.current += 1;
    pendingCommitRef.current = null;
    clearTransitionTimers();
    resetPresentation();
    setPhase('IDLE');
    if (reason === 'watchdog_recovery') countersRef.current.watchdog += 1;
    optionsRef.current.onInvalidated(reason);
    optionsRef.current.onAnomaly({ reason, phase: recoveryPhase, durationMs });
  }, [clearTransitionTimers, resetPresentation, setPhase]);

  const startTransitionTimers = useCallback((): void => {
    clearTransitionTimers();
    transitionStartedAtRef.current = Date.now();
    delayedRef.current = setTimeout(() => {
      if (mountedRef.current && phaseRef.current !== 'IDLE') {
        setIsTransitionDelayed(true);
      }
    }, 250);
    watchdogRef.current = setTimeout(
      () => recoverCurrentEpoch('watchdog_recovery'),
      optionsRef.current.reducedMotion ? 100 : 500,
    );
  }, [clearTransitionTimers, recoverCurrentEpoch]);

  const completeCenter = useCallback((
    finished: boolean | undefined,
    animationEpoch: number,
    expectedCardId: string | null,
  ): void => {
    if (
      !finished ||
      !mountedRef.current ||
      animationEpoch !== epochRef.current ||
      expectedCardId !== activeCardIdRef.current ||
      phaseRef.current !== 'SNAPPING'
    ) return;
    clearTransitionTimers();
    resetPresentation();
    setPhase('IDLE');
    const afterCenter = afterCenterRef.current;
    afterCenterRef.current = null;
    afterCenter?.();
  }, [clearTransitionTimers, resetPresentation, setPhase]);

  const animateToCenter = useCallback((afterCenter?: () => void): void => {
    const animationEpoch = epochRef.current;
    const expectedCardId = activeCardIdRef.current;
    afterCenterRef.current = afterCenter ?? null;
    setPhase('SNAPPING');
    startTransitionTimers();
    const duration = optionsRef.current.reducedMotion ? DECK_REDUCED_MS : DECK_SNAP_MS;
    positionX.value = withTiming(0, { duration, easing: DECK_EASE_OUT }, (finished) => {
      runOnJS(completeCenter)(finished, animationEpoch, expectedCardId);
    });
    positionY.value = withTiming(0, { duration, easing: DECK_EASE_OUT });
  }, [completeCenter, positionX, positionY, setPhase, startTransitionTimers]);

  const settleCommit = useCallback((
    token: DeckSwipeCommitToken,
    phaseAlreadyCommitting = false,
  ): boolean => {
    if (phaseAlreadyCommitting) {
      if (phaseRef.current !== 'COMMITTING') return false;
    } else {
      if (phaseRef.current !== 'EXITING') return false;
      setPhase('COMMITTING');
    }

    const tokenKey = deckCommitTokenKey(token);
    if (lastRequestedCommitKeyRef.current === tokenKey) {
      recoverCurrentEpoch('duplicate_commit_blocked');
      return false;
    }
    lastRequestedCommitKeyRef.current = tokenKey;
    countersRef.current.committed += 1;
    const settlement = optionsRef.current.onCommitRequested(token);
    if (!settlement) {
      recoverCurrentEpoch('stale_completion_ignored');
      return false;
    }
    const durationMs = Math.max(0, Date.now() - transitionStartedAtRef.current);
    if (durationMs > 400) {
      optionsRef.current.onAnomaly({
        reason: 'transition_duration',
        phase: phaseRef.current,
        durationMs,
      });
    }
    pendingCommitRef.current = null;
    activeCardIdRef.current = 'nextCardId' in settlement
      ? settlement.nextCardId
      : null;
    clearTransitionTimers();
    resetPresentation();
    setPhase('IDLE');
    optionsRef.current.onCommitSettled(token, settlement);
    return true;
  }, [clearTransitionTimers, recoverCurrentEpoch, resetPresentation, setPhase]);

  const completeExit = useCallback((finished: boolean | undefined, token: DeckSwipeCommitToken): void => {
    const valid = isCurrentDeckCompletion({
      finished: finished === true,
      mounted: mountedRef.current,
      phase: phaseRef.current,
      expectedEpoch: token.epoch,
      currentEpoch: epochRef.current,
      expectedCardId: token.cardId,
      currentCardId: activeCardIdRef.current,
    });
    if (!valid) {
      if (
        mountedRef.current &&
        token.epoch === epochRef.current &&
        token.cardId === activeCardIdRef.current &&
        phaseRef.current === 'EXITING'
      ) {
        countersRef.current.stale += 1;
        optionsRef.current.onAnomaly({
          reason: 'stale_completion_ignored',
          phase: phaseRef.current,
          durationMs: Math.max(0, Date.now() - transitionStartedAtRef.current),
        });
        animateToCenter();
      }
      return;
    }
    settleCommit(token);
  }, [animateToCenter, settleCommit]);

  const beginExit = useCallback((direction: DeckSwipeDirection): boolean => {
    const cardId = activeCardIdRef.current;
    if (!cardId || phaseRef.current !== 'DRAGGING') return false;
    const token: DeckSwipeCommitToken = { cardId, direction, epoch: epochRef.current };
    if (!optionsRef.current.onSwipeValidated(token)) {
      animateToCenter(() => optionsRef.current.onSwipeRejectedCentered(token));
      return false;
    }

    pendingCommitRef.current = token;
    setPhase('EXITING');
    startTransitionTimers();
    const duration = optionsRef.current.reducedMotion ? DECK_REDUCED_MS : DECK_EXIT_MS;
    const targetX = (direction === 'right' ? 1 : -1) * (optionsRef.current.screenWidth + spacing.lg);
    const targetY = Math.max(-100, Math.min(100, latestEndYRef.current));
    positionX.value = withTiming(targetX, { duration, easing: DECK_EASE_OUT }, (finished) => {
      runOnJS(completeExit)(finished, token);
    });
    positionY.value = withTiming(targetY, { duration, easing: DECK_EASE_OUT });
    return true;
  }, [animateToCenter, completeExit, positionX, positionY, setPhase, startTransitionTimers]);

  const fastForwardPendingExit = useCallback((): boolean => {
    const token = pendingCommitRef.current;
    if (
      !token ||
      !canFastForwardDeckExit({
        mounted: mountedRef.current,
        phase: phaseRef.current,
        expectedEpoch: token.epoch,
        currentEpoch: epochRef.current,
        expectedCardId: token.cardId,
        currentCardId: activeCardIdRef.current,
      })
    ) return false;

    // Move out of EXITING before cancellation so the UI-thread completion sees
    // a stale phase and remains inert while this exact token settles once.
    setPhase('COMMITTING');
    cancelAnimation(positionX);
    cancelAnimation(positionY);
    clearTransitionTimers();
    resetPresentation();
    return settleCommit(token, true);
  }, [clearTransitionTimers, positionX, positionY, resetPresentation, setPhase, settleCommit]);

  const rejectInput = useCallback((): void => {
    countersRef.current.rejected += 1;
    optionsRef.current.onTransitionRejected(phaseRef.current);
  }, []);

  const beginGesture = useCallback((): void => {
    if (phaseRef.current === 'EXITING' && !fastForwardPendingExit()) {
      rejectInput();
      return;
    }
    if (!canAdmitDeckInput(phaseRef.current) || !activeCardIdRef.current) {
      rejectInput();
      return;
    }
    countersRef.current.admitted += 1;
    epochRef.current = nextDeckGestureEpoch(epochRef.current);
    setPhase('DRAGGING');
  }, [fastForwardPendingExit, rejectInput, setPhase]);

  const finalizeGesture = useCallback((
    translationX: number,
    translationY: number,
    velocityX: number,
    success: boolean,
  ): void => {
    if (phaseRef.current !== 'DRAGGING') return;
    latestEndYRef.current = translationY;

    if (!success) {
      animateToCenter();
      return;
    }
    if (translationY < -50 && Math.abs(translationX) < 50) {
      if (optionsRef.current.onExpandValidated()) {
        animateToCenter(() => optionsRef.current.onExpandRequested());
      } else {
        animateToCenter();
      }
      return;
    }

    const direction = shouldCommitSwipe(translationX, velocityX);
    if (direction) {
      beginExit(direction);
    } else {
      animateToCenter();
    }
  }, [animateToCenter, beginExit]);

  const gesture = useMemo(() => Gesture.Pan()
    .minDistance(10)
    .maxPointers(1)
    .onBegin(() => {
      runOnJS(beginGesture)();
    })
    .onUpdate((event) => {
      positionX.value = event.translationX;
      positionY.value = event.translationY;
    })
    .onFinalize((event, success) => {
      runOnJS(finalizeGesture)(
        event.translationX,
        event.translationY,
        event.velocityX,
        success,
      );
    }), [beginGesture, finalizeGesture, positionX, positionY]);

  const requestSwipe = useCallback((direction: DeckSwipeDirection): boolean => {
    if (!canAdmitDeckInput(phaseRef.current) || !activeCardIdRef.current) {
      rejectInput();
      return false;
    }
    countersRef.current.admitted += 1;
    epochRef.current = nextDeckGestureEpoch(epochRef.current);
    latestEndYRef.current = 0;
    setPhase('DRAGGING');
    return beginExit(direction);
  }, [beginExit, rejectInput, setPhase]);

  const requestTapExpand = useCallback((): boolean => {
    if (!canAdmitDeckInput(phaseRef.current) || !activeCardIdRef.current) {
      rejectInput();
      return false;
    }
    optionsRef.current.onExpandRequested();
    return true;
  }, [rejectInput]);

  const isIdle = useCallback((): boolean => phaseRef.current === 'IDLE', []);

  const invalidate = useCallback((reason: string): void => {
    epochRef.current += 1;
    pendingCommitRef.current = null;
    clearTransitionTimers();
    resetPresentation();
    setPhase('IDLE');
    optionsRef.current.onInvalidated(reason);
  }, [clearTransitionTimers, resetPresentation, setPhase]);

  useEffect(() => {
    const previousCardId = activeCardIdRef.current;
    if (previousCardId === options.activeCardId) return;
    if (phaseRef.current === 'COMMITTING' && pendingCommitRef.current?.cardId === previousCardId) {
      activeCardIdRef.current = options.activeCardId;
      return;
    }
    invalidate('active-card-replacement');
    activeCardIdRef.current = options.activeCardId;
  }, [invalidate, options.activeCardId]);

  useEffect(() => () => {
    mountedRef.current = false;
    epochRef.current += 1;
    cancelAnimation(positionX);
    cancelAnimation(positionY);
    clearTransitionTimers();
    optionsRef.current.onPhaseChanged('IDLE');
    optionsRef.current.onInvalidated('unmount');
  }, [clearTransitionTimers, positionX, positionY]);

  const currentCardStyle = useAnimatedStyle(() => ({
    // #1576 — MUST be written explicitly, and must stay key-symmetric with
    // previewCardStyle. DeckSwipeStage swaps ONE keyed poster node from
    // previewCardStyle to this style on behind->current promotion (#1481: the node
    // is deliberately NOT remounted, to avoid re-decoding the hero). previewCardStyle
    // writes opacity 0 at rest; Reanimated does not restore properties written by a
    // detached style, so omitting opacity here leaves the promoted poster stamped at
    // opacity 0 permanently — the black card. See I-PROPOSED-1576-ANIMATED-STYLE-SWAP-KEY-PARITY.
    opacity: 1,
    transform: [
      { translateX: positionX.value },
      { translateY: positionY.value },
      {
        rotate: `${interpolate(
          positionX.value,
          [-options.screenWidth / 2, -SWIPE_COMMIT_DISTANCE, 0, SWIPE_COMMIT_DISTANCE, options.screenWidth / 2],
          [-12, -6, 0, 6, 12],
          Extrapolation.CLAMP,
        )}deg`,
      },
    ],
  }), [options.screenWidth]);
  const previewCardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      positionX.value,
      [-SWIPE_COMMIT_DISTANCE, -16, 0, 16, SWIPE_COMMIT_DISTANCE],
      [1, 0.12, 0, 0.12, 1],
      Extrapolation.CLAMP,
    ),
    transform: [{
      scale: interpolate(
        positionX.value,
        [-SWIPE_COMMIT_DISTANCE, 0, SWIPE_COMMIT_DISTANCE],
        [1, 0.965, 1],
        Extrapolation.CLAMP,
      ),
    }],
  }));
  const likeIndicatorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      positionX.value,
      [0, 16, SWIPE_COMMIT_MIN_DX, SWIPE_COMMIT_DISTANCE],
      [0, 0.15, 0.35, 1],
      Extrapolation.CLAMP,
    ),
    transform: [{
      scale: interpolate(
        positionX.value,
        [0, 16, SWIPE_COMMIT_DISTANCE],
        [0.96, 0.96, 1],
        Extrapolation.CLAMP,
      ),
    }],
  }));
  const passIndicatorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      positionX.value,
      [-SWIPE_COMMIT_DISTANCE, -SWIPE_COMMIT_MIN_DX, -16, 0],
      [1, 0.35, 0.15, 0],
      Extrapolation.CLAMP,
    ),
    transform: [{
      scale: interpolate(
        positionX.value,
        [-SWIPE_COMMIT_DISTANCE, -16, 0],
        [1, 0.96, 0.96],
        Extrapolation.CLAMP,
      ),
    }],
  }));

  return {
    currentCardStyle,
    previewCardStyle,
    likeIndicatorStyle,
    passIndicatorStyle,
    isTransitionDelayed,
    gesture,
    requestSwipe,
    requestTapExpand,
    isIdle,
    invalidate,
    getCounters: () => ({ ...countersRef.current }),
  };
}
