/**
 * issue #4271 — what the host's "Scan to pay" screen shows, as pure data
 * (approved design H3–H5). The guest page's copy (B4–B5) is in
 * doorPayGuestState.ts, so the two routes share no state module.
 *
 * Only the server says a code is over. The host's clock passing `expires_at`
 * means "ask" (a payment may be going through); every end state says whether
 * money was taken.
 */

import type {
  DoorPayCodeStatus,
  DoorPayLatePayment,
  DoorPayLiveStatus,
} from "../../services/doorPayCodeService";

export const isDoorPayPastTime = (
  status: DoorPayCodeStatus,
  expiresAt: string,
  nowMs: number,
): boolean => {
  if (status !== "open" && status !== "opened") return false;
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && nowMs > expiry;
};

/**
 * What the host's screen shows. A server answer of payment_landing holds until
 * the row turns paid. Past its time, the code reads "checking" until the server
 * answers; if the server says the code is still live, the phone's clock was ahead.
 */
export const doorPayHostStatus = (
  status: DoorPayCodeStatus,
  expiresAt: string,
  nowMs: number,
  serverAnswer: DoorPayLiveStatus | null,
): DoorPayLiveStatus => {
  if (status !== "open" && status !== "opened") return status;
  if (serverAnswer === "payment_landing") return "payment_landing";
  if (!isDoorPayPastTime(status, expiresAt, nowMs)) return status;
  return serverAnswer === "open" || serverAnswer === "opened" ? status : "checking";
};

/** "9:42" — whole seconds left, never negative. */
export const formatDoorPayCountdown = (expiresAt: string, nowMs: number): string => {
  const expiry = new Date(expiresAt).getTime();
  const left = Number.isFinite(expiry) ? Math.max(0, Math.floor((expiry - nowMs) / 1000)) : 0;
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

/** Whole seconds left on a code (0 once past, or for an unreadable time). */
export const doorPayCountdownSeconds = (expiresAt: string, nowMs: number): number => {
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) ? Math.max(0, Math.floor((expiry - nowMs) / 1000)) : 0;
};

/** Door polish: under a minute left, the status pill's dot turns warning. */
export const DOOR_PAY_URGENT_SECONDS = 60;

/** The waiting pill: the one live number on the screen, in tabular digits. */
export const doorPayWaitingPillText = (countdown: string): string => `Point your camera here · ${countdown}`;

/** What a screen reader hears on focus: "Code expires in 9 minutes 42 seconds". */
export const doorPayCountdownWords = (secondsLeft: number): string => {
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (seconds > 0 || minutes === 0) parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  return `Code expires in ${parts.join(" ")}`;
};

export type DoorPayHostAction = "new_code" | "cash_instead" | "back_to_door";

export interface DoorPayHostEndCopy {
  title: string;
  body: string;
  primary: { label: string; action: DoorPayHostAction };
  secondary: { label: string; action: DoorPayHostAction } | null;
}

