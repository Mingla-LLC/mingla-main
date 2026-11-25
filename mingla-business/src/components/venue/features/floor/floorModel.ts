/**
 * #4490 P5-2 — the floor plan, as pure data (no React, no services).
 *
 * A space's floor is a room drawn in plan units: 1000 units wide, and
 * `1000 / aspect` units tall (a wide room is shorter). Tables and landmarks
 * (bar, stage, door…) sit in the same units, so a round table stays round in
 * any room. The server stores table places in `venue_tables.plan_x/plan_y/
 * plan_w/plan_h/plan_rotation` (0..1000) and the room in the space's
 * `plan_shape.room` (the site plan's x/y/w/h live beside it and are kept).
 *
 * Every function here is unit-tested: snapping, nudging, rotating, keeping a
 * table inside the room, undo, the state word on each table, and the plain
 * words for every server refusal.
 */

// #4490 — the room, its landmarks and a table's default size live in
// floorRoom.ts (the guest seat map loads only that); re-exported here.
export * from "./floorRoom";
import {
  PLAN_WIDTH,
  type TableShape,
  type RoomShape,
  type PlanBox,
  type FloorRoom,
  roomHeight,
  normaliseRotation,
  round1,
} from "./floorRoom";


export function rotateBy(box: PlanBox, delta: number): PlanBox {
  return { ...box, rotation: normaliseRotation(box.rotation + delta) };
}

export const SNAP_UNITS = 20;
export const NUDGE_UNITS = 10;
export const NUDGE_BIG_UNITS = 50;

export function snap(value: number, on: boolean, grid = SNAP_UNITS): number {
  return on ? Math.round(value / grid) * grid : value;
}


/** Keep a box inside the room (its top-left corner moves; size stays). */
export function clampBox(box: PlanBox, roomShape: RoomShape): PlanBox {
  const height = roomHeight(roomShape);
  const w = Math.max(20, Math.min(PLAN_WIDTH, box.w));
  const h = Math.max(20, Math.min(height, box.h));
  return {
    ...box,
    w,
    h,
    x: round1(Math.max(0, Math.min(PLAN_WIDTH - w, box.x))),
    y: round1(Math.max(0, Math.min(height - h, box.y))),
  };
}

export function moveBox(box: PlanBox, dx: number, dy: number, roomShape: RoomShape, snapOn: boolean): PlanBox {
  return clampBox({ ...box, x: snap(box.x + dx, snapOn), y: snap(box.y + dy, snapOn) }, roomShape);
}

export function resizeBox(box: PlanBox, factor: number, roomShape: RoomShape): PlanBox {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const w = Math.max(30, Math.min(400, box.w * factor));
  const h = Math.max(30, Math.min(400, box.h * factor));
  return clampBox({ ...box, w: round1(w), h: round1(h), x: cx - w / 2, y: cy - h / 2 }, roomShape);
}

/**
 * Where to put a table that is not on the floor yet: the first free spot on a
 * 120-unit grid, left to right, top to bottom; the room centre when full.
 */
export function freeSpot(occupied: readonly PlanBox[], size: { w: number; h: number }, roomShape: RoomShape): { x: number; y: number } {
  const height = roomHeight(roomShape);
  const step = 120;
  for (let y = 40; y + size.h <= height - 20; y += step) {
    for (let x = 40; x + size.w <= PLAN_WIDTH - 20; x += step) {
      const hit = occupied.some(
        (o) => x < o.x + o.w + 10 && x + size.w + 10 > o.x && y < o.y + o.h + 10 && y + size.h + 10 > o.y,
      );
      if (!hit) return { x, y };
    }
  }
  return { x: Math.round((PLAN_WIDTH - size.w) / 2), y: Math.round((height - size.h) / 2) };
}

