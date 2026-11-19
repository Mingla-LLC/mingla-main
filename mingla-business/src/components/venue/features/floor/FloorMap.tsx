/**
 * #4490 P5-2 — FloorMap (`fl-live`, `fl-seat`, `fl-edit`, `ph-floor`): one
 * space's room drawn to scale with its tables where they stand.
 *
 * Every table is a labelled button that carries its state as a WORD ("Free",
 * "Seated", "Booked", "Fits 8", "Taken"), never colour alone; the outline
 * style differs per state too (solid, double, dashed, dimmed). Colours are
 * design tokens only. In edit mode a table (or a landmark) drags with a mouse
 * or a finger; the editor around it offers keys and buttons for the same
 * moves, so nothing needs a drag.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import {
  LANDMARK_LABEL,
  PLAN_WIDTH,
  roomHeight,
  seatDots,
  type FloorRoom,
  type Landmark,
  type PlanBox,
  type TableShape,
} from "./floorModel";

export type FloorTableTone = "free" | "booked" | "seated" | "pending" | "next" | "fit" | "dim" | "plain";

export interface FloorMapTable {
  id: string;
  name: string;
  shape: TableShape;
  box: PlanBox;
  seats: number;
  /** The word drawn under the name ("Free", "Seated", "4 seats"). */
  word: string;
  tone: FloorTableTone;
  accessibilityLabel: string;
}

export interface FloorMapProps {
  room: FloorRoom;
  tables: readonly FloorMapTable[];
  selectedId: string | null;
  onSelect?: (id: string) => void;
  /** Edit mode: tables and landmarks drag; `final` is true on release. */
  editing?: boolean;
  onMove?: (kind: "table" | "landmark", id: string, box: PlanBox, final: boolean) => void;
  /** 1 = fit the width; 2 = twice as big (the parent scrolls). */
  zoom?: number;
  /** Fixed drawing width (px) instead of measuring (tests, the zoomed view). */
  width?: number;
  showSeats?: boolean;
  testID?: string;
}

function toneStyle(tone: FloorTableTone): object {
  switch (tone) {
    case "seated":
      return styles.toneSeated;
    case "booked":
      return styles.toneBooked;
    case "pending":
      return styles.tonePending;
    case "fit":
      return styles.toneFit;
    case "dim":
      return styles.toneDim;
    case "next":
    case "free":
    case "plain":
    default:
      return styles.toneFree;
  }
}

function shapeStyle(shape: TableShape): object {
  switch (shape) {
    case "round":
    case "high_top":
      return styles.shapeRound;
    case "booth":
      return styles.shapeBooth;
    case "sofa":
      return styles.shapeSofa;
    case "rect":
    default:
      return styles.shapeRect;
  }
}

interface DragHandlers {
  kind: "table" | "landmark";
  id: string;
  box: PlanBox;
  scale: number;
  editing: boolean;
  onMove?: FloorMapProps["onMove"];
  onSelect?: (id: string) => void;
}

type DragResponder = { panHandlers: object };

function useDrag({ kind, id, box, scale, editing, onMove, onSelect }: DragHandlers): DragResponder {
  const start = useRef<PlanBox>(box);
  const live = useRef({ box, scale, onMove, onSelect });
  live.current = { box, scale, onMove, onSelect };
  return useMemo(
    (): DragResponder =>
      // A test renderer without PanResponder still draws the floor (no drag).
      typeof PanResponder?.create !== "function"
        ? { panHandlers: {} }
        : PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => editing && (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3),
        // Take the gesture from the table's own button once it moves (a tap still selects).
        onMoveShouldSetPanResponderCapture: (_e, g) => editing && (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = live.current.box;
          live.current.onSelect?.(id);
        },
        onPanResponderMove: (_e, g) => {
          const s = live.current.scale;
          if (s <= 0) return;
          live.current.onMove?.(kind, id, { ...start.current, x: start.current.x + g.dx / s, y: start.current.y + g.dy / s }, false);
        },
        onPanResponderRelease: (_e, g) => {
          const s = live.current.scale;
          if (s <= 0) return;
          live.current.onMove?.(kind, id, { ...start.current, x: start.current.x + g.dx / s, y: start.current.y + g.dy / s }, true);
        },
      }),
    [editing, id, kind],
  );
}

/**
 * Web: drag with pointer events on the DOM node (mouse, pen and touch in a
 * browser). The responder system above stays for native.
 */
