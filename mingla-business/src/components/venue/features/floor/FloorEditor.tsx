/**
 * #4490 P5-2 — the floor plan editor for one space (`fl-edit`, `fl-empty`).
 *
 * Choose the room's shape, add landmarks (bar, stage, door…), put tables on
 * the floor and move them. Every move works three ways:
 *  - drag with a mouse or a finger;
 *  - keys on a computer (arrows move, Shift moves further, R rotates,
 *    + / - resize, Ctrl/Cmd+Z undoes, Esc lets go);
 *  - buttons (Up, Down, Left, Right, Rotate, Smaller, Bigger), so a phone or
 *    a screen reader never needs a drag.
 * Snap to grid is on by default. Undo keeps the last 50 steps. "Save layout"
 * sends only what moved, with the space's version: if someone else saved in
 * between, the host is told and can reload (nothing is overwritten).
 *
 * The table's own details (name, seats, money, joins) save on their own from
 * the table panel; the layout is saved with "Save layout".
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Platform, ScrollView as RNScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useTouchFloor } from "../../../../hooks/useTouchFloor";
import { useSaveVenueFloorPlan } from "../../../../hooks/useVenueTables";
import type { FloorSpace, VenueFloorTable } from "../../../../services/venueFloorService";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { Chip } from "../../../ui/Pill";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Sheet } from "../../../ui/Sheet";
import { ScrollView as SmartScrollView } from "../../../../wrappers/SmartScrollView";
import type { VenueModuleLeaveHandle } from "../../venueLeaveContract";
import { FloorMap, type FloorMapTable } from "./FloorMap";
import {
  changedPlaces,
  clampBox,
  defaultTableSize,
  floorErrorCopy,
  freeSpot,
  overlappingTables,
  LANDMARK_KINDS,
  LANDMARK_LABEL,
  moveBox,
  NUDGE_BIG_UNITS,
  NUDGE_UNITS,
  parseRoom,
  resizeBox,
  ROOM_SHAPES,
  roomPlanShape,
  rotateBy,
  sameRoom,
  seatsLine,
  SHAPE_LABEL,
  snap,
  undoPop,
  undoPush,
  undoReplace,
  undoStart,
  type FloorDraft,
  type Landmark,
  type LandmarkKind,
  type Placement,
  type PlanBox,
  type RoomShape,
  type UndoStack,
} from "./floorModel";
import { TableForm } from "./TableForm";
import { nextTableNameAfter } from "./tableDraft";

const WIDE = 1024;

const LANDMARK_SIZE: Readonly<Record<LandmarkKind, { w: number; h: number }>> = {
  bar: { w: 300, h: 60 },
  stage: { w: 260, h: 120 },
  door: { w: 120, h: 30 },
  kitchen: { w: 220, h: 140 },
  window: { w: 400, h: 24 },
  dance_floor: { w: 240, h: 240 },
};

export interface FloorEditorProps {
  brandId: string | null;
  venueId: string | null;
  space: FloorSpace;
  spaces: ReadonlyArray<{ id: string; name: string }>;
  allTables: readonly VenueFloorTable[];
  currency: string | null;
  features: { minSpendTables: boolean; pickATable: boolean; floorPlan: boolean; till?: boolean };
  canEdit: boolean;
  onOpenSettings?: () => void;
  onToast: (message: string) => void;
  onReload: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function placementsFrom(space: FloorSpace): Record<string, Placement> {
  const out: Record<string, Placement> = {};
  for (const t of space.tables) {
    if (t.planX === null || t.planY === null) continue;
    const size = defaultTableSize(t.shape, t.capacity);
    out[t.id] = {
      x: t.planX,
      y: t.planY,
      w: t.planW ?? size.w,
      h: t.planH ?? size.h,
      rotation: t.rotation,
      shape: t.shape,
    };
  }
  return out;
}

function draftFrom(space: FloorSpace): FloorDraft {
  return { room: parseRoom(space.planShape), places: placementsFrom(space) };
}

function isTyping(): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  if (el === null) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

export const FloorEditor = forwardRef<VenueModuleLeaveHandle, FloorEditorProps>(function FloorEditor(
  { brandId, venueId, space: floorSpace, spaces, allTables, currency, features, canEdit, onOpenSettings, onToast, onReload, onDirtyChange },
  ref,
): React.ReactElement {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const touch = useTouchFloor();
  const save = useSaveVenueFloorPlan(brandId, venueId);

  const saved = useMemo(() => draftFrom(floorSpace), [floorSpace]);
  const savedKey = JSON.stringify(saved);
  const [stack, setStack] = useState<UndoStack<FloorDraft>>(() => undoStart(saved));
  const draft = stack.present;
  const dirty = JSON.stringify(draft) !== savedKey;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // New server truth (after a save, or another host's change) replaces a clean draft.
  useEffect(() => {
    if (!dirtyRef.current) setStack(undoStart(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [formFor, setFormFor] = useState<{ tableId: string | null } | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const dragBase = useRef<FloorDraft | null>(null);

  const tables = floorSpace.tables;
  const byId = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const selectedTable = selectedId !== null ? (byId.get(selectedId) ?? null) : null;
  const selectedLandmark = selectedId !== null ? (draft.room.landmarks.find((l) => l.id === selectedId) ?? null) : null;
  const unplaced = tables.filter((t) => draft.places[t.id] === undefined);

  const commit = useCallback((next: FloorDraft): void => {
    setStack((s) => undoPush(s, next));
    setError(null);
  }, []);

  const updateBox = useCallback(
    (id: string, fn: (box: PlanBox) => PlanBox): void => {
      const place = draft.places[id];
      if (place !== undefined) {
        const box = fn(place);
        commit({ ...draft, places: { ...draft.places, [id]: { ...place, ...box } } });
        return;
      }
      const lm = draft.room.landmarks.find((l) => l.id === id);
      if (lm !== undefined) {
        const box = fn(lm);
        commit({ ...draft, room: { ...draft.room, landmarks: draft.room.landmarks.map((l) => (l.id === id ? { ...l, ...box } : l)) } });
      }
    },
    [commit, draft],
  );

  const nudge = useCallback(
    (dx: number, dy: number): void => {
      if (selectedId === null) return;
      updateBox(selectedId, (b) => moveBox(b, dx, dy, draft.room.shape, false));
    },
    [draft.room.shape, selectedId, updateBox],
  );
  const rotate = useCallback(
    (deg: number): void => {
      if (selectedId === null) return;
      updateBox(selectedId, (b) => rotateBy(b, deg));
    },
    [selectedId, updateBox],
  );
  const resize = useCallback(
    (factor: number): void => {
      if (selectedId === null) return;
      updateBox(selectedId, (b) => resizeBox(b, factor, draft.room.shape));
    },
    [draft.room.shape, selectedId, updateBox],
  );
  const undo = useCallback((): void => setStack((s) => undoPop(s)), []);

  const onMove = useCallback(
    (kind: "table" | "landmark", id: string, box: PlanBox, final: boolean): void => {
      if (!canEdit) return;
      const base = dragBase.current ?? draft;
      if (dragBase.current === null) dragBase.current = draft;
      const placed = final
        ? clampBox({ ...box, x: snap(box.x, snapOn), y: snap(box.y, snapOn) }, base.room.shape)
        : clampBox(box, base.room.shape);
      const apply = (d: FloorDraft): FloorDraft =>
        kind === "table"
          ? { ...d, places: { ...d.places, [id]: { ...(d.places[id] as Placement), ...placed } } }
          : { ...d, room: { ...d.room, landmarks: d.room.landmarks.map((l) => (l.id === id ? { ...l, ...placed } : l)) } };
      if (final) {
        const next = apply(base);
        dragBase.current = null;
        setStack((s) => undoPush({ past: s.past, present: base }, next));
      } else {
        setStack((s) => undoReplace(s, apply(s.present)));
      }
    },
    [canEdit, draft, snapOn],
  );

  // Keys (computer): arrows move, Shift further, R rotates, +/- resize, Ctrl/Cmd+Z undo, Esc lets go.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || !canEdit) return undefined;
    const handler = (e: KeyboardEvent): void => {
      if (isTyping()) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undo();
        return;
      }
      if (selectedId === null) return;
      const step = e.shiftKey ? NUDGE_BIG_UNITS : NUDGE_UNITS;
      const moves: Record<string, [number, number]> = {
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      };
      const m = moves[e.key];
      if (m !== undefined) {
        e.preventDefault();
        nudge(m[0], m[1]);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        rotate(e.shiftKey ? -15 : 15);
      } else if (e.key === "+" || e.key === "=") {
        resize(1.1);
      } else if (e.key === "-") {
        resize(0.9);
      } else if (e.key === "Escape") {
        setSelectedId(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [canEdit, nudge, resize, rotate, selectedId, undo]);

  const placeTable = (t: VenueFloorTable): void => {
    const size = defaultTableSize(t.shape, t.capacity);
    const occupied = [...Object.values(draft.places), ...draft.room.landmarks];
    const spot = freeSpot(occupied, size, draft.room.shape);
    commit({ ...draft, places: { ...draft.places, [t.id]: { ...spot, ...size, rotation: 0, shape: t.shape } } });
    setSelectedId(t.id);
  };
  const takeOff = (id: string): void => {
    const next = { ...draft.places };
    delete next[id];
    commit({ ...draft, places: next });
    setSelectedId(null);
  };
  const setRoomShape = (shape: RoomShape): void => {
    const room = { ...draft.room, shape };
    const places: Record<string, Placement> = {};
    for (const [id, p] of Object.entries(draft.places)) places[id] = { ...p, ...clampBox(p, shape) };
    commit({ room: { ...room, landmarks: room.landmarks.map((l) => ({ ...l, ...clampBox(l, shape) })) }, places });
  };
  const addLandmark = (kind: LandmarkKind): void => {
    const size = LANDMARK_SIZE[kind];
    const occupied = [...Object.values(draft.places), ...draft.room.landmarks];
    const spot = freeSpot(occupied, size, draft.room.shape);
    const id = `lm-${Date.now().toString(36)}`;
    const lm: Landmark = { id, kind, ...spot, ...size, rotation: 0 };
    commit({ ...draft, room: { ...draft.room, landmarks: [...draft.room.landmarks, lm].slice(0, 12) } });
    setSelectedId(id);
  };
  const removeLandmark = (id: string): void => {
    commit({ ...draft, room: { ...draft.room, landmarks: draft.room.landmarks.filter((l) => l.id !== id) } });
    setSelectedId(null);
  };

  // #4490 P5 follow-up — tables on top of each other are named and block saving.
  const overlaps = overlappingTables(draft.places);
  const overlapIds = new Set(overlaps.flat());
  const overlapWords = overlaps
    .slice(0, 3)
    .map(([a, b]) => `${byId.get(a)?.name ?? "A table"} and ${byId.get(b)?.name ?? "another"}`)
    .join("; ");

  const overlapCount = overlaps.length;
  useEffect(() => {
    // Once the tables are apart, the "move them apart" refusal goes away.
    if (overlapCount === 0) setError((e) => (e !== null && e.startsWith("Move ") ? null : e));
  }, [overlapCount]);

  const doSave = async (): Promise<void> => {
    if (!canEdit || save.isPending || !dirty) return;
    if (overlaps.length > 0) {
      setError(`Move ${overlapWords} apart before saving: guests and staff couldn't tell them apart.`);
      return;
    }
    setError(null);
    const writes = changedPlaces(saved.places, draft.places).map((w) => ({ ...w, shape: byId.get(w.tableId)?.shape ?? w.shape }));
    const roomChanged = !sameRoom(saved.room, draft.room);
    try {
      await save.mutateAsync({
        spaceId: floorSpace.id,
        tables: writes,
        ...(roomChanged ? { planShape: roomPlanShape(floorSpace.planShape, draft.room) } : {}),
        expectedVersion: floorSpace.version,
      });
      dirtyRef.current = false;
      onToast("Floor saved");
    } catch (e) {
      const code = (e as { code?: string }).code ?? "unknown";
      if (code === "stale_write") setStale(true);
      setError(floorErrorCopy(code));
      throw e;
    }
  };

  // Tables taken off the floor keep their old place on the server; the editor
  // only offers "Not on the floor" for tables that never had one (the server
  // has no "unplace"). So "Take off the floor" is shown only before a save.
  const savedPlaced = (id: string): boolean => saved.places[id] !== undefined;

  useImperativeHandle(
    ref,
    (): VenueModuleLeaveHandle => ({
      isDirty: () => dirtyRef.current || formDirty,
      changedLabels: () => [...(dirtyRef.current ? [`${floorSpace.name} floor`] : []), ...(formDirty ? ["Table details"] : [])],
      isValid: () => true,
      save: async () => {
        if (dirtyRef.current) await doSave();
      },
      discard: () => {
        setStack(undoStart(saved));
        setFormFor(null);
        setFormDirty(false);
      },
    }),
  );

  const mapTables: FloorMapTable[] = tables
    .filter((t) => draft.places[t.id] !== undefined)
    .map((t) => {
      const p = draft.places[t.id] as Placement;
      const extras = [
        t.minSpendMinor > 0 ? "minimum spend" : null,
        t.combinable ? "can be joined" : null,
        t.reservationPolicy === "walk_in_only" ? "walk-ins only" : null,
      ].filter(Boolean);
      return {
        id: t.id,
        name: t.name,
        shape: t.shape,
        box: p,
        seats: t.capacity,
        word: overlapIds.has(t.id) ? "Overlaps" : seatsLine(t.capacity, t.minParty),
        tone: overlapIds.has(t.id) ? "pending" : "plain",
        accessibilityLabel: `${t.name}, ${SHAPE_LABEL[t.shape]}, ${seatsLine(t.capacity, t.minParty)}${extras.length > 0 ? `, ${extras.join(", ")}` : ""}`,
      };
    });

  const moveBar =
    selectedId !== null && (selectedTable !== null ? draft.places[selectedId] !== undefined : selectedLandmark !== null) ? (
      <View style={styles.moveBar} testID="floor-move-bar">
        <Text style={styles.moveTitle} numberOfLines={1}>
          {selectedTable !== null ? selectedTable.name : selectedLandmark !== null ? LANDMARK_LABEL[selectedLandmark.kind] : ""}
        </Text>
        <View style={styles.moveRow}>
          <Button label="Left" variant="secondary" size="sm" onPress={() => nudge(-NUDGE_UNITS * 2, 0)} accessibilityLabel="Move left" testID="floor-move-left" />
          <Button label="Up" variant="secondary" size="sm" onPress={() => nudge(0, -NUDGE_UNITS * 2)} accessibilityLabel="Move up" testID="floor-move-up" />
          <Button label="Down" variant="secondary" size="sm" onPress={() => nudge(0, NUDGE_UNITS * 2)} accessibilityLabel="Move down" testID="floor-move-down" />
          <Button label="Right" variant="secondary" size="sm" onPress={() => nudge(NUDGE_UNITS * 2, 0)} accessibilityLabel="Move right" testID="floor-move-right" />
        </View>
        <View style={styles.moveRow}>
          <Button label="Rotate" variant="secondary" size="sm" onPress={() => rotate(45)} accessibilityLabel="Rotate 45 degrees" testID="floor-rotate" />
          <Button label="Smaller" variant="secondary" size="sm" onPress={() => resize(0.9)} testID="floor-smaller" />
          <Button label="Bigger" variant="secondary" size="sm" onPress={() => resize(1.1)} testID="floor-bigger" />
          {selectedLandmark !== null ? (
            <Button label="Remove" variant="ghost" size="sm" onPress={() => removeLandmark(selectedLandmark.id)} testID="floor-landmark-remove" />
          ) : selectedTable !== null && !savedPlaced(selectedTable.id) ? (
            <Button label="Take off the floor" variant="ghost" size="sm" onPress={() => takeOff(selectedTable.id)} testID="floor-take-off" />
          ) : null}
        </View>
        {Platform.OS === "web" && wide ? (
          <Text style={styles.hint}>Keys: arrows move (Shift moves further), R rotates, + and - resize, Ctrl+Z undoes.</Text>
        ) : null}
      </View>
    ) : (
      <Text style={styles.hint}>
        {tables.length === 0 ? "Add your first table." : "Pick a table on the floor or in the list to move it."}
      </Text>
    );

  const roomCard = (
    <View style={styles.card} testID="floor-room-card">
      <Text style={styles.cardTitle}>The room</Text>
      <View style={styles.chips} accessibilityLabel="Room shape">
        {ROOM_SHAPES.map((r) => (
          <Chip
            key={r.key}
            label={r.label}
            selected={draft.room.shape === r.key}
            onPress={canEdit ? () => setRoomShape(r.key) : undefined}
            style={touch > 0 ? { minHeight: touch } : undefined}
            testID={`floor-room-${r.key}`}
          />
        ))}
      </View>
      <Text style={styles.label}>Add to the room</Text>
      <View style={styles.chips}>
        {LANDMARK_KINDS.map((k) => (
          <Chip
            key={k}
            label={LANDMARK_LABEL[k]}
            onPress={canEdit ? () => addLandmark(k) : undefined}
            style={touch > 0 ? { minHeight: touch } : undefined}
            testID={`floor-add-${k}`}
          />
        ))}
      </View>
    </View>
  );

  const tableList = (
    <View style={styles.card} testID="floor-table-list">
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{`Tables in ${floorSpace.name}`}</Text>
        {canEdit ? (
          <Button label="Add a table" variant="secondary" size="sm" leadingIcon="plus" onPress={() => setFormFor({ tableId: null })} testID="floor-add-table" />
        ) : null}
      </View>
      {tables.length === 0 ? <Text style={styles.hint}>No tables here yet.</Text> : null}
      {tables.map((t) => {
        const on = draft.places[t.id] !== undefined;
        return (
          <View key={t.id} style={[styles.row, selectedId === t.id ? styles.rowOn : null]}>
            <View style={styles.rowText}>
              <Text style={styles.rowName} numberOfLines={1}>{t.name}</Text>
              <Text style={styles.hint} numberOfLines={2}>
                {[SHAPE_LABEL[t.shape], seatsLine(t.capacity, t.minParty), on ? "On the floor" : "Not on the floor yet"].join(" · ")}
              </Text>
            </View>
            {on ? (
              <Button label={selectedId === t.id ? "Selected" : "Select"} variant="secondary" size="sm" onPress={() => setSelectedId(t.id)} accessibilityLabel={`Select ${t.name} to move it`} testID={`floor-list-select-${t.id}`} />
            ) : canEdit ? (
              <Button label="Place" variant="secondary" size="sm" onPress={() => placeTable(t)} accessibilityLabel={`Place ${t.name} on the floor`} testID={`floor-list-place-${t.id}`} />
            ) : null}
            <Button label="Edit" variant="ghost" size="sm" onPress={() => setFormFor({ tableId: t.id })} accessibilityLabel={`Edit ${t.name}`} testID={`floor-list-edit-${t.id}`} />
          </View>
        );
      })}
    </View>
  );

  const formTable = formFor !== null && formFor.tableId !== null ? (byId.get(formFor.tableId) ?? null) : null;
  const form =
    formFor !== null ? (
      <TableForm
        brandId={brandId}
        venueId={venueId}
        table={formTable}
        spaces={spaces}
        allTables={allTables}
        defaultSpaceId={floorSpace.id}
        defaultName={nextTableNameAfter(allTables.map((t) => t.name), floorSpace.tables[floorSpace.tables.length - 1]?.name)}
        defaultLike={floorSpace.tables[floorSpace.tables.length - 1] ?? null}
        currency={currency}
        features={features}
        canEdit={canEdit}
        onOpenSettings={onOpenSettings}
        onDirtyChange={setFormDirty}
        onCancel={() => setFormFor(null)}
        onSaved={(t, message) => {
          setFormFor(null);
          setFormDirty(false);
          onToast(message);
          // A new table goes straight onto the floor (save the layout to keep it there).
          if (formFor.tableId === null && t !== null && t.spaceId === floorSpace.id) placeTable(t);
          if (t === null) setSelectedId(null);
        }}
        testID="floor-table-form"
      />
    ) : null;

  const toolbar = (
    <View style={styles.toolbar}>
      <Button label="Undo" variant="secondary" size="sm" onPress={undo} disabled={stack.past.length === 0} accessibilityLabel="Undo the last change" testID="floor-undo" />
      <Button
        label={snapOn ? "Snap: on" : "Snap: off"}
        variant="secondary"
        size="sm"
        onPress={() => setSnapOn((v) => !v)}
        accessibilityLabel={snapOn ? "Snap to grid is on. Turn it off" : "Snap to grid is off. Turn it on"}
        testID="floor-snap"
      />
      <Button
        label={zoom === 1 ? "Zoom in" : "Zoom out"}
        variant="secondary"
        size="sm"
        onPress={() => setZoom((z) => (z === 1 ? 2 : 1))}
        testID="floor-zoom"
      />
      <View style={styles.grow} />
      {dirty ? <Text style={styles.unsaved}>Unsaved layout</Text> : null}
      {dirty ? (
        <Button label="Discard" variant="ghost" size="sm" onPress={() => setStack(undoStart(saved))} testID="floor-discard" />
      ) : null}
      {canEdit ? (
        <Button
          label="Save layout"
          variant="primary"
          size="sm"
          onPress={() => void doSave().catch(() => undefined)}
          loading={save.isPending}
          disabled={!dirty || save.isPending}
          testID="floor-save"
        />
      ) : null}
    </View>
  );

  const map = (
    <View style={styles.mapWrap}>
      {zoom > 1 ? (
        <RNScrollView horizontal style={styles.zoomScroll} contentContainerStyle={styles.zoomContent} testID="floor-zoom-scroll">
          <FloorMap
            room={draft.room}
            tables={mapTables}
            selectedId={selectedId}
            onSelect={setSelectedId}
            editing={canEdit}
            onMove={onMove}
            width={Math.max(280, (wide ? width - 720 : width - 48))}
            zoom={zoom}
            testID="floor-map-edit"
          />
        </RNScrollView>
      ) : (
        <FloorMap
          room={draft.room}
          tables={mapTables}
          selectedId={selectedId}
          onSelect={setSelectedId}
          editing={canEdit}
          onMove={onMove}
          testID="floor-map-edit"
        />
      )}
    </View>
  );

  const notices = (
    <>
      {stale ? (
        <Banner
          tone="warning"
          title="Someone else changed this floor"
          body="Reload to see their layout. Your unsaved moves will be dropped."
          action={{
            label: "Reload",
            onPress: () => {
              setStale(false);
              setError(null);
              setStack(undoStart(saved));
              dirtyRef.current = false;
              onReload();
            },
            testID: "floor-reload",
          }}
          testID="floor-stale"
        />
      ) : error !== null ? (
        <Text style={styles.error} accessibilityRole="alert" testID="floor-error">{error}</Text>
      ) : null}
      {overlaps.length > 0 && canEdit ? (
        <Banner
          tone="warning"
          title={overlaps.length === 1 ? "Two tables overlap" : `${overlaps.length} pairs of tables overlap`}
          body={`${overlapWords}${overlaps.length > 3 ? " and more" : ""}. Drag one of each pair to a clear spot, then save.`}
          testID="floor-overlap"
        />
      ) : null}
      {unplaced.length > 0 && canEdit ? (
        <Banner
          tone="info"
          title={`${unplaced.length} ${unplaced.length === 1 ? "table isn't" : "tables aren't"} on the floor yet`}
          body={unplaced.map((t) => t.name).join(", ")}
          action={{ label: "Place them", onPress: () => {
            let d = draft;
            for (const t of unplaced) {
              const size = defaultTableSize(t.shape, t.capacity);
              const spot = freeSpot([...Object.values(d.places), ...d.room.landmarks], size, d.room.shape);
              d = { ...d, places: { ...d.places, [t.id]: { ...spot, ...size, rotation: 0, shape: t.shape } } };
            }
            commit(d);
          }, testID: "floor-place-all" }}
          testID="floor-unplaced"
        />
      ) : null}
    </>
  );

  if (wide) {
    return (
      <View style={styles.host} testID="floor-editor">
        {toolbar}
        {notices}
        <View style={styles.twoCol}>
          <View style={styles.mapCol}>
            {map}
            {moveBar}
          </View>
          <View style={styles.sideCol}>
            {form !== null ? <View style={styles.card}>{form}</View> : null}
            {roomCard}
            {tableList}
          </View>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.host} testID="floor-editor">
      {toolbar}
      {notices}
      {map}
      {moveBar}
      {tableList}
      {roomCard}
      <Sheet
        visible={formFor !== null}
        onClose={() => setFormFor(null)}
        snapPoint={0.9}
        dismissGuard={() => formDirty}
        onRequestClose={() => setFormFor(null)}
        testID="floor-table-sheet"
      >
        <View style={styles.sheetBody}>
          <PickerSheetHead title={formTable !== null ? formTable.name : "Add a table"} onClose={() => setFormFor(null)} testID="floor-table-sheet-head" />
          <SmartScrollView style={styles.sheetScrollBox} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
            {form}
          </SmartScrollView>
        </View>
      </Sheet>
    </View>
  );
});

const styles = StyleSheet.create({
  host: { gap: space[4] },
  toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  grow: { flexGrow: 1 },
  unsaved: { ...type.caption, color: color.warningText },
  twoCol: { flexDirection: "row", alignItems: "flex-start", gap: space[5] },
  mapCol: { flex: 1, minWidth: 0, gap: space[3] },
  sideCol: { width: 340, gap: space[4] },
  mapWrap: { width: "100%" },
  zoomScroll: { width: "100%" },
  zoomContent: { paddingBottom: space[3], paddingRight: space[3] },
  card: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space[2], justifyContent: "space-between", flexWrap: "wrap" },
  cardTitle: { ...type.row, color: color.text1 },
  label: { ...type.label, color: color.text2 },
  hint: { ...type.caption, color: color.text2 },
  error: { ...type.small, color: color.errorText },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  row: { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 48, paddingVertical: space[1], borderRadius: radius.sm },
  rowOn: { backgroundColor: color.fill.railOn, paddingHorizontal: space[2] },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { ...type.row, color: color.text1 },
  moveBar: { gap: space[2], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.fill.tile },
  moveTitle: { ...type.row, color: color.text1 },
  moveRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  sheetBody: { flex: 1, paddingHorizontal: space[4] },
  sheetScrollBox: { flex: 1 },
  sheetScroll: { gap: space[3], paddingBottom: space[8] },
});
