/**
 * #4490 P5-3 — the guest's table choices as pure data (unit-tested):
 *  - the party size range (the venue's partyMax, up to 100; above it a
 *    big-party request when the venue allows one);
 *  - the word on each table of the seat map (never colour alone);
 *  - the hold and minimum-spend lines shown before paying;
 *  - the waitlist and notify-me copy, and every server refusal in words.
 */
import type { GuestTableOption, GuestWaitlistEntry } from "../../../services/venueTableGuestService";

import { DEFAULT_PARTY_MAX } from "./tablesFlow";

export { DEFAULT_PARTY_MAX };
export const ABSOLUTE_PARTY_MAX = 100;

export interface PartyRange {
  /** The stepper's top. */
  max: number;
  /** The biggest party a table (or joined pair) seats online. */
  tableMax: number;
  bigPartyAllowed: boolean;
}

export function partyRange(tables: { partyMax: number | null; largePartyRequest: boolean | null } | null): PartyRange {
  const tableMax = tables?.partyMax != null && tables.partyMax > 0 ? Math.min(ABSOLUTE_PARTY_MAX, tables.partyMax) : DEFAULT_PARTY_MAX;
  const bigPartyAllowed = tables?.largePartyRequest === true;
  return { max: bigPartyAllowed ? ABSOLUTE_PARTY_MAX : tableMax, tableMax, bigPartyAllowed };
}

export function isBigParty(party: number, range: PartyRange): boolean {
  return range.bigPartyAllowed && party > range.tableMax;
}

/** "Up to 8", "Up to 8 online · bigger groups ask". */
export function partyDetail(range: PartyRange): string {
  return range.bigPartyAllowed ? `Up to ${range.tableMax} online · bigger groups ask` : `Up to ${range.tableMax}`;
}

/** The word on a table of the seat map. */
export function tableWord(option: GuestTableOption, selected: boolean): string {
  if (selected) return "Yours";
  switch (option.status) {
    case "free":
      return `Seats ${option.capacity}`;
    case "taken":
      return "Taken";
    case "not_pickable":
      return "Staff choose";
    case "not_fit":
    default:
      return "Wrong size";
  }
}

export function tableA11y(option: GuestTableOption, selected: boolean, money: (m: number) => string): string {
  const name = option.names.join(" and ");
  const parts = [`${name}, seats ${option.capacity}`];
  if (selected) parts.push("your table");
  else if (option.status === "free") parts.push("free");
  else if (option.status === "taken") parts.push("taken at this time");
  else if (option.status === "not_pickable") parts.push("the venue chooses this table");
  else parts.push("doesn't fit your party");
  if (option.minSpendMinor > 0) parts.push(`spend at least ${money(option.minSpendMinor)}`);
  if (option.holdPerGuestMinor !== null && option.holdPerGuestMinor > 0) {
    parts.push(`${money(option.holdPerGuestMinor)} a guest to hold it`);
  } else if (option.holdMinor !== null && option.holdMinor > 0) {
    parts.push(`${money(option.holdMinor)} to hold this table`);
  }
  return parts.join(", ");
}

export interface PickMoneyLines {
  /** "₦5,000 a guest holds it and comes off your bill." */
  hold: string | null;
  /** "Spend at least ₦80,000 on food and drinks." */
  minSpend: string | null;
  /** "₦20,000 to hold it for 4." */
  holdTotal: string | null;
}

export function pickMoneyLines(option: GuestTableOption | null, party: number, money: (m: number) => string): PickMoneyLines {
  if (option === null) return { hold: null, minSpend: null, holdTotal: null };
  const per = option.holdPerGuestMinor;
  const total = option.holdMinor ?? (per !== null ? per * party : null);
  return {
    hold:
      per !== null && per > 0
        ? `${money(per)} a guest holds it and comes off your bill.`
        : total !== null && total > 0
          ? "Comes off your bill."
          : null,
    holdTotal:
      total !== null && total > 0
        ? per !== null && per > 0
          ? `${money(total)} to hold it for ${party}`
          : `${money(total)} to hold this table`
        : null,
    minSpend: option.minSpendMinor > 0 ? `Spend at least ${money(option.minSpendMinor)} on food and drinks. It's settled at the venue.` : null,
  };
}

/** "B1 + B2 · seats 8" for a joined pair. */
export function optionTitle(option: GuestTableOption): string {
  return option.kind === "join" ? `${option.names.join(" + ")} · joined, seats ${option.capacity}` : option.names[0] ?? "Table";
}

