/**
 * DraftSelectOverlay — ORCH-1116 [Hub multi-select draft delete].
 *
 * Shared selection-affordance layer for the 3 Hub list cards (event/trip/
 * experience). Keeps all three cards visually identical and DRY. Renders, as
 * absolute-fill children INSIDE the host's overflow:'hidden' clip (so they round
 * to radius.lg on every platform with no platform fork):
 *   - the press-and-hold ring (DESIGN §5.1B) — charges over 350ms delayLongPress
 *   - the selected wash overlay (DESIGN §4.2)
 * and a `useDraftHoldRing` hook that wires the ring to the card body Pressable's
 * onPressIn/onPressOut, plus a null-shake helper for non-draft long-press
 * (honest no-op, DESIGN §5.1D).
 *
 * The hold-ring + null-shake are visual affordances only; the actual long-press
 * → enterWith and tap → toggle wiring lives on the card's Pressable.
 */

import React, { useCallback, useRef } from "react";
import { Animated, Easing, StyleSheet, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { accent, durations, radius as radiusTokens } from "../../constants/designSystem";

const HOLD_RING_DURATION = 350; // == delayLongPress (SPEC §3.7.1)

export interface DraftHoldRing {
  /** Spread onto the card body Pressable. */
  pressHandlers: {
    onPressIn: () => void;
    onPressOut: () => void;
  };
  /** Drives the hold-ring opacity/scale overlay. */
  ringOpacity: Animated.Value;
  ringScale: Animated.Value;
  /** translateX for the non-draft null-shake (apply to host). */
  shakeX: Animated.Value;
  /** Play the 1-cycle null-shake on a non-draft long-press attempt. */
  playNullShake: () => void;
}

/**
 * Wires the press-and-hold ring + null-shake animations. `enabled` should be
 * `selectable` (a draft row) — when false, the press handlers are no-ops so a
 * non-draft row never charges the ring.
 */
export function useDraftHoldRing(enabled: boolean): DraftHoldRing {
  const reducedMotion = useReducedMotion();
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(1.02)).current;
  const shakeX = useRef(new Animated.Value(0)).current;

  const onPressIn = useCallback(() => {
    if (!enabled) return;
    ringScale.setValue(1.02);
    Animated.parallel([
      Animated.timing(ringOpacity, {
        toValue: 0.9,
        duration: HOLD_RING_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(ringScale, {
        toValue: 1.0,
        duration: reducedMotion ? 0 : HOLD_RING_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [enabled, ringOpacity, ringScale, reducedMotion]);

  const onPressOut = useCallback(() => {
    if (!enabled) return;
    Animated.timing(ringOpacity, {
      toValue: 0,
      duration: durations.fast,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enabled, ringOpacity]);

  const playNullShake = useCallback(() => {
    if (reducedMotion) return;
    shakeX.setValue(0);
    Animated.sequence([
      Animated.timing(shakeX, {
        toValue: -4,
        duration: durations.normal / 4,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(shakeX, {
        toValue: 4,
        duration: durations.normal / 2,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(shakeX, {
        toValue: 0,
        duration: durations.normal / 4,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [shakeX, reducedMotion]);

  return {
    pressHandlers: { onPressIn, onPressOut },
    ringOpacity,
    ringScale,
    shakeX,
    playNullShake,
  };
}

export interface DraftSelectOverlayProps {
  selected: boolean;
  selectable: boolean;
  ringOpacity: Animated.Value;
  ringScale: Animated.Value;
}

/**
 * The visual overlays (ring + wash). Mount INSIDE the host (so overflow:'hidden'
 * clips them to radius.lg). Renders nothing for a non-selectable row.
 */
export const DraftSelectOverlay: React.FC<DraftSelectOverlayProps> = ({
  selected,
  selectable,
  ringOpacity,
  ringScale,
}) => {
  if (!selectable) return null;
  return (
    <>
      {/* Selected wash (DESIGN §4.2) */}
      {selected ? (
        <Animated.View
          pointerEvents="none"
          style={styles.selectedWash}
        />
      ) : null}
      {/* Press-and-hold ring (DESIGN §5.1B) */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.holdRing,
          { opacity: ringOpacity, transform: [{ scale: ringScale }] },
        ]}
      />
    </>
  );
};

const selectedWash: ViewStyle = {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: accent.tint,
};

const holdRing: ViewStyle = {
  ...StyleSheet.absoluteFillObject,
  borderWidth: 2,
  borderColor: accent.warm,
  borderRadius: radiusTokens.lg,
};

const styles = StyleSheet.create({
  selectedWash,
  holdRing,
});

export default DraftSelectOverlay;
