/**
 * #4490 P1-8 — the site plan (`sp-site`): every space drawn where it sits, as
 * a labelled button. P1 shows each space as "Open" (bookings arrive in P2–P4);
 * status is always a word, never colour alone. Arrange mode (wide web only)
 * lets the host drag a space to move it and drag its corner to resize it.
 */
import React, { useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";
import type { SpacePlanShape, VenueSpace } from "../../../services/venueFeaturesService";
import { spaceFitsLabel } from "../../ui/SpacePicker";
import { clampShape } from "./spaceModel";

export interface SitePlanProps {
  spaces: readonly VenueSpace[];
  shapes: Record<string, SpacePlanShape>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  arranging: boolean;
  onShapeChange?: (id: string, shape: SpacePlanShape) => void;
  height?: number;
}

function DraggableSpace({
  spaceRow,
  shape,
  size,
  selected,
  arranging,
  onSelect,
  onShapeChange,
}: {
  spaceRow: VenueSpace;
  shape: SpacePlanShape;
  size: { width: number; height: number };
  selected: boolean;
  arranging: boolean;
  onSelect: () => void;
  onShapeChange?: (shape: SpacePlanShape) => void;
}): React.ReactElement {
  const start = useRef<SpacePlanShape>(shape);
  const shapeRef = useRef(shape);
  shapeRef.current = shape;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const changeRef = useRef(onShapeChange);
  changeRef.current = onShapeChange;

  const move = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => arranging,
        onMoveShouldSetPanResponder: () => arranging,
        onPanResponderGrant: () => {
          start.current = shapeRef.current;
        },
        onPanResponderMove: (_e, g) => {
          const { width, height } = sizeRef.current;
          if (width <= 0 || height <= 0) return;
          changeRef.current?.(
            clampShape({
              ...start.current,
              x: start.current.x + (g.dx / width) * 100,
              y: start.current.y + (g.dy / height) * 100,
            }),
          );
        },
      }),
    [arranging],
  );
  const resize = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => arranging,
        onMoveShouldSetPanResponder: () => arranging,
        onPanResponderGrant: () => {
          start.current = shapeRef.current;
        },
        onPanResponderMove: (_e, g) => {
          const { width, height } = sizeRef.current;
          if (width <= 0 || height <= 0) return;
          changeRef.current?.(
            clampShape({
              ...start.current,
              w: start.current.w + (g.dx / width) * 100,
              h: start.current.h + (g.dy / height) * 100,
            }),
          );
        },
      }),
    [arranging],
  );

  const label = `${spaceRow.name}, fits ${spaceFitsLabel(spaceRow)}, open`;
  return (
    <View
      style={[
        styles.spaceBox,
        {
          left: `${shape.x}%`,
          top: `${shape.y}%`,
          width: `${shape.w}%`,
          height: `${shape.h}%`,
        },
        selected && styles.spaceBoxSelected,
        arranging && styles.spaceBoxArranging,
      ]}
      {...(arranging ? move.panHandlers : {})}
    >
      <Pressable
        onPress={onSelect}
        accessibilityRole="button"
        accessibilityLabel={arranging ? `${spaceRow.name}. Drag to move` : label}
        accessibilityState={{ selected }}
        style={styles.spacePress}
        testID={`site-plan-space-${spaceRow.id}`}
      >
        <Text style={styles.spaceName} numberOfLines={2}>{spaceRow.name}</Text>
        <Text style={styles.spaceFits} numberOfLines={1}>{spaceFitsLabel(spaceRow)}</Text>
        {!arranging ? <Text style={styles.spaceState}>Open</Text> : null}
      </Pressable>
      {arranging ? (
        <View
          style={styles.resizeHandle}
          accessibilityLabel={`Resize ${spaceRow.name}`}
          {...resize.panHandlers}
        />
      ) : null}
    </View>
  );
}

export function SitePlan({
  spaces,
  shapes,
  selectedId,
  onSelect,
  arranging,
  onShapeChange,
  height = 420,
}: SitePlanProps): React.ReactElement {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height: h } = event.nativeEvent.layout;
    setSize({ width, height: h });
  };
  const placed = spaces.filter((s) => shapes[s.id] !== undefined);
  return (
    <View
      style={[styles.plot, { height }]}
      onLayout={onLayout}
      accessibilityLabel={arranging ? "Site plan, arranging" : "Site plan"}
      testID="site-plan"
    >
      {placed.map((s) => (
        <DraggableSpace
          key={s.id}
          spaceRow={s}
          shape={shapes[s.id] as SpacePlanShape}
          size={size}
          selected={selectedId === s.id}
          arranging={arranging}
          onSelect={() => onSelect(s.id)}
          onShapeChange={onShapeChange !== undefined ? (shape) => onShapeChange(s.id, shape) : undefined}
        />
      ))}
    </View>
  );
}

export function SitePlanLegend(): React.ReactElement {
  return (
    <View style={styles.legend} accessibilityLabel="Legend: Open means guests can use the space">
      <View style={styles.legendSwatch} />
      <Text style={styles.legendText}>Open</Text>
      <Text style={styles.legendNote}>Hired, on hold and event days show here once bookings arrive.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    position: "relative",
    width: "100%",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    overflow: "hidden",
  },
  spaceBox: {
    position: "absolute",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
    overflow: "hidden",
  },
  spaceBoxSelected: { borderColor: color.accent, borderWidth: 2 },
  spaceBoxArranging: { borderStyle: "dashed" },
  spacePress: { flex: 1, padding: space[2], gap: 2 },
  spaceName: { ...type.row, color: color.text1 },
  spaceFits: { ...type.caption, color: color.text2 },
  spaceState: { ...type.label, color: color.text2, marginTop: "auto" },
  resizeHandle: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 22,
    height: 22,
    borderTopLeftRadius: radius.sm,
    backgroundColor: color.fill.handle,
  },
  legend: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] },
  legendSwatch: {
    width: 14,
    height: 14,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  legendText: { ...type.caption, color: color.text1 },
  legendNote: { ...type.caption, color: color.text3 },
});
