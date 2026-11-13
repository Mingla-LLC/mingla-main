// Issue #4422 — one ops alert when a guest was reached on no channel and
// nothing more is owed to them.
//
// The database decides who is unreached and records that they were alerted
// (`issue_4422_claim_unreached_guest_alerts`, one statement, at most once per
// RSVP notification or ticket order). This module turns one claim into one
// email to the existing delivery-health recipients (API_HEALTH_ALERT_EMAILS,
// the same family offering-invite-dispatch alerts on). The email holds ids and
// safe codes only, never a contact.
//
// A TRADE-OFF MADE ON PURPOSE: the ledger row is written before the email is
// sent, so a failed send is not retried on the next tick. A retry would need a
// second "sent" state and a sweeper of its own; instead a failure is logged as
// `unreached_guest_alert_failed` with the count, so it is visible in the logs,
// and the guests are still findable in the ledger table.

// The existing delivery-health recipients; no new inbox, no new secret.
import { apiHealthAlertRecipients } from "./secretBundle.ts";
import {
  type OpsAlertEmailInput,
  type OpsAlertEmailResult,
  sendOpsAlertEmail,
} from "./stripeOpsAlertEmail.ts";

export type UnreachedSource = "rsvp" | "ticket";

export interface UnreachedAlertClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string | null; message?: string | null } | null;
  }>;
}

export interface UnreachedRow {
  subject_id: string;
  event_id: string | null;
  codes: string | null;
}

export interface UnreachedAlertDeps {
  send?: (input: OpsAlertEmailInput) => Promise<OpsAlertEmailResult>;
  recipients?: () => string[];
}

export type UnreachedAlertOutcome =
  | "none"
  | "sent"
  | "send_failed"
  | "claim_failed";

const SUBJECTS: Record<UnreachedSource, string> = {
  rsvp: "RSVP guests not reached",
  ticket: "Ticket buyers not reached",
};

const INTRO: Record<UnreachedSource, string> = {
  rsvp:
    "These RSVP messages reached the guest on no channel, and nothing more will be sent. Ids and codes only: look the rows up in rsvp_notifications and rsvp_notification_deliveries.",
  ticket:
    "These ticket orders reached the buyer on no channel, and nothing more will be sent. Ids and codes only: look the rows up in ticket_order_notifications.",
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function isRow(value: unknown): value is UnreachedRow {
  return !!value && typeof value === "object" &&
    typeof (value as UnreachedRow).subject_id === "string";
}

/** One paragraph per subject: id prefix, event id and codes. */
export function unreachedAlertParagraphs(
  source: UnreachedSource,
  rows: readonly UnreachedRow[],
): string[] {
  return [
    INTRO[source],
    ...rows.map((row) =>
      `${row.subject_id.slice(0, 8)} · event ${row.event_id ?? "unknown"} · ${
        row.codes ?? "no code"
      }`
    ),
  ];
}

export async function alertUnreachedGuests(
  client: UnreachedAlertClient,
  source: UnreachedSource,
  deps: UnreachedAlertDeps = {},
): Promise<UnreachedAlertOutcome> {
  let rows: UnreachedRow[];
  try {
    const { data, error } = await client.rpc(
      "issue_4422_claim_unreached_guest_alerts",
      { p_source: source, p_limit: 50 },
    );
    if (error) {
      console.error(JSON.stringify({
        event: "unreached_guest_alert_claim_failed",
        source,
        code: String(error.code ?? "unknown"),
      }));
      return "claim_failed";
    }
    rows = (Array.isArray(data) ? data : []).filter(isRow);
  } catch {
    console.error(JSON.stringify({
      event: "unreached_guest_alert_claim_failed",
      source,
      code: "threw",
    }));
    return "claim_failed";
  }
  if (rows.length === 0) return "none";

  const ids = rows.map((row) => row.subject_id).sort();
  try {
    const result = await (deps.send ?? sendOpsAlertEmail)({
      subject: `${SUBJECTS[source]} (${rows.length})`,
      paragraphs: unreachedAlertParagraphs(source, rows),
      recipients: (deps.recipients ?? apiHealthAlertRecipients)(),
      idempotencyKey: `issue4422:${source}:${await sha256Hex(ids.join(","))}`,
    });
    if (result.succeeded === 0 || result.failed > 0) {
      console.error(JSON.stringify({
        event: "unreached_guest_alert_failed",
        source,
        count: rows.length,
        attempted: result.attempted,
        failed: result.failed,
      }));
      return "send_failed";
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: "unreached_guest_alert_failed",
      source,
      count: rows.length,
      reason: error instanceof Error ? error.message.slice(0, 120) : "threw",
    }));
    return "send_failed";
  }
  console.info(JSON.stringify({
    event: "unreached_guest_alert_sent",
    source,
    count: rows.length,
  }));
  return "sent";
}