/** Seat dots around a table (plan units, centres). Nothing for very big tables. */
export function seatDots(shape: TableShape, box: Pick<PlanBox, "w" | "h">, seats: number): Array<{ x: number; y: number }> {
  const n = Math.max(0, Math.min(16, seats));
  if (n === 0) return [];
  const gap = 14;
  if (shape === "round" || shape === "high_top") {
    const r = box.w / 2 + gap;
    return Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2 - Math.PI / 2;
      return { x: box.w / 2 + Math.cos(a) * r, y: box.h / 2 + Math.sin(a) * r };
    });
  }
  if (shape === "booth" || shape === "sofa") {
    // One long side (the sofa back is the other).
    return Array.from({ length: n }, (_, k) => ({ x: ((k + 0.5) * box.w) / n, y: box.h + gap }));
  }
  const top = Math.ceil(n / 2);
  const bottom = n - top;
  return [
    ...Array.from({ length: top }, (_, k) => ({ x: ((k + 0.5) * box.w) / top, y: -gap })),
    ...Array.from({ length: bottom }, (_, k) => ({ x: ((k + 0.5) * box.w) / bottom, y: box.h + gap })),
  ];
}

// ---------------------------------------------------------------- editor state

/** One table's place on the floor (null = not on the floor yet). */
export type Placement = PlanBox & { shape: TableShape };

export interface FloorDraft {
  room: FloorRoom;
  /** tableId → its place. A table missing here is "not on the floor yet". */
  places: Record<string, Placement>;
}

export interface UndoStack<T> {
  past: T[];
  present: T;
}

export const UNDO_LIMIT = 50;

export function undoStart<T>(present: T): UndoStack<T> {
  return { past: [], present };
}

export function undoPush<T>(stack: UndoStack<T>, next: T): UndoStack<T> {
  if (JSON.stringify(next) === JSON.stringify(stack.present)) return stack;
  const past = [...stack.past, stack.present];
  return { past: past.length > UNDO_LIMIT ? past.slice(past.length - UNDO_LIMIT) : past, present: next };
}

/** Replace the present without a history step (a drag in progress). */
export function undoReplace<T>(stack: UndoStack<T>, next: T): UndoStack<T> {
  return { past: stack.past, present: next };
}

export function undoPop<T>(stack: UndoStack<T>): UndoStack<T> {
  if (stack.past.length === 0) return stack;
  return { past: stack.past.slice(0, -1), present: stack.past[stack.past.length - 1] as T };
}

/** The tables whose place changed (what a Save sends). */
export function changedPlaces(
  saved: Readonly<Record<string, Placement>>,
  draft: Readonly<Record<string, Placement>>,
): Array<{ tableId: string; planX: number; planY: number; planW: number; planH: number; rotation: number; shape: TableShape }> {
  const out: Array<{ tableId: string; planX: number; planY: number; planW: number; planH: number; rotation: number; shape: TableShape }> = [];
  for (const [tableId, p] of Object.entries(draft)) {
    const s = saved[tableId];
    if (
      s !== undefined &&
      s.x === p.x &&
      s.y === p.y &&
      s.w === p.w &&
      s.h === p.h &&
      s.rotation === p.rotation &&
      s.shape === p.shape
    ) {
      continue;
    }
    out.push({
      tableId,
      planX: round1(Math.max(0, Math.min(1000, p.x))),
      planY: round1(Math.max(0, Math.min(1000, p.y))),
      planW: round1(Math.max(1, Math.min(1000, p.w))),
      planH: round1(Math.max(1, Math.min(1000, p.h))),
      rotation: normaliseRotation(p.rotation),
      shape: p.shape,
    });
  }
  return out;
}

/** The box a table really covers once rotated (axis-aligned bounds). */
export function coveredBounds(p: PlanBox): { left: number; top: number; right: number; bottom: number } {
  const rad = (normaliseRotation(p.rotation) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = p.w * cos + p.h * sin;
  const h = p.w * sin + p.h * cos;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 };
}

/**
 * #4490 P5 follow-up — tables drawn on top of each other. Two tables overlap
 * when their covered areas cross by more than `tolerance` plan units each
 * way (touching edges are fine: booths stand back to back). Pairs come back
 * in a stable order; the editor names them and won't save until they part.
 */
export function overlappingTables(
  places: Readonly<Record<string, PlanBox>>,
  tolerance = 2,
): Array<[string, string]> {
  const ids = Object.keys(places).sort();
  const out: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i += 1) {
    const a = coveredBounds(places[ids[i] as string] as PlanBox);
    for (let j = i + 1; j < ids.length; j += 1) {
      const b = coveredBounds(places[ids[j] as string] as PlanBox);
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapX > tolerance && overlapY > tolerance) out.push([ids[i] as string, ids[j] as string]);
    }
  }
  return out;
}

