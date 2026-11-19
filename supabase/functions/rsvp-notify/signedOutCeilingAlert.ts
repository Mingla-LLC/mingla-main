// Issue #4508 N-8 — the first time in a UTC day the daily ceiling on texts to
// guests added by signed-out inviters holds a guest, the database records
// that day (rsvp_guest_signed_out_ceiling_hits). On the every-minute tick this
// module sends ONE ops alert for each unreported day through the shared
// ops-alert helper, to the existing delivery-health recipients
// (API_HEALTH_ALERT_EMAILS, as the friend-going alert does; no new inbox, no
// new secret), and marks the day reported only AFTER the alert went out. A
// failed send leaves it unreported for the next tick; the idempotency key
// (the day) stops a repeated tick from emailing it twice. The email holds the
// day and the time only.

import { apiHealthAlertRecipients } from "../_shared/secretBundle.ts";
import {
  type OpsAlertEmailInput,
  type OpsAlertEmailResult,
  sendOpsAlertEmail,
} from "../_shared/stripeOpsAlertEmail.ts";

export interface CeilingAlertClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown;
    error: { code?: string | null; message?: string | null } | null;
  }>;
}

export interface CeilingAlertDeps {
  send?: (input: OpsAlertEmailInput) => Promise<OpsAlertEmailResult>;
  recipients?: () => string[];
}

export type CeilingAlertOutcome =
  | "none"
  | "sent"
  | "list_failed"
  | "send_failed"
  | "mark_failed";

interface HitRow {
  hit_day: string;
  first_hit_at: string | null;
}

function isHitRow(value: unknown): value is HitRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.hit_day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.hit_day);
}

function log(event: string, detail: Record<string, unknown>): void {
  console.error(JSON.stringify({ event, ...detail }));
}

export async function alertSignedOutCeilingHits(
  client: CeilingAlertClient,
  deps: CeilingAlertDeps = {},
): Promise<CeilingAlertOutcome> {
  let rows: HitRow[];
  try {
    const { data, error } = await client.rpc("issue_4508_list_ceiling_hits", {});
    if (error) {
      log("rsvp_guest_ceiling_list_failed", {
        code: String(error.code ?? "unknown"),
      });
      return "list_failed";
    }
    rows = (Array.isArray(data) ? data : []).filter(isHitRow);
  } catch {
    log("rsvp_guest_ceiling_list_failed", { code: "threw" });
    return "list_failed";
  }
  if (rows.length === 0) return "none";

  let outcome: CeilingAlertOutcome = "sent";
  for (const row of rows) {
    try {
      const result = await (deps.send ?? sendOpsAlertEmail)({
        subject: `RSVP guest texts paused for signed-out inviters (${row.hit_day})`,
        paragraphs: [
          "The daily ceiling on texts to plus-ones added by signed-out inviters (300 in a rolling 24 hours, all events together) was reached. Guests added by signed-out inviters are still saved, but they are not texted until the count drops below the ceiling, and held guests are not texted later.",
          `First guest held: ${row.first_hit_at ?? row.hit_day} (UTC day ${row.hit_day}).`,
          "Check rsvp_guest_invite_log for keys starting ip: in the last 24 hours to see whether this is real demand or abuse.",
        ],
        recipients: (deps.recipients ?? apiHealthAlertRecipients)(),
        idempotencyKey: `issue4508:signed-out-ceiling:${row.hit_day}`,
      });
      if (result.succeeded === 0 || result.failed > 0) {
        log("rsvp_guest_ceiling_alert_failed", {
          day: row.hit_day,
          attempted: result.attempted,
          failed: result.failed,
        });
        outcome = "send_failed";
        continue;
      }
    } catch (error) {
      log("rsvp_guest_ceiling_alert_failed", {
        day: row.hit_day,
        reason: error instanceof Error ? error.message.slice(0, 120) : "threw",
      });
      outcome = "send_failed";
      continue;
    }
    try {
      const { error } = await client.rpc(
        "issue_4508_mark_ceiling_hit_reported",
        { p_hit_day: row.hit_day },
      );
      if (error) {
        log("rsvp_guest_ceiling_mark_failed", {
          day: row.hit_day,
          code: String(error.code ?? "unknown"),
        });
        if (outcome === "sent") outcome = "mark_failed";
        continue;
      }
    } catch {
      log("rsvp_guest_ceiling_mark_failed", { day: row.hit_day, code: "threw" });
      if (outcome === "sent") outcome = "mark_failed";
      continue;
    }
    console.info(JSON.stringify({
      event: "rsvp_guest_ceiling_alert_sent",
      day: row.hit_day,
    }));
  }
  return outcome;
}
