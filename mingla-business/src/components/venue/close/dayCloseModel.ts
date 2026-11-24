/**
 * #4490 spec 08 O5 part B — what Close the day shows, as pure functions
 * (display only: every number is the server's; nothing here adds money up
 * except the live "Difference" preview while someone types the count, which
 * the server computes again when the day is closed).
 */

import { formatCurrency } from "../../../utils/currency";
import type {
  DayLatePayment,
  DayOpenCheck,
  DayPerson,
  DaySummary,
  TillSettings,
  TillSettingsPatch,
} from "../../../services/venueDayCloseService";
import { CLOSE_COPY } from "./dayCloseCopy";

export type DifferenceTone = "ok" | "warn";

/** "₦500.00 short", "₦1,200.00 over", "Balanced" (spec 08 §3 O5). */
export function differenceWords(differenceMinor: number, currency: string): { text: string; tone: DifferenceTone } {
  if (differenceMinor === 0) return { text: CLOSE_COPY.balanced, tone: "ok" };
  const amount = formatCurrency(Math.abs(differenceMinor), currency, true);
  return differenceMinor < 0
    ? { text: CLOSE_COPY.short(amount), tone: "warn" }
    : { text: CLOSE_COPY.over(amount), tone: "warn" };
}

/** The difference while typing (display only; the server records its own). */
export function countPreview(expectedMinor: number, countedMinor: number | null): number | null {
  return countedMinor === null ? null : countedMinor - expectedMinor;
}

export function methodLabel(key: string): string {
  return CLOSE_COPY.method[key] ?? CLOSE_COPY.otherMethod;
}

/** A person on the close. A Till device is never shown as a person. */
export function personName(p: DayPerson | null | undefined): string {
  if (!p) return CLOSE_COPY.person.teamMember;
  switch (p.kind) {
    case "device":
      return CLOSE_COPY.person.device;
    case "system":
      return CLOSE_COPY.person.system;
    case "mingla_support":
      // #4490 after #4579: the server's name already carries the Mingla mark
      // ("Kunle from Mingla"); "Mingla Team" when there is no safe name.
      return p.name ?? CLOSE_COPY.person.minglaSupport;
    case "person":
      return p.name ?? CLOSE_COPY.person.teamMember;
    default: {
      const never: never = p.kind;
      return never;
    }
  }
}

/**
 * #4490 08-O5 fix 4: how a late payment is named on the closed day: the
 * check's name or QR spot, else who took it, never a bare "Team member".
 */
export function latePaymentTitle(p: Pick<DayLatePayment, "checkLabel" | "takenBy">): string {
  if (p.checkLabel !== null && p.checkLabel.trim() !== "") return p.checkLabel;
  const by = p.takenBy;
  if (by !== null && !(by.kind === "person" && by.name === null)) return CLOSE_COPY.lateTakenBy(personName(by));
  return CLOSE_COPY.latePaymentUntitled;
}

export function blockingChecks(summary: DaySummary): DayOpenCheck[] {
  return summary.openChecks.filter((c) => c.blocks);
}

export function waitingChecks(summary: DaySummary): DayOpenCheck[] {
  return summary.openChecks.filter((c) => !c.blocks && c.waitingForScan);
}

/** The view a day is in (close-day, close-done). */
export type DayView = "open" | "closed";

export function dayView(summary: DaySummary): DayView {
  return summary.state === "closed" ? "closed" : "open";
}

/** A date the close may name: today's service day or the 7 days before it. */
export function dateProblem(date: string, today: string): "future" | "too_old" | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  if (date > today) return "future";
  const t = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const d = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return (t - d) / 86_400_000 > 7 ? "too_old" : null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-21" -> "Sat 21 Nov" (a calendar day; no device clock or zone). */
export function dayLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "1 h 52 min", "22 min". */
export function ageLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}

// ---------------------------------------------------------------- settings

export const TIP_OPTIONS_MAX = 6;
export const TIP_PERCENT_MAX = 30;
export const AUTO_LOCK_MIN = 1;
export const AUTO_LOCK_MAX = 10;
export const TARGET_MIN = 1;
export const TARGET_MAX = 90;
export const FOOTER_MAX = 200;

/** Tip choices are stored in basis points; the screen edits whole and half percents. */
export function bpsToPercentText(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1).replace(/\.0$/, "");
}

/** Only what changed is sent (the server merges it with its version check). */
export function settingsPatchFrom(base: TillSettings, draft: TillSettings): TillSettingsPatch {
  const patch: TillSettingsPatch = {};
  if (draft.tipsEnabled !== base.tipsEnabled) patch.tipsEnabled = draft.tipsEnabled;
  if (JSON.stringify(draft.tipBpsOptions) !== JSON.stringify(base.tipBpsOptions)) patch.tipBpsOptions = draft.tipBpsOptions;
  if (draft.autoLockMinutes !== base.autoLockMinutes) patch.autoLockMinutes = draft.autoLockMinutes;
  if (draft.printPaper !== base.printPaper) patch.printPaper = draft.printPaper;
  if (draft.defaultStation !== base.defaultStation) patch.defaultStation = draft.defaultStation;
  if (draft.targetMinutes.kitchen !== base.targetMinutes.kitchen || draft.targetMinutes.bar !== base.targetMinutes.bar) {
    patch.targetMinutes = draft.targetMinutes;
  }
  if (JSON.stringify([...draft.screenStations].sort()) !== JSON.stringify([...base.screenStations].sort())) {
    patch.screenStations = draft.screenStations;
  }
  const footer = (draft.receiptFooter ?? "").trim();
  if (footer !== (base.receiptFooter ?? "")) patch.receiptFooter = footer.length > 0 ? footer : null;
  return patch;
}

export function settingsValid(draft: TillSettings): boolean {
  return draft.tipBpsOptions.length <= TIP_OPTIONS_MAX
    && draft.tipBpsOptions.every((b) => Number.isInteger(b) && b >= 0 && b <= TIP_PERCENT_MAX * 100)
    && draft.autoLockMinutes >= AUTO_LOCK_MIN && draft.autoLockMinutes <= AUTO_LOCK_MAX
    && (draft.receiptFooter ?? "").trim().length <= FOOTER_MAX;
}

/**
 * #4490 08-O5 fix 2 (O5-B4): how wide a headline tile on the closed-day card
 * is. Four across only where there is room for a full amount (1024 and up);
 * below that each tile takes its own row, so "₦45,100.00" is never cut off at
 * 390 or 768. The amount itself also wraps (KpiTile wrapValue) as the floor.
 */
export function closedTileBasis(windowWidth: number): "100%" | "22%" {
  return windowWidth >= 1024 ? "22%" : "100%";
}
