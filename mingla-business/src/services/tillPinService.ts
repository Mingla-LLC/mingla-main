/**
 * #4490 spec 08 O5 part A — Till PINs (edge function `venue-till`): the PIN
 * staff list, a member's own PIN and a manager's reset. Split from
 * venueTillService so the Team page and the device sign-out check load only
 * this, not the Till: TillError and the one-shot call live here too.
 */
import { supabase } from "./supabase";
import type { TillPinPerson } from "../components/venue/till/pinModel";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export class TillError extends Error {
  readonly code: string;
  readonly item: string | null;
  readonly remainingMinor: number | null;
  /** 08-O4 (T13): who has the unit next and when (offer_space_taken). */
  readonly unitName: string | null;
  readonly nextAt: string | null;
  /** 08-O4 fix 1 (O4-T4): when the unit in use frees up (offer_space_taken). */
  readonly freeAt: string | null;
  /** #4490 O5: a wrong PIN's tries left, a lock's end. */
  triesLeft: number | null = null;
  lockedUntil: string | null = null;
  /** #4490 O5 part C: item_sold_out: units still left of that item. */
  stockLeft: number | null = null;
  constructor(
    code: string,
    item: string | null = null,
    remainingMinor: number | null = null,
    next: { unitName: string | null; nextAt: string | null; freeAt?: string | null } | null = null,
  ) {
    super(code);
    this.name = "TillError";
    this.code = code;
    this.item = item;
    this.remainingMinor = remainingMinor;
    this.unitName = next?.unitName ?? null;
    this.nextAt = next?.nextAt ?? null;
    this.freeAt = next?.freeAt ?? null;
  }
}

async function tillError(error: { message?: string; context?: unknown }): Promise<TillError> {
  const context = error.context;
  if (context !== null && context !== undefined && typeof (context as Response).json === "function") {
    try {
      const body = obj(await (context as Response).json());
      if (typeof body.code === "string" && body.code.length > 0) {
        // #4490 O5 part C: item_sold_out names the item (itemName) and what is left.
        const e = new TillError(body.code, strOrNull(body.item) ?? strOrNull(body.itemName), numOrNull(body.remainingMinor),
          { unitName: strOrNull(body.unitName), nextAt: strOrNull(body.nextAt), freeAt: strOrNull(body.freeAt) });
        e.triesLeft = numOrNull(body.triesLeft);
        e.lockedUntil = strOrNull(body.lockedUntil);
        e.stockLeft = numOrNull(body.left);
        return e;
      }
    } catch {
      // An unreadable body falls through to the network mapping below.
    }
  }
  const raw = error.message ?? "";
  return new TillError(/failed to fetch|network|load failed/i.test(raw) ? "network" : "till_failed");
}

export async function tillOnce<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("venue-till", { body });
  if (error) throw await tillError(error as { message?: string; context?: unknown });
  const envelope = obj(data);
  if (envelope.kind !== "success") throw new TillError(str(envelope.code, "till_failed"));
  return envelope.data as T;
}

export interface TillPinStaff {
  /** True only on a Till device login at this venue (the Till released there). */
  gated: boolean;
  venueName: string | null;
  autoLockMinutes: number;
  people: TillPinPerson[];
  /** False: nobody who may manage the venue has a PIN (sign out by email code). */
  managerHasPin: boolean;
}

export function mapTillPinStaff(v: unknown): TillPinStaff {
  const r = obj(v);
  return {
    gated: r.gated === true,
    venueName: strOrNull(r.venueName),
    autoLockMinutes: num(r.autoLockMinutes, 2),
    people: arr(r.staff).map((p) => {
      const x = obj(p);
      return {
        memberId: str(x.memberId),
        name: str(x.name, "Team member"),
        isMinglaTeam: x.isMinglaTeam === true,
        role: str(x.role),
        profile: strOrNull(x.profile),
        canSell: x.canSell === true,
        canApprove: x.canApprove === true,
        canManage: x.canManage === true,
      };
    }).filter((p) => p.memberId.length > 0),
    managerHasPin: r.managerHasPin === true,
  };
}

export async function fetchTillPinStaff(venueId: string): Promise<TillPinStaff> {
  return mapTillPinStaff(await tillOnce<unknown>({ action: "pin_staff", venueId }));
}

export interface TillPinStatus {
  memberId: string;
  tillDevice: boolean;
  hasPin: boolean;
  setAt: string | null;
  hardLocked: boolean;
  lockedUntil: string | null;
}

export function mapTillPinStatus(v: unknown): TillPinStatus {
  const r = obj(v);
  return {
    memberId: str(r.memberId),
    tillDevice: r.tillDevice === true,
    hasPin: r.hasPin === true,
    setAt: strOrNull(r.setAt),
    hardLocked: r.hardLocked === true,
    lockedUntil: strOrNull(r.lockedUntil),
  };
}

/** The signed-in member's own PIN for a brand (Team > Till PIN). */
export async function fetchMyTillPin(brandId: string): Promise<TillPinStatus> {
  return mapTillPinStatus(await tillOnce<unknown>({ action: "pin_status", brandId }));
}

export async function setMyTillPin(input: { brandId: string; pin: string }): Promise<void> {
  await tillOnce<unknown>({ action: "pin_set", ...input });
}

export interface TillPinMember {
  memberId: string;
  userId: string;
  hasPin: boolean;
  setAt: string | null;
  hardLocked: boolean;
  lockedUntil: string | null;
}

/** PIN state of the members the signed-in manager may reset. */
export async function fetchTeamTillPins(brandId: string): Promise<TillPinMember[]> {
  const data = obj(await tillOnce<unknown>({ action: "pin_team", brandId }));
  return arr(data.members).map((m) => {
    const x = obj(m);
    return {
      memberId: str(x.memberId),
      userId: str(x.userId),
      hasPin: x.hasPin === true,
      setAt: strOrNull(x.setAt),
      hardLocked: x.hardLocked === true,
      lockedUntil: strOrNull(x.lockedUntil),
    };
  });
}

export async function resetTillPin(memberId: string): Promise<void> {
  await tillOnce<unknown>({ action: "pin_reset", memberId });
}
