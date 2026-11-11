/**
 * #4389 Door mode — the rules of the door sale screen as pure data, so they are
 * unit-tested without rendering (design "DM", approved 2026-11-11).
 *
 * - Tickets: the I-30 door filter and the old sheet's per-tier max (99). A tap
 *   on a tile adds one, the minus takes one off.
 * - How they pay: chips in buildDoorPaymentOptions order. Tap to Pay only where
 *   it works and never on the web, then Buyer's phone (pay code), then Cash.
 *   Manual is not a chip (it lives under the header menu).
 * - The method is remembered per event per device. The first time, Tap to Pay
 *   where it works, otherwise Buyer's phone.
 * - Idempotency: one clientRequestId per sale attempt. The same basket keeps its
 *   id until a sale completes, so a retry after a lost answer is the same order;
 *   a changed basket or a completed sale gets a new one. A second press while a
 *   sale is in flight is dropped.
 *
 * MINGLA-INVARIANT: I-4389-DOOR-MODE-ONE-ORDER-PER-ATTEMPT | issue #4389 | A door sale attempt carries one clientRequestId and a press while one is in flight is dropped (DoorAttemptGate); pinned by issue_4389_door_mode.implementor.test.ts.
 */
import type { LiveEvent } from "../../store/liveEventStore";
import type { TicketStub } from "../../store/draftEventStore";
import type { DoorSaleRecord } from "../../types/doorSales";
import type { DoorPayLiveStatus } from "../../services/doorPayCodeCore";
import { deriveLiveStatus } from "../../utils/eventLifecycle";
import { computeMasterStartAtUtc } from "../../utils/eventDateMath";
import type { DoorPaymentOption } from "./doorPaymentOptions";

/** The methods that are chips. Manual is reachable from the header menu. */
export type DoorModeChipMethod = "tap_to_pay" | "pay_code" | "cash";
/** Everything Door mode can charge with. */
export type DoorModeMethod = DoorModeChipMethod | "manual";

/** Same cap as the old sale sheet. */
export const DOOR_MODE_MAX_PER_TIER = 99;

/** How long the green Paid confirmation stays before the screen resets. */
export const DOOR_MODE_PAID_MS = 2_000;

export interface DoorCartLine {
  ticketTypeId: string;
  quantity: number;
}

/** I-30: door + both tiers; hidden and online-only tiers never show at the door. */
export const doorModeTiers = (tickets: readonly TicketStub[]): TicketStub[] =>
  tickets
    .filter((t) => t.visibility !== "hidden" && t.availableAt !== "online")
    .sort((a, b) => a.displayOrder - b.displayOrder);

export const cartQuantity = (cart: readonly DoorCartLine[], ticketTypeId: string): number =>
  cart.find((line) => line.ticketTypeId === ticketTypeId)?.quantity ?? 0;

/** Tap on a tile: one more, capped at the per-tier max. */
export const addOneTicket = (cart: readonly DoorCartLine[], ticketTypeId: string): DoorCartLine[] => {
  const current = cartQuantity(cart, ticketTypeId);
  if (current >= DOOR_MODE_MAX_PER_TIER) return [...cart];
  if (current === 0) return [...cart, { ticketTypeId, quantity: 1 }];
  return cart.map((line) => (line.ticketTypeId === ticketTypeId ? { ...line, quantity: current + 1 } : line));
};

/** The minus: one fewer; the line goes at zero. */
export const removeOneTicket = (cart: readonly DoorCartLine[], ticketTypeId: string): DoorCartLine[] => {
  const current = cartQuantity(cart, ticketTypeId);
  if (current <= 1) return cart.filter((line) => line.ticketTypeId !== ticketTypeId);
  return cart.map((line) => (line.ticketTypeId === ticketTypeId ? { ...line, quantity: current - 1 } : line));
};

/** Seed from a draft (Ari, "Sell another"): only door tiers, capped, positive. */
export const seedDoorCart = (
  seed: readonly DoorCartLine[] | null | undefined,
  tiers: readonly TicketStub[],
): DoorCartLine[] =>
  (seed ?? []).flatMap((line) => {
    if (!tiers.some((t) => t.id === line.ticketTypeId) || !(line.quantity > 0)) return [];
    return [{ ticketTypeId: line.ticketTypeId, quantity: Math.min(DOOR_MODE_MAX_PER_TIER, Math.floor(line.quantity)) }];
  });

export const cartTicketCount = (cart: readonly DoorCartLine[]): number =>
  cart.reduce((sum, line) => sum + line.quantity, 0);

/** A stable key for "the same basket". Order of taps does not matter. */
export const doorBasketKeyOf = (cart: readonly DoorCartLine[], eventDateId: string | null): string =>
  `${eventDateId ?? "-"}|${[...cart]
    .sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId))
    .map((line) => `${line.ticketTypeId}x${line.quantity}`)
    .join(",")}`;

// ---- How they pay ------------------------------------------------------------

/**
 * The chips, in buildDoorPaymentOptions order. Tap to Pay never shows on the
 * web, whatever the options say.
 */
export const doorModeChips = (options: readonly DoorPaymentOption[], platform: string): DoorModeChipMethod[] =>
  options
    .map((option) => option.id)
    .filter((id): id is DoorModeChipMethod => id === "tap_to_pay" || id === "pay_code" || id === "cash")
    .filter((id) => !(id === "tap_to_pay" && platform === "web"));

/** First time on this event and phone: Tap to Pay where it works, else Buyer's phone. */
export const defaultDoorMethod = (chips: readonly DoorModeChipMethod[]): DoorModeChipMethod =>
  chips.includes("tap_to_pay") ? "tap_to_pay" : "pay_code";