/** Plain words for every table / waitlist refusal the guest can meet. */
export function tableGuestErrorCopy(code: string): string | null {
  switch (code) {
    case "table_taken":
      return "Someone just took that table. Pick another, or choose Any table.";
    case "table_not_pickable":
      return "The venue chooses that table. Pick another, or choose Any table.";
    case "table_pick_unavailable":
      return "Picking a table isn't open right now. Choose Any table instead.";
    case "table_not_fit":
      return "That table doesn't fit your party. Pick a bigger table.";
    case "table_not_found":
      return "That table isn't available any more. Pick another.";
    case "table_ids_invalid":
    case "space_id_invalid":
      return "That choice isn't valid any more. Pick again.";
    case "large_party_not_needed":
      return "A table fits your party, so you can book it straight away.";
    case "tables_request_failed":
      return "We couldn't load the tables. Try again.";
    case "waitlist_invalid":
    case "waitlist_date_invalid":
      return "Check the day and times, then try again.";
    case "waitlist_guest_invalid":
      return "Add your name, and an email or a phone number we can reach you on.";
    case "waitlist_party_too_large":
      return "That party is bigger than the venue seats. Contact the venue directly.";
    case "waitlist_closed":
      return "The venue isn't taking waitlist sign-ups online right now.";
    case "waitlist_already_joined":
      return "You're already on this waitlist for that day. Check the link we sent you.";
    case "waitlist_not_found":
      return "We couldn't find this waitlist place. It may have ended, or the link is incomplete.";
    case "waitlist_token_required":
      return "Open this page from the link we sent you.";
    case "rate_limited":
      return "That's a lot of tries in a short time. Wait a few minutes, then try again.";
    default:
      return null;
  }
}

/** The waitlist page's headline and line. */
export function waitlistStateCopy(
  entry: GuestWaitlistEntry,
  clock: (iso: string) => string,
  today: string | null = null,
): { title: string; body: string } {
  const venue = entry.venue.name;
  switch (entry.status) {
    case "notified":
      return {
        title: "A table is ready",
        body:
          entry.offeredSlotAt !== null
            ? `${venue} has a table for you at ${clock(entry.offeredSlotAt)}. Book it now before someone else does.`
            : entry.desiredDate !== null && today !== null && entry.desiredDate > today
              ? `${venue} has a table for you on ${dayWords(entry.desiredDate)}. Book it now before someone else does.`
              : `${venue} is ready for you. Head to the host stand and give your name.`,
      };
    case "seated":
      return { title: "You're seated", body: `Enjoy ${venue}.` };
    case "left":
    case "lost":
      return { title: "You left the waitlist", body: `${venue} won't contact you about this one.` };
    case "expired":
      return { title: "This waitlist place ended", body: "The time passed. Join again if you'd still like a table." };
    case "waiting":
    default: {
      const range = entry.desiredFrom !== null && entry.desiredTo !== null ? ` between ${entry.desiredFrom.slice(0, 5)} and ${entry.desiredTo.slice(0, 5)}` : "";
      return {
        title: entry.position !== null ? `You're number ${entry.position}` : "You're on the waitlist",
        body: `We'll tell you as soon as a table for ${entry.partySize} opens${range}.${entry.quotedWaitMinutes !== null ? ` About ${entry.quotedWaitMinutes} minutes.` : ""}`,
      };
    }
  }
}

/** Notify-me ranges: start and end chips from the day's slot labels ("19:00"…). */
export function windowChoices(slotLabels: readonly string[]): string[] {
  const set = new Set<string>();
  for (const l of slotLabels) {
    const m = /^(\d{1,2}):(\d{2})/.exec(l);
    if (m !== null) set.add(`${m[1]?.padStart(2, "0")}:${m[2]}`);
  }
  return [...set].sort();
}

export { tablesBlockChangesFlow } from "./tablesFlow";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Tue 24 Nov" for a YYYY-MM-DD day. */
export function dayWords(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return `${WD[at.getUTCDay()]} ${at.getUTCDate()} ${MO[at.getUTCMonth()]}`;
}

/** Notify-me range to start with: around the first full time, else the evening. */
export function defaultNotifyRange(times: readonly string[], fullTimes: readonly string[]): { from: string | null; to: string | null } {
  if (times.length < 2) return { from: times[0] ?? null, to: null };
  const anchor = fullTimes[0] ?? times.find((t) => t >= "19:00") ?? times[0] ?? null;
  const i = Math.max(0, times.indexOf(anchor ?? ""));
  const from = times[Math.min(i, times.length - 2)] ?? null;
  const to = times[Math.min(i + 4, times.length - 1)] ?? null;
  return { from, to };
}
