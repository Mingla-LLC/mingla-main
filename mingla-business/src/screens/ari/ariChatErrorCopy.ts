/**
 * #3184 — the words the Ari chat shows when a message could not be answered.
 *
 * Before this module the chat had copy for a handful of codes and fell back to
 * "check your connection" for everything else. A brand with no website, a role
 * refusal and a conflict were all reported as a broken network the device did
 * not have. Now every registry code has its own honest sentence, and the
 * connection sentence belongs to exactly one code: TRANSPORT_UNAVAILABLE, which
 * agentChatService returns only when the request never reached Mingla.
 *
 * Dependency-free on purpose: a type-only import, no React Native, no
 * diagnostics. The screen lazy-loads its reporter (#3186), and this module
 * must not undo that.
 */

import type { AriErrorCode } from "../../services/agentReliability";

export const ARI_CHAT_CONNECTION_COPY =
  "Ari could not connect — check your connection and try again.";

const INTERNAL_COPY =
  "Ari couldn't finish that request. Nothing was changed; try again shortly.";

// Typed against the registry's AriErrorCode union, so adding a family without
// copy fails the type check instead of silently falling back.
const REGISTRY_COPY: Readonly<Record<AriErrorCode, string>> = Object.freeze({
  VALIDATION_FAILED:
    "Ari couldn't use those details. Nothing was changed; try rephrasing.",
  UNAUTHENTICATED:
    "Your session expired. Sign in again to keep chatting with Ari.",
  FORBIDDEN:
    "Your role on this brand doesn't allow that. Nothing was changed.",
  ROLE_REVOKED: "Your access to this brand changed. Nothing was changed.",
  TENANT_MISMATCH:
    "This chat belongs to a different brand. Start a new chat for this brand.",
  STALE_PROPOSAL:
    "That request is out of date. Nothing was changed; ask Ari again.",
  CONFLICT:
    "Something changed while Ari was working. Nothing was changed; try again.",
  RATE_LIMITED: "Ari is busy right now. Try again shortly.",
  OFFLINE: "You're offline. Reconnect to continue this plan.",
  // The ONLY entry that mentions the connection.
  TRANSPORT_UNAVAILABLE: ARI_CHAT_CONNECTION_COPY,
  PROVIDER_UNAVAILABLE:
    "Ari is temporarily unavailable. Nothing was changed; try again shortly.",
  DEPENDENCY_UNAVAILABLE:
    "Ari can't reach part of Mingla right now. Nothing was changed; try again shortly.",
  DEADLINE_EXCEEDED:
    "Ari is checking whether that finished. Don't send it again yet.",
  RESULT_UNKNOWN: "Ari is confirming the result. Don't send it again yet.",
  RECONCILIATION_REQUIRED:
    "Ari is verifying the result before showing it as complete.",
  MINIMUM_VERSION_REQUIRED: "Update Mingla Business to keep using Ari.",
  PAID_ORDER_MUST_REFUND:
    "Paid orders can't be cancelled. Ask Ari to refund the order instead.",
  REFUND_PREVIEW_UNPRICED:
    "Ari couldn't get an exact refund amount. Nothing was changed; try again in a moment.",
  DOMAIN_ACTION_REFUSED:
    "Mingla couldn't complete that as requested. Nothing was changed; review the details and try something different.",
  INTERNAL: INTERNAL_COPY,
});

// Client-origin codes and retained legacy task-state codes the chat can still
// receive. None of them mentions the connection.
const CLIENT_COPY: Readonly<Record<string, string>> = Object.freeze({
  // #3186 — a misconfiguration is NOT a network error and must never be
  // reported as one. `ENVELOPE_INVALID` means the server answered and this app
  // refused the answer: exactly what #3185 was, and for nine days every user
  // was told to check a connection that was fine.
  ENVELOPE_INVALID:
    "Ari replied but this app couldn't verify the response. That's on us — it's been reported.",
  EDGE_ERROR: INTERNAL_COPY,
  EMPTY: "Ari didn't send a reply. Nothing was changed; try again.",
  IN_FLIGHT: "Ari is already working on that request.",
  TASK_STATE_CONFLICT:
    "This plan changed on another device. Ari refreshed it; choose again.",
  CHOICE_STALE:
    "That choice is no longer active. Ari refreshed the current step.",
  TIMEZONE_REQUIRED:
    "Ari needs your timezone before choosing an exact date and time.",
  PLANNER_UNAVAILABLE:
    "Ari couldn't safely plan that step. Your progress is saved; try again.",
  TASK_STATE_INVALID:
    "Ari couldn't safely read this plan. Nothing was changed.",
  TASK_STATE_OVERSIZED:
    "This plan is too large to continue safely. Start a new Ari chat.",
  TASK_RECOVERY_REQUIRED:
    "The action finished, but Ari needs to reconcile the plan before continuing.",
});

function ownCopy(
  table: Readonly<Record<string, string>>,
  code: string,
): string | undefined {
  // Own keys only: a code such as "constructor" must not match Object.prototype.
  return Object.prototype.hasOwnProperty.call(table, code)
    ? table[code]
    : undefined;
}

/** The toast copy for a failed Ari chat send. Unknown codes get INTERNAL copy. */
export function ariChatErrorCopy(code: string): string {
  return ownCopy(REGISTRY_COPY, code) ?? ownCopy(CLIENT_COPY, code) ??
    INTERNAL_COPY;
}

/**
 * True when the failure is one we did not anticipate and must reach Sentry:
 * an envelope this app refused, an unclassified edge error, or any code with
 * no copy of its own.
 */
export function shouldReportAriChatError(code: string): boolean {
  if (code === "ENVELOPE_INVALID" || code === "EDGE_ERROR") return true;
  return ownCopy(REGISTRY_COPY, code) === undefined &&
    ownCopy(CLIENT_COPY, code) === undefined;
}
