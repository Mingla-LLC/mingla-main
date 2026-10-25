/**
 * Door scan result copy for the issue #3827 "Find by name" Admit, worded
 * exactly as the QR camera's result overlay (scanner/index.tsx
 * handleBarcodeScanned), so a QR scan and a name admit say the same thing.
 * The QR branch itself is left as it is (it is pinned by ORCH-0793/0795/1447
 * gates); a test pins the two to the same strings.
 *
 * Pure: no camera, no haptics (the web door imports it too).
 */

import type { ScanResult } from "../../store/scanStore";

const RELATIVE_TIME_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

export const formatRelativeTime = (iso: string): string => {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const delta = now - then;
  if (delta < RELATIVE_TIME_MS.minute) return "just now";
  if (delta < RELATIVE_TIME_MS.hour) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.minute)}m ago`;
  }
  if (delta < RELATIVE_TIME_MS.day) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.hour)}h ago`;
  }
  return `${Math.floor(delta / RELATIVE_TIME_MS.day)}d ago`;
};

// ORCH-0793 — render an upcoming door time as the operator reads it.
// Same day → "at 9:00 PM"; tomorrow → "tomorrow 9:00 PM";
// further out → "Fri Nov 14, 9:00 PM". UTC ISO in, locale string out.
export const formatDoorTime = (iso: string): string => {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const now = new Date();
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    then.getFullYear() === tomorrow.getFullYear() &&
    then.getMonth() === tomorrow.getMonth() &&
    then.getDate() === tomorrow.getDate();
  const time = then.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return `at ${time}`;
  if (isTomorrow) return `tomorrow ${time}`;
  const date = then.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${date}, ${time}`;
};

export type ScanTone = "success" | "warning" | "error";

export interface ScanResultCopy {
  kind: ScanResult;
  message: string;
  detail?: string;
  tone: ScanTone;
}

const KNOWN: ReadonlySet<string> = new Set<ScanResult>([
  "success", "duplicate", "wrong_event", "not_found", "void",
  "cancelled_order", "not_yet_open", "event_ended",
]);

export const asScanResult = (raw: string): ScanResult =>
  KNOWN.has(raw) ? (raw as ScanResult) : "not_found";

/**
 * issue #3281 PR8 — admitted-date line for the door overlay.
 * "Admitted - Sat 25 Oct - Halloween edition" / "Date 2 of 3" as detail.
 */
export const formatAdmittedDateLine = (opts: {
  dayLabel: string | null | undefined;
  overrideTitle?: string | null;
  passIndex?: number | null;
  passTotal?: number | null;
}): string | null => {
  const day =
    typeof opts.dayLabel === "string" && opts.dayLabel.trim().length > 0
      ? opts.dayLabel.trim()
      : null;
  if (day === null) return null;
  const title =
    typeof opts.overrideTitle === "string" && opts.overrideTitle.trim().length > 0
      ? opts.overrideTitle.trim()
      : null;
  return title !== null ? `Admitted - ${day} - ${title}` : `Admitted - ${day}`;
};

export const formatPassDateProgress = (
  passIndex: number | null | undefined,
  passTotal: number | null | undefined,
): string | null => {
  if (
    typeof passIndex !== "number" ||
    typeof passTotal !== "number" ||
    !Number.isFinite(passIndex) ||
    !Number.isFinite(passTotal) ||
    passTotal < 2 ||
    passIndex < 1
  ) {
    return null;
  }
  return `Date ${passIndex} of ${passTotal}`;
};

/** What the door says for one server scan result. `noun` is the offering noun ("event"). */
export const describeScanResult = (
  raw: string,
  scan: {
    buyerName: string | null;
    ticketName: string | null;
    nextStartAt: string | null;
    lastEndAt: string | null;
    /** issue #3281 PR8 */
    eventDateId?: string | null;
    dayLabel?: string | null;
    overrideTitle?: string | null;
    passIndex?: number | null;
    passTotal?: number | null;
  },
  noun: string,
): ScanResultCopy => {
  const kind = asScanResult(raw);
  const nounCap = noun.length > 0 ? `${noun[0].toUpperCase()}${noun.slice(1)}` : noun;
  const admitted = formatAdmittedDateLine(scan);
  const passProgress = formatPassDateProgress(scan.passIndex, scan.passTotal);
  const day =
    typeof scan.dayLabel === "string" && scan.dayLabel.trim().length > 0
      ? scan.dayLabel.trim()
      : null;
  switch (kind) {
    case "success":
      return {
        kind,
        message: admitted ?? `${scan.buyerName ?? "Guest"} checked in`,
        detail:
          passProgress ??
          (admitted !== null
            ? (scan.buyerName ?? scan.ticketName ?? "Ticket")
            : (scan.ticketName ?? "Ticket")),
        tone: "success",
      };
    case "duplicate":
      return {
        kind,
        message: day !== null ? `Already scanned for ${day}` : "Already checked in",
        detail: scan.ticketName ?? undefined,
        tone: "warning",
      };
    case "wrong_event":
      return { kind, message: `Different ${noun}`, detail: scan.ticketName ?? undefined, tone: "error" };
    case "void":
      return { kind, message: "Ticket not valid", detail: scan.ticketName ?? undefined, tone: "error" };
    case "not_yet_open":
      return {
        kind,
        message: "Doors aren't open yet",
        detail: scan.nextStartAt
          ? `Opens ${formatDoorTime(scan.nextStartAt)}`
          : day !== null
            ? `Opens ${day}`
            : "Try again closer to start time",
        tone: "warning",
      };
    case "event_ended":
      return {
        kind,
        message: scan.lastEndAt ? `${nounCap} ended ${formatRelativeTime(scan.lastEndAt)}` : `${nounCap} has ended`,
        detail: `Ticket can't be used after the ${noun}`,
        tone: "warning",
      };
    case "not_found":
    case "cancelled_order":
      return { kind, message: "Ticket not found", detail: scan.ticketName ?? undefined, tone: "error" };
    default: {
      const _exhaust: never = kind;
      return _exhaust;
    }
  }
};
