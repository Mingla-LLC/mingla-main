/**
 * ORCH-1150 — public-submit-rsvp
 *
 * Anon-capable guest RSVP write for event_type='rsvp' events. verify_jwt=false
 * (config.toml). Runs under service-role; validates input; calls the
 * SECURITY DEFINER `submit_event_rsvp` RPC which does the two-dimension
 * resolve + real waitlist write (SPEC §5.3).
 *
 * ORCH-1150: do NOT merge back into the event/ticket checkout path — RSVP has
 * zero tickets + no money gate; this writes a Going/Not-going row, never an
 * order. Notify is TRANSACTIONAL (fired by the publish-edit / approve-deny /
 * auto-promote producers, NOT here).
 *
 * A4-NEW: a link guest (no JWT) MUST supply name + email + phone. A logged-in
 * app-user (JWT resolves a user_id) supplies none of those (profile-inherited).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ORCH-1163 [rsvp-shared-body] — REUSE the existing pepper helper (the same one
// the Stripe/Paystack webhook routers use); do NOT inline a new env read.
import { qrTokenPepper } from "../_shared/ticketCheckout.ts";
// ORCH-1203 GAP-C1 — surface a missing-pepper misconfig immediately. REUSE the
// shared ops-alert helper (the same one ORCH-0956 disputes + ORCH-1201 health use).
import { sendOpsAlertEmail } from "../_shared/stripeOpsAlertEmail.ts";
import {
  deriveRsvpRecoveryToken,
  rsvpRecoveryUrl,
  sha256Hex,
} from "../_shared/rsvpPass.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RsvpGuestInput {
  name?: string;
  email?: string;
  phone?: string;
}

interface SubmitRsvpRequest {
  eventId?: string;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  rsvpStatus?: "going" | "not_going" | "maybe";
  plusCount?: number;
  // ORCH-1163 [rsvp-shared-body] — one CONTACT record per plus-one (name/email/
  // phone), NOT a count. Length must match plusCount for going/maybe.
  guests?: RsvpGuestInput[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// E.164-ish: optional +, 7–15 digits.
const PHONE_RE = /^\+?[0-9]{7,15}$/;

// Naive in-memory per-IP rate limit (best-effort; resets on cold start). The DB
// unique indexes + the RPC are the real guard; this just blunts burst spam.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const ipHits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (entry === undefined || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

function normalizePhone(raw: string): string | null {
  const trimmed = raw.replace(/[\s()-]/g, "");
  if (!PHONE_RE.test(trimmed)) return null;
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("[public-submit-rsvp] missing SUPABASE_URL / service key");
    return json(500, { error: "server_misconfigured" });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return json(429, { error: "rate_limited" });
  }

  let body: SubmitRsvpRequest;
  try {
    body = (await req.json()) as SubmitRsvpRequest;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const rsvpStatus = body.rsvpStatus;
  if (eventId.length === 0) {
    return json(400, { error: "event_id_required" });
  }
  // ORCH-1150 R2 D-10: 'maybe' is an accepted RSVP status (cap-neutral, auto-
  // approved). The A4-NEW anon-contact gate below is status-agnostic, so a Maybe
  // link guest still must supply name+email+phone — do NOT relax it for maybe.
  if (
    rsvpStatus !== "going" &&
    rsvpStatus !== "not_going" &&
    rsvpStatus !== "maybe"
  ) {
    return json(400, { error: "rsvp_status_invalid" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Resolve a logged-in app user from the bearer token, if present.
  let userId: string | null = null;
  let verifiedUserEmail = "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (token.length > 0) {
    try {
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data.user) {
        userId = data.user.id;
        verifiedUserEmail = data.user.email?.trim() ?? "";
      }
    } catch (err) {
      // Non-fatal: fall through as an anon link guest.
      console.warn("[public-submit-rsvp] token resolve failed", String(err));
    }
  }

  let guestName =
    typeof body.guestName === "string" ? body.guestName.trim() : "";
  let guestEmail =
    typeof body.guestEmail === "string" ? body.guestEmail.trim() : "";
  let rawPhone =
    typeof body.guestPhone === "string" ? body.guestPhone.trim() : "";

  let normalizedPhone: string | null = null;

  // A4-NEW: link guest (anon) must carry name + email + phone, all valid.
  if (userId === null) {
    if (
      guestName.length === 0 ||
      guestEmail.length === 0 ||
      !EMAIL_RE.test(guestEmail) ||
      rawPhone.length === 0
    ) {
      return json(400, { error: "rsvp_contact_required" });
    }
    normalizedPhone = normalizePhone(rawPhone);
    if (normalizedPhone === null) {
      return json(400, { error: "rsvp_phone_invalid" });
    }
  } else {
    // Signed-in Explorer RSVPs still require a complete canonical contact
    // snapshot. A verified auth email is authoritative when present; profile
    // contact follows, and body input is only a completion fallback.
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name,email,phone")
      .eq("id", userId)
      .maybeSingle();
    const p = (profile ?? {}) as {
      display_name?: string | null;
      email?: string | null;
      phone?: string | null;
    };
    guestName = guestName || p.display_name?.trim() ||
      verifiedUserEmail.split("@")[0] || "";
    guestEmail = verifiedUserEmail || p.email?.trim() || guestEmail || "";
    rawPhone = rawPhone || p.phone?.trim() || "";
    if (!guestName || !EMAIL_RE.test(guestEmail) || !rawPhone) {
      return json(400, { error: "rsvp_contact_required" });
    }
    normalizedPhone = normalizePhone(rawPhone);
    if (normalizedPhone === null) {
      return json(400, { error: "rsvp_phone_invalid" });
    }
  }

  const plusCount =
    typeof body.plusCount === "number" && Number.isFinite(body.plusCount)
      ? Math.max(0, Math.floor(body.plusCount))
      : 0;

  // ORCH-1163 [rsvp-shared-body] — per-guest plus-one validation. not_going
  // forces an empty array (no plus-ones). For going/maybe with plusCount > 0,
  // guests.length must equal plusCount and each guest must carry a valid
  // name/email/phone (same EMAIL_RE / normalizePhone gates as the primary).
  // The RPC re-validates server-side; this is the friendly 400 contract.
  const rawGuests = Array.isArray(body.guests) ? body.guests : [];
  let normalizedGuests: Array<{ name: string; email: string; phone: string }> =
    [];
  if (rsvpStatus === "going" || rsvpStatus === "maybe") {
    if (plusCount > 0) {
      if (rawGuests.length !== plusCount) {
        return json(400, { error: "rsvp_guest_count_mismatch" });
      }
      for (const g of rawGuests) {
        const gName = typeof g?.name === "string" ? g.name.trim() : "";
        const gEmail = typeof g?.email === "string" ? g.email.trim() : "";
        const gRawPhone = typeof g?.phone === "string" ? g.phone.trim() : "";
        if (
          gName.length === 0 ||
          gEmail.length === 0 ||
          !EMAIL_RE.test(gEmail) ||
          gRawPhone.length === 0
        ) {
          return json(400, { error: "rsvp_guest_contact_required" });
        }
        const gPhone = normalizePhone(gRawPhone);
        if (gPhone === null) {
          return json(400, { error: "rsvp_guest_phone_invalid" });
        }
        normalizedGuests.push({ name: gName, email: gEmail, phone: gPhone });
      }
    }
    // plusCount === 0 → no guests required; ignore any stray array.
  } else {
    // not_going → no plus-ones.
    normalizedGuests = [];
  }

  // ORCH-1163 — source the QR pepper via the shared helper. A misconfigured env
  // must NOT break the RSVP write: on throw, log + proceed with a null pepper
  // (the RPC then writes the row but mints no signed pass).
  // ORCH-1203 GAP-C1 — a missing pepper is fail-OPEN by design here (I-1: the
  // RSVP must still be written), but it is a misconfiguration that silently
  // suppresses every going-RSVP entry pass until the every-15-min backfill cron
  // re-mints + delivers them. Upgrade the silent console log to an ops alert so
  // the misconfig is caught immediately. The alert is wrapped so it can NEVER
  // throw into the RSVP path.
  let qrPepper: string | null = null;
  try {
    qrPepper = qrTokenPepper();
  } catch (err) {
    console.error(
      "[public-submit-rsvp] qr_token_pepper unavailable — proceeding without signed pass",
      String(err),
    );
    qrPepper = null;
    // I-1: alerting must NOT block the RSVP write. Swallow any failure.
    try {
      const alertEmails = (
        Deno.env.get("RSVP_QR_ALERT_EMAILS") ?? "seth@usemingla.com"
      )
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (alertEmails.length > 0) {
        await sendOpsAlertEmail({
          subject:
            "🚨 RSVP QR pepper unavailable — going RSVPs minting NO signed pass",
          paragraphs: [
            "public-submit-rsvp could not resolve the QR token pepper, so the RSVP was written WITHOUT a signed entry pass (fail-open, I-1).",
            "Every going RSVP submitted while the pepper is missing has qr_code=NULL and no QR pass has been emailed.",
            "The every-15-min backfill cron (backfill_going_rsvp_qr_codes) will re-mint + deliver these once the pepper is restored — but the pepper env MUST be fixed now.",
            `Event ID: ${eventId}`,
            `Reason: ${String(err)}`,
          ],
          recipients: alertEmails,
          cta: null,
        });
      }
    } catch (alertErr) {
      console.error(
        "[public-submit-rsvp] ops alert for missing pepper failed (non-fatal)",
        String(alertErr),
      );
    }
  }

  const { data, error } = await admin.rpc("submit_event_rsvp_with_delivery", {
    p_event_id: eventId,
    p_user_id: userId,
    p_guest_name: guestName.length > 0 ? guestName : null,
    p_guest_email: guestEmail.length > 0 ? guestEmail : null,
    p_guest_phone: normalizedPhone,
    p_rsvp_status: rsvpStatus,
    p_plus_count: plusCount,
    p_guests: normalizedGuests,
    p_qr_token_pepper: qrPepper,
  });

  if (error !== null) {
    switch (error.code) {
      case "P1901":
        console.warn(
          "[public-submit-rsvp] RSVP rejected",
          JSON.stringify({
            event_id: eventId,
            reason: "rsvp_event_ended",
            authenticated: userId !== null,
            server_timestamp: new Date().toISOString(),
          }),
        );
        return json(410, { error: "rsvp_event_ended" });
      case "P1902":
        console.warn(
          "[public-submit-rsvp] RSVP rejected",
          JSON.stringify({
            event_id: eventId,
            reason: "rsvp_date_unavailable",
            authenticated: userId !== null,
            server_timestamp: new Date().toISOString(),
          }),
        );
        return json(409, { error: "rsvp_date_unavailable" });
    }
    const code = error.message ?? "";
    if (code.includes("rsvp_not_open")) return json(404, { error: "rsvp_not_open" });
    if (code.includes("rsvp_full")) return json(409, { error: "rsvp_full" });
    if (code.includes("rsvp_contact_required")) {
      return json(400, { error: "rsvp_contact_required" });
    }
    // ORCH-1163 — per-guest validation surfaced by the RPC as friendly 400s.
    if (code.includes("rsvp_guest_count_mismatch")) {
      return json(400, { error: "rsvp_guest_count_mismatch" });
    }
    if (code.includes("rsvp_guest_contact_required")) {
      return json(400, { error: "rsvp_guest_contact_required" });
    }
    if (code.includes("rsvp_status_invalid")) {
      return json(400, { error: "rsvp_status_invalid" });
    }
    console.error("[public-submit-rsvp] rpc error", code);
    return json(500, { error: "rsvp_write_failed" });
  }

  const result = (data ?? {}) as {
    rsvpId?: string;
    status?: string;
    approvalStatus?: string;
    capacityFull?: boolean;
    confirmationToken?: string | null;
  };

  const passEligible = result.status === "going" && result.approvalStatus === "approved";

  // Only admitted entities are provisioned or exposed. Approval/promotion
  // workers provision recovery later from the same canonical entity rows.
  const passEntities = passEligible && typeof result.rsvpId === "string"
    ? await provisionPassEntities(admin, result.rsvpId, qrPepper)
    : [];

  if (typeof result.rsvpId === "string") {
    // Drain the acknowledgement rows as well as pass rows. Delivery remains
    // best-effort relative to the already committed RSVP write.
    try {
      const { data: due } = await admin.from("rsvp_notifications")
        .select("id")
        .eq("rsvp_id", result.rsvpId)
        .in("status", ["pending", "failed_retryable"]);
      for (const row of (due ?? []) as Array<{ id: string }>) {
        await admin.functions.invoke("rsvp-notify", {
          body: { notificationId: row.id },
        });
      }
    } catch (err) {
      console.warn("[public-submit-rsvp] RSVP delivery drain failed (non-fatal)", String(err));
    }
  }

  return json(200, {
    rsvpId: result.rsvpId ?? null,
    status: result.status ?? rsvpStatus,
    approvalStatus: result.approvalStatus ?? "approved",
    capacityFull: result.capacityFull ?? false,
    confirmationToken: passEligible ? result.confirmationToken ?? null : null,
    acknowledgement: result.approvalStatus === "pending"
      ? "pending_approval"
      : result.status === "waitlisted"
      ? "waitlisted"
      : result.status === "maybe"
      ? "maybe"
      : result.status === "not_going"
      ? "not_going"
      : "accepted",
    credentials: passEligible
      ? passEntities.map((entity) => ({
            entityType: entity.role,
            entityId: entity.entityId,
            displayName: entity.displayName,
            qrCode: entity.qrCode,
            pdfFetchRef: entity.entityId,
          }))
      : [],
    anonymousRecovery: userId === null && passEligible
      ? passEntities.map((entity) => ({
          entityType: entity.role,
          entityId: entity.entityId,
          recoveryToken: entity.recoveryToken,
          recoveryUrl: entity.recoveryToken
            ? rsvpRecoveryUrl(entity.role, entity.entityId, entity.recoveryToken)
            : null,
        }))
      : [],
  });
});

// ORCH-1163 [rsvp-shared-body] — build the recipient fan-out + enqueue/invoke
// rsvp-notify. One `rsvp_pass` row per recipient:
//   • PRIMARY  → event_rsvps.qr_code, role='primary', primaryUserId=user_id
//   • each GUEST → event_rsvp_guests.{id,email,name,qr_code,matched_user_id}
// idempotency_key = `rsvp_pass:${rsvpId}:${guestId || 'primary'}` (the queue's
// UNIQUE index de-dupes re-submits; ON CONFLICT DO NOTHING). After enqueue we
// invoke rsvp-notify per inserted row (the queue has no auto-drainer), passing
// the service-role bearer (rsvp-notify is verify_jwt=true). Best-effort — the
// caller already returned 200 to the guest on the committed write.
// deno-lint-ignore no-explicit-any
type AdminClient = ReturnType<typeof createClient<any, "public", any>>;

interface PassEntityResponse {
  entityId: string;
  guestId: string | null;
  role: "primary" | "guest";
  displayName: string;
  qrCode: string | null;
  recoveryToken: string | null;
}

async function provisionPassEntities(
  admin: AdminClient,
  rsvpId: string,
  pepper: string | null,
): Promise<PassEntityResponse[]> {
  const { data: primaryRaw } = await admin.from("event_rsvps")
    .select("id,guest_name,qr_code,pass_recovery_token_created_at")
    .eq("id", rsvpId).maybeSingle();
  if (!primaryRaw) return [];
  const { data: guestsRaw } = await admin.from("event_rsvp_guests")
    .select("id,name,qr_code,pass_recovery_token_created_at")
    .eq("rsvp_id", rsvpId).order("created_at", { ascending: true });
  const rows = [
    {
      entityId: String(primaryRaw.id), guestId: null,
      role: "primary" as const, displayName: String(primaryRaw.guest_name ?? "Guest"),
      qrCode: primaryRaw.qr_code as string | null,
      createdAt: primaryRaw.pass_recovery_token_created_at as string | null,
      table: "event_rsvps",
    },
    ...((guestsRaw ?? []) as Array<Record<string, unknown>>).map((g) => ({
      entityId: String(g.id), guestId: String(g.id), role: "guest" as const,
      displayName: String(g.name ?? "Guest"), qrCode: g.qr_code as string | null,
      createdAt: g.pass_recovery_token_created_at as string | null,
      table: "event_rsvp_guests",
    })),
  ];
  const output: PassEntityResponse[] = [];
  for (const row of rows) {
    let recoveryToken: string | null = null;
    // Every entity receives recovery material. Anonymous guests get the
    // plaintext once in the submit response; signed-in guests never do, but the
    // delivery worker can deterministically rebuild it for the secure SMS link.
    if (pepper) {
      const createdAt = row.createdAt ?? new Date().toISOString();
      recoveryToken = await deriveRsvpRecoveryToken({
        entityId: row.entityId, createdAtIso: createdAt, pepper,
      });
      const recoveryHash = await sha256Hex(recoveryToken);
      const { error } = await admin.from(row.table).update({
        pass_recovery_token_hash: recoveryHash,
        pass_recovery_token_created_at: createdAt,
      }).eq("id", row.entityId);
      if (error) {
        console.warn("[public-submit-rsvp] recovery hash persistence failed", error.message);
        recoveryToken = null;
      }
    }
    output.push({
      entityId: row.entityId, guestId: row.guestId, role: row.role,
      displayName: row.displayName, qrCode: row.qrCode, recoveryToken,
    });
  }
  return output;
}

async function dispatchRsvpPasses(
  admin: AdminClient,
  eventId: string,
  rsvpId: string,
  primaryUserId: string | null,
): Promise<void> {
  // 1. Resolve the primary pass + event/brand context + each guest.
  const { data: rsvpRow } = await admin
    .from("event_rsvps")
    .select("id, user_id, guest_name, guest_email, qr_code")
    .eq("id", rsvpId)
    .maybeSingle();
  if (!rsvpRow) return;

  const { data: eventRow } = await admin
    .from("events")
    .select("id, title, slug, brand_id, location_text, timezone")
    .eq("id", eventId)
    .maybeSingle();
  if (!eventRow) return;

  let brandName = "Mingla";
  let brandSlug: string | null = null;
  const { data: brandRow } = await admin
    .from("brands")
    .select("slug, name")
    .eq("id", (eventRow as { brand_id: string }).brand_id)
    .maybeSingle();
  if (brandRow?.name) brandName = brandRow.name;
  if (brandRow?.slug) brandSlug = brandRow.slug;

  // Master date for the human date line (Constitution #9 — no fabrication).
  const { data: masterDate } = await admin
    .from("event_dates")
    .select("start_at, end_at")
    .eq("event_id", eventId)
    .eq("is_master", true)
    .maybeSingle();

  const ev = eventRow as {
    id: string;
    title: string | null;
    slug: string | null;
    brand_id: string;
    location_text: string | null;
    timezone: string | null;
  };
  const eventName = ev.title ?? "your event";
  const dateLine = formatDateLine(
    (masterDate as { start_at?: string } | null)?.start_at ?? null,
    ev.timezone,
  );
  const venueLine = ev.location_text;
  const deepLink =
    brandSlug && ev.slug
      ? `https://usemingla.com/e/${brandSlug}/${ev.slug}`
      : "https://usemingla.com";

  const { data: guests } = await admin
    .from("event_rsvp_guests")
    .select("id, name, email, qr_code, matched_user_id")
    .eq("rsvp_id", rsvpId);

  // 2. Build the recipient list (primary + each guest).
  type Recipient = {
    guestId: string | null;
    recipientEmail: string | null;
    recipientName: string | null;
    qrCode: string | null;
    matchedUserId: string | null;
    role: "primary" | "guest";
  };
  const recipients: Recipient[] = [];

  const primary = rsvpRow as {
    user_id: string | null;
    guest_name: string | null;
    guest_email: string | null;
    qr_code: string | null;
  };
  recipients.push({
    guestId: null,
    recipientEmail: primary.guest_email,
    recipientName: primary.guest_name,
    qrCode: primary.qr_code,
    matchedUserId: null,
    role: "primary",
  });
  for (const g of (guests ?? []) as Array<{
    id: string;
    name: string | null;
    email: string | null;
    qr_code: string | null;
    matched_user_id: string | null;
  }>) {
    recipients.push({
      guestId: g.id,
      recipientEmail: g.email,
      recipientName: g.name,
      qrCode: g.qr_code,
      matchedUserId: g.matched_user_id,
      role: "guest",
    });
  }

  // 3. Enqueue one rsvp_pass row per recipient, then invoke rsvp-notify for it.
  for (const r of recipients) {
    const idempotencyKey = `rsvp_pass:${rsvpId}:${r.guestId ?? "primary"}`;
    const payload = {
      template_key: "rsvp_pass",
      rsvp_id: rsvpId,
      event_id: eventId,
      recipientEmail: r.recipientEmail,
      recipientName: r.recipientName,
      qrCode: r.qrCode,
      matchedUserId: r.matchedUserId,
      primaryUserId: r.role === "primary" ? primaryUserId : null,
      role: r.role,
      eventName,
      dateLine,
      venueLine,
      brandName,
      brandId: ev.brand_id,
      deepLink,
    };

    const { data: inserted, error: insErr } = await admin
      .from("rsvp_notifications")
      .insert({
        event_id: eventId,
        rsvp_id: rsvpId,
        channel: null,
        recipient: r.recipientEmail,
        status: "pending",
        template_key: "rsvp_pass",
        payload,
        idempotency_key: idempotencyKey,
        attempt_count: 0,
      })
      .select("id")
      .maybeSingle();

    // ON CONFLICT (re-submit) → unique violation; that recipient was already
    // queued/sent. Skip silently (idempotent).
    if (insErr) {
      if (!String(insErr.message ?? "").toLowerCase().includes("duplicate")) {
        console.warn("[public-submit-rsvp] rsvp_pass enqueue failed", insErr.message);
      }
      continue;
    }
    const notificationId = (inserted as { id?: string } | null)?.id;
    if (!notificationId) continue;

    try {
      await admin.functions.invoke("rsvp-notify", {
        body: { notificationId },
      });
    } catch (invokeErr) {
      // The row stays 'pending' for a future retry sweep; non-fatal here.
      console.warn("[public-submit-rsvp] rsvp-notify invoke failed", String(invokeErr));
    }
  }
}

// Minimal, fabrication-free date line for the pass payload. Real ISO only;
// returns null when the host gave no master start (Constitution #9).
function formatDateLine(startAtIso: string | null, timezone: string | null): string | null {
  if (!startAtIso) return null;
  try {
    const d = new Date(startAtIso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone ?? "UTC",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return null;
  }
}