export function sameRoom(a: FloorRoom, b: FloorRoom): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------- live service

export type LiveTableState = "free" | "booked" | "seated" | "not_confirmed" | "next";

export interface LiveTableFacts {
  now: { status: string; guestName: string | null; partySize: number; freeAround: string | null } | null;
  next: { status: string; reservedFor: string } | null;
}

/** The state of one table at the floor's moment (always shown as a word). */
export function liveTableState(facts: LiveTableFacts): LiveTableState {
  if (facts.now !== null) {
    if (facts.now.status === "seated") return "seated";
    if (facts.now.status === "requested") return "not_confirmed";
    return "booked";
  }
  if (facts.next !== null) return "next";
  return "free";
}

export const LIVE_STATE_WORD: Readonly<Record<LiveTableState, string>> = {
  free: "Free",
  booked: "Booked",
  seated: "Seated",
  not_confirmed: "Not confirmed",
  next: "Free now",
};

/** "Seated · Kunle A. · 5" / "Free · next 20:30" / "Free". */
export function liveTableLine(facts: LiveTableFacts, clock: (iso: string) => string): string {
  const state = liveTableState(facts);
  if (facts.now !== null) {
    const who = facts.now.guestName !== null && facts.now.guestName.trim().length > 0 ? facts.now.guestName.trim() : "Guest";
    return `${LIVE_STATE_WORD[state]} · ${who} · ${facts.now.partySize}`;
  }
  if (facts.next !== null) return `Free · next ${clock(facts.next.reservedFor)}`;
  return "Free";
}

// ---------------------------------------------------------------- copy

/** Plain words for every table / floor refusal (never a raw code). */
export function floorErrorCopy(code: string): string {
  switch (code) {
    case "not_authorized":
    case "forbidden":
      return "You don't have permission to change tables here. Ask a brand owner or admin.";
    case "table_name_required":
      return "Give the table a name, up to 60 characters.";
    case "table_capacity_invalid":
      return "A table seats 1 to 100.";
    case "table_min_party_invalid":
      return "The smallest party can't be more than the seats.";
    case "table_space_invalid":
      return "Pick a space for this table. That space may have been removed.";
    case "table_shape_invalid":
      return "Pick a shape for the table.";
    case "table_plan_invalid":
      return "A table is outside the room. Move it back inside and save again.";
    case "table_min_spend_invalid":
      return "Enter the minimum spend as an amount.";
    case "min_spend_tables_off":
      return "Turn on Minimum-spend tables in Settings first, then set a minimum spend.";
    case "table_hold_invalid":
      return "Enter an amount above zero for this deposit.";
    case "table_deposit_mode_invalid":
      return "Pick how guests pay the deposit for this table.";
    case "table_deposit_needs_min_spend":
      return "Set a minimum spend first.";
    case "table_deposit_needs_min_spend_tables":
      return "Turn on Minimum-spend tables in Settings first.";
    case "table_deposit_uses_min_spend":
      return "1 table takes a share of the minimum spend as a deposit. Change its deposit first.";
    case "table_join_invalid":
      return "Only tables in the same space that can be joined can be paired.";
    case "table_not_found":
      return "That table was removed. We've loaded the latest.";
    case "space_not_found":
      return "That space was removed. We've loaded the latest.";
    case "stale_write":
      return "Someone else changed this floor a moment ago. Reload to see their changes, then try again.";
    case "table_taken":
      return "That table is taken at that time. Pick another.";
    case "table_not_fit":
      return "That table doesn't fit this party. Pick a bigger table or join two.";
    case "reservation_not_active":
      return "That booking is no longer active.";
    case "invalid_payload":
      return "Something in the form isn't right. Check it and try again.";
    case "network":
      return "You're offline or the connection dropped. Your changes are still here, so try again.";
    default:
      return "Couldn't save. Your changes are still here, so try again.";
  }
}

/** "4 seats", "1 seat", "4 to 6 guests". */
export function seatsLine(capacity: number, minParty: number | null): string {
  if (minParty !== null && minParty > 1 && minParty < capacity) return `${minParty} to ${capacity} guests`;
  return `${capacity} ${capacity === 1 ? "seat" : "seats"}`;
}

/** Table names joined for a pair: "B1 + B2". */
export function pairName(names: readonly string[]): string {
  return names.join(" + ");
}
