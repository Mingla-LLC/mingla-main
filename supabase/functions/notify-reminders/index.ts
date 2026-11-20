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
import type { DispatchV2Input, DispatchV2Result } from "../_shared/notifyV2.ts";
import { isExactServiceBearer } from "../_shared/legacyEmailIdempotency.ts";

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

  // Surface partial failure (no silent failure) but never throw — the cron should
  // keep running and retry next tick; idempotency makes retries safe.
  return json(
    formReminders === null
      ? { ok: !hadError, enqueued: results, windowMinutes }
      : { ok: !hadError, enqueued: results, windowMinutes, formReminders },
    hadError ? 207 : 200,
  );
}

if (import.meta.main) serve((req) => handler(req));
