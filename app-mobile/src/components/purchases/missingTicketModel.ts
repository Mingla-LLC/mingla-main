/**
 * #4473 — pure helpers for "Missing a ticket?" and its add sheet.
 *
 * Kept free of React Native imports so the route, the sheet and the purchase
 * banner share one answer for where a found ticket opens, how long ago the
 * last check ran and what the "ask them to send it" message says.
 */
import { formatPhoneNational } from "@mingla/phone-input/phoneNumber";

import { COUNTRIES } from "../../constants/countries";
import type { ClaimedEntry } from "../../services/attendanceClaimService";
import type { ClaimIdentifier } from "../../services/claimContactService";
import { formatStartsAtLabel } from "../../utils/zoneLabel";

/** Where a found purchase opens: the same detail routes Purchases uses. */
export function claimedEntryPath(entry: ClaimedEntry): string {
  if (
    entry.routeKind === "order" || entry.routeKind === "rsvp" ||
    entry.routeKind === "reservation" || entry.routeKind === "venue_order"
  ) {
    return `/purchases/${entry.routeKind}/${encodeURIComponent(entry.routeId)}`;
  }
  if (entry.routeKind === "held_ticket") {
    return `/purchases/order/${encodeURIComponent(entry.routeId)}`;
  }
  return "/purchases";
}

/** "Tue 15 Dec, 19:00 · Lantern Room", or whichever half is known. */
export function claimedEntryMetaLine(entry: ClaimedEntry): string | null {
  const parts = [
    formatStartsAtLabel(entry.startsAt, entry.timezone),
    entry.venueLine?.trim() || null,
  ].filter((part): part is string => !!part);
  return parts.length ? parts.join(" · ") : null;
}

export type LastCheckedCopy =
  | { key: "justNow" }
  | { key: "minutes"; count: number }
  | { key: "hours"; count: number }
  | { key: "days"; count: number };

/** Buckets the time since the last sweep for the "Last checked …" line. */
export function lastCheckedCopy(checkedAt: number, now: number): LastCheckedCopy {
  const minutes = Math.floor(Math.max(0, now - checkedAt) / 60_000);
  if (minutes < 1) return { key: "justNow" };
  if (minutes < 60) return { key: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "hours", count: hours };
  return { key: "days", count: Math.floor(hours / 24) };
}

/** 24 → "0:24", 75 → "1:15". */
export function resendClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** "+15555550123" → "+1 (555) 555-0123", written the way its country writes it. */
export function formatPhoneForMessage(e164: string): string {
  const normalized = e164.replace(/[^+\d]/g, "");
  const country = [...COUNTRIES]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((candidate) => normalized.startsWith(candidate.dialCode));
  if (!country) return normalized;
  const national = normalized.slice(country.dialCode.length);
  const formatted = formatPhoneNational(country.code, national).trim();
  return `${country.dialCode} ${formatted || national}`;
}

/**
 * The confirmed contacts to put in the share message: the first email and the
 * first mobile this account has proved. Nothing unconfirmed is ever included.
 */
export function askMessageContacts(
  identifiers: readonly ClaimIdentifier[] | null | undefined,
): string[] {
  const list = identifiers ?? [];
  const email = list.find((identifier) => identifier.kind === "email");
  const phone = list.find((identifier) => identifier.kind === "phone");
  return [
    email ? email.value : null,
    phone ? formatPhoneForMessage(phone.value) : null,
  ].filter((value): value is string => !!value);
}

/** True when any found ticket is also confirmed on another account. */
export function hasSharedEntry(entries: readonly ClaimedEntry[]): boolean {
  return entries.some((entry) => entry.sharedWithAnotherAccount === true);
}

/** Merges the verify result with a follow-up sweep, newest entry wins. */
export function mergeFoundEntries(
  first: readonly ClaimedEntry[],
  second: readonly ClaimedEntry[],
): ClaimedEntry[] {
  const byKey = new Map(first.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  for (const entry of second) byKey.set(`${entry.kind}:${entry.id}`, entry);
  return [...byKey.values()];
}
