/**
 * META-ORCH-1104 Phase 0 — support ticket status transition logic (pure).
 *
 * The status lifecycle (SPEC §2.1, enforced in the edge fn, not a DB trigger):
 *   new → open → pending ↔ open → resolved → closed
 *   resolved/closed may reopen → open on a new requester message.
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
