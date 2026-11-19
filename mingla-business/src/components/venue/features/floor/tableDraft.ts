/**
 * #4490 P5-2 — the table form as pure data: the draft, its checks in plain
 * words and the payload `issue_4490_manage_table` takes (only changed fields
 * on an update). Unit-tested.
 */
import type { TableFields, VenueFloorTable } from "../../../../services/venueFloorService";
import type { TableShape } from "./floorModel";

export interface TableDraft {
  name: string;
  spaceId: string | null;
  shape: TableShape;
  capacity: number;
  /** 1 = any party. */
  minParty: number;
  minSpendMinor: number | null;
  holdOn: boolean;
  holdPerGuestMinor: number | null;
  guestPickable: boolean;
  combinable: boolean;
  joinsWith: string[];
  accessible: boolean;
  walkInOnly: boolean;
}

export function tableDraftFrom(
  table: VenueFloorTable | null,
  defaults: { spaceId: string | null; name?: string; like?: Pick<VenueFloorTable, "shape" | "capacity"> | null },
): TableDraft {
  if (table === null) {
    return {
      name: defaults.name ?? "",
      spaceId: defaults.spaceId,
      // #4490 N24: a new table copies the last one's shape and seats.
      shape: defaults.like?.shape ?? "round",
      capacity: defaults.like?.capacity ?? 4,
      minParty: 1,
      minSpendMinor: null,
      holdOn: false,
      holdPerGuestMinor: null,
      guestPickable: true,
      combinable: false,
      joinsWith: [],
      accessible: false,
      walkInOnly: false,
    };
  }
  return {
    name: table.name,
    spaceId: table.spaceId,
    shape: table.shape,
    capacity: table.capacity,
    minParty: table.minParty ?? 1,
    minSpendMinor: table.minSpendMinor > 0 ? table.minSpendMinor : null,
    holdOn: table.depositPerGuestMinor !== null && table.depositPerGuestMinor > 0,
    holdPerGuestMinor: table.depositPerGuestMinor,
    guestPickable: table.guestPickable,
    combinable: table.combinable,
    joinsWith: [...table.joinsWith],
    accessible: table.accessible,
    walkInOnly: table.reservationPolicy === "walk_in_only",
  };
}

export interface TableDraftIssues {
  name: string | null;
  space: string | null;
  minParty: string | null;
  hold: string | null;
}

export function tableDraftIssues(d: TableDraft): TableDraftIssues {
  const name = d.name.trim();
  return {
    name: name.length === 0 ? "Give the table a name." : name.length > 60 ? "Keep the name to 60 characters." : null,
    space: d.spaceId === null ? "Pick the space this table is in." : null,
    minParty: d.minParty > d.capacity ? "The smallest party can't be more than the seats." : null,
    hold: d.holdOn && (d.holdPerGuestMinor === null || d.holdPerGuestMinor <= 0) ? "Enter the hold per guest, or switch the hold off." : null,
  };
}

export function tableDraftValid(d: TableDraft): boolean {
  const i = tableDraftIssues(d);
  return i.name === null && i.space === null && i.minParty === null && i.hold === null;
}

/** The fields to send. On an update only what changed (the server keeps the rest). */
export function tablePayload(d: TableDraft, saved: VenueFloorTable | null, opts: { minSpendOn: boolean }): TableFields {
  const full: TableFields = {
    name: d.name.trim(),
    capacity: d.capacity,
    minParty: d.minParty > 1 ? d.minParty : null,
    shape: d.shape,
    guestPickable: d.guestPickable,
    combinable: d.combinable,
    accessible: d.accessible,
    depositPerGuestMinor: d.holdOn ? (d.holdPerGuestMinor ?? 0) : null,
    reservationPolicy: d.walkInOnly ? "walk_in_only" : "reservable",
    joinsWith: d.combinable ? [...d.joinsWith].sort() : [],
  };
  if (opts.minSpendOn) full.minSpendMinor = d.minSpendMinor ?? 0;
  if (d.spaceId !== null) full.spaceId = d.spaceId;
  if (saved === null) return full;
  const before = tablePayload(tableDraftFrom(saved, { spaceId: saved.spaceId }), null, opts);
  const out: TableFields = {};
  for (const key of Object.keys(full) as Array<keyof TableFields>) {
    if (JSON.stringify(full[key]) !== JSON.stringify(before[key])) {
      (out as Record<string, unknown>)[key] = full[key];
    }
  }
  // A switch away from "can be joined" also clears the pairs.
  if (!d.combinable && saved.joinsWith.length > 0) out.joinsWith = [];
  return out;
}

export function tableDraftDirty(
  d: TableDraft,
  saved: VenueFloorTable | null,
  defaults: { spaceId: string | null; name?: string; like?: Pick<VenueFloorTable, "shape" | "capacity"> | null },
): boolean {
  return JSON.stringify(d) !== JSON.stringify(tableDraftFrom(saved, defaults));
}

/** "Next free name" for a new table in a space: T1, T2… (skips names in use). */
export function nextTableName(existing: readonly string[], prefix = "T"): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${prefix}${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${prefix}${existing.length + 1}`;
}

/**
 * #4490 N24: the next name after the last table added, keeping its letters
 * (B1 → B2, Booth 3 → Booth 4); "T1" when there is no table yet.
 */
export function nextTableNameAfter(existing: readonly string[], last: string | null | undefined): string {
  const m = /^(.*?)(\d+)$/.exec((last ?? "").trim());
  return nextTableName(existing, m !== null && m[1].length > 0 ? m[1] : "T");
}
