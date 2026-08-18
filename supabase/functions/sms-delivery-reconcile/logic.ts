// ===========================================================================
// #2218 — `sent` IS AN ACCEPTANCE, NOT A DELIVERY. THIS IS WHERE THAT IS SETTLED.
// ===========================================================================
// THE DEFECT: `notification_deliveries` held seven SMS rows and exactly ONE had
// a `delivered_at`. Every Nigerian row — including one from 2026-08-04 with a
// perfectly ordinary numeric Termii id — sat at `sent`, `delivered_at NULL`,
// `failed_reason NULL`, forever. Nothing in the system ever revisited a `sent`
// row, so an accepted-and-dropped message and a delivered one were the same
// database state. That is why a founder had to notice a missing text.
//
// TWO REASONS A ROW CAN STALL AT `sent`, AND THEY NEED DIFFERENT ANSWERS:
//
//   1. THE REPORT NEVER CAME. Termii delivers status by webhook only, and a
//      webhook that is misconfigured, unsubscribed or firing at a stale URL
//      produces silence that is indistinguishable from success. Silence is not
//      evidence. So this sweep does not wait for it: it ASKS, via Termii's
//      History endpoint (`GET /api/sms/inbox?api_key=…&message_id=…`,
//      https://developers.termii.com/history), which reports the same terminal
//      statuses the webhook would have — Delivered / Message Sent / Rejected /
//      Expired / Message Failed / DND Active on Phone Number.
//
//   2. THE ID CANNOT BE ASKED ABOUT. The failing send returned
//      `sig_7678b296aa6240b4864a6dcb294124b4`, and a controlled re-send
//      returned `sig_d39356e5a21e477d82194175970f0552` — a shape that appears
//      in no part of Termii's published API, while every prior send from this
//      account returned the documented numeric form. Both reconciliation routes
//      key on that numeric id, so an id like this can never be matched by a
//      report and never looked up in History. It is an acceptance we are
//      structurally unable to confirm, and the honest terminal state for it is
//      NOT "delivered".
//
// WHAT THIS WILL NOT DO: silently decide. Every row it touches either gains a
// real `delivered_at`, or gains a terminal failure WITH A NAMED REASON, and the
// unresolvable ones are counted into an alert a person reads. `sent` is no
// longer a resting state.
//
// PURE BY CONSTRUCTION — no Deno, no fetch, no client at module scope, so the
// classifier and the deadline arithmetic are executable in a test.

/** Termii History rows, as the provider returns them. */
export interface TermiiHistoryRow {
  message_id?: unknown;
  status?: unknown;
}

export type ReconcileVerdict =
  | { kind: "delivered" }
  | { kind: "failed"; reason: string }
  | { kind: "pending" }
  | { kind: "unreconcilable"; reason: string };

/**
 * Termii's documented terminal statuses. Kept as a mapping rather than a
 * `includes("deliver")` sniff so a status Termii adds later lands in `pending`
 * (honest: we do not know it) instead of being pattern-matched into a verdict
 * nobody designed.
 */
export function classifyTermiiHistoryStatus(raw: string): ReconcileVerdict {
  const s = raw.trim().toLowerCase();
  if (s === "delivered") return { kind: "delivered" };
  if (
    s === "rejected" || s === "expired" || s === "message failed" ||
    s === "failed" || s === "undeliverable" || s.includes("dnd")
  ) {
    return { kind: "failed", reason: `termii_${s.replace(/\s+/g, "_")}` };
  }
  // "Message Sent" means Termii handed it on and has no report yet. That is
  // EXACTLY the state this sweep exists to distrust, so it is `pending`, never
  // `delivered` — the delivery-report webhook classifies it as success, which
  // is defensible for a push it received, and indefensible for an answer we
  // went looking for.
  return { kind: "pending" };
}

/**
 * Milliseconds after `sent_at` before a row without a delivery confirmation is
 * declared undelivered.
 *
 * 45 minutes, not 5: Nigerian carrier reports routinely lag several minutes and
 * a too-eager deadline would manufacture false failures on messages that DID
 * arrive — which corrupts the ledger in the opposite direction and is just as
 * dishonest. It is also far under the hours a buyer would wait before deciding
 * we simply never texted them.
 */
export const DELIVERY_CONFIRMATION_DEADLINE_MS = 45 * 60 * 1000;

/** A row this sweep can act on. */
export interface StaleSmsRow {
  id: string;
  provider: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
}

export function isPastConfirmationDeadline(
  row: Pick<StaleSmsRow, "sent_at">,
  now: Date,
  deadlineMs: number = DELIVERY_CONFIRMATION_DEADLINE_MS,
): boolean {
  if (row.sent_at === null) return false;
  const sentMs = new Date(row.sent_at).getTime();
  if (Number.isNaN(sentMs)) return false;
  return now.getTime() - sentMs >= deadlineMs;
}

/**
 * The verdict for a row that has passed its deadline and that History could not
 * (or cannot) resolve.
 *
 * The two reasons are kept DISTINCT on purpose. `provider_message_id_unreconcilable`
 * says the provider handed us an identifier its own APIs do not accept — an
 * integration fault, and the one an engineer must act on. `delivery_unconfirmed`
 * says we asked properly and got no confirmation — a deliverability fault, and
 * the one operations must act on. Collapsing them into one string would put the
 * #2218 signal back in the dark within a month.
 */
export function deadlineVerdict(
  row: StaleSmsRow,
  idIsReconcilable: boolean,
): ReconcileVerdict {
  if (!idIsReconcilable) {
    return {
      kind: "unreconcilable",
      reason: `provider_message_id_unreconcilable:${row.provider ?? "unknown"}`,
    };
  }
  return {
    kind: "failed",
    reason: `delivery_unconfirmed:${row.provider ?? "unknown"}`,
  };
}

/** Pick the History entry for one message id out of whatever shape came back. */
export function findHistoryStatus(
  payload: unknown,
  messageId: string,
): string | null {
  const rows: TermiiHistoryRow[] = Array.isArray(payload)
    ? payload as TermiiHistoryRow[]
    : Array.isArray((payload as { data?: unknown })?.data)
    ? (payload as { data: TermiiHistoryRow[] }).data
    : [];
  for (const row of rows) {
    // Termii renders the id as a string in some responses and a bare number in
    // others; a 25-digit bare number does not survive float64, so compare on
    // the STRING form of whatever arrived rather than coercing to Number.
    if (String(row.message_id ?? "").trim() !== messageId) continue;
    const status = String(row.status ?? "").trim();
    return status.length > 0 ? status : null;
  }
  return null;
}
