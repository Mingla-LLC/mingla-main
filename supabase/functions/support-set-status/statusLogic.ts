/**
 * META-ORCH-1104 Phase 0 — support ticket status transition logic (pure).
 *
 * The status lifecycle (SPEC §2.1, enforced in the edge fn, not a DB trigger):
 *   new → open → pending ↔ open → resolved → closed
 *   Staff may reopen resolved/closed → open.
 *   #4382: a customer message reopens pending/resolved → open (built in the
 *   send path, issue_4382_post_support_message, mirrored by
 *   statusAfterCustomerMessage below); a closed ticket refuses replies.
 *   Waiting (pending) needs a next-update time in the future.
 *
 * Pure + unit-testable so the adversarial "illegal transition" test (T-2.4)
 * runs without a live DB.
 */

export type SupportStatus = "new" | "open" | "pending" | "resolved" | "closed";

export const SUPPORT_STATUSES: readonly SupportStatus[] = [
  "new",
  "open",
  "pending",
  "resolved",
  "closed",
];

// Legal target set per current status. Staff-driven transitions only.
const LEGAL_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  new: ["open", "pending", "resolved", "closed"],
  open: ["pending", "resolved", "closed"],
  pending: ["open", "resolved", "closed"],
  resolved: ["open", "closed"], // reopen or close
  closed: ["open"], // reopen only
};

export function isSupportStatus(v: unknown): v is SupportStatus {
  return typeof v === "string" &&
    (SUPPORT_STATUSES as readonly string[]).includes(v);
}

export function isLegalTransition(
  from: SupportStatus,
  to: SupportStatus,
): boolean {
  if (from === to) return true; // idempotent no-op
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function resolvedAtForTransition(
  to: SupportStatus,
  priorResolvedAt: string | null,
): string | null {
  if (to === "resolved" || to === "closed") {
    return priorResolvedAt ?? new Date().toISOString();
  }
  // reopened → clear resolved_at
  if (to === "open" || to === "pending") return null;
  return priorResolvedAt;
}

/** #4382 — Waiting needs a next-update promise that is still in the future. */
export function waitingNeedsNextUpdate(
  to: SupportStatus,
  nextUpdateAt: string | null,
  nowMs = Date.now(),
): boolean {
  if (to !== "pending") return false;
  const at = nextUpdateAt ? Date.parse(nextUpdateAt) : Number.NaN;
  return !Number.isFinite(at) || at <= nowMs;
}

/**
 * #4382 — what a customer message does to a ticket. Mirrors the database
 * send path: Waiting or Resolved goes back to Open, a closed ticket refuses.
 */
export function statusAfterCustomerMessage(
  from: SupportStatus,
): { ok: true; status: SupportStatus; reopened: boolean } | {
  ok: false;
  error: "ticket_closed";
} {
  if (from === "closed") return { ok: false, error: "ticket_closed" };
  if (from === "pending" || from === "resolved") {
    return { ok: true, status: "open", reopened: true };
  }
  return { ok: true, status: from, reopened: false };
}
