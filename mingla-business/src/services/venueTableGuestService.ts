/**
 * #4490 P5-3 — the guest's tables and waitlist reads/writes (anon; buying and
 * joining never need an account, and nothing here calls useAuth).
 *
 *  - `pg_venue_available_tables`: the table map for a time (free / taken /
 *    not pickable / doesn't fit), with each table's hold and minimum spend;
 *  - edge `venue-waitlist`: join (returns the private token once), get, leave;
 *  - the spaces' room shapes from the public page read.
 */
import { supabase } from "./supabase";

export type GuestTableStatus = "free" | "taken" | "not_pickable" | "not_fit";

export interface GuestTableOption {
  kind: "table" | "join";
  tableIds: string[];
  names: string[];
  spaceId: string | null;
  spaceName: string | null;
  capacity: number;
  shape: "round" | "rect" | "booth" | "sofa" | "high_top";
  planX: number | null;
  planY: number | null;
  planW: number | null;
  planH: number | null;
  rotation: number;
  status: GuestTableStatus;
  minSpendMinor: number;
  holdPerGuestMinor: number | null;
  holdMinor: number | null;
}

const SHAPES = ["round", "rect", "booth", "sofa", "high_top"] as const;
const STATUSES: readonly GuestTableStatus[] = ["free", "taken", "not_pickable", "not_fit"];
const n = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function mapGuestTableRow(raw: unknown): GuestTableOption | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ids = strs(r.table_ids);
  if (ids.length === 0) return null;
  const shape = SHAPES.find((s) => s === r.shape) ?? "rect";
  const status = STATUSES.find((s) => s === r.status) ?? "taken";
  return {
    kind: r.option_kind === "join" ? "join" : "table",
    tableIds: ids,
    names: strs(r.names),
    spaceId: typeof r.space_id === "string" ? r.space_id : null,
    spaceName: typeof r.space_name === "string" ? r.space_name : null,
    capacity: n(r.capacity) ?? 0,
    shape,
    planX: n(r.plan_x),
    planY: n(r.plan_y),
    planW: n(r.plan_w),
    planH: n(r.plan_h),
    rotation: n(r.plan_rotation) ?? 0,
    status,
    minSpendMinor: n(r.min_spend_minor) ?? 0,
    holdPerGuestMinor: n(r.hold_minor_per_guest),
    holdMinor: n(r.hold_minor),
  };
}

export async function fetchGuestTables(input: {
  venueId: string;
  date: string;
  partySize: number;
  slotStartUtc: string;
  spaceId: string | null;
}): Promise<GuestTableOption[]> {
  const { data, error } = await supabase.rpc("pg_venue_available_tables", {
    p_venue_id: input.venueId,
    p_date: input.date,
    p_party_size: input.partySize,
    p_slot_start: input.slotStartUtc,
    p_space_id: input.spaceId,
  });
  if (error !== null) throw new Error("tables_request_failed");
  return (Array.isArray(data) ? data : []).map(mapGuestTableRow).filter((o): o is GuestTableOption => o !== null);
}

/** Each space's raw `plan_shape` (its floor plan's room lives in `.room`). */
export async function fetchGuestSpacePlans(input: { brandSlug: string; venueSlug: string }): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("pg_public_venue_page", {
    p_brand_slug: input.brandSlug,
    p_venue_slug: input.venueSlug,
  });
  if (error !== null) throw new Error("page_request_failed");
  const out: Record<string, unknown> = {};
  const spaces = data !== null && typeof data === "object" && Array.isArray((data as { spaces?: unknown }).spaces)
    ? ((data as { spaces: unknown[] }).spaces)
    : [];
  for (const raw of spaces) {
    if (raw === null || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.id === "string") out[s.id] = s.planShape ?? null;
  }
  return out;
}

// ---------------------------------------------------------------- waitlist

export type GuestWaitlistStatus = "waiting" | "notified" | "seated" | "left" | "expired" | "lost";

export interface GuestWaitlistEntry {
  waitlistId: string;
  status: GuestWaitlistStatus;
  position: number | null;
  partySize: number;
  desiredDate: string | null;
  desiredFrom: string | null;
  desiredTo: string | null;
  quotedWaitMinutes: number | null;
  notifiedAt: string | null;
  offeredSlotAt: string | null;
  expiresAt: string | null;
  guestName: string | null;
  createdAt: string | null;
  venue: { id: string; name: string; slug: string | null; brandSlug: string | null; brandName: string | null; timezone: string | null };
  /** #4490 Explorer W1: the app claim link as the server sent it (parsed by the page). */
  claim: unknown;
}

