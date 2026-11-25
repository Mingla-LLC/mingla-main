/**
 * #4490 spec 08 O3 — pure display state for the kitchen and bar screens. Ticket
 * state is the server's (issue_4490_station_board); this file only sorts it
 * into columns, works out timers, and decides when the chime rings.
 *
 * Sound rule (spec 08 §3 O3): when any ticket for this station is New, play
 * once immediately, then every 20 s until every New ticket is accepted; no
 * volume escalation. Mute is 15 minutes or 1 hour, never persists past its
 * time and never survives a restart (it lives in memory only).
 */
import { venueWallClock } from "@mingla/brand-rendering/venueOpenState";

export type StationChoice = "kitchen" | "bar" | "all";
export type StationName = "kitchen" | "bar";
export type StationTicketState = "new" | "cooking" | "ready" | "voided" | "done";
export type StationColumn = "new" | "cooking" | "ready";

export const STATION_REPEAT_MS = 20_000;
export const STATION_MUTE_MINUTES = [15, 60] as const;
export type StationMuteMinutes = (typeof STATION_MUTE_MINUTES)[number];
const DEFAULT_TARGET_MINUTES: Record<StationName, number> = { kitchen: 15, bar: 5 };

export interface StationLine {
  itemId: string;
  name: string;
  quantity: number;
  notes: string | null;
  modifiers: string[];
  prepState: string;
  voided: boolean;
  voidedAt: string | null;
  voidedByName: string | null;
  readyAt: string | null;
}

export interface StationTicket {
  orderId: string;
  station: StationName;
  ticketNo: string;
  destination: string;
  movedFrom: string | null;
  guestOrder: boolean;
  sellerName: string | null;
  tellName: string | null;
  sentAt: string;
  orderStatus: string;
  stationRev: number;
  state: StationTicketState;
  acceptedAt: string | null;
  acceptedByName: string | null;
  readyAt: string | null;
  readyByName: string | null;
  pickedUpAt: string | null;
  printedCount: number;
  lines: StationLine[];
}

