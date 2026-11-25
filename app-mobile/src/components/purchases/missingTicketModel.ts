/**
 * #4473 — pure helpers for "Missing a ticket?" and its add sheet.
 *
 * Kept free of React Native imports so the route, the sheet and the purchase
 * banner share one answer for where a found ticket opens, how long ago the
 * last check ran and what the "ask them to send it" message says.
 */
import { formatPhoneNational } from "@mingla/phone-input/phoneNumber";

import { COUNTRIES } from "../../constants/countries";
import type { ClaimedEntry, PendingClaim } from "../../services/attendanceClaimService";
import { linkedClaimedEntry } from "../../services/pendingClaimPolicy";
import type { ClaimIdentifier } from "../../services/claimContactService";
import { formatStartsAtLabel } from "../../utils/zoneLabel";

/** Where a found purchase opens: the same detail routes Purchases uses. */
export function claimedEntryPath(entry: ClaimedEntry): string {
  if (
    entry.routeKind === "order" || entry.routeKind === "rsvp" ||
    entry.routeKind === "reservation" || entry.routeKind === "venue_order" ||
    // #4490 Explorer W2 (N157 closed): venue bookings, plans and waitlist
    // places open their own Purchases detail (the pass, the plan, the place).
    entry.routeKind === "venue_booking" || entry.routeKind === "venue_membership" ||
    entry.routeKind === "venue_waitlist"
  ) {
    return `/purchases/${entry.routeKind}/${encodeURIComponent(entry.routeId)}`;
  }
  // #4490 Explorer W1: Till receipts open the Purchases list.
  // [TRANSITIONAL] list, not detail: exits when spec 08 adds the Till receipt
  // detail (then route it like the venue kinds above).
  if (entry.routeKind === "venue_till_sale") {
    return "/purchases";
  }
  if (entry.routeKind === "held_ticket") {
    return `/purchases/order/${encodeURIComponent(entry.routeId)}`;
  }
  if (entry.routeKind === "stay") {
    // #4473 — a shared stay opens read-only in Purchases; the buyer's own
    // stay opens on its stay screen.
    return entry.role === "shared"
      ? `/purchases/stay/${encodeURIComponent(entry.routeId)}`
      : `/stay/${encodeURIComponent(entry.routeId)}`;
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

/**
 * #4473 — the countries claim-contact can text a code to
 * (supabase/functions/claim-contact SUPPORTED_PHONE_COUNTRIES). The add
 * sheet's country picker offers only these, in this order.
 */
export const CLAIM_PHONE_COUNTRIES = ["US", "CA", "GB", "NG", "GH", "KE", "ZA"] as const;
export type ClaimPhoneCountry = (typeof CLAIM_PHONE_COUNTRIES)[number];

export function isClaimPhoneCountry(code: string | null | undefined): code is ClaimPhoneCountry {
  return !!code && (CLAIM_PHONE_COUNTRIES as readonly string[]).includes(code);
}

/** The device's country when claim-contact can text it, else the US. */
export function defaultClaimPhoneCountry(deviceCountry: string | null | undefined): ClaimPhoneCountry {
  return isClaimPhoneCountry(deviceCountry) ? deviceCountry : "US";
}

const EXAMPLE_NATIONAL: Record<ClaimPhoneCountry, string> = {
  US: "5551234567",
  CA: "4165551234",
  GB: "07400123456",
  NG: "08021234567",
  GH: "0241234567",
  KE: "0712345678",
  ZA: "0712345678",
};

/** An example mobile number written the way the selected country writes it. */
export function claimPhonePlaceholder(country: string | null | undefined): string | undefined {
  if (!isClaimPhoneCountry(country)) return undefined;
  return formatPhoneNational(country, EXAMPLE_NATIONAL[country]).trim();
}

/**
 * #4490 W2-N24 — the landed question uses the noun the server sent for the
 * claim (a venue pass is "Is this your pass?"); a ticket keeps its words.
 */
export function claimLinkLandedTitleKey(noun: string | null): string {
  return noun === "pass" || noun === "booking" || noun === "receipt"
    ? `missing.landed.titleNoun.${noun}`
    : "missing.landed.title";
}

export type OnboardingClaimHandoff = {
  /** Where the app goes when onboarding ends; null = stay on Home. */
  path: string | null;
  /** The opened purchase's kind (log only); null when nothing opens. */
  kind: ClaimedEntry["kind"] | null;
  /** Why (log only, never personal): no_link, nothing_attached, linked, several_unmatched. */
  reason: "no_link" | "nothing_attached" | "linked" | "several_unmatched";
};

/**
 * #4490 W2-N31 — a new account made from a claim link's welcome card: when
 * onboarding ends, open THAT purchase's detail. `linked` is the claim the link
 * resolved to (welcome card or onboarding's pending claim); `attached` is the
 * claimed rows of the sweep that attached them. Several found and none
 * matching the link opens the Purchases list (the others stay reachable
 * there). No link: nothing changes (Home and the found-purchase banner).
 */
export function onboardingClaimHandoff(
  linked: PendingClaim | null,
  attached: readonly ClaimedEntry[] | null,
): OnboardingClaimHandoff {
  if (linked === null) return { path: null, kind: null, reason: "no_link" };
  if (attached === null || attached.length === 0) {
    return { path: null, kind: null, reason: "nothing_attached" };
  }
  const entry = linkedClaimedEntry(attached, linked);
  if (entry === null) return { path: "/purchases", kind: null, reason: "several_unmatched" };
  return { path: claimedEntryPath(entry), kind: entry.kind, reason: "linked" };
}

/**
 * #4490 N157 — where the found-purchase banner's View goes: one purchase, or
 * the one the claim link was for when the sweep attached several, opens its
 * own detail; anything else opens the Purchases list.
 */
export function bannerDestination(
  claimed: readonly ClaimedEntry[],
  linkedClaim: PendingClaim | null = null,
): string {
  const entry = linkedClaimedEntry(claimed, linkedClaim);
  return entry ? claimedEntryPath(entry) : "/purchases";
}

/** W2-N31 — the banner's View handler: hide the banner, then open the target. */
export function openFoundBannerTarget(input: {
  claimed: readonly ClaimedEntry[];
  linkedClaim: PendingClaim | null;
  dismiss: () => void;
  push: (path: string) => void;
}): string {
  const path = bannerDestination(input.claimed, input.linkedClaim);
  input.dismiss();
  input.push(path);
  return path;
}