export class GuestWaitlistError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "GuestWaitlistError";
    this.code = code;
  }
}

const WL_STATUSES: readonly GuestWaitlistStatus[] = ["waiting", "notified", "seated", "left", "expired", "lost"];
const s = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function mapGuestWaitlistEntry(raw: unknown): GuestWaitlistEntry | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = s(r.waitlistId);
  if (id === null) return null;
  const v = r.venue !== null && typeof r.venue === "object" ? (r.venue as Record<string, unknown>) : {};
  return {
    claim: r.claim ?? null,
    waitlistId: id,
    status: WL_STATUSES.find((x) => x === r.status) ?? "waiting",
    position: n(r.position),
    partySize: n(r.partySize) ?? 1,
    desiredDate: s(r.desiredDate),
    desiredFrom: s(r.desiredFrom),
    desiredTo: s(r.desiredTo),
    quotedWaitMinutes: n(r.quotedWaitMinutes),
    notifiedAt: s(r.notifiedAt),
    offeredSlotAt: s(r.offeredSlotAt),
    expiresAt: s(r.expiresAt),
    guestName: s(r.guestName),
    createdAt: s(r.createdAt),
    venue: {
      id: s(v.id) ?? "",
      name: s(v.name) ?? "the venue",
      slug: s(v.slug),
      brandSlug: s(v.brandSlug),
      brandName: s(v.brandName),
      timezone: s(v.timezone),
    },
  };
}

async function invokeWaitlist(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("venue-waitlist", { body });
  if (error) {
    const response = (error as { context?: unknown }).context as Response | undefined;
    if (response && typeof response.json === "function") {
      const parsed = (await response.json().catch(() => ({}))) as { code?: unknown };
      throw new GuestWaitlistError(typeof parsed.code === "string" ? parsed.code : "waitlist_request_failed");
    }
    throw new GuestWaitlistError("waitlist_request_failed");
  }
  if (data === null || typeof data !== "object" || (data as { kind?: unknown }).kind !== "success") {
    throw new GuestWaitlistError("waitlist_request_failed");
  }
  const payload = (data as { data?: unknown }).data;
  return payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

export async function joinGuestWaitlist(input: {
  venueId: string;
  partySize: number;
  date: string;
  from: string | null;
  to: string | null;
  guest: { name: string; email: string | null; phone: string | null; phoneCountryIso: string | null };
}): Promise<{ entry: GuestWaitlistEntry; token: string | null; visitPath: string | null }> {
  const data = await invokeWaitlist({
    action: "join",
    venueId: input.venueId,
    partySize: input.partySize,
    date: input.date,
    ...(input.from !== null && input.to !== null ? { from: input.from, to: input.to } : {}),
    guest: {
      name: input.guest.name,
      ...(input.guest.email !== null ? { email: input.guest.email } : {}),
      ...(input.guest.phone !== null ? { phone: input.guest.phone, phoneCountryIso: input.guest.phoneCountryIso } : {}),
    },
  });
  const entry = mapGuestWaitlistEntry(data);
  if (entry === null) throw new GuestWaitlistError("waitlist_request_failed");
  return { entry, token: s(data.token), visitPath: s(data.visitPath) };
}

export async function getGuestWaitlist(input: { waitlistId: string; token: string | null }): Promise<GuestWaitlistEntry> {
  const entry = mapGuestWaitlistEntry(
    await invokeWaitlist({ action: "get", waitlistId: input.waitlistId, ...(input.token !== null ? { token: input.token } : {}) }),
  );
  if (entry === null) throw new GuestWaitlistError("waitlist_not_found");
  return entry;
}

export async function leaveGuestWaitlist(input: { waitlistId: string; token: string | null }): Promise<GuestWaitlistEntry> {
  const entry = mapGuestWaitlistEntry(
    await invokeWaitlist({ action: "leave", waitlistId: input.waitlistId, ...(input.token !== null ? { token: input.token } : {}) }),
  );
  if (entry === null) throw new GuestWaitlistError("waitlist_not_found");
  return entry;
}