/** H5 — the host's end states. */
export const doorPayHostEndCopy = (
  status: "expired" | "failed" | "cancelled",
): DoorPayHostEndCopy => {
  switch (status) {
    case "expired":
      return {
        title: "This code expired",
        body: "Nothing was charged. Show a new code to try again.",
        primary: { label: "Show a new code", action: "new_code" },
        secondary: { label: "Take cash instead", action: "cash_instead" },
      };
    case "failed":
      return {
        title: "Payment didn't go through",
        body: "Their bank declined it. Nothing was charged.",
        primary: { label: "Try again", action: "new_code" },
        secondary: { label: "Take cash instead", action: "cash_instead" },
      };
    case "cancelled":
      return {
        title: "Sale cancelled",
        body: "The code no longer works. Nothing was charged.",
        primary: { label: "Back to door sales", action: "back_to_door" },
        secondary: null,
      };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
};

/**
 * Opens the sale sheet only once nothing can still land on this code: a live code
 * is closed first, and a close that didn't confirm (a payment landed, or no
 * answer) leaves the sheet shut so the host can't charge twice.
 */
export const closeDoorPayCodeThen = async (args: {
  status: DoorPayCodeStatus | undefined;
  close: () => Promise<boolean>;
  open: () => void;
}): Promise<void> => {
  const live = args.status === "open" || args.status === "opened";
  if (live && !(await args.close())) return;
  args.open();
};

/** What the server says about money on a closed code. */
export type DoorPayLatePaymentRead =
  | { kind: "checking" }
  | { kind: "unknown" }
  | { kind: "none" }
  | { kind: "payment"; state: DoorPayLatePayment["state"]; amount: string };

/**
 * The end-state body. "Nothing was charged." only when the provider can take no
 * more money and the server found none: Paystack has no way to close its page,
 * so its copy says what happens if a payment still lands. A refund reads
 * "refunded" only once the provider confirmed it; before that it may be queued
 * and not sent (the refund worker's kill switch), so the copy says exactly that.
 */
export const doorPayHostEndBody = (
  status: "expired" | "failed" | "cancelled",
  late: DoorPayLatePaymentRead,
  provider: "stripe" | "paystack" = "stripe",
): string => {
  switch (late.kind) {
    case "none":
      if (provider === "paystack" && status !== "failed") {
        return status === "expired"
          ? "No payment has come in. If one still lands, it's refunded in full. Show a new code to try again."
          : "The code no longer works. No payment has come in. If one still lands, it's refunded in full.";
      }
      return doorPayHostEndCopy(status).body;
    case "checking":
      return "Checking for a payment…";
    case "unknown":
      return "Couldn't check for a payment. Check your connection before charging them again.";
    case "payment":
      switch (late.state) {
        case "refunded":
          return `A payment came in after this code closed. ${late.amount} was refunded to the guest.`;
        case "refunding":
          return `A payment came in after this code closed. ${late.amount} is queued to go back to the guest. It hasn't reached them yet. Don't charge them again until it has.`;
        case "kept":
          return `A payment of ${late.amount} came in after this code closed. It stands as an online order, so you can refund it from Orders.`;
        default: {
          const exhaustive: never = late.state;
          return exhaustive;
        }
      }
    default: {
      const exhaustive: never = late;
      return exhaustive;
    }
  }
};

/**
 * The paid screen's Guest row. Null hides the row: "Walk-up" is only ever the
 * server's answer, never a name that is still loading or failed to load.
 */
export const doorPayGuestRowValue = (read: {
  isSuccess: boolean;
  name: string | null | undefined;
}): string | null => {
  if (!read.isSuccess) return null;
  return typeof read.name === "string" && read.name.trim().length > 0 ? read.name.trim() : "Walk-up";
};

/** "2× General admission" or "5 tickets". */
export const summarizeDoorPayLines = (
  lines: { name: string; quantity: number }[],
): string => {
  if (lines.length === 0) return "";
  if (lines.length === 1) return `${lines[0].quantity}× ${lines[0].name}`;
  return `${lines.reduce((sum, line) => sum + line.quantity, 0)} tickets`;
};

/** Seconds since the guest opened the link, for "Opened on their phone 12s ago". */
export const openedAgoLabel = (openedAt: string | null, nowMs: number): string => {
  if (openedAt === null) return "just now";
  const opened = new Date(openedAt).getTime();
  if (!Number.isFinite(opened)) return "just now";
  const seconds = Math.max(0, Math.floor((nowMs - opened) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
};

/**
 * H6 — what the host sees when door-pay-code text_link refuses: 429
 * text_link_limit_reached (3 texts per code), 400 buyer_phone_invalid, 409
 * door_code_unavailable, else a retry line. Reads DoorPayCodeError's
 * {code, status} structurally so this file stays free of the service import.
 */
export const doorPayTextLinkErrorMessage = (error: unknown): string => {
  const e = typeof error === "object" && error !== null ? (error as { code?: unknown; status?: unknown }) : {};
  if (e.code === "text_link_limit_reached" || e.status === 429) {
    return "This code has been texted 3 times already. Ask them to scan it, or show a new code.";
  }
  if (e.code === "buyer_phone_invalid") {
    return "That number doesn't look right. Check it and try again.";
  }
  if (e.code === "door_code_unavailable") {
    return "This code can't be paid any more. Show a new code.";
  }
  return "Couldn't send the link. Check your connection and try again.";
};
