/**
 * #4490 P5-2 — the table form as pure data: the draft, its checks in plain
 * words and the payload `issue_4490_manage_table` takes (only changed fields
 * on an update). Unit-tested.
 */
import type { TableDepositMode, TableFields, VenueFloorTable } from "../../../../services/venueFloorService";
import type { TableShape } from "./floorModel";

export interface TableDraft {
  name: string;
  spaceId: string | null;
  shape: TableShape;
  capacity: number;
  /** 1 = any party. */
  minParty: number;
  minSpendMinor: number | null;
  depositMode: TableDepositMode;
  holdPerGuestMinor: number | null;
  holdPerTableMinor: number | null;
  holdShareBps: number | null;
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
      depositMode: "venue_rule",
      holdPerGuestMinor: null,
      holdPerTableMinor: null,
      holdShareBps: null,
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
    depositMode: table.depositMode,
    holdPerGuestMinor: table.depositPerGuestMinor,
    holdPerTableMinor: table.depositFlatMinor,
    holdShareBps: table.depositShareBps,
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
    hold:
      d.depositMode === "per_guest" && (d.holdPerGuestMinor === null || d.holdPerGuestMinor <= 0)
        ? "Enter an amount above zero."
        : d.depositMode === "per_table" && (d.holdPerTableMinor === null || d.holdPerTableMinor <= 0)
          ? "Enter an amount above zero."
          : d.depositMode === "min_spend_share" && (d.minSpendMinor === null || d.minSpendMinor <= 0)
            ? "Set a minimum spend first."
            : d.depositMode === "min_spend_share"
                && (d.holdShareBps === null || d.holdShareBps < 500 || d.holdShareBps > 10000 || d.holdShareBps % 500 !== 0)
              ? "Pick a share from 5% to 100%."
              : null,
  };
}

export function tableDraftValid(d: TableDraft): boolean {
  const i = tableDraftIssues(d);
  return i.name === null && i.space === null && i.minParty === null && i.hold === null;
}

/** A newly selected share starts at the same visible 5% value the stepper shows. */
export function tableDepositModePatch(
  d: Pick<TableDraft, "holdShareBps">,
  depositMode: TableDepositMode,
): Pick<TableDraft, "depositMode" | "holdShareBps"> {
  return {
    depositMode,
    holdShareBps:
      depositMode === "min_spend_share"
        ? (d.holdShareBps ?? 500)
        : d.holdShareBps,
  };
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
    depositMode: d.depositMode,
    depositPerGuestMinor: d.depositMode === "per_guest" ? d.holdPerGuestMinor : null,
    depositFlatMinor: d.depositMode === "per_table" ? d.holdPerTableMinor : null,
    depositShareBps: d.depositMode === "min_spend_share" ? d.holdShareBps : null,
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

/** The server uses this same round-half-up formula; this value is display only. */
export function tableDepositShareMinor(minSpendMinor: number | null, shareBps: number | null): number | null {
  if (minSpendMinor === null || minSpendMinor <= 0 || shareBps === null || shareBps <= 0) return null;
  return Math.floor((minSpendMinor * shareBps + 5000) / 10000);
}

/** Host list copy for a table's chosen deposit type. */
export function tableDepositLine(table: VenueFloorTable, money: (minor: number) => string): string | null {
  switch (table.depositMode) {
    case "per_guest":
      return table.depositPerGuestMinor !== null ? `${money(table.depositPerGuestMinor)} a guest` : null;
    case "per_table":
      return table.depositFlatMinor !== null ? `${money(table.depositFlatMinor)} a table` : null;
    case "min_spend_share":
      return table.depositShareBps !== null ? `${table.depositShareBps / 100}% of minimum spend` : null;
    case "venue_rule":
    default:
      return null;
  }
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
