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
 *
 * Issue #4508: each plus-one needs only a phone number (guestPayload.ts); the
 * old {name,email,phone} guest is still accepted. The response lists each
 * guest with its invite link. Two more operations ride this function
 * (guestOps.ts): guest_lookup (the live match under the number field) and
 * guest_bring (a claimed guest brings one more person).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ORCH-1163 [rsvp-shared-body] — REUSE the existing pepper helper (the same one
// the Stripe/Paystack webhook routers use); do NOT inline a new env read.
import { qrTokenPepper } from "../_shared/ticketCheckout.ts";
// ORCH-1203 GAP-C1 — surface a missing-pepper misconfig immediately. REUSE the
// shared ops-alert helper (the same one ORCH-0956 disputes + ORCH-1201 health use).
import { sendOpsAlertEmail } from "../_shared/stripeOpsAlertEmail.ts";
import { deriveRsvpRecoveryToken, sha256Hex } from "../_shared/rsvpPass.ts";
import { mintClaimLink } from "../_shared/claimLink.ts";
import {
  autoFollowBrandBestEffort,
  rsvpStatusAutoFollows,
} from "../_shared/autoFollowBrand.ts";
import {
  fireRsvpAdConversion,
  parseRsvpAdContext,
  scheduleRsvpAdConversion,
} from "./rsvpAdConversion.ts";
import {
  applySmsRoute,
  guestNoticeDispatch,
  type GuestNotice,
  mapGuestRpcError,
  parseGuests,
  rsvpClientKey,
  shapeSubmitGuest,
  signedOutGuestGate,
  signedOutGuestRefusal,
} from "./guestPayload.ts";
// #4508 P3: the one E.164 -> country authority the SMS adapter routes by
// (smsProviderForDestination is null exactly when this is). Imported directly
// so this function does not take on the adapter's secret-bundle reads.
import { countryFromE164 } from "../_shared/e164Country.ts";
import { handleGuestOp, isGuestOp } from "./guestOps.ts";
// #4508 R-4 — the caller's address, read the one way the repo reads it.
import { requestClientIp } from "../_shared/ticketLinkToken.ts";
// #4508 R-9 — a plus-one's pass name follows the 1.11 rule.
import { rsvpGuestDisplayName } from "../_shared/rsvpGuestName.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SubmitRsvpRequest {
  eventId?: string;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  guestPhoneCountryIso?: string | null;
  rsvpStatus?: "going" | "not_going" | "maybe";
  plusCount?: number;
  // ORCH-1163 / #4508 — one record per plus-one: {phone, phoneCountryIso} with
  // optional name / email. Length must match plusCount when plusCount is sent.
  guests?: unknown;
  // #4238 W2-5 — the web browser's ad match keys + click id (web only).
  ad_context?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;
const COUNTRY_ISO_RE = /^[A-Z]{2}$/;

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
  const trimmed = raw.trim();
  return PHONE_RE.test(trimmed) ? trimmed : null;
}

