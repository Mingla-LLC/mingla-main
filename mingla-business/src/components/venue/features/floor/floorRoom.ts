/**
 * #4490 P5-2 — the floor plan's room (shape, landmarks, plan units) and a
 * table's default size, as pure data. Split from floorModel.ts (which
 * re-exports it) so the guest's seat map (VenueFloorPick) never loads the
 * Host floor editor's model.
 */

export function normaliseRotation(deg: number): number {
  const r = Math.round(deg) % 360;
  return r < 0 ? r + 360 : r;
}

/** One decimal place (plan units). */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export const PLAN_WIDTH = 1000;

export type TableShape = "round" | "rect" | "booth" | "sofa" | "high_top";
export const TABLE_SHAPES: readonly TableShape[] = ["round", "rect", "booth", "sofa", "high_top"];

export const SHAPE_LABEL: Readonly<Record<TableShape, string>> = {
  round: "Round",
  rect: "Square",
  booth: "Booth",
  sofa: "Sofa",
  high_top: "High top",
};

export type RoomShape = "rect" | "wide" | "square" | "l_shape" | "round";
export const ROOM_SHAPES: ReadonlyArray<{ key: RoomShape; label: string }> = [
  { key: "rect", label: "Rectangle" },
  { key: "wide", label: "Long room" },
  { key: "square", label: "Square" },
  { key: "l_shape", label: "L-shape" },
  { key: "round", label: "Round" },
];

export type LandmarkKind = "bar" | "stage" | "door" | "kitchen" | "window" | "dance_floor";
export const LANDMARK_LABEL: Readonly<Record<LandmarkKind, string>> = {
  bar: "Bar",
  stage: "Stage",
  door: "Door",
  kitchen: "Kitchen",
  window: "Windows",
  dance_floor: "Dance floor",
};
export const LANDMARK_KINDS: readonly LandmarkKind[] = ["bar", "stage", "door", "kitchen", "window", "dance_floor"];

export interface PlanBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface Landmark extends PlanBox {
  id: string;
  kind: LandmarkKind;
}

export interface FloorRoom {
  shape: RoomShape;
  landmarks: Landmark[];
}

export const DEFAULT_ROOM: FloorRoom = { shape: "rect", landmarks: [] };

/** Width / height of the room. */
export function roomAspect(shape: RoomShape): number {
  switch (shape) {
    case "wide":
      return 16 / 9;
    case "square":
    case "round":
      return 1;
    case "l_shape":
    case "rect":
    default:
      return 4 / 3;
  }
}

/** Plan units tall (the width is always 1000). */
export function roomHeight(shape: RoomShape): number {
  return Math.round(PLAN_WIDTH / roomAspect(shape));
}

/** Read `plan_shape.room` defensively (anything unknown = the default room). */
export function parseRoom(planShape: unknown): FloorRoom {
  if (planShape === null || typeof planShape !== "object") return { ...DEFAULT_ROOM, landmarks: [] };
  const room = (planShape as Record<string, unknown>).room;
  if (room === null || typeof room !== "object") return { ...DEFAULT_ROOM, landmarks: [] };
  const r = room as Record<string, unknown>;
  const shape = ROOM_SHAPES.some((s) => s.key === r.shape) ? (r.shape as RoomShape) : "rect";
  const landmarks: Landmark[] = [];
  if (Array.isArray(r.landmarks)) {
    for (const raw of r.landmarks.slice(0, 12)) {
      if (raw === null || typeof raw !== "object") continue;
      const l = raw as Record<string, unknown>;
      const kind = LANDMARK_KINDS.includes(l.kind as LandmarkKind) ? (l.kind as LandmarkKind) : null;
      const box = boxFrom(l);
      if (kind === null || box === null) continue;
      landmarks.push({ id: typeof l.id === "string" && l.id.length > 0 ? l.id : `lm-${landmarks.length + 1}`, kind, ...box });
    }
  }
  return { shape, landmarks };
}

function boxFrom(v: Record<string, unknown>): PlanBox | null {
  const n = (k: string): number | null => (typeof v[k] === "number" && Number.isFinite(v[k] as number) ? (v[k] as number) : null);
  const x = n("x");
  const y = n("y");
  const w = n("w");
  const h = n("h");
  if (x === null || y === null || w === null || h === null) return null;
  return { x, y, w, h, rotation: normaliseRotation(n("rotation") ?? 0) };
}

/** The room as it is saved inside `plan_shape` (the site plan's keys are kept). */
export function roomPlanShape(existing: unknown, room: FloorRoom): Record<string, unknown> {
  const base =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  // The server's space check needs x / y / w / h numbers. A space that is not
  // on the site plan yet gets a zero-size box, which the site plan reads as
  // "not on the plan" (`mapPlanShape`), so its own arranging is untouched.
  for (const key of ["x", "y", "w", "h"] as const) {
    if (typeof base[key] !== "number") base[key] = 0;
  }
  base.room = {
    shape: room.shape,
    landmarks: room.landmarks.map((l) => ({
      id: l.id,
      kind: l.kind,
      x: round1(l.x),
      y: round1(l.y),
      w: round1(l.w),
      h: round1(l.h),
      rotation: l.rotation,
    })),
  };
  return base;
}

// ---------------------------------------------------------------- tables

/** The size a new table of this shape and seats starts at (plan units). */
export function defaultTableSize(shape: TableShape, seats: number): { w: number; h: number } {
  const s = Math.max(1, Math.min(100, seats));
  switch (shape) {
    case "round": {
      const d = Math.min(220, 60 + s * 10);
      return { w: d, h: d };
    }
    case "high_top": {
      const d = Math.min(120, 50 + s * 5);
      return { w: d, h: d };
    }
    case "booth":
      return { w: Math.min(320, 90 + s * 15), h: 80 };
    case "sofa":
      return { w: Math.min(360, 110 + s * 15), h: 90 };
    case "rect":
    default:
      return { w: Math.min(320, 60 + s * 15), h: s <= 2 ? 70 : 90 };
  }
}
