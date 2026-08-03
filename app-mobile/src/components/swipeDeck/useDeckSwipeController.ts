import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
// [TRANSITIONAL: I-1481] RNGH 2.x remains until a separately approved Consumer
// gesture migration passes physical iOS/Android Fabric crash soak.
import {
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
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
  phase: DeckSwipePhase;
  positionX: Animated.Value;
  positionY: Animated.Value;
  rotate: Animated.AnimatedInterpolation<string>;
  likeOpacity: Animated.AnimatedInterpolation<number>;
  passOpacity: Animated.AnimatedInterpolation<number>;
  likeScale: Animated.AnimatedInterpolation<number>;
  passScale: Animated.AnimatedInterpolation<number>;
  previewOpacity: Animated.AnimatedInterpolation<number>;
  previewScale: Animated.AnimatedInterpolation<number>;
  isTransitionDelayed: boolean;
  onGestureEvent: (...args: unknown[]) => void;
  onHandlerStateChange: (event: PanGestureHandlerStateChangeEvent) => void;
  requestSwipe: (direction: DeckSwipeDirection) => boolean;
  requestTapExpand: () => boolean;
  invalidate: (reason: string) => void;
  getCounters: () => DeckSwipeCounters;
}

export function useDeckSwipeController(
  options: UseDeckSwipeControllerOptions,
): DeckSwipeController {
  const positionX = useRef(new Animated.Value(0)).current;
  const positionY = useRef(new Animated.Value(0)).current;
  const [phase, setRenderedPhase] = useState<DeckSwipePhase>('IDLE');
  const [isTransitionDelayed, setIsTransitionDelayed] = useState(false);
  const phaseRef = useRef<DeckSwipePhase>('IDLE');
  const epochRef = useRef(0);
  const activeCardIdRef = useRef<string | null>(options.activeCardId);
  const mountedRef = useRef(true);
  const activeAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionStartedAtRef = useRef(0);
  const pendingCommitRef = useRef<DeckSwipeCommitToken | null>(null);
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
    if (mountedRef.current) setRenderedPhase(next);
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
    positionX.setValue(0);
    positionY.setValue(0);
  }, [positionX, positionY]);

  const recoverCurrentEpoch = useCallback((reason: DeckSwipeAnomalyReason): void => {
    const recoveryPhase = phaseRef.current;
    const durationMs = Math.max(0, Date.now() - transitionStartedAtRef.current);
    epochRef.current += 1;
    activeAnimationRef.current?.stop();
    activeAnimationRef.current = null;
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

  const animateToCenter = useCallback((afterCenter?: () => void): void => {
    const animationEpoch = epochRef.current;
    const expectedCardId = activeCardIdRef.current;
    setPhase('SNAPPING');
    startTransitionTimers();
    const animation = Animated.parallel([
      Animated.timing(positionX, {
        toValue: 0,
        duration: optionsRef.current.reducedMotion ? DECK_REDUCED_MS : DECK_SNAP_MS,
        easing: DECK_EASE_OUT,
        useNativeDriver: true,
      }),
      Animated.timing(positionY, {
        toValue: 0,
        duration: optionsRef.current.reducedMotion ? DECK_REDUCED_MS : DECK_SNAP_MS,
        easing: DECK_EASE_OUT,
        useNativeDriver: true,
      }),
    ]);
    activeAnimationRef.current = animation;
    animation.start(({ finished }) => {
      if (
        !finished ||
        !mountedRef.current ||
        animationEpoch !== epochRef.current ||
        expectedCardId !== activeCardIdRef.current ||
        phaseRef.current !== 'SNAPPING'
      ) {
        return;
      }
      activeAnimationRef.current = null;
      clearTransitionTimers();
      resetPresentation();
      setPhase('IDLE');
      afterCenter?.();
    });
  }, [clearTransitionTimers, positionX, positionY, resetPresentation, setPhase, startTransitionTimers]);

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
    activeAnimationRef.current = null;
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
    const animation = Animated.parallel([
      Animated.timing(positionX, {
        toValue: targetX,
        duration,
        easing: DECK_EASE_OUT,
        useNativeDriver: true,
      }),
      Animated.timing(positionY, {
        toValue: targetY,
        duration,
        easing: DECK_EASE_OUT,
        useNativeDriver: true,
      }),
    ]);
    activeAnimationRef.current = animation;
    animation.start(({ finished }) => {
      const valid = isCurrentDeckCompletion({
        finished,
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
    });
    return true;
  }, [animateToCenter, positionX, positionY, settleCommit, setPhase, startTransitionTimers]);

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

    // Move out of EXITING before stop(): React Native may synchronously invoke
    // the old animation callback with finished:false. That callback must see a
    // stale phase and remain inert while the exact pending token settles once.
    setPhase('COMMITTING');
    const outgoingAnimation = activeAnimationRef.current;
    activeAnimationRef.current = null;
    outgoingAnimation?.stop();
    clearTransitionTimers();
    resetPresentation();
    return settleCommit(token, true);
  }, [clearTransitionTimers, resetPresentation, setPhase, settleCommit]);

  const onGestureEvent = useMemo(
    () => Animated.event<PanGestureHandlerGestureEvent>(
      [{ nativeEvent: { translationX: positionX, translationY: positionY } }],
      { useNativeDriver: true },
    ),
    [positionX, positionY],
  );

  const rejectInput = useCallback((): void => {
    countersRef.current.rejected += 1;
    optionsRef.current.onTransitionRejected(phaseRef.current);
  }, []);

  const onHandlerStateChange = useCallback((event: PanGestureHandlerStateChangeEvent): void => {
    const { state, translationX, translationY, velocityX } = event.nativeEvent;
    if (state === State.BEGAN) {
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
      return;
    }

    if (state !== State.END && state !== State.CANCELLED && state !== State.FAILED) return;
    if (phaseRef.current !== 'DRAGGING') return;
    latestEndYRef.current = translationY;

    if (state !== State.END) {
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
  }, [animateToCenter, beginExit, fastForwardPendingExit, rejectInput, setPhase]);

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

  const invalidate = useCallback((reason: string): void => {
    epochRef.current += 1;
    activeAnimationRef.current?.stop();
    activeAnimationRef.current = null;
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
    activeAnimationRef.current?.stop();
    clearTransitionTimers();
    optionsRef.current.onPhaseChanged('IDLE');
    optionsRef.current.onInvalidated('unmount');
  }, [clearTransitionTimers]);

  const rotate = useMemo(() => positionX.interpolate({
    inputRange: [-options.screenWidth / 2, -SWIPE_COMMIT_DISTANCE, 0, SWIPE_COMMIT_DISTANCE, options.screenWidth / 2],
    outputRange: ['-12deg', '-6deg', '0deg', '6deg', '12deg'],
    extrapolate: 'clamp',
  }), [options.screenWidth, positionX]);
  const likeOpacity = useMemo(() => positionX.interpolate({
    inputRange: [0, 16, SWIPE_COMMIT_MIN_DX, SWIPE_COMMIT_DISTANCE],
    outputRange: [0, 0.15, 0.35, 1],
    extrapolate: 'clamp',
  }), [positionX]);
  const passOpacity = useMemo(() => positionX.interpolate({
    inputRange: [-SWIPE_COMMIT_DISTANCE, -SWIPE_COMMIT_MIN_DX, -16, 0],
    outputRange: [1, 0.35, 0.15, 0],
    extrapolate: 'clamp',
  }), [positionX]);
  const likeScale = useMemo(() => positionX.interpolate({
    inputRange: [0, 16, SWIPE_COMMIT_DISTANCE],
    outputRange: [0.96, 0.96, 1],
    extrapolate: 'clamp',
  }), [positionX]);
  const passScale = useMemo(() => positionX.interpolate({
    inputRange: [-SWIPE_COMMIT_DISTANCE, -16, 0],
    outputRange: [1, 0.96, 0.96],
    extrapolate: 'clamp',
  }), [positionX]);
  const previewOpacity = useMemo(() => positionX.interpolate({
    inputRange: [-SWIPE_COMMIT_DISTANCE, -16, 0, 16, SWIPE_COMMIT_DISTANCE],
    outputRange: [1, 0.12, 0, 0.12, 1],
    extrapolate: 'clamp',
  }), [positionX]);
  const previewScale = useMemo(() => positionX.interpolate({
    inputRange: [-SWIPE_COMMIT_DISTANCE, 0, SWIPE_COMMIT_DISTANCE],
    outputRange: [1, 0.965, 1],
    extrapolate: 'clamp',
  }), [positionX]);

  return {
    phase,
    positionX,
    positionY,
    rotate,
    likeOpacity,
    passOpacity,
    likeScale,
    passScale,
    previewOpacity,
    previewScale,
    isTransitionDelayed,
    onGestureEvent,
    onHandlerStateChange,
    requestSwipe,
    requestTapExpand,
    invalidate,
    getCounters: () => ({ ...countersRef.current }),
  };
}
