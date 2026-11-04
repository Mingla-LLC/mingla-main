/**
 * Issue #4265 — the Likes saved grid's pure decisions.
 *
 * Everything here is deliberately import-free so the Deno regression suite
 * (`__tests__/issue_4265_likes_grid.implementor.test.ts`) can load it without a
 * bundler. Anything that needs the app (opening-hours parsing, i18n, the
 * scheduling validators) is passed in by the caller.
 */

/** Two columns: 16pt page edges, 12pt between columns, 20pt between rows. */
export const SAVED_GRID_COLUMNS = 2;

/** How long the "Removed from Likes" Undo stays available. */
export const SAVED_UNDO_WINDOW_MS = 3000;

// ── Primary button ─────────────────────────────────────────────────────────

export type SavedPrimaryAction = "schedule" | "tickets" | "inCalendar" | "findSimilar";

export interface SavedPrimaryActionInput {
  /** The card is already in the calendar (scheduledCardIds or a calendar entry). */
  isScheduled: boolean;
  /** A ticketed event whose last date is in the past. */
  isEnded: boolean;
  /** The card sells tickets: purchase options, or a brand-authored event. */
  isTicketed: boolean;
}

/**
 * The one main button each saved card shows.
 *
 * Ended beats everything (the card is dimmed and offers "Find similar"), then a
 * booked card quiets down to "In calendar", then anything that sells tickets
 * goes to the existing ticket path, and every other place or plan schedules.
 */
export function resolveSavedPrimaryAction(input: SavedPrimaryActionInput): SavedPrimaryAction {
  if (input.isEnded) return "findSimilar";
  if (input.isScheduled) return "inCalendar";
  if (input.isTicketed) return "tickets";
  return "schedule";
}

/** No end time is published for most events, so a start this old counts as over. */
export const SAVED_EVENT_ASSUMED_LENGTH_MS = 6 * 60 * 60 * 1000;

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True only when the saved event's date is provably in the past. A card with no
 * date at all is never called "ended" (Constitution #9: missing is hidden, not
 * guessed).
 */
export function isSavedEventEnded(card: unknown, nowMs: number): boolean {
  if (!card || typeof card !== "object") return false;
  const times = card as { masterDateUtc?: unknown; masterEndAtUtc?: unknown };
  const end = parseIsoMs(times.masterEndAtUtc);
  if (end !== null) return end < nowMs;
  const start = parseIsoMs(times.masterDateUtc);
  if (start === null) return false;
  return start + SAVED_EVENT_ASSUMED_LENGTH_MS < nowMs;
}

interface SavedTicketShape {
  purchaseOptions?: unknown;
}

export function isSavedCardTicketed(card: SavedTicketShape | null | undefined, isBrandExperience: boolean): boolean {
  if (isBrandExperience) return true;
  return Array.isArray(card?.purchaseOptions) && card!.purchaseOptions.length > 0;
}

// ── Quick schedule slots ───────────────────────────────────────────────────

export interface QuickSlot {
  /** Device-local start time the user is picking. */
  at: Date;
  /** Whole days between today and the slot (0 = today). */
  dayOffset: number;
}

export interface QuickSlotResult {
  slots: QuickSlot[];
  /** "hours": computed from real opening hours. "default": hours unknown. */
  source: "hours" | "default";
}

export interface ComputeQuickSlotsInput {
  now: Date;
  /** Whether the card (or every stop of a plan) publishes opening hours. */
  hasHours: boolean;
  /** true = open at that moment, false = closed, null = cannot tell. */
  isOpenAt: (at: Date) => boolean | null;
  count?: number;
  horizonDays?: number;
  /** A slot must start at least this far in the future. */
  leadMinutes?: number;
}

/**
 * The times people actually go out, in the order we try them on each day.
 * Minutes since midnight, device-local.
 */
export const QUICK_SLOT_PREFERRED_MINUTES: ReadonlyArray<number> = [
  19 * 60 + 30, // 7:30 PM
  12 * 60, //      12:00 PM
  18 * 60 + 30, // 6:30 PM
  13 * 60, //      1:00 PM
  11 * 60, //      11:00 AM
  20 * 60 + 30, // 8:30 PM
  17 * 60, //      5:00 PM
  15 * 60, //      3:00 PM
  10 * 60, //      10:00 AM
  21 * 60 + 30, // 9:30 PM
  9 * 60, //       9:00 AM
  8 * 60, //       8:00 AM
];

