// Issue #4508 P3-5 / R-5 — a friend-is-going enqueue that failed inside the
// RSVP trigger is recorded in rsvp_friend_going_failures (the RSVP itself
// always lands). On the every-minute tick this module turns the unreported
// failures into ONE ops alert through the shared ops-alert helper, to the
// existing delivery-health recipients (API_HEALTH_ALERT_EMAILS, the same
// family #4422 alerts on in this worker; no new inbox, no new secret), and
// marks them reported only AFTER the alert went out. A failed send leaves
// them unreported, so the next tick tries again; the idempotency key (a hash
// of the failure ids) stops a repeated tick from emailing the same set twice.
// The email holds ids, event ids and SQL states only.

import { apiHealthAlertRecipients } from "../_shared/secretBundle.ts";
import {
  type OpsAlertEmailInput,
  type OpsAlertEmailResult,
  sendOpsAlertEmail,
} from "../_shared/stripeOpsAlertEmail.ts";

export interface FriendGoingAlertClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string | null; message?: string | null } | null;
  }>;
}

export interface FriendGoingAlertDeps {
  send?: (input: OpsAlertEmailInput) => Promise<OpsAlertEmailResult>;
  recipients?: () => string[];
}

export type FriendGoingAlertOutcome =
  | "none"
  | "sent"
  | "list_failed"
  | "send_failed"
  | "mark_failed";

interface FailureRow {
  failure_id: number;
  event_id: string | null;
  sql_state: string;
}

function isFailureRow(value: unknown): value is FailureRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (typeof row.failure_id === "number" ||
    typeof row.failure_id === "string") &&
    typeof row.sql_state === "string";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function log(event: string, detail: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...detail }));
}

export async function alertFriendGoingFailures(
  client: FriendGoingAlertClient,
  deps: FriendGoingAlertDeps = {},
): Promise<FriendGoingAlertOutcome> {
  let rows: FailureRow[];
  try {
    const { data, error } = await client.rpc(
      "issue_4508_list_friend_going_failures",
      { p_limit: 50 },
    );
    if (error) {
      log("friend_going_failure_list_failed", {
        code: String(error.code ?? "unknown"),
      });
      return "list_failed";
    }
    rows = (Array.isArray(data) ? data : []).filter(isFailureRow);
  } catch {
    log("friend_going_failure_list_failed", { code: "threw" });
    return "list_failed";
  }
  if (rows.length === 0) return "none";

  const ids = rows.map((row) => Number(row.failure_id)).sort((a, b) => a - b);
  try {
    const result = await (deps.send ?? sendOpsAlertEmail)({
      subject: `Friend-is-going notices not queued (${rows.length})`,
      paragraphs: [
        "These RSVPs landed, but queuing their friend-is-going notices failed inside the database, so those friends were not told. Ids and SQL states only: look the rows up in rsvp_friend_going_failures.",
        ...rows.map((row) =>
          `failure ${row.failure_id} · event ${
            row.event_id ?? "unknown"
          } · SQLSTATE ${row.sql_state}`
        ),
      ],
      recipients: (deps.recipients ?? apiHealthAlertRecipients)(),
      idempotencyKey: `issue4508:friend-going:${await sha256Hex(
        ids.join(","),
      )}`,
    });
    if (result.succeeded === 0 || result.failed > 0) {
      log("friend_going_failure_alert_failed", {
        count: rows.length,
        attempted: result.attempted,
        failed: result.failed,
      });
      return "send_failed";
    }
  } catch (error) {
    log("friend_going_failure_alert_failed", {
      count: rows.length,
      reason: error instanceof Error ? error.message.slice(0, 120) : "threw",
    });
    return "send_failed";
  }

  try {
    const { error } = await client.rpc(
      "issue_4508_mark_friend_going_failures_reported",
      { p_ids: ids },
    );
    if (error) {
      log("friend_going_failure_mark_failed", {
        code: String(error.code ?? "unknown"),
        count: rows.length,
      });
      return "mark_failed";
    }
  } catch {
    log("friend_going_failure_mark_failed", {
      code: "threw",
      count: rows.length,
    });
    return "mark_failed";
  }
  console.info(JSON.stringify({
    event: "friend_going_failure_alert_sent",
    count: rows.length,
  }));
  return "sent";
}