function optionalCountryIso(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && COUNTRY_ISO_RE.test(value)
    ? value
    : undefined;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// #4508 T1: exported so the signed-out guest refusal can be driven through
// the real handler in a test; the runtime serves it as before.
export const handler = async (req: Request): Promise<Response> => {
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

  // #4508 R-4: the same address rule as _shared/ticketLinkToken.ts (the
  // platform's connecting-IP header first), never a second rule.
  const ip = requestClientIp(req);
  if (rateLimited(ip)) {
    return json(429, { error: "rate_limited" });
  }

  let body: SubmitRsvpRequest;
  try {
    body = (await req.json()) as SubmitRsvpRequest;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  // Issue #4508 — guest_lookup / guest_bring.
  if (isGuestOp(body)) {
    const opAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    let opUserId: string | null = null;
    const opAuth = req.headers.get("Authorization") ?? "";
    const opToken = opAuth.toLowerCase().startsWith("bearer ")
      ? opAuth.slice(7).trim()
      : "";
    if (opToken.length > 0) {
      try {
        const { data, error } = await opAdmin.auth.getUser(opToken);
        if (!error && data.user) opUserId = data.user.id;
      } catch (err) {
        console.warn("[public-submit-rsvp] token resolve failed", String(err));
      }
    }
    const result = await handleGuestOp(
      body as unknown as Record<string, unknown>,
      {
        rpc: async (name, args) => {
          const { data, error } = await opAdmin.rpc(name, args);
          return {
            data,
            error: error ? { message: error.message, code: error.code } : null,
          };
        },
        userId: opUserId,
        ip,
        pepper: () => {
          try {
            return qrTokenPepper();
          } catch (err) {
            console.error(
              "[public-submit-rsvp] qr_token_pepper unavailable for guest_bring",
              String(err),
            );
            return null;
          }
        },
        drain: (rsvpId) => drainRsvpDeliveries(opAdmin, rsvpId),
      },
    );
    return json(result.status, result.body);
  }
  if (
    !body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).some((key) =>
      ![
        "eventId",
        "guestName",
        "guestEmail",
        "guestPhone",
        "guestPhoneCountryIso",
        "rsvpStatus",
        "plusCount",
        "guests",
        "ad_context",
      ].includes(key)
    )
  ) {
    return json(400, { error: "rsvp_payload_invalid" });
  }

  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const rsvpStatus = body.rsvpStatus;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      eventId,
    )
  ) {
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

  // #4508 T1: adding a plus-one needs a signed-in account. Any guest from a
  // caller without a verified session refuses the whole RSVP here, before a
  // number (or the list) is read, with one constant answer. A signed-out RSVP
  // without guests carries on exactly as before.
  const signedOutRefusal = signedOutGuestRefusal({
    signedIn: userId !== null,
    rawGuests: body.guests,
    rawPlusCount: body.plusCount,
    rsvpStatus,
  });
  if (signedOutRefusal !== null) {
    return json(signedOutRefusal.status, signedOutRefusal.body);
  }

  let guestName = typeof body.guestName === "string"
    ? body.guestName.trim()
    : "";
  let guestEmail = typeof body.guestEmail === "string"
    ? body.guestEmail.trim()
    : "";
  let rawPhone = typeof body.guestPhone === "string"
    ? body.guestPhone.trim()
    : "";
  if (
    guestName.length > 120 || guestEmail.length > 254 || rawPhone.length > 40
  ) {
    return json(400, { error: "rsvp_payload_invalid" });
  }

  let normalizedPhone: string | null = null;
  const guestPhoneCountryIso = optionalCountryIso(body.guestPhoneCountryIso);
  if (guestPhoneCountryIso === undefined) {
    return json(400, { error: "rsvp_phone_country_invalid" });
  }

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

  // ORCH-1163 / #4508 — per-guest validation (guestPayload.ts). not_going
  // forces no plus-ones. The RPC re-validates server-side; this is the
  // friendly 400 contract.
  const parsedGuests = parseGuests({
    rawGuests: body.guests,
    rawPlusCount: body.plusCount,
    rsvpStatus,
    primaryPhone: normalizedPhone,
    signedIn: userId !== null,
  });
  if (!parsedGuests.ok) return json(400, { error: parsedGuests.error });
  const plusCount = parsedGuests.plusCount;
  const normalizedGuests = parsedGuests.guests;

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

  // Issue #4508 P1-2: a signed-out inviter's guest-number caps are keyed by
  // a salted hash of their network address (never the number they typed);
  // the database reads it from this request header.
  const inviterClient = await rsvpClientKey(ip);
  // Issue #4508 R-1: count a signed-out caller's guest numbers first, in a
  // transaction of their own, so a refused submit still counts. T1: a
  // signed-out caller with guests is refused above, so this passes straight
  // through; it stays as defence in depth (no caller reaches it with guests).
  const gate = await signedOutGuestGate({
    signedIn: userId !== null,
    guests: normalizedGuests,
    attempt: async (count) => {
      const { data: attemptData, error: attemptError } = await admin.rpc(
        "rsvp_guest_signed_out_attempt",
        { p_event_id: eventId, p_guest_count: count },
      ).setHeader("x-mingla-rsvp-client", inviterClient);
      return {
        data: attemptData,
        error: attemptError
          ? { message: attemptError.message, code: attemptError.code }
          : null,
      };
    },
  });
  if (gate !== null) return json(gate.status, gate.body);
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
    p_guest_phone_country_iso: guestPhoneCountryIso,
  }).setHeader("x-mingla-rsvp-client", inviterClient);

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
      case "P4063":
        console.warn(
          "[public-submit-rsvp] RSVP rejected",
          JSON.stringify({
            event_id: eventId,
            reason: "rsvp_already_exists",
            authenticated: false,
            server_timestamp: new Date().toISOString(),
          }),
        );
        return json(409, { error: "rsvp_already_exists" });
    }
    const code = error.message ?? "";
    if (code.includes("rsvp_not_open")) {
      return json(404, { error: "rsvp_not_open" });
    }
    if (code.includes("rsvp_full")) return json(409, { error: "rsvp_full" });
    // #4508 — guest refusals the form shows in plain words.
    const guestError = mapGuestRpcError(error.code, code);
    if (guestError) return json(guestError.status, { error: guestError.error });
    if (code.includes("rsvp_already_exists")) {
      console.warn(
        "[public-submit-rsvp] RSVP rejected",
        JSON.stringify({
          event_id: eventId,
          reason: "rsvp_already_exists",
          authenticated: false,
          server_timestamp: new Date().toISOString(),
        }),
      );
      return json(409, { error: "rsvp_already_exists" });
    }
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
    guests?: Array<{
      guestId?: string | null;
      phoneLast4?: string | null;
      onMingla?: boolean;
      displayName?: string;
      claimed?: boolean;
      addedFromFriend?: boolean;
      willText?: boolean;
      notTextedReason?: string | null;
    }>;
    guestNotices?: unknown;
  };

  const passEligible = result.status === "going" &&
    result.approvalStatus === "approved";

  // Only admitted entities are provisioned or exposed. Approval/promotion
  // workers provision recovery later from the same canonical entity rows.
  const passEntities = passEligible && typeof result.rsvpId === "string"
    ? await provisionPassEntities(admin, result.rsvpId, qrPepper)
    : [];
  const claim = passEligible && typeof result.rsvpId === "string"
    ? await mintClaimLink(admin, "rsvp", result.rsvpId)
    : null;

  // #3682 — a signed-in guest who RSVPs follows the brand. Claimed by
  // (rsvp, rsvpId) so a replay never re-follows someone who unfollowed.
  // Bounded (1.5 s) and fail-open: the RSVP is already committed.
  if (
    userId !== null && typeof result.rsvpId === "string" &&
    rsvpStatusAutoFollows(result.status ?? rsvpStatus)
  ) {
    try {
      const { data: followEvent, error: followEventErr } = await admin
        .from("events")
        .select("brand_id")
        .eq("id", eventId)
        .maybeSingle();
      if (followEventErr !== null) {
        console.error(
          "[public-submit-rsvp] auto-follow brand lookup failed (non-fatal)",
          followEventErr.message,
        );
      } else {
        await autoFollowBrandBestEffort(admin, {
          userId,
          brandId: (followEvent?.brand_id as string | null | undefined) ?? null,
          source: "rsvp",
          sourceKind: "rsvp",
          sourceId: result.rsvpId,
        });
      }
    } catch (err) {
      console.error(
        "[public-submit-rsvp] auto-follow failed (non-fatal)",
        String(err),
      );
    }
  }

  // #4238 W2-5 (I-4238-RSVP-CONVERSION-PAIRED): a going / waitlisted web RSVP
  // is a free sign-up on the ad platforms, event_id = the RSVP id. After the
  // commit, never blocking it; bounded when waitUntil is unavailable.
  await scheduleRsvpAdConversion(
    // `as never`: the dual @supabase/supabase-js type graph, as every other
    // fireAdConversion caller does (ticket-checkout-confirm, venue-reservation-confirm).
    fireRsvpAdConversion(admin as never, {
      rsvpId: result.rsvpId,
      status: result.status ?? rsvpStatus,
      adContext: parseRsvpAdContext(body.ad_context, req),
    }),
  );

  if (typeof result.rsvpId === "string") {
    // Drain the acknowledgement rows as well as pass rows. Delivery remains
    // best-effort relative to the already committed RSVP write.
    await drainRsvpDeliveries(admin, result.rsvpId);
  }

  // Issue #4508 T3 / P3-T11 — in-app notices the submit asked for (an
  // inviter whose guest RSVPed on their own; a claimed guest who was
  // removed). Best-effort: the RSVP is committed.
  await sendGuestNotices(admin, result.guestNotices);

  // Issue #4508 P3 — a guest the SMS adapter has no route for is answered
  // willText false (unsupported_region) now, not "Text on its way".
  const submittedGuests = await routeSubmittedGuests(admin, result.guests ?? []);

  // Issue #4508 1.15 — each guest with the link the text carries, for the
  // success screen's "Invites sent" and "Send it yourself too".
  const guestsOut: Array<Record<string, unknown>> = [];
  for (const guest of submittedGuests) {
    // R-1: a signed-out caller gets no invite link (see shapeSubmitGuest).
    const link = userId !== null && typeof guest.guestId === "string"
      ? await mintClaimLink(admin, "rsvp_guest", guest.guestId)
      : null;
    // C1 / C3 / R-2: a signed-out caller sees willText only, never whether a
    // number has an account or why it will not be texted.
    guestsOut.push(shapeSubmitGuest(guest, link, userId !== null));
  }

  return json(200, {
    rsvpId: result.rsvpId ?? null,
    status: result.status ?? rsvpStatus,
    approvalStatus: result.approvalStatus ?? "approved",
    capacityFull: result.capacityFull ?? false,
    // Issue #4063: anonymous browser callers receive a pointer, never a pass
    // credential. Signed-in owners retain the legacy fields until Explorer's
    // native consumer moves to the unified claim contract.
    confirmationToken: userId !== null && passEligible
      ? result.confirmationToken ?? null
      : null,
    claim: {
      shortUrl: claim?.url ?? null,
      code: claim?.code ?? null,
    },
    acknowledgement: result.approvalStatus === "pending"
      ? "pending_approval"
      : result.status === "waitlisted"
      ? "waitlisted"
      : result.status === "maybe"
      ? "maybe"
      : result.status === "not_going"
      ? "not_going"
      : "accepted",
    credentials: userId !== null && passEligible
      ? passEntities.map((entity) => ({
        entityType: entity.role,
        entityId: entity.entityId,
        displayName: entity.displayName,
        qrCode: entity.qrCode,
        pdfFetchRef: entity.entityId,
      }))
      : [],
    anonymousRecovery: [],
    guests: guestsOut,
  });
};

