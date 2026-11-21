/**
 * #4490 P5-2 — tables in spaces and the floor plan (Host).
 *
 * Every write is a server RPC that checks who may manage tables
 * (`issue_4490_manage_table`, `issue_4490_save_floor_plan`,
 * `issue_4490_assign_table`); the read is `issue_4490_floor_plan`. Errors keep
 * the server's token for plain-word mapping (`floorErrorCopy`), never shown raw.
 */
import { randomId } from "../utils/randomId";
import { supabase } from "./supabase";

export type FloorTableShape = "round" | "rect" | "booth" | "sofa" | "high_top";
export type TableDepositMode = "venue_rule" | "per_guest" | "per_table" | "min_spend_share";

export class VenueFloorError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "VenueFloorError";
    this.code = code;
  }
}

export function toVenueFloorError(error: unknown): VenueFloorError {
  if (error instanceof VenueFloorError) return error;
  const obj = error !== null && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const raw = typeof obj.message === "string" ? obj.message : String(error ?? "");
  if (/failed to fetch|network/i.test(raw)) return new VenueFloorError("network");
  const code = (raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw).trim();
  return new VenueFloorError(code.length > 0 && code.length < 64 ? code : "unknown");
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const num = (v: unknown, fallback = 0): number => numOrNull(v) ?? fallback;

export interface VenueFloorTable {
  id: string;
  venueId: string;
  spaceId: string | null;
  name: string;
  capacity: number;
  minParty: number | null;
  maxParty: number | null;
  shape: FloorTableShape;
  planX: number | null;
  planY: number | null;
  planW: number | null;
  planH: number | null;
  rotation: number;
  combinable: boolean;
  accessible: boolean;
  guestPickable: boolean;
  minSpendMinor: number;
  depositMode: TableDepositMode;
  /** Kept for installed clients and per-guest display. Null in every other mode. */
  depositPerGuestMinor: number | null;
  depositFlatMinor: number | null;
  depositShareBps: number | null;
  reservationPolicy: "reservable" | "walk_in_only" | "approval_required";
  isActive: boolean;
  sortOrder: number;
  joinsWith: string[];
  now: FloorBooking | null;
  next: FloorBooking | null;
}

export interface FloorBooking {
  reservationId: string;
  guestName: string | null;
  partySize: number;
  reservedFor: string;
  status: string;
  minSpendMinor: number;
  joined: boolean;
  freeAround: string | null;
}

export interface FloorSpace {
  id: string;
  name: string;
  setting: string | null;
  /** The raw `plan_shape` (site-plan rectangle + `room`). */
  planShape: unknown;
  version: number;
  tables: VenueFloorTable[];
}

export interface FloorUnassigned {
  reservationId: string;
  guestName: string | null;
  partySize: number;
  reservedFor: string;
  status: string;
  version: number;
}

export interface VenueFloorPlan {
  venueId: string;
  at: string;
  localDate: string;
  timezone: string;
  features: { floorPlan: boolean; pickATable: boolean; minSpendTables: boolean };
  partyMax: number;
  spaces: FloorSpace[];
  unplaced: VenueFloorTable[];
  unassigned: FloorUnassigned[];
}

const SHAPES: readonly FloorTableShape[] = ["round", "rect", "booth", "sofa", "high_top"];

function mapBooking(v: unknown): FloorBooking | null {
  if (v === null || v === undefined) return null;
  const b = obj(v);
  const id = str(b.reservationId);
  if (id.length === 0) return null;
  return {
    reservationId: id,
    guestName: strOrNull(b.guestName),
    partySize: num(b.partySize, 1),
    reservedFor: str(b.reservedFor),
    status: str(b.status, "confirmed"),
    minSpendMinor: num(b.minSpendMinor),
    joined: b.joined === true,
    freeAround: strOrNull(b.freeAround),
  };
}

export function mapFloorTable(v: unknown): VenueFloorTable {
  const t = obj(v);
  const shape = str(t.shape, "rect");
  const policy = str(t.reservationPolicy, "reservable");
  const depositPerGuestMinor = numOrNull(t.depositPerGuestMinor);
  const rawDepositMode = str(t.depositMode);
  const depositMode: TableDepositMode =
    rawDepositMode === "per_guest" || rawDepositMode === "per_table" || rawDepositMode === "min_spend_share"
      ? rawDepositMode
      : depositPerGuestMinor !== null && depositPerGuestMinor > 0
        ? "per_guest"
        : "venue_rule";
  return {
    id: str(t.id),
    venueId: str(t.venueId),
    spaceId: strOrNull(t.spaceId),
    name: str(t.name),
    capacity: num(t.capacity, 2),
    minParty: numOrNull(t.minParty),
    maxParty: numOrNull(t.maxParty),
    shape: (SHAPES as readonly string[]).includes(shape) ? (shape as FloorTableShape) : "rect",
    planX: numOrNull(t.planX),
    planY: numOrNull(t.planY),
    planW: numOrNull(t.planW),
    planH: numOrNull(t.planH),
    rotation: num(t.rotation),
    combinable: t.combinable === true,
    accessible: t.accessible === true,
    guestPickable: t.guestPickable !== false,
    minSpendMinor: num(t.minSpendMinor),
    depositMode,
    depositPerGuestMinor,
    depositFlatMinor: numOrNull(t.depositFlatMinor),
    depositShareBps: numOrNull(t.depositShareBps),
    reservationPolicy:
      policy === "walk_in_only" || policy === "approval_required" ? policy : "reservable",
    isActive: t.isActive !== false,
    sortOrder: num(t.sortOrder),
    joinsWith: arr(t.joinsWith).filter((x): x is string => typeof x === "string"),
    now: mapBooking(t.now),
    next: mapBooking(t.next),
  };
}

export function mapFloorPlan(v: unknown): VenueFloorPlan {
  const p = obj(v);
  const f = obj(p.features);
  return {
    venueId: str(p.venueId),
    at: str(p.at),
    localDate: str(p.localDate),
    timezone: str(p.timezone, "UTC"),
    features: {
      floorPlan: f.floorPlan === true,
      pickATable: f.pickATable === true,
      minSpendTables: f.minSpendTables === true,
    },
    partyMax: num(p.partyMax),
    spaces: arr(p.spaces).map((raw) => {
      const s = obj(raw);
      return {
        id: str(s.id),
        name: str(s.name),
        setting: strOrNull(s.setting),
        planShape: s.planShape ?? null,
        version: num(s.version, 1),
        tables: arr(s.tables).map(mapFloorTable),
      };
    }),
    unplaced: arr(p.unplaced).map(mapFloorTable),
    unassigned: arr(p.unassigned).map((raw) => {
      const u = obj(raw);
      return {
        reservationId: str(u.reservationId),
        guestName: strOrNull(u.guestName),
        partySize: num(u.partySize, 1),
        reservedFor: str(u.reservedFor),
        status: str(u.status),
        version: num(u.version, 1),
      };
    }),
  };
}

export async function fetchVenueFloorPlan(venueId: string, at: string | null): Promise<VenueFloorPlan> {
  const { data, error } = await supabase.rpc("issue_4490_floor_plan", {
    p_venue_id: venueId,
    p_space_id: null,
    p_at: at,
  });
  if (error !== null) throw toVenueFloorError(error);
  return mapFloorPlan(data);
}

/** Fields the table form sends (all optional on update). */
export interface TableFields {
  name?: string;
  spaceId?: string;
  capacity?: number;
  minParty?: number | null;
  shape?: FloorTableShape;
  planX?: number | null;
  planY?: number | null;
  planW?: number | null;
  planH?: number | null;
  rotation?: number;
  combinable?: boolean;
  accessible?: boolean;
  guestPickable?: boolean;
  minSpendMinor?: number;
  depositMode?: TableDepositMode;
  depositPerGuestMinor?: number | null;
  depositFlatMinor?: number | null;
  depositShareBps?: number | null;
  reservationPolicy?: "reservable" | "walk_in_only" | "approval_required";
  joinsWith?: string[];
}

export async function manageVenueTable(input: {
  venueId: string;
  action: "create" | "update" | "archive";
  tableId?: string;
  fields?: TableFields;
}): Promise<VenueFloorTable | null> {
  const payload: Json = { ...(input.fields ?? {}) };
  if (input.tableId !== undefined) payload.tableId = input.tableId;
  const { data, error } = await supabase.rpc("issue_4490_manage_table", {
    p_action: input.action,
    p_venue_id: input.venueId,
    p_payload: payload,
    p_idempotency_key: `table-${input.action}-${randomId()}`,
  });
  if (error !== null) throw toVenueFloorError(error);
  return input.action === "archive" ? null : mapFloorTable(data);
}

export interface FloorPlaceWrite {
  tableId: string;
  planX: number;
  planY: number;
  planW: number;
  planH: number;
  rotation: number;
  shape: FloorTableShape;
}

export async function saveVenueFloorPlan(input: {
  venueId: string;
  spaceId: string;
  tables: FloorPlaceWrite[];
  /** The whole `plan_shape` to store (site-plan keys kept + `room`), or undefined to leave it. */
  planShape?: Record<string, unknown>;
  expectedVersion: number;
}): Promise<VenueFloorPlan> {
  const payload: Json = { tables: input.tables };
  if (input.planShape !== undefined) payload.planShape = input.planShape;
  const { data, error } = await supabase.rpc("issue_4490_save_floor_plan", {
    p_venue_id: input.venueId,
    p_space_id: input.spaceId,
    p_payload: payload,
    p_expected_version: input.expectedVersion,
    p_idempotency_key: `floor-${randomId()}`,
  });
  if (error !== null) throw toVenueFloorError(error);
  return mapFloorPlan(data);
}

export interface TableOption {
  kind: "table" | "join";
  tableIds: string[];
  names: string[];
  capacity: number;
  spaceId: string | null;
  free: boolean;
  minSpendMinor: number;
}

export interface TableSuggestions {
  bestFit: TableOption | null;
  orJoin: TableOption | null;
  options: TableOption[];
}

function mapOption(v: unknown): TableOption | null {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  const ids = arr(o.tableIds).filter((x): x is string => typeof x === "string");
  if (ids.length === 0) return null;
  return {
    kind: str(o.kind) === "join" ? "join" : "table",
    tableIds: ids,
    names: arr(o.names).filter((x): x is string => typeof x === "string"),
    capacity: num(o.capacity),
    spaceId: strOrNull(o.spaceId),
    free: o.free === true,
    minSpendMinor: num(o.minSpendMinor),
  };
}

export async function suggestTables(input: {
  venueId: string;
  reservedFor: string;
  partySize: number;
  reservationId: string | null;
}): Promise<TableSuggestions> {
  const { data, error } = await supabase.rpc("issue_4490_suggest_tables", {
    p_venue_id: input.venueId,
    p_reserved_for: input.reservedFor,
    p_party_size: input.partySize,
    p_space_id: null,
    p_reservation_id: input.reservationId,
  });
  if (error !== null) throw toVenueFloorError(error);
  const d = obj(data);
  return {
    bestFit: mapOption(d.bestFit),
    orJoin: mapOption(d.orJoin),
    options: arr(d.options).map(mapOption).filter((o): o is TableOption => o !== null),
  };
}

export async function assignTable(input: {
  reservationId: string;
  tableIds: string[];
  expectedVersion: number;
}): Promise<{ version: number }> {
  const { data, error } = await supabase.rpc("issue_4490_assign_table", {
    p_reservation_id: input.reservationId,
    p_table_ids: input.tableIds,
    p_expected_version: input.expectedVersion,
  });
  if (error !== null) throw toVenueFloorError(error);
  return { version: num(obj(data).version, input.expectedVersion + 1) };
}

/** The reservation's current version (the floor read has it only for bookings with no table). */
export async function fetchReservationVersion(reservationId: string): Promise<number> {
  const { data, error } = await supabase.from("reservations").select("version").eq("id", reservationId).maybeSingle();
  if (error !== null) throw toVenueFloorError(error);
  return num(obj(data).version, 1);
}
