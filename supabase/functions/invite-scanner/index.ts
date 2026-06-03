// ORCH-1051 [Scanner invite + brand-scoped scanner] — invite endpoint.
// META-ORCH-1048 sub-C.
//
// AUTHENTICATED edge function (verify_jwt=true in config.toml). The Business
// app POSTs an invite from either /event/[id]/scanners (scope=event) or
// /brand/[id]/scanners (scope=brand). The function:
//   1. extracts auth.uid() from the JWT,
//   2. enforces event_manager+ rank via biz_brand_effective_rank (rank ≥ 40
//      = MANAGE_SCANNERS gate),
//   3. validates inputs (scope discriminates event_id requirement),
//   4. mints a 32-byte URL-safe random token, stores SHA-256(token), and
//      INSERTs into scanner_invitations via service role,
//   5. ships the invite via Resend; if Resend fails the INSERT is rolled
//      back (DELETE) so we never leave orphan rows.
//
// HTTP contract:
//   POST { brand_id, event_id?, scope: 'event'|'brand',
//          invitee_email, invitee_name, can_accept_payments? }
//   → 201 { invitation_id }
//   → 400 { error:'validation', fields?:string[] }
//   → 401 { error:'unauthenticated' }
//   → 403 { error:'forbidden' }
//   → 404 { error:'brand_not_found' | 'event_not_found' }
//   → 409 { error:'already_invited' }
//   → 502 { error:'email_send_failed' }
//   → 500 { error:'server' }
//
// External API — Resend "Send Email" (COMMS-0003 docs cited):
//   POST https://api.resend.com/emails
//   https://resend.com/docs/api-reference/emails/send-email

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_SCOPES = new Set(["event", "brand"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 100;
const EMAIL_MAX = 254;

const RANK_EVENT_MANAGER = 40;

const TOKEN_BYTES = 32;
const EXPIRY_DAYS = 7;

export interface InviteScannerPayload {
  brand_id: string;
  event_id: string | null;
  scope: "event" | "brand";
  invitee_email: string;
  invitee_name: string;
  can_accept_payments: boolean;
}

export type ValidationOutcome =
  | { ok: true; payload: InviteScannerPayload }
  | { ok: false; fields: string[] };

export function validateInvite(raw: unknown): ValidationOutcome {
  const fields: string[] = [];
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const brandId = str(body.brand_id).trim();
  const eventIdRaw = str(body.event_id).trim();
  const scope = str(body.scope).trim();
  const inviteeEmail = str(body.invitee_email).trim().toLowerCase();
  const inviteeName = str(body.invitee_name).trim();
  const canAcceptPayments = body.can_accept_payments === true;

  if (!/^[0-9a-f-]{32,36}$/i.test(brandId)) fields.push("brand_id");
  if (!VALID_SCOPES.has(scope)) fields.push("scope");

  // scope=event requires a valid event_id; scope=brand requires no event_id.
  let eventId: string | null = null;
  if (scope === "event") {
    if (!/^[0-9a-f-]{32,36}$/i.test(eventIdRaw)) {
      fields.push("event_id");
    } else {
      eventId = eventIdRaw;
    }
  } else if (scope === "brand") {
    if (eventIdRaw.length > 0) {
      fields.push("event_id"); // must be omitted/null for brand scope
    }
  }

  if (!EMAIL_RE.test(inviteeEmail) || inviteeEmail.length > EMAIL_MAX) {
    fields.push("invitee_email");
  }
  if (inviteeName.length < 1 || inviteeName.length > NAME_MAX) {
    fields.push("invitee_name");
  }

  if (fields.length > 0) return { ok: false, fields };
  return {
    ok: true,
    payload: {
      brand_id: brandId,
      event_id: eventId,
      scope: scope as "event" | "brand",
      invitee_email: inviteeEmail,
      invitee_name: inviteeName,
      can_accept_payments: canAcceptPayments,
    },
  };
}

// Random URL-safe token. 32 bytes → ~43 base64url chars; ~256 bits of entropy.
function makeToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildInviteEmail(input: {
  inviteeName: string;
  inviteeEmail: string;
  brandName: string;
  eventName: string | null;
  inviterName: string;
  scope: "event" | "brand";
  acceptUrl: string;
  from: string;
}): { from: string; to: string[]; subject: string; html: string; text: string } {
  const subject = input.scope === "event"
    ? `Scan tickets at ${input.eventName ?? input.brandName} on Mingla`
    : `Scan tickets for ${input.brandName} on Mingla`;
  const roleLine = input.scope === "event"
    ? `scan tickets at <strong>${escHtml(input.eventName ?? input.brandName)}</strong>`
    : `scan tickets at every <strong>${escHtml(input.brandName)}</strong> event`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;color:#0e0e10;max-width:560px;">
  <p>Hi ${escHtml(input.inviteeName)},</p>
  <p><strong>${escHtml(input.inviterName)}</strong> invited you to ${roleLine} on Mingla.</p>
  <p style="margin:24px 0;">
    <a href="${escHtml(input.acceptUrl)}"
       style="background:#EB7825;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block;">
      Accept invitation
    </a>
  </p>
  <p style="color:#6b7280;font-size:13px;">This link expires in ${EXPIRY_DAYS} days.
  If the button doesn't work, copy and paste this URL into your browser:</p>
  <p style="word-break:break-all;font-size:12px;color:#6b7280;">${escHtml(input.acceptUrl)}</p>
</div>`;
  const text = input.scope === "event"
    ? `Hi ${input.inviteeName},\n\n${input.inviterName} invited you to scan tickets at ${input.eventName ?? input.brandName} on Mingla.\n\nAccept: ${input.acceptUrl}\n\nThis link expires in ${EXPIRY_DAYS} days.`
    : `Hi ${input.inviteeName},\n\n${input.inviterName} invited you to scan tickets at every ${input.brandName} event on Mingla.\n\nAccept: ${input.acceptUrl}\n\nThis link expires in ${EXPIRY_DAYS} days.`;
  return {
    from: input.from,
    to: [input.inviteeEmail],
    subject,
    html,
    text,
  };
}

async function sendInviteEmail(
  apiKey: string,
  payload: ReturnType<typeof buildInviteEmail>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // no-attachment: scanner invite is a transactional HTML email (accept link
    // only) — no PDF/ticket/file attachment by design.
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (response.ok) return { ok: true };
    let detail = "";
    try {
      const body = await response.json() as { message?: string };
      detail = body?.message ?? "";
    } catch {
      /* ignore */
    }
    return { ok: false, error: `resend_${response.status}:${detail}` };
  } catch (err) {
    return {
      ok: false,
      error: `resend_throw:${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

const PG_UNIQUE_VIOLATION = "23505";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthenticated" }, 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "validation" }, 400);
  }
  const validated = validateInvite(raw);
  if (!validated.ok) {
    return json({ error: "validation", fields: validated.fields }, 400);
  }
  const payload = validated.payload;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userResult, error: userErr } = await callerClient.auth
      .getUser();
    if (userErr || !userResult?.user) {
      return json({ error: "unauthenticated" }, 401);
    }
    const userId = userResult.user.id;
    const inviterEmail = userResult.user.email ?? "";

    const service = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Permission gate: rank ≥ event_manager (MANAGE_SCANNERS).
    const { data: rankRow, error: rankErr } = await service.rpc(
      "biz_brand_effective_rank",
      { p_brand_id: payload.brand_id, p_user_id: userId },
    );
    if (rankErr) {
      console.error("[invite-scanner] rank lookup failed", rankErr.message);
      return json({ error: "server" }, 500);
    }
    const callerRank = typeof rankRow === "number" ? rankRow : 0;
    if (callerRank < RANK_EVENT_MANAGER) {
      return json({ error: "forbidden" }, 403);
    }

    // Brand lookup for the email template + 404 surface.
    const { data: brandRow, error: brandErr } = await service
      .from("brands")
      .select("id, display_name")
      .eq("id", payload.brand_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (brandErr) {
      console.error("[invite-scanner] brand lookup failed", brandErr.message);
      return json({ error: "server" }, 500);
    }
    if (!brandRow) {
      return json({ error: "brand_not_found" }, 404);
    }

    // Event lookup for scope=event (must match the brand).
    let eventName: string | null = null;
    if (payload.scope === "event" && payload.event_id) {
      const { data: eventRow, error: eventErr } = await service
        .from("events")
        .select("id, name, brand_id, deleted_at")
        .eq("id", payload.event_id)
        .maybeSingle();
      if (eventErr) {
        console.error("[invite-scanner] event lookup failed", eventErr.message);
        return json({ error: "server" }, 500);
      }
      if (!eventRow || eventRow.deleted_at || eventRow.brand_id !== payload.brand_id) {
        return json({ error: "event_not_found" }, 404);
      }
      eventName = typeof eventRow.name === "string" ? eventRow.name : null;
    }

    // Duplicate guard — pending invite for brand+email+scope+event already exists.
    let dupQuery = service
      .from("scanner_invitations")
      .select("id")
      .eq("brand_id", payload.brand_id)
      .eq("email", payload.invitee_email)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString());
    if (payload.scope === "event" && payload.event_id) {
      dupQuery = dupQuery.eq("event_id", payload.event_id);
    } else {
      dupQuery = dupQuery.is("event_id", null);
    }
    const { data: existing, error: existingErr } = await dupQuery
      .limit(1)
      .maybeSingle();
    if (existingErr) {
      console.error(
        "[invite-scanner] duplicate lookup failed",
        existingErr.message,
      );
      return json({ error: "server" }, 500);
    }
    if (existing) {
      return json({ error: "already_invited" }, 409);
    }

    // Mint token + hash.
    const token = makeToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(
      Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const permissions = {
      canScan: true,
      canAcceptPayments: payload.can_accept_payments === true,
    };

    const { data: inserted, error: insertErr } = await service
      .from("scanner_invitations")
      .insert({
        brand_id: payload.brand_id,
        event_id: payload.event_id,
        scope: payload.scope,
        email: payload.invitee_email,
        invitee_name: payload.invitee_name,
        permissions,
        invited_by: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        status: "pending",
      })
      .select("id")
      .single();
    if (insertErr) {
      if (insertErr.code === PG_UNIQUE_VIOLATION) {
        return json({ error: "server" }, 500);
      }
      console.error("[invite-scanner] insert failed", insertErr.message);
      return json({ error: "server" }, 500);
    }

    const businessOrigin = Deno.env.get("MINGLA_BUSINESS_WEB_URL") ??
      "https://business.usemingla.com";
    const acceptUrl = `${
      businessOrigin.replace(/\/+$/, "")
    }/accept-scanner-invitation?token=${encodeURIComponent(token)}`;

    const inviterDisplay = inviterEmail || "A teammate";
    const brandDisplay = brandRow.display_name as string ?? "your brand";

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!resendKey) {
      console.error(
        "[invite-scanner] RESEND_API_KEY missing — rolling back insert",
      );
      await service.from("scanner_invitations").delete().eq("id", inserted.id);
      return json({ error: "email_send_failed" }, 502);
    }

    const from = Deno.env.get("RESEND_INVITE_FROM") ??
      Deno.env.get("RESEND_MARKETING_FROM") ??
      "Mingla <noreply@usemingla.com>";

    const emailPayload = buildInviteEmail({
      inviteeName: payload.invitee_name,
      inviteeEmail: payload.invitee_email,
      brandName: brandDisplay,
      eventName,
      inviterName: inviterDisplay,
      scope: payload.scope,
      acceptUrl,
      from,
    });

    const sent = await sendInviteEmail(resendKey, emailPayload);
    if (!sent.ok) {
      console.error("[invite-scanner] resend failed", sent.error);
      await service.from("scanner_invitations").delete().eq("id", inserted.id);
      return json({ error: "email_send_failed" }, 502);
    }

    // Best-effort audit row — non-fatal if it errors.
    try {
      await service.from("audit_log").insert({
        user_id: userId,
        brand_id: payload.brand_id,
        event_id: payload.event_id,
        action: "scanner_invitation_sent",
        target_type: "scanner_invitation",
        target_id: inserted.id,
        after: {
          scope: payload.scope,
          invitee_email: payload.invitee_email,
          permissions,
        },
      });
    } catch {
      /* ignore */
    }

    return json({ invitation_id: inserted.id }, 201);
  } catch (err) {
    console.error(
      "[invite-scanner] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