if (import.meta.main) serve(handler);

// Issue #4508 P3 — willText false (unsupported_region) for a guest whose
// stored number the SMS adapter cannot route. One read of the party's numbers
// (service role); on a read failure the answer stays as the database gave it.
async function routeSubmittedGuests<
  T extends { guestId?: string | null; willText?: boolean },
>(admin: AdminClient, guests: T[]): Promise<T[]> {
  const ids = guests
    .filter((g) => g.willText !== false && typeof g.guestId === "string")
    .map((g) => g.guestId as string);
  if (ids.length === 0) return guests;
  const { data, error } = await admin.from("event_rsvp_guests")
    .select("id,phone")
    .in("id", ids);
  if (error !== null) {
    console.warn("[public-submit-rsvp] guest route read failed", error.message);
    return guests;
  }
  const phones = new Map<string, string | null>();
  for (const row of (data ?? []) as Array<{ id: string; phone: string | null }>) {
    phones.set(String(row.id), row.phone);
  }
  return applySmsRoute(
    guests,
    (id) => phones.get(id),
    (phone) => /^\+[1-9][0-9]{7,14}$/.test(phone.trim()) && countryFromE164(phone.trim()) !== null,
  );
}

// Issue #4508 T3 / P3-T11 — send each notice through notify-dispatch (the
// path "This isn't me" uses). Never throws into the committed RSVP.
async function sendGuestNotices(
  admin: AdminClient,
  notices: unknown,
): Promise<void> {
  if (!Array.isArray(notices)) return;
  for (const notice of notices as GuestNotice[]) {
    const body = guestNoticeDispatch(notice);
    if (body === null) continue;
    try {
      const { error } = await admin.functions.invoke("notify-dispatch", { body });
      if (error) {
        console.warn("[public-submit-rsvp] guest notice failed", error.message);
      }
    } catch (err) {
      console.warn("[public-submit-rsvp] guest notice failed", String(err));
    }
  }
}