function atMinutes(base: Date, dayOffset: number, minutes: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, 0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

/**
 * The next `count` times the place is open — at most one per day, so the four
 * tiles are four different days. Closed (or unparseable) days are skipped.
 * When the card has no hours at all, the four default evening/weekend slots are
 * returned instead; the caller still runs them through the existing
 * scheduling check, so an unverifiable time is never booked silently.
 */
export function computeQuickSlots(input: ComputeQuickSlotsInput): QuickSlotResult {
  const count = input.count ?? 4;
  const horizonDays = input.horizonDays ?? 14;
  const earliest = input.now.getTime() + (input.leadMinutes ?? 30) * 60_000;

  if (!input.hasHours) {
    return { slots: computeDefaultQuickSlots(input.now, count, earliest), source: "default" };
  }

  const slots: QuickSlot[] = [];
  for (let dayOffset = 0; dayOffset < horizonDays && slots.length < count; dayOffset += 1) {
    let picked: Date | null = null;
    for (const minutes of QUICK_SLOT_PREFERRED_MINUTES) {
      const candidate = atMinutes(input.now, dayOffset, minutes);
      if (candidate.getTime() < earliest) continue;
      if (input.isOpenAt(candidate) === true) {
        picked = candidate;
        break;
      }
    }
    if (!picked) {
      // Unusual hours (a 6–8 AM bakery, a 2 PM-only gallery): first open half hour.
      for (let minutes = 6 * 60; minutes < 24 * 60; minutes += 30) {
        const candidate = atMinutes(input.now, dayOffset, minutes);
        if (candidate.getTime() < earliest) continue;
        if (input.isOpenAt(candidate) === true) {
          picked = candidate;
          break;
        }
      }
    }
    if (picked) slots.push({ at: picked, dayOffset });
  }
  return { slots, source: "hours" };
}

/** Tonight 7:30 PM, tomorrow 7:30 PM, next Saturday 12 PM, next Sunday 11 AM. */
export function computeDefaultQuickSlots(now: Date, count: number, earliestMs: number): QuickSlot[] {
  const offsetToWeekday = (weekday: number): number => {
    const diff = (weekday - now.getDay() + 7) % 7;
    return diff === 0 ? 7 : diff;
  };
  const wanted: Array<[number, number]> = [
    [0, 19 * 60 + 30],
    [1, 19 * 60 + 30],
    [offsetToWeekday(6), 12 * 60],
    [offsetToWeekday(0), 11 * 60],
    // Top-ups for when tonight has already gone.
    [2, 19 * 60 + 30],
    [3, 19 * 60 + 30],
  ];
  const seen = new Set<number>();
  const slots: QuickSlot[] = [];
  for (const [dayOffset, minutes] of wanted) {
    const at = atMinutes(now, dayOffset, minutes);
    const ms = at.getTime();
    if (ms < earliestMs || seen.has(ms)) continue;
    seen.add(ms);
    slots.push({ at, dayOffset });
    if (slots.length >= count) break;
  }
  return slots.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export type QuickSlotDayLabel = "today" | "tonight" | "tomorrow" | "weekday";

/** "Tonight" after 5 PM, "Today" before, "Tomorrow", else the weekday name. */
export function quickSlotDayLabel(slot: QuickSlot): QuickSlotDayLabel {
  if (slot.dayOffset === 0) return slot.at.getHours() >= 17 ? "tonight" : "today";
  if (slot.dayOffset === 1) return "tomorrow";
  return "weekday";
}

// ── Heart remove with Undo ─────────────────────────────────────────────────

export interface PendingRemovalController<T> {
  /** Hide now; commit after the undo window unless undone. */
  schedule: (id: string, payload: T) => void;
  /** Cancel a pending removal. Returns true when something was undone. */
  undo: (id: string) => boolean;
  /** Commit every pending removal immediately (screen is going away). */
  flushAll: () => void;
  isPending: (id: string) => boolean;
  pendingIds: () => string[];
}

export function createPendingRemovalController<T>(options: {
  delayMs: number;
  onCommit: (id: string, payload: T) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): PendingRemovalController<T> {
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const pending = new Map<string, { payload: T; handle: unknown }>();

  const commit = (id: string): void => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    options.onCommit(id, entry.payload);
  };

  return {
    schedule(id, payload) {
      const existing = pending.get(id);
      if (existing) clearTimer(existing.handle);
      const handle = setTimer(() => commit(id), options.delayMs);
      pending.set(id, { payload, handle });
    },
    undo(id) {
      const entry = pending.get(id);
      if (!entry) return false;
      clearTimer(entry.handle);
      pending.delete(id);
      return true;
    },
    flushAll() {
      for (const [id, entry] of [...pending.entries()]) {
        clearTimer(entry.handle);
        commit(id);
      }
    },
    isPending: (id) => pending.has(id),
    pendingIds: () => [...pending.keys()],
  };
}