function useWebDrag(
  nodeRef: React.RefObject<View | null>,
  input: { kind: "table" | "landmark"; id: string; box: PlanBox; scale: number; editing: boolean; onMove?: FloorMapProps["onMove"]; onSelect?: (id: string) => void },
): void {
  const live = useRef(input);
  live.current = input;
  useEffect(() => {
    if (Platform.OS !== "web" || !input.editing) return undefined;
    const node = nodeRef.current as unknown as HTMLElement | null;
    if (node === null || typeof node.addEventListener !== "function") return undefined;
    let start: { x: number; y: number; box: PlanBox } | null = null;
    let moved = false;
    const delta = (e: PointerEvent): PlanBox | null => {
      if (start === null || live.current.scale <= 0) return null;
      const s = live.current.scale;
      return { ...start.box, x: start.box.x + (e.clientX - start.x) / s, y: start.box.y + (e.clientY - start.y) / s };
    };
    const onMoveEvt = (e: PointerEvent): void => {
      if (start === null) return;
      if (!moved && Math.abs(e.clientX - start.x) < 4 && Math.abs(e.clientY - start.y) < 4) return;
      moved = true;
      e.preventDefault();
      const b = delta(e);
      if (b !== null) live.current.onMove?.(live.current.kind, live.current.id, b, false);
    };
    const onUp = (e: PointerEvent): void => {
      if (start !== null && moved) {
        const b = delta(e);
        if (b !== null) live.current.onMove?.(live.current.kind, live.current.id, b, true);
      }
      start = null;
      window.removeEventListener("pointermove", onMoveEvt);
      window.removeEventListener("pointerup", onUp);
    };
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, box: live.current.box };
      moved = false;
      live.current.onSelect?.(live.current.id);
      window.addEventListener("pointermove", onMoveEvt);
      window.addEventListener("pointerup", onUp);
    };
    node.style.touchAction = "none";
    node.style.cursor = "grab";
    node.addEventListener("pointerdown", onDown);
    return () => {
      node.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMoveEvt);
      window.removeEventListener("pointerup", onUp);
    };
  }, [input.editing, nodeRef]);
}

