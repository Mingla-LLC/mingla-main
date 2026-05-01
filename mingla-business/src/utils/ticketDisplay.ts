/**
 * Centralised ticket display helpers (I-15 — single source).
 *
 * NEVER implement local ticket-modifier formatters in components.
 * Reuse the helpers below or extend this file with new ones.
 *
 * Mirrors the I-14 pattern established by `eventDateDisplay.ts` for
 * date display. Established by Cycle 5 spec §3.3 + investigation
 * HIDDEN-2 (Constitution #2 lift).
 *
 * `displayOrder` is OWNED by this file. Never mutate it inline in
 * components — always go through `moveTicketUp` / `moveTicketDown` /
 * `renormalizeDisplayOrder`.
 */

import type { TicketStub } from "../store/draftEventStore";
import { formatGbpRound, formatCount } from "./currency";

export interface TicketBadge {
  label: string;
  variant: "info" | "warning" | "muted" | "accent";
}

/**
 * "Free · max 4 / buyer · approval" — sub-line under ticket name.
 *
 * Modifiers compose left-to-right:
 *   price → max-per-buyer (if non-default) → approval → password →
 *   waitlist → non-transferable.
 */
export const formatTicketSubline = (t: TicketStub): string => {
  const parts: string[] = [];

  // Price (always first)
  parts.push(
    t.isFree ? "Free" : t.priceGbp !== null ? formatGbpRound(t.priceGbp) : "—",
  );

  // Max purchase qty — only show when meaningful (cap < 10)
  if (t.maxPurchaseQty !== null && t.maxPurchaseQty < 10) {
    parts.push(`max ${t.maxPurchaseQty} / buyer`);
  }

  // Modifiers — short labels for compact sub-line
  if (t.approvalRequired) parts.push("approval");
  if (t.passwordProtected) parts.push("password");
  if (t.waitlistEnabled) parts.push("waitlist");
  if (!t.allowTransfers) parts.push("non-transferable");

  return parts.join(" · ");
};

/** Capacity display for ticket card stats row. */
export const formatTicketCapacity = (t: TicketStub): string => {
  if (t.isUnlimited) return "Unlimited";
  if (t.capacity !== null) return formatCount(t.capacity);
  return "—";
};

/**
 * Returns badges for a ticket. Badges render as Pill primitives in
 * Step 5 TicketCard, Step 7 mini card (per-ticket), and PreviewEventView.
 *
 * Order matters — most important first (visibility blocks all others
 * since "Sales paused" overrides everything).
 */
export const formatTicketBadges = (t: TicketStub): TicketBadge[] => {
  const badges: TicketBadge[] = [];
  if (t.visibility === "disabled") {
    badges.push({ label: "Sales paused", variant: "warning" });
    // When disabled, suppress other badges — single clear signal
    return badges;
  }
  if (t.visibility === "hidden") {
    badges.push({ label: "Hidden — direct link only", variant: "muted" });
  }
  if (t.approvalRequired) badges.push({ label: "Approval required", variant: "info" });
  if (t.passwordProtected) badges.push({ label: "Password required", variant: "info" });
  if (t.waitlistEnabled) badges.push({ label: "+ Waitlist", variant: "info" });
  return badges;
};

/**
 * Buyer-side button copy on PreviewEventView's PublicTicketRow.
 *
 * Cycle 5 doesn't simulate "capacity reached" — waitlist label only
 * appears at runtime when capacity reaches 0 (Cycle 9/10).
 */
export const formatTicketButtonLabel = (t: TicketStub): string => {
  if (t.visibility === "disabled") return "Sales paused";
  if (t.approvalRequired) return "Request access";
  if (t.passwordProtected) return "Enter password to unlock";
  if (t.isFree) return "Get free ticket";
  return "Buy ticket";
};

/**
 * Aggregated event-level badges shown on Step 7 mini-card. Combines
 * across all tickets — "Some tickets require approval" if any ticket
 * has approvalRequired, etc.
 */
export const formatEventLevelTicketBadges = (
  tickets: TicketStub[],
): TicketBadge[] => {
  const badges: TicketBadge[] = [];
  if (tickets.some((t) => t.approvalRequired)) {
    badges.push({ label: "Some tickets require approval", variant: "info" });
  }
  if (tickets.some((t) => t.passwordProtected)) {
    badges.push({ label: "Some tickets are password-protected", variant: "info" });
  }
  if (tickets.some((t) => t.waitlistEnabled)) {
    badges.push({ label: "Waitlist available", variant: "info" });
  }
  return badges;
};

/**
 * Sort tickets by displayOrder ascending; ties broken by id (stable
 * fallback so React keys stay consistent across renders).
 */
export const sortTicketsByDisplayOrder = (
  tickets: TicketStub[],
): TicketStub[] => {
  return [...tickets].sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    return a.id.localeCompare(b.id);
  });
};

/**
 * Renormalize displayOrder values to 0..N-1 based on the array's CURRENT
 * positional order (NOT a re-sort by existing displayOrder).
 *
 * Caller responsibility: pass tickets in the desired final order.
 *
 * IMPORTANT: this previously re-sorted by displayOrder before renumbering,
 * which silently undid `moveTicketUp`/`moveTicketDown` swaps (the swapped
 * array still had original displayOrder values, sorting put them back in
 * original order). Fixed 2026-04-30.
 */
export const renormalizeDisplayOrder = (
  tickets: TicketStub[],
): TicketStub[] => {
  return tickets.map((t, i) => ({ ...t, displayOrder: i }));
};

/**
 * Move a ticket up by 1 position. Returns new array (renormalized).
 * Returns the same array reference if the ticket is already at the
 * top or doesn't exist — safe to use unconditionally.
 */
export const moveTicketUp = (
  tickets: TicketStub[],
  ticketId: string,
): TicketStub[] => {
  const sorted = sortTicketsByDisplayOrder(tickets);
  const idx = sorted.findIndex((t) => t.id === ticketId);
  if (idx <= 0) return tickets;
  const swapped = [...sorted];
  const a = swapped[idx];
  const b = swapped[idx - 1];
  swapped[idx - 1] = a;
  swapped[idx] = b;
  return renormalizeDisplayOrder(swapped);
};

/**
 * Move a ticket down by 1 position. Returns new array (renormalized).
 */
export const moveTicketDown = (
  tickets: TicketStub[],
  ticketId: string,
): TicketStub[] => {
  const sorted = sortTicketsByDisplayOrder(tickets);
  const idx = sorted.findIndex((t) => t.id === ticketId);
  if (idx === -1 || idx >= sorted.length - 1) return tickets;
  const swapped = [...sorted];
  const a = swapped[idx];
  const b = swapped[idx + 1];
  swapped[idx + 1] = a;
  swapped[idx] = b;
  return renormalizeDisplayOrder(swapped);
};

/**
 * Returns the next available displayOrder for a newly-created ticket.
 * Always = current max + 1, so new tickets append to end.
 */
export const nextDisplayOrder = (tickets: TicketStub[]): number => {
  if (tickets.length === 0) return 0;
  return Math.max(...tickets.map((t) => t.displayOrder)) + 1;
};
