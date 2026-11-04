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

function dateWindowEndMs(start: unknown, end: unknown): number | null {
  const endMs = parseIsoMs(end);
  if (endMs !== null) return endMs;
  const startMs = parseIsoMs(start);
  return startMs === null ? null : startMs + SAVED_EVENT_ASSUMED_LENGTH_MS;
}

/**
 * True only when EVERY date the saved card knows about is provably in the past.
 *
 * The card's master date is its FIRST date, so a recurring or multi-date
 * experience whose first date passed is still on sale: the decision uses the
 * latest of the master date, the server's next date (`nextStartAtUtc`, which the
 * chat list and Discover cards prefer) and every upcoming occurrence. A
 * recurring experience can always grow another date, so it is never called
 * ended from a saved snapshot. A card with no date at all is never "ended"
 * (Constitution #9: missing is hidden, not guessed).
 */
export function isSavedEventEnded(card: unknown, nowMs: number): boolean {
  if (!card || typeof card !== "object") return false;
  const c = card as {
    masterDateUtc?: unknown;
    masterEndAtUtc?: unknown;
    nextStartAtUtc?: unknown;
    nextEndAtUtc?: unknown;
    upcomingOccurrences?: unknown;
    isRecurring?: unknown;
  };
  if (c.isRecurring === true) return false;
  const windows: Array<number | null> = [
    dateWindowEndMs(c.masterDateUtc, c.masterEndAtUtc),
    dateWindowEndMs(c.nextStartAtUtc, c.nextEndAtUtc),
  ];
  if (Array.isArray(c.upcomingOccurrences)) {
    for (const occ of c.upcomingOccurrences) {
      if (occ && typeof occ === "object") {
        const o = occ as { startAt?: unknown; endAt?: unknown };
        windows.push(dateWindowEndMs(o.startAt, o.endAt));
      }
    }
  }
  let latest: number | null = null;
  for (const w of windows) {
    if (w !== null && (latest === null || w > latest)) latest = w;
  }
  return latest !== null && latest < nowMs;
}

interface SavedTicketShape {
  purchaseOptions?: unknown;
}

export function isSavedCardTicketed(card: SavedTicketShape | null | undefined, isBrandExperience: boolean): boolean {
  if (isBrandExperience) return true;
  return Array.isArray(card?.purchaseOptions) && card!.purchaseOptions.length > 0;
}

// ── Quick schedule slots ───────────────────────────────────────────────────

export type ScheduleEntry = "quickSheet" | "fullPicker";

/**
 * Where a Schedule tap goes. The quick sheet only offers times the existing
 * scheduling check can confirm open, which needs real opening hours — for a
 * single place, and for EVERY stop of a plan (one stop without hours makes the
 * check reject any time). When hours are unknown the tap opens the full
 * date/time picker directly instead of showing tiles that would all be refused.
 *
 * @param stopHoursKnown one entry per place (a single card passes one), true
 *   when that place publishes parseable opening hours.
 */
export function resolveScheduleEntry(stopHoursKnown: ReadonlyArray<boolean>): ScheduleEntry {
  if (stopHoursKnown.length === 0) return "fullPicker";
  return stopHoursKnown.every(Boolean) ? "quickSheet" : "fullPicker";
}

export interface QuickSlot {
  /** Device-local start time the user is picking. */
  at: Date;
  /** Whole days between today and the slot (0 = today). */
  dayOffset: number;
}

export interface QuickSlotResult {
  /** Times the existing check confirms open; empty = none in the horizon. */
  slots: QuickSlot[];
}

export interface ComputeQuickSlotsInput {
  now: Date;
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
 * tiles are four different days. Closed (or unparseable) days are skipped, and
 * a time is offered only when `isOpenAt` answers true. Callers reach this only
 * for cards whose hours are known (see resolveScheduleEntry).
 */
export function computeQuickSlots(input: ComputeQuickSlotsInput): QuickSlotResult {
  const count = input.count ?? 4;
  const horizonDays = input.horizonDays ?? 14;
  const earliest = input.now.getTime() + (input.leadMinutes ?? 30) * 60_000;

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
  return { slots };
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
  /**
   * Commit every pending removal immediately (screen is going away). Returns
   * the ids it committed so the caller can take down their Undo toasts — an
   * Undo left on screen after the commit would be a dead button.
   */
  flushAll: () => string[];
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
      const flushed: string[] = [];
      for (const [id, entry] of [...pending.entries()]) {
        clearTimer(entry.handle);
        commit(id);
        flushed.push(id);
      }
      return flushed;
    },
    isPending: (id) => pending.has(id),
    pendingIds: () => [...pending.keys()],
  };
}