// Best-effort: deliver the RSVP's pending rows now (the queue's every-minute
// sweep is the backstop).
async function drainRsvpDeliveries(
  admin: AdminClient,
  rsvpId: string,
): Promise<void> {
  try {
    const { data: due } = await admin.from("rsvp_notifications")
      .select("id")
      .eq("rsvp_id", rsvpId)
      .in("status", ["pending", "failed_retryable"]);
    for (const row of (due ?? []) as Array<{ id: string }>) {
      await admin.functions.invoke("rsvp-notify", {
        body: { notificationId: row.id },
      });
    }
  } catch (err) {
    console.warn(
      "[public-submit-rsvp] RSVP delivery drain failed (non-fatal)",
      String(err),
    );
  }
}

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
      entityId: String(primaryRaw.id),
      guestId: null,
      role: "primary" as const,
      displayName: String(primaryRaw.guest_name ?? "Guest"),
      qrCode: primaryRaw.qr_code as string | null,
      createdAt: primaryRaw.pass_recovery_token_created_at as string | null,
      table: "event_rsvps",
    },
    // #4508 R-9: a guest's pass name follows the 1.11 rule.
    ...(await Promise.all(
      ((guestsRaw ?? []) as Array<Record<string, unknown>>).map(async (g) => ({
        entityId: String(g.id),
        guestId: String(g.id),
        role: "guest" as const,
        displayName: await rsvpGuestDisplayName(
          admin,
          String(g.id),
          typeof g.name === "string" ? g.name : null,
        ),
        qrCode: g.qr_code as string | null,
        createdAt: g.pass_recovery_token_created_at as string | null,
        table: "event_rsvp_guests",
      })),
    )),
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
        entityId: row.entityId,
        createdAtIso: createdAt,
        pepper,
      });
      const recoveryHash = await sha256Hex(recoveryToken);
      const { error } = await admin.from(row.table).update({
        pass_recovery_token_hash: recoveryHash,
        pass_recovery_token_created_at: createdAt,
      }).eq("id", row.entityId);
      if (error) {
        console.warn(
          "[public-submit-rsvp] recovery hash persistence failed",
          error.message,
        );
        recoveryToken = null;
      }
    }
    output.push({
      entityId: row.entityId,
      guestId: row.guestId,
      role: row.role,
      displayName: row.displayName,
      qrCode: row.qrCode,
      recoveryToken,
    });
  }
  return output;
}