export interface StationBoard {
  venueId: string;
  venueName: string;
  brandId: string;
  station: StationChoice;
  timezone: string | null;
  serverNow: string;
  targetMinutes: Record<StationName, number>;
  printPaper: string;
  defaultStation: StationName;
  noStationItems: number;
  tickets: StationTicket[];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const STATES: ReadonlySet<string> = new Set(["new", "cooking", "ready", "voided", "done"]);

export function parseStationChoice(value: unknown): StationChoice | null {
  return value === "kitchen" || value === "bar" || value === "all" ? value : null;
}

function parseLine(raw: unknown): StationLine {
  const l = obj(raw);
  return {
    itemId: str(l.itemId),
    name: str(l.name),
    quantity: Math.max(1, num(l.quantity, 1)),
    notes: strOrNull(l.notes),
    modifiers: Array.isArray(l.modifiers) ? l.modifiers.filter((m): m is string => typeof m === "string") : [],
    prepState: str(l.prepState, "pending"),
    voided: l.voided === true,
    voidedAt: strOrNull(l.voidedAt),
    voidedByName: strOrNull(l.voidedByName),
    readyAt: strOrNull(l.readyAt),
  };
}

export function parseStationTicket(raw: unknown): StationTicket | null {
  const t = obj(raw);
  const station = t.station === "bar" ? "bar" : t.station === "kitchen" ? "kitchen" : null;
  const state = str(t.state);
  if (station === null || !STATES.has(state) || str(t.orderId).length === 0) return null;
  return {
    orderId: str(t.orderId),
    station,
    ticketNo: str(t.ticketNo),
    destination: str(t.destination, "Counter"),
    movedFrom: strOrNull(t.movedFrom),
    guestOrder: t.guestOrder === true,
    sellerName: strOrNull(t.sellerName),
    tellName: strOrNull(t.tellName),
    sentAt: str(t.sentAt),
    orderStatus: str(t.orderStatus),
    stationRev: num(t.stationRev),
    state: state as StationTicketState,
    acceptedAt: strOrNull(t.acceptedAt),
    acceptedByName: strOrNull(t.acceptedByName),
    readyAt: strOrNull(t.readyAt),
    readyByName: strOrNull(t.readyByName),
    pickedUpAt: strOrNull(t.pickedUpAt),
    printedCount: num(t.printedCount),
    lines: Array.isArray(t.lines) ? t.lines.map(parseLine) : [],
  };
}

export function parseStationBoard(raw: unknown): StationBoard {
  const b = obj(raw);
  const settings = obj(b.settings);
  const targets = obj(settings.targetMinutes);
  return {
    venueId: str(b.venueId),
    venueName: str(b.venueName),
    brandId: str(b.brandId),
    station: parseStationChoice(b.station) ?? "kitchen",
    timezone: strOrNull(b.timezone),
    serverNow: str(b.serverNow),
    targetMinutes: {
      kitchen: num(targets.kitchen, DEFAULT_TARGET_MINUTES.kitchen),
      bar: num(targets.bar, DEFAULT_TARGET_MINUTES.bar),
    },
    printPaper: str(settings.printPaper, "a4"),
    defaultStation: settings.defaultStation === "bar" ? "bar" : "kitchen",
    noStationItems: num(b.noStationItems),
    tickets: (Array.isArray(b.tickets) ? b.tickets : [])
      .map(parseStationTicket)
      .filter((t): t is StationTicket => t !== null && t.state !== "done"),
  };
}

export const ticketKey = (t: Pick<StationTicket, "orderId" | "station">): string => `${t.orderId}:${t.station}`;

/** A voided ticket stays where it was (struck through) until it leaves the board. */
export function columnOf(t: StationTicket): StationColumn {
  switch (t.state) {
    case "new":
      return "new";
    case "cooking":
      return "cooking";
    case "ready":
      return "ready";
    case "voided":
    case "done":
      return t.readyAt !== null ? "ready" : t.acceptedAt !== null ? "cooking" : "new";
    default: {
      const never: never = t.state;
      return never;
    }
  }
}

export function columnTickets(tickets: readonly StationTicket[], column: StationColumn): StationTicket[] {
  return tickets.filter((t) => columnOf(t) === column);
}

/** Tickets that make the screen ring and flash: New and not voided. */
export function ringingKeys(tickets: readonly StationTicket[]): string[] {
  return tickets.filter((t) => t.state === "new").map(ticketKey);
}

export function isMuted(mutedUntil: number | null, now: number): boolean {
  return mutedUntil !== null && now < mutedUntil;
}

export function muteUntil(now: number, minutes: StationMuteMinutes): number {
  return now + minutes * 60_000;
}

export interface ChimeInput {
  ringing: readonly string[];
  /** Keys already rung for (a fresh arrival rings at once). */
  heard: ReadonlySet<string>;
  lastChimeAt: number | null;
  now: number;
  mutedUntil: number | null;
}

/** Ring now? Once at once for anything new, then every 20 s while any ticket is New. */
export function shouldChime(input: ChimeInput): boolean {
  if (input.ringing.length === 0 || isMuted(input.mutedUntil, input.now)) return false;
  if (input.ringing.some((key) => !input.heard.has(key))) return true;
  if (input.lastChimeAt === null) return true;
  return input.now - input.lastChimeAt >= STATION_REPEAT_MS;
}

/** Server time minus device time, so timers do not trust the device clock. */
export function clockOffsetMs(serverNow: string, deviceNow: number): number {
  const server = Date.parse(serverNow);
  return Number.isFinite(server) ? server - deviceNow : 0;
}

export function ageSeconds(sentAt: string, deviceNow: number, offsetMs: number): number {
  const at = Date.parse(sentAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((deviceNow + offsetMs - at) / 1000));
}

/** "0:38", "17:05", then "1 h 05" from an hour. */
export function ageLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h} h ${String(m).padStart(2, "0")}`;
  }
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Past the venue's target minutes for the station (spec: the timer turns danger). */
export function isLate(ticket: StationTicket, seconds: number, targets: Record<StationName, number>): boolean {
  if (ticket.state !== "new" && ticket.state !== "cooking") return false;
  const target = targets[ticket.station] ?? DEFAULT_TARGET_MINUTES[ticket.station];
  return target > 0 && seconds >= target * 60;
}

/** "21:40" in the venue's zone (never formatToParts); null when unknown. */
export function venueTime(at: number | string, timeZone: string | null): string | null {
  const date = new Date(typeof at === "number" ? at : Date.parse(at));
  const clock = venueWallClock(date, timeZone);
  if (clock === null) return null;
  return `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
}

/** The ticket to name in the New banner: the oldest one still New. */
export function oldestNew(tickets: readonly StationTicket[]): StationTicket | null {
  return tickets.find((t) => t.state === "new") ?? null;
}

/** Who sent it, as the ticket says it. */
export function ticketSender(t: StationTicket, guestLabel: string): string {
  return t.guestOrder ? guestLabel : t.sellerName ?? "Staff";
}

/** Items a cook still has to make (the line checkboxes on a Cooking ticket). */
export function openLines(t: StationTicket): StationLine[] {
  return t.lines.filter((l) => !l.voided && l.prepState !== "ready" && l.prepState !== "served");
}

export function stationNoun(choice: StationChoice): string {
  return choice === "bar" ? "bar" : choice === "kitchen" ? "kitchen" : "kitchen and bar";
}
