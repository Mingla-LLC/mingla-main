/**
 * issue #4271 — what the host's "Scan to pay" screen and the guest's
 * `/pay/door/<code>` page show, as pure data (approved design H3–H5, B4–B5).
 *
 * "expired" is derived: an open or opened code past `expires_at` reads as
 * expired even before the server persists it. Every end state says whether
 * money was taken.
 */

import type { DoorPayCodeStatus } from "../../services/doorPayCodeService";

export const effectiveDoorPayStatus = (
  status: DoorPayCodeStatus,
  expiresAt: string,
  nowMs: number,
): DoorPayCodeStatus => {
  if (status !== "open" && status !== "opened") return status;
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && nowMs > expiry ? "expired" : status;
};

/** "9:42" — whole seconds left, never negative. */
export const formatDoorPayCountdown = (expiresAt: string, nowMs: number): string => {
  const expiry = new Date(expiresAt).getTime();
  const left = Number.isFinite(expiry) ? Math.max(0, Math.floor((expiry - nowMs) / 1000)) : 0;
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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

export interface DoorPayGuestEndCopy {
  title: string;
  body: string;
}

/** B5 — the guest's "can't be used" states. Pre-purchase: no app talk. */
export const doorPayGuestEndCopy = (
  status: "expired" | "paid" | "cancelled" | "failed",
): DoorPayGuestEndCopy => {
  switch (status) {
    case "expired":
      return {
        title: "This code has expired",
        body: "You weren't charged. Ask the door to show a new one.",
      };
    case "paid":
      return {
        title: "This code is already paid",
        body: "If that was you, you're in. Check your texts for the receipt.",
      };
    case "cancelled":
      return {
        title: "The door cancelled this sale",
        body: "You weren't charged.",
      };
    case "failed":
      return {
        title: "Payment didn't go through",
        body: "You weren't charged. Ask the door to show a new code.",
      };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
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