function TableNode({
  table,
  scale,
  selected,
  editing,
  showSeats,
  onSelect,
  onMove,
}: {
  table: FloorMapTable;
  scale: number;
  selected: boolean;
  editing: boolean;
  showSeats: boolean;
  onSelect?: (id: string) => void;
  onMove?: FloorMapProps["onMove"];
}): React.ReactElement {
  const drag = useDrag({ kind: "table", id: table.id, box: table.box, scale, editing, onMove, onSelect });
  const nodeRef = useRef<View | null>(null);
  useWebDrag(nodeRef, { kind: "table", id: table.id, box: table.box, scale, editing, onMove, onSelect });
  const w = table.box.w * scale;
  const h = table.box.h * scale;
  const compact = w < 56 || h < 34;
  const dots = showSeats && w >= 28 ? seatDots(table.shape, table.box, table.seats) : [];
  const dotSize = Math.max(5, Math.min(10, 9 * scale * 1.6));
  return (
    <View
      ref={nodeRef}
      style={[
        styles.tableWrap,
        {
          left: table.box.x * scale,
          top: table.box.y * scale,
          width: w,
          height: h,
          transform: [{ rotate: `${table.box.rotation}deg` }],
        },
      ]}
      {...(editing && Platform.OS !== "web" ? drag.panHandlers : {})}
    >
      {dots.map((d, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[
            styles.seat,
            table.tone === "dim" ? styles.seatDim : null,
            { width: dotSize, height: dotSize, left: d.x * scale - dotSize / 2, top: d.y * scale - dotSize / 2 },
          ]}
        />
      ))}
      <Pressable
        onPress={onSelect !== undefined ? () => onSelect(table.id) : undefined}
        disabled={onSelect === undefined}
        accessibilityRole="button"
        accessibilityLabel={editing ? `${table.accessibilityLabel}. Drag to move, or use the arrow buttons` : table.accessibilityLabel}
        accessibilityState={{ selected }}
        style={[styles.table, shapeStyle(table.shape), toneStyle(table.tone), selected ? styles.selected : null]}
        testID={`floor-table-${table.id}`}
      >
        <Text style={[styles.tableName, compact ? styles.tableNameCompact : null]} numberOfLines={1}>
          {table.name}
        </Text>
        {!compact && table.word.length > 0 ? (
          <Text style={styles.tableWord} numberOfLines={1}>
            {table.word}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

function LandmarkNode({
  landmark,
  scale,
  selected,
  editing,
  onSelect,
  onMove,
}: {
  landmark: Landmark;
  scale: number;
  selected: boolean;
  editing: boolean;
  onSelect?: (id: string) => void;
  onMove?: FloorMapProps["onMove"];
}): React.ReactElement {
  const drag = useDrag({ kind: "landmark", id: landmark.id, box: landmark, scale, editing, onMove, onSelect });
  const nodeRef = useRef<View | null>(null);
  useWebDrag(nodeRef, { kind: "landmark", id: landmark.id, box: landmark, scale, editing, onMove, onSelect });
  const label = LANDMARK_LABEL[landmark.kind];
  const inner = (
    <Text style={styles.landmarkText} numberOfLines={1}>
      {label}
    </Text>
  );
  return (
    <View
      ref={nodeRef}
      style={[
        styles.landmark,
        selected ? styles.selected : null,
        {
          left: landmark.x * scale,
          top: landmark.y * scale,
          width: landmark.w * scale,
          height: landmark.h * scale,
          transform: [{ rotate: `${landmark.rotation}deg` }],
        },
      ]}
      {...(editing && Platform.OS !== "web" ? drag.panHandlers : {})}
    >
      {editing && onSelect !== undefined ? (
        <Pressable
          onPress={() => onSelect(landmark.id)}
          accessibilityRole="button"
          accessibilityLabel={`${label}. Drag to move, or use the arrow buttons`}
          accessibilityState={{ selected }}
          style={styles.landmarkPress}
          testID={`floor-landmark-${landmark.id}`}
        >
          {inner}
        </Pressable>
      ) : (
        <View style={styles.landmarkPress} accessibilityLabel={label}>
          {inner}
        </View>
      )}
    </View>
  );
}

export function FloorMap({
  room,
  tables,
  selectedId,
  onSelect,
  editing = false,
  onMove,
  zoom = 1,
  width: fixedWidth,
  showSeats = true,
  testID,
}: FloorMapProps): React.ReactElement {
  const [measured, setMeasured] = useState(0);
  const onLayout = (event: LayoutChangeEvent): void => {
    if (fixedWidth !== undefined) return;
    const w = event.nativeEvent.layout.width;
    if (Math.abs(w - measured) > 0.5) setMeasured(w);
  };
  const base = fixedWidth ?? measured;
  const drawWidth = base * zoom;
  const scale = drawWidth / PLAN_WIDTH;
  const height = roomHeight(room.shape) * scale;
  const round = room.shape === "round";
  return (
    <View onLayout={onLayout} style={fixedWidth !== undefined ? { width: fixedWidth * zoom } : styles.measure} testID={testID}>
      {drawWidth > 0 ? (
        <View
          style={[styles.room, round ? styles.roomRound : null, { width: drawWidth, height }]}
          accessibilityLabel={editing ? "Floor plan, editing" : "Floor plan"}
        >
          {room.shape === "l_shape" ? (
            <View
              pointerEvents="none"
              style={[styles.lCut, { width: drawWidth * 0.42, height: height * 0.42 }]}
              accessibilityLabel="Not part of the room"
            />
          ) : null}
          {room.landmarks.map((l) => (
            <LandmarkNode
              key={l.id}
              landmark={l}
              scale={scale}
              selected={selectedId === l.id}
              editing={editing}
              onSelect={onSelect}
              onMove={onMove}
            />
          ))}
          {tables.map((t) => (
            <TableNode
              key={t.id}
              table={t}
              scale={scale}
              selected={selectedId === t.id}
              editing={editing}
              showSeats={showSeats}
              onSelect={onSelect}
              onMove={onMove}
            />
          ))}
        </View>
      ) : (
        <View style={{ height: 240 }} />
      )}
    </View>
  );
}

/** The legend: every state as a swatch AND a word. */
export function FloorLegend({ items }: { items: ReadonlyArray<{ tone: FloorTableTone; label: string }> }): React.ReactElement {
  return (
    <View style={styles.legend} accessibilityLabel={`Legend: ${items.map((i) => i.label).join(", ")}`}>
      {items.map((i) => (
        <View key={i.label} style={styles.legendItem}>
          <View style={[styles.legendSwatch, toneStyle(i.tone)]} />
          <Text style={styles.legendText}>{i.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  measure: { width: "100%" },
  room: {
    position: "relative",
    alignSelf: "flex-start",
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.inset,
    overflow: "visible",
  },
  roomRound: { borderRadius: radius.full },
  lCut: {
    position: "absolute",
    right: -2,
    top: -2,
    backgroundColor: color.canvas,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: color.lineStrong,
    borderBottomLeftRadius: radius.md,
  },
  landmark: {
    position: "absolute",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tile,
  },
  landmarkPress: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space[1] },
  landmarkText: { ...type.label, color: color.text2 },
  tableWrap: { position: "absolute" },
  seat: {
    position: "absolute",
    borderRadius: radius.full,
    backgroundColor: color.fill.handle,
  },
  seatDim: { opacity: 0.4 },
  table: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  shapeRound: { borderRadius: radius.full },
  shapeRect: { borderRadius: radius.sm },
  shapeBooth: { borderRadius: radius.md, borderTopWidth: 5 },
  shapeSofa: { borderRadius: radius.lg, borderBottomWidth: 5 },
  toneFree: { backgroundColor: color.fill.tile, borderColor: color.line },
  toneSeated: { backgroundColor: color.successTint, borderColor: color.success },
  toneBooked: { backgroundColor: color.infoTint, borderColor: color.info, borderWidth: 3 },
  tonePending: { backgroundColor: color.warningTint, borderColor: color.warning, borderStyle: "dashed" },
  toneFit: { backgroundColor: color.fill.tile, borderColor: color.textStrong, borderWidth: 2.5 },
  toneDim: { backgroundColor: color.fill.inset, borderColor: color.line, opacity: 0.55, borderStyle: "dotted" },
  selected: { borderColor: color.focus, borderWidth: 3 },
  tableName: { ...type.caption, color: color.text1, fontWeight: "700" },
  tableNameCompact: { fontSize: 10, lineHeight: 12 },
  tableWord: { ...type.label, color: color.text2, fontSize: 10, lineHeight: 12 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space[3], alignItems: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: space[1] },
  legendSwatch: { width: 16, height: 16, borderRadius: radius.xs, borderWidth: 1.5 },
  legendText: { ...type.caption, color: color.text2 },
});
