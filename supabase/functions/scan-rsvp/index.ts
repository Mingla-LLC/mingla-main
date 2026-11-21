/** Issue #1447 — authenticated RSVP admission scanner endpoint. */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  readDoorAnswersForSubject,
  type DoorReadClient,
} from "../_shared/doorBookedStart.ts";
import {
  ownsRecentAdmittedScan,
  RSVP_DOOR_ANSWERS_DEADLINE_MS,
  rsvpDoorSubjectFromScanResult,
} from "./doorAnswers.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const current = ipHits.get(ip);
  if (!current || current.resetAt <= now) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_MAX;
}

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

type QueryResult = { data: unknown; error: unknown };

async function doorFullAnswers(
  service: DoorReadClient,
  actorId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const scanId = typeof body.scanId === "string" ? body.scanId : "";
  if (!UUID_RE.test(eventId) || !UUID_RE.test(scanId)) {
    return respond({ error: "door_answers_payload_required" }, 400);
  }
  const receipt = await service
    .from("rsvp_scan_events")
    .select("requested_event_id, rsvp_id, guest_id, scanner_user_id, outcome, scanned_at")
    .eq("id", scanId)
    .maybeSingle() as QueryResult;
  if (receipt.error) return respond({ error: "door_answers_failed" }, 500);
  const row = receipt.data as Record<string, unknown> | null;
  if (row === null || !ownsRecentAdmittedScan(row, actorId, eventId)) {
    return respond({ error: "door_answers_scan_required" }, 403);
  }
  let subject: { kind: "rsvp" | "rsvp_guest"; id: string } | null = null;
  if (typeof row.rsvp_id === "string") subject = { kind: "rsvp", id: row.rsvp_id };
  if (typeof row.guest_id === "string") {
    const guest = await service
      .from("event_rsvp_guests")
      .select("claimed_at")
      .eq("id", row.guest_id)
      .maybeSingle() as QueryResult;
    if (guest.error) return respond({ error: "door_answers_failed" }, 500);
    if (typeof (guest.data as { claimed_at?: unknown } | null)?.claimed_at === "string") {
      subject = { kind: "rsvp_guest", id: row.guest_id };
    }
  }
  if (subject === null) return respond({ error: "door_answers_scan_required" }, 403);
  const result = await service.rpc("brand_form_door_full_answers", {
    p_actor_id: actorId,
    p_event_id: eventId,
    p_subject: subject,
    p_via: "scan",
  }) as QueryResult;
  if (result.error) {
    const message = String((result.error as { message?: unknown }).message ?? "");
    return respond(
      { error: /forbidden|subject_other_event|subject_not_current/.test(message)
        ? "door_answers_forbidden"
        : "door_answers_failed" },
      /forbidden|subject_other_event|subject_not_current/.test(message) ? 403 : 500,
    );
  }
  return respond((result.data ?? { state: "no_form" }) as Record<string, unknown>);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") {
    return respond({ error: "method_not_allowed" }, 405);
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (isRateLimited(ip)) {
    console.warn(JSON.stringify({ event: "rsvp_scan_rate_limited" }));
    return respond({ error: "rate_limited" }, 429);
  }
  const startedAt = Date.now();
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("authorization");
  if (!url || !anon) return respond({ error: "server_misconfigured" }, 500);
  if (!authorization) return respond({ error: "auth_required" }, 401);
  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) {
    return respond({ error: "auth_required" }, 401);
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (body.action === "door_full_answers") {
    if (!serviceKey) return respond({ error: "server_misconfigured" }, 500);
    const service = createClient(url, serviceKey, { auth: { persistSession: false } });
    return await doorFullAnswers(service as unknown as DoorReadClient, authData.user.id, body);
  }
  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const rawPayload = body.payload ?? body.qrPayload;
  const qrPayload = typeof rawPayload === "string" ? rawPayload.trim() : "";
  if (!UUID_RE.test(eventId) || !qrPayload || qrPayload.length > 512) {
    return respond({ error: "scan_payload_required" }, 400);
  }
  const { data, error } = await caller.rpc("biz_rsvp_scan", {
    p_event_id: eventId,
    p_qr_payload: qrPayload,
  });
  if (error) {
    const forbidden = error.message.includes("scanner_not_authorized");
    console.info(JSON.stringify({
      event: "rsvp_scan_result",
      eventId,
      outcome: forbidden ? "unauthorized" : "error",
      latencyMs: Date.now() - startedAt,
    }));
    return respond({
      error: forbidden ? "scanner_not_authorized" : "scan_failed",
    }, forbidden ? 403 : 400);
  }
  let result = (data ?? { result: "not_found" }) as Record<string, unknown>;
  const subject = rsvpDoorSubjectFromScanResult(result);
  // #4541: admission is already recorded. The optional form read has the same
  // 1.5 s deadline as ticket scans and can never change that result.
  if (subject !== null && serviceKey) {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), RSVP_DOOR_ANSWERS_DEADLINE_MS);
    try {
      const service = createClient(url, serviceKey, { auth: { persistSession: false } });
      const doorAnswers = await readDoorAnswersForSubject(
        service as unknown as DoorReadClient,
        authData.user.id,
        eventId,
        subject,
        deadline.signal,
      );
      if (doorAnswers !== null) result = { ...result, doorAnswers };
    } finally {
      clearTimeout(timer);
    }
  }
  console.info(JSON.stringify({
    event: "rsvp_scan_result",
    eventId,
    outcome: typeof result.result === "string" ? result.result : "error",
    latencyMs: Date.now() - startedAt,
  }));
  return respond(result);
});
