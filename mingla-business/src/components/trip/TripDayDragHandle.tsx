/**
 * #4522 — the grip a host drags to reorder itinerary days, with its keyboard and
 * screen-reader alternative. A drag reports how far it moved; the list decides
 * where the card lands. The same reorder is available without a pointer:
 * ArrowUp / ArrowDown on the focused grip (web), the grip's increment / decrement
 * accessibility actions (VoiceOver / TalkBack), and the Move up / Move down
 * buttons on every day card.
 */

import React, { useMemo } from "react";
import { PanResponder, Pressable, StyleSheet, View } from "react-native";

import { color, radius, space } from "../../constants/designSystem";

export interface TripDayDragHandleProps {
  dayLabel: string;
  disabled?: boolean;
  onDragStart: () => void;
  onDragMove: (dy: number) => void;
  /** `dy` is the total vertical distance of the drag. */
  onDragEnd: (dy: number) => void;
  /** Keyboard / screen-reader step: -1 = one day earlier, +1 = one day later. */
  onStep: (direction: -1 | 1) => void;
  testID?: string;
}

export const TripDayDragHandle: React.FC<TripDayDragHandleProps> = ({
  dayLabel,
  disabled = false,
  onDragStart,
  onDragMove,
  onDragEnd,
  onStep,
  testID,
}) => {
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        // The list is inside a scroll view; once a drag starts it keeps the touch.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => onDragStart(),
        onPanResponderMove: (_e, g) => onDragMove(g.dy),
        onPanResponderRelease: (_e, g) => onDragEnd(g.dy),
        onPanResponderTerminate: (_e, g) => onDragEnd(g.dy),
      }),
    [disabled, onDragStart, onDragMove, onDragEnd],
  );
  return (
    <Pressable
      {...responder.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel={`Reorder ${dayLabel}`}
      accessibilityHint="Drag, or swipe up or down, to move this day's plan to another day"
      accessibilityActions={[
        { name: "increment", label: "Move later" },
        { name: "decrement", label: "Move earlier" },
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "increment") onStep(1);
        else if (e.nativeEvent.actionName === "decrement") onStep(-1);
      }}
      // react-native-web passes onKeyDown through; native ignores it.
      {...({
        onKeyDown: (e: { key: string; preventDefault: () => void }) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onStep(-1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onStep(1);
          }
        },
      } as object)}
      disabled={disabled}
      hitSlop={8}
      style={[styles.handle, disabled ? styles.disabled : null]}
      testID={testID}
    >
      <View style={styles.dots}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={styles.dotRow}>
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>
        ))}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  handle: {
    width: 44,
    height: 44,
    marginLeft: -space[2],
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.4 },
  dots: { gap: 3 },
  dotRow: { flexDirection: "row", gap: 3 },
  dot: { width: 4, height: 4, borderRadius: radius.full, backgroundColor: color.text3 },
});