/**
 * What the screen shows picked. The host's choice this visit wins, then the one
 * remembered for this event on this phone, then the default. A remembered
 * method that is no longer a chip (Tap to Pay on another phone) falls back.
 */
export const resolveDoorMethod = (input: {
  chosen: DoorModeMethod | null;
  remembered: DoorModeChipMethod | null;
  chips: readonly DoorModeChipMethod[];
}): DoorModeMethod => {
  if (input.chosen === "manual") return "manual";
  if (input.chosen !== null && input.chips.includes(input.chosen)) return input.chosen;
  if (input.remembered !== null && input.chips.includes(input.remembered)) return input.remembered;
  return defaultDoorMethod(input.chips);
};

export const isDoorCardMethod = (method: DoorModeMethod): method is "tap_to_pay" | "pay_code" =>
  method === "tap_to_pay" || method === "pay_code";

/** The method memory key: one per user, event and phone (AsyncStorage is per device). */
export const doorMethodMemoryKey = (userId: string, eventId: string): string =>
  `mingla-business.doorMode.method.v1:${userId}:${eventId}`;

export interface DoorMethodMemory {
  method: DoorModeChipMethod | null;
  /** The one-time "remembered" line was shown for this event on this phone. */
  noted: boolean;
}

export const parseDoorMethodMemory = (raw: string | null): DoorMethodMemory => {
  if (raw === null) return { method: null, noted: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { method: null, noted: false };
    const record = parsed as Record<string, unknown>;
    const method =
      record.method === "tap_to_pay" || record.method === "pay_code" || record.method === "cash" ? record.method : null;
    return { method, noted: record.noted === true };
  } catch {
    // An unreadable value is treated as never set; the next choice overwrites it.
    return { method: null, noted: false };
  }
};

// ---- Idempotency ---------------------------------------------------------------

/**
 * One clientRequestId per sale attempt and at most one attempt in flight.
 * `idFor` keeps the id for the same basket (a retry is the same order) and
 * makes a new one when the basket changes; `completed` retires it after a sale.
 */
export class DoorAttemptGate {
  private inFlight = false;
  private basketKey: string | null = null;
  private requestId: string;

  constructor(private readonly makeId: () => string) {
    this.requestId = makeId();
  }

  idFor(basketKey: string): string {
    if (this.basketKey !== basketKey) {
      this.basketKey = basketKey;
      this.requestId = this.makeId();
    }
    return this.requestId;
  }

  get busy(): boolean {
    return this.inFlight;
  }

  /** Runs `task` unless one is already running; a dropped press returns `{ ran: false }`. */
  async run<T>(task: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
    if (this.inFlight) return { ran: false };
    this.inFlight = true;
    try {
      return { ran: true, value: await task() };
    } finally {
      this.inFlight = false;
    }
  }

  completed(): void {
    this.basketKey = null;
    this.requestId = this.makeId();
  }
}

// ---- Header and picker ---------------------------------------------------------

const TONIGHT_WINDOW_MS = 18 * 60 * 60 * 1000;

/**
 * "Door · {n} sold tonight": tickets on door sales recorded in the last 18
 * hours (a night that runs past midnight stays one night), fully refunded
 * sales excluded.
 */
export const doorTicketsSoldTonight = (sales: readonly DoorSaleRecord[], nowMs: number): number =>
  sales.reduce((sum, sale) => {
    if (sale.status === "refunded_full") return sum;
    const at = Date.parse(sale.recordedAt);
    if (!Number.isFinite(at) || nowMs - at > TONIGHT_WINDOW_MS || at - nowMs > 60_000) return sum;
    return sum + sale.lines.reduce((s, line) => s + line.quantity, 0);
  }, 0);

export interface DoorSaleCandidate {
  eventId: string;
  name: string;
  live: boolean;
  startAtUtc: string | null;
}

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * The events a door sale can be for right now: live, or starting today, and
 * not cancelled, ended or past. Soonest first. Two or more ask "Which event?".
 */
export const doorSaleCandidates = (events: readonly LiveEvent[], nowMs: number): DoorSaleCandidate[] => {
  const now = new Date(nowMs);
  return events
    .flatMap((event): DoorSaleCandidate[] => {
      const startAtUtc = computeMasterStartAtUtc(event);
      const status = deriveLiveStatus(event, startAtUtc);
      if (status === "past" || status === "cancelled") return [];
      const startMs = startAtUtc === null ? Number.NaN : Date.parse(startAtUtc);
      const today = Number.isFinite(startMs) && sameLocalDay(new Date(startMs), now);
      if (status !== "live" && !today) return [];
      return [{ eventId: event.id, name: event.name, live: status === "live", startAtUtc }];
    })
    .sort((a, b) => {
      const at = a.startAtUtc === null ? Number.POSITIVE_INFINITY : Date.parse(a.startAtUtc);
      const bt = b.startAtUtc === null ? Number.POSITIVE_INFINITY : Date.parse(b.startAtUtc);
      return at - bt;
    });
};

// ---- Scan to pay -----------------------------------------------------------------

/** What the pay code sheet shows for the code's live status (doorPayHostStatus). */
export type DoorModeCodeStep = "loading" | "live" | "paying" | "settling" | "paid" | "ended";

/**
 * The sheet moves on by itself: "paid" closes it and shows the green Paid
 * overlay. Only the server ends a code (expired, failed, cancelled); "checking"
 * and "payment_landing" hold the sheet with no cancel, so money in flight is
 * never abandoned.
 */
export const doorModeCodeStep = (status: DoorPayLiveStatus | null): DoorModeCodeStep => {
  switch (status) {
    case null:
      return "loading";
    case "open":
      return "live";
    case "opened":
      return "paying";
    case "checking":
    case "payment_landing":
      return "settling";
    case "paid":
      return "paid";
    case "expired":
    case "failed":
    case "cancelled":
      return "ended";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};
