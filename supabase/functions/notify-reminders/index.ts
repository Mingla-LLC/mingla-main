// META-ORCH-1161 Sub-C "b" — notify-reminders.
//
// #4063: a pg_cron schedule (every 5 min) POSTs here. We call the
// pg_notify_reminders_enqueue() RPC once per lead bucket (24h + 2h). The RPC does
// the atomic windowed select → INSERT into notification_outbox (idempotent per
// {category}:{entityId}:{leadBucket}); the existing 1-min outbox drain then
// forwards each row to notify-dispatch v2 (simultaneous send + can_send gate +
// per-market SMS kill-switch). The buyer and reservation reminders never send
// directly. #4514: after them, this fn queues the optional brand form reminder
// (brand_form_auto_reminders_due) and drains the brand form request queue
// through notify-dispatch, on the same five-minute cron.
//
// Lead times are ENV-configurable (defaults 24h + 2h per §7.3 / §12 Q1 RESOLVED):
//   REMINDER_LEAD_24H_HOURS  (default 24)
//   REMINDER_LEAD_2H_HOURS   (default 2)
// The RPC's third argument is retained only for compatibility/logging; the SQL
// owns the fixed -7/+3 minute window paired with the five-minute cron.
//
// verify_jwt=false (config.toml): invoked by pg_cron with the service-role bearer,
// which is checked exactly (isExactServiceBearer): it now triggers paid texts.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type FormRequestDeps,
  runAutoFormReminders,
} from "../_shared/brandFormRequests.ts";
import type {
  FormDispatchInput as DispatchV2Input,
  FormDispatchResult as DispatchV2Result,
} from "../_shared/brandFormDispatchTypes.ts";
import { isExactServiceBearer } from "../_shared/legacyEmailIdempotency.ts";
// #4541 R7.2: the existing delivery-health recipients and the existing ops
// alert email (the unreachedGuestAlert.ts pattern). No new secret names.
import { apiHealthAlertRecipients } from "../_shared/secretBundle.ts";
import {
  type OpsAlertEmailInput,
  type OpsAlertEmailResult,
  sendOpsAlertEmail,
} from "../_shared/stripeOpsAlertEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** The one database call this function makes per lead bucket (injectable for tests). */
export interface ReminderAdmin {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface ReminderDeps {
  createAdmin?: (url: string, serviceKey: string) => ReminderAdmin;
  /** #4514: the notify v2 dispatcher the brand form reminder sends with. */
  dispatch?: FormRequestDeps["dispatch"];
  /** #4541 R7.2: the ops alert sender and its recipients (injectable for tests). */
  sendAlert?: (input: OpsAlertEmailInput) => Promise<OpsAlertEmailResult>;
  alertRecipients?: () => string[];
}

/** #4541 R7.2: the four forms alert kinds and their subject lines. */
export const FORM_OPS_ALERT_SUBJECTS = {
  form_drain_error: "Mingla forms: form request sending failed",
  form_sends_failing: "Mingla forms: form requests are failing",
  form_queue_stuck: "Mingla forms: form requests are stuck in the queue",
  checkout_answers_stuck: "Mingla forms: checkout answers are stuck",
} as const;
export type FormOpsAlertKind = keyof typeof FORM_OPS_ALERT_SUBJECTS;

const ADMIN_FORMS_VIEW = "https://admin.usemingla.com/#/brands";

const count = (v: unknown): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;

/**
 * #4541 R1.7 and R7.2: after the form request drain, retry checkout answers
 * whose finalize did not land (brand_form_checkout_answers_retry), read the
 * queue's health, and raise at most one alert per kind per day
 * (brand_form_ops_alert_claim) to the existing delivery-health recipients.
 * Counts and the Admin view link only: never a contact, link or answer. Never
 * throws: a failure here is logged and reported, and the cron keeps running.
 */
export async function runFormsOps(
  admin: ReminderAdmin,
  drainError: string | null,
  deps: Pick<ReminderDeps, "sendAlert" | "alertRecipients"> = {},
): Promise<{
  retry: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
  alerts: FormOpsAlertKind[];
  errors: string[];
}> {
  const errors: string[] = [];
  const obj = (v: unknown): Record<string, unknown> | null =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? v as Record<string, unknown>
      : null;
  const retried = await admin.rpc("brand_form_checkout_answers_retry", {
    p_limit: 50,
  });
  if (retried.error) errors.push(`retry: ${retried.error.message}`);
  const retry = retried.error ? null : obj(retried.data);
  const read = await admin.rpc("brand_form_queue_health", {});
  if (read.error) errors.push(`health: ${read.error.message}`);
  const health = read.error ? null : obj(read.data);

  const due: Array<[FormOpsAlertKind, string[]]> = [];
  if (drainError !== null) {
    due.push(["form_drain_error", [
      "The five-minute form request drain failed this run. It retries on the next run.",
    ]]);
  }
  if (health !== null && count(health.failedLastHour) >= 10) {
    due.push(["form_sends_failing", [
      `${count(health.failedLastHour)} form requests failed in the last hour.`,
    ]]);
  }
  if (health !== null && count(health.stuckQueued) > 0) {
    due.push(["form_queue_stuck", [
      `${count(health.stuckQueued)} form requests have waited in the queue for more than 30 minutes.`,
    ]]);
  }
  const stuck = Math.max(
    count(health?.stashStuck),
    count(retry?.stuck),
  );
  if (stuck > 0) {
    due.push(["checkout_answers_stuck", [
      `${stuck} checkout answers could not be saved to their order after 5 tries or 30 minutes.`,
    ]]);
  }
  const alerts: FormOpsAlertKind[] = [];
  for (const [kind, lines] of due) {
    const claim = await admin.rpc("brand_form_ops_alert_claim", {
      p_kind: kind,
    });
    if (claim.error) {
      errors.push(`claim ${kind}: ${claim.error.message}`);
      continue;
    }
    if (claim.data !== true) continue;
    try {
      const result = await (deps.sendAlert ?? sendOpsAlertEmail)({
        subject: FORM_OPS_ALERT_SUBJECTS[kind],
        paragraphs: [
          ...lines,
          "Open the Admin forms view for counts by brand. This email carries counts only.",
        ],
        recipients: (deps.alertRecipients ?? apiHealthAlertRecipients)(),
        cta: { label: "Open Admin", url: ADMIN_FORMS_VIEW },
        idempotencyKey: `issue4541:${kind}:${new Date().toISOString().slice(0, 10)}`,
      });
      if (result.succeeded === 0 || result.failed > 0) {
        errors.push(`alert ${kind}: send_failed`);
      } else {
        alerts.push(kind);
      }
    } catch (error) {
      errors.push(
        `alert ${kind}: ${error instanceof Error ? error.message.slice(0, 120) : "threw"}`,
      );
    }
  }
  return { retry, health, alerts, errors };
}

/**
 * #4514: the brand form reminder sends through notify-dispatch (the v2
 * category path), the same dispatcher the outbox drain uses, so this function
 * never holds provider secrets itself. The contact path carries the link in the
 * request only; notify-dispatch keeps no message body for a contact send.
 */
export async function viaNotifyDispatch(
  url: string,
  serviceKey: string,
  input: DispatchV2Input,
  fetchImpl: typeof fetch = fetch,
): Promise<DispatchV2Result> {
  const response = await fetchImpl(`${url}/functions/v1/notify-dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify({
      category_key: input.category_key,
      user_id: input.user_id ?? null,
      contact: input.contact ?? null,
      payload: input.payload,
      idempotency_key: input.idempotency_key,
      country_code: input.country_code ?? null,
      requested_channel: input.requested_channel ?? null,
    }),
  });
  const value: unknown = await response.json().catch(() => null);
  if (typeof value !== "object" || value === null) {
    return { success: false, reason: `notify_dispatch_${response.status}` };
  }
  return value as DispatchV2Result;
}

export async function handler(
  req: Request,
  deps: ReminderDeps = {},
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "missing_authorization" }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: "server_misconfigured" }, 500);
  }
  // Only the cron's service-role bearer: any other token is refused before a
  // single call (this function triggers paid texts).
  if (!isExactServiceBearer(authHeader, SERVICE_KEY)) {
    return json({ error: "forbidden" }, 403);
  }

  const admin: ReminderAdmin = deps.createAdmin
    ? deps.createAdmin(SUPABASE_URL, SERVICE_KEY)
    : createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

  const lead24h = envInt("REMINDER_LEAD_24H_HOURS", 24);
  const lead2h = envInt("REMINDER_LEAD_2H_HOURS", 2);
  const windowMinutes = 10;

  // One enqueue pass per lead bucket. Each is independently idempotent (the outbox
  // UNIQUE on idempotency_key), so a failure of one bucket never blocks the other.
  const buckets: Array<{ bucket: "24h" | "2h"; hours: number }> = [
    { bucket: "24h", hours: lead24h },
    { bucket: "2h", hours: lead2h },
  ];

  const results: Record<string, number | string> = {};
  let hadError = false;

  for (const { bucket, hours } of buckets) {
    const { data, error } = await admin.rpc("pg_notify_reminders_enqueue", {
      p_lead_hours: hours,
      p_lead_bucket: bucket,
      p_window_minutes: windowMinutes,
    });
    if (error) {
      hadError = true;
      results[bucket] = `error: ${error.message}`;
      console.error(
        `[notify-reminders] enqueue ${bucket} failed:`,
        error.message,
      );
    } else {
      results[bucket] = typeof data === "number" ? data : 0;
    }
  }

  // #4514 wave 4 (decision 13): the optional brand form reminder, two days
  // before each guest's own date, AFTER the buyer and reservation reminders
  // above, which it never changes or blocks. Due reminders are queued in SQL;
  // the drain then sends the queue (and resumes any host send a dead request
  // left) through notify-dispatch rather than the outbox, because a text or
  // email carries the guest's personal form link, a credential that is never
  // stored. Nothing due and nothing queued: the response is unchanged.
  const formReminders = await runAutoFormReminders({
    rpc: async (fn, args) => {
      const { data, error } = await admin.rpc(fn, args);
      return {
        data,
        error: error === null ? null : { message: error.message },
      };
    },
    dispatch: deps.dispatch ??
      ((input) => viaNotifyDispatch(SUPABASE_URL, SERVICE_KEY, input)),
  }).catch((error: unknown) => {
    hadError = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[notify-reminders] brand form reminders failed:", message);
    return { error: message };
  });

  // #4541 R1.7 / R7.2: retry checkout answers, read the queue's health and
  // raise the forms ops alerts (once per kind per day).
  const drainError = formReminders !== null && "error" in formReminders
    ? String(formReminders.error)
    : null;
  const formsOps = await runFormsOps(admin, drainError, deps).catch(
    (error: unknown) => ({
      retry: null,
      health: null,
      alerts: [] as FormOpsAlertKind[],
      errors: [error instanceof Error ? error.message : String(error)],
    }),
  );
  if (formsOps.errors.length > 0) {
    hadError = true;
    console.error("[notify-reminders] forms ops:", formsOps.errors.join("; "));
  }
  const formsOpsOut = formsOps.alerts.length > 0 || formsOps.errors.length > 0 ||
      count(formsOps.retry?.promoted) + count(formsOps.retry?.failed) > 0
    ? {
      retry: formsOps.retry,
      alerts: formsOps.alerts,
      errors: formsOps.errors.length,
    }
    : null;

  // Surface partial failure (no silent failure) but never throw — the cron should
  // keep running and retry next tick; idempotency makes retries safe.
  return json(
    {
      ok: !hadError,
      enqueued: results,
      windowMinutes,
      ...(formReminders === null ? {} : { formReminders }),
      ...(formsOpsOut === null ? {} : { formsOps: formsOpsOut }),
    },
    hadError ? 207 : 200,
  );
}

if (import.meta.main) serve((req) => handler(req));
