// ORCH-1050 [Brand team invite + accept + ownership transfer] — invite endpoint.
//
// AUTHENTICATED edge function (verify_jwt=true in config.toml). The Business
// app POSTs an invite from /brand/[id]/team. The function:
//   1. extracts auth.uid() from the JWT,
//   2. enforces brand_admin+ rank via biz_brand_effective_rank (stricter
//      check for role='brand_owner': caller MUST already be the brand_owner),
//   3. validates inputs,
//   4. mints a 32-byte URL-safe random token, stores SHA-256(token), and
//      INSERTs into brand_invitations via service role (the inline RLS
//      predicate would re-evaluate biz_brand_effective_rank but service
//      role bypasses it; the rank check above is the real gate),
//   5. ships the invite via Resend; if Resend fails the INSERT is rolled
//      back (DELETE on the inserted row) so we never leave orphan rows.
//
// HTTP contract:
//   POST { brand_id, invitee_email, invitee_name, role }
//   → 201 { invitation_id }
//   → 400 { error:'validation', fields?:string[] }
//   → 401 { error:'unauthenticated' }
//   → 403 { error:'forbidden' }
//   → 404 { error:'brand_not_found' }
//   → 409 { error:'already_invited' }
//   → 502 { error:'email_send_failed' }
//   → 500 { error:'server' }
//
// External API — Resend "Send Email" (COMMS-0003 docs cited):
//   POST https://api.resend.com/emails
//   https://resend.com/docs/api-reference/emails/send-email
//   Mirrors supabase/functions/beta-access-lead-submit/index.ts:212-219.

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

const VALID_ROLES = new Set([
  "brand_owner",
  "brand_admin",
  "event_manager",
  "finance_manager",
  "marketing_manager",
  "scanner",
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 100;
const EMAIL_MAX = 254;

const RANK_BRAND_ADMIN = 50;
const RANK_BRAND_OWNER = 60;

const TOKEN_BYTES = 32;
const EXPIRY_DAYS = 7;

export interface InvitePayload {
  brand_id: string;
  invitee_email: string;
  invitee_name: string;
  role: string;
}

export type ValidationOutcome =
  | { ok: true; payload: InvitePayload }
  | { ok: false; fields: string[] };

export function validateInvite(raw: unknown): ValidationOutcome {
  const fields: string[] = [];
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const brandId = str(body.brand_id).trim();
  const inviteeEmail = str(body.invitee_email).trim().toLowerCase();
  const inviteeName = str(body.invitee_name).trim();
  const role = str(body.role).trim();

  // Loose UUID shape check (DB will hard-reject malformed UUIDs).
  if (!/^[0-9a-f-]{32,36}$/i.test(brandId)) fields.push("brand_id");
  if (!EMAIL_RE.test(inviteeEmail) || inviteeEmail.length > EMAIL_MAX) {
    fields.push("invitee_email");
  }
  if (inviteeName.length < 1 || inviteeName.length > NAME_MAX) {
    fields.push("invitee_name");
  }
  if (!VALID_ROLES.has(role)) fields.push("role");

  if (fields.length > 0) return { ok: false, fields };
  return {
    ok: true,
    payload: {
      brand_id: brandId,
      invitee_email: inviteeEmail,
      invitee_name: inviteeName,
      role,
    },
  };
}

// Random URL-safe token. 32 bytes → ~43 base64url chars; ~256 bits of entropy.
function makeToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  // base64url
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
  inviterName: string;
  role: string;
  acceptUrl: string;
  from: string;
}): { from: string; to: string[]; subject: string; html: string; text: string } {
  const roleLabel = roleDisplay(input.role);
  const subject = `${input.brandName} invited you to join their team on Mingla`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;color:#0e0e10;max-width:560px;">
  <p>Hi ${escHtml(input.inviteeName)},</p>
  <p><strong>${escHtml(input.inviterName)}</strong> invited you to join
  <strong>${escHtml(input.brandName)}</strong> on Mingla as
  <strong>${escHtml(roleLabel)}</strong>.</p>
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
  const text =
    `Hi ${input.inviteeName},\n\n${input.inviterName} invited you to join ` +
    `${input.brandName} on Mingla as ${roleLabel}.\n\nAccept: ${input.acceptUrl}\n\n` +
    `This link expires in ${EXPIRY_DAYS} days.`;
  return {
    from: input.from,
    to: [input.inviteeEmail],
    subject,
    html,
    text,
  };
}

function roleDisplay(role: string): string {
  switch (role) {
    case "brand_owner":
      return "Brand owner";
    case "brand_admin":
      return "Brand admin";
    case "event_manager":
      return "Event manager";
    case "finance_manager":
      return "Finance manager";
    case "marketing_manager":
      return "Marketing manager";
    case "scanner":
      return "Scanner";
    default:
      return role;
  }
}

async function sendInviteEmail(
  apiKey: string,
  payload: ReturnType<typeof buildInviteEmail>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // no-attachment: this is a plain transactional invite. No PDF/file
    // payload → opt-out from ORCH-0785-A's attachment-aware gate.
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

  // Auth — verify_jwt=true means the gateway already authenticated. We still
  // need auth.uid() to scope the permission check, so we instantiate a client
  // bound to the caller JWT and read it back via supabase.auth.getUser().
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

    // Permission gate: rank ≥ brand_admin. For role='brand_owner', tighter
    // gate: caller MUST be the current brand_owner (rank 60). The RPC enforces
    // the same constraint defensively but this gives clean 403 vs ambiguous
    // 5xx.
    const { data: rankRow, error: rankErr } = await service.rpc(
      "biz_brand_effective_rank",
      { p_brand_id: payload.brand_id, p_user_id: userId },
    );
    if (rankErr) {
      console.error("[invite-brand-member] rank lookup failed", rankErr.message);
      return json({ error: "server" }, 500);
    }
    const callerRank = typeof rankRow === "number" ? rankRow : 0;
    if (callerRank < RANK_BRAND_ADMIN) {
      return json({ error: "forbidden" }, 403);
    }
    if (payload.role === "brand_owner" && callerRank < RANK_BRAND_OWNER) {
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
      console.error("[invite-brand-member] brand lookup failed", brandErr.message);
      return json({ error: "server" }, 500);
    }
    if (!brandRow) {
      return json({ error: "brand_not_found" }, 404);
    }

    // Duplicate guard — if a pending invite already exists for this brand+email,
    // surface 409. (status='pending' AND expires_at > now()).
    const { data: existing, error: existingErr } = await service
      .from("brand_invitations")
      .select("id")
      .eq("brand_id", payload.brand_id)
      .eq("email", payload.invitee_email)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (existingErr) {
      console.error(
        "[invite-brand-member] duplicate lookup failed",
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

    const { data: inserted, error: insertErr } = await service
      .from("brand_invitations")
      .insert({
        brand_id: payload.brand_id,
        email: payload.invitee_email,
        invitee_name: payload.invitee_name,
        role: payload.role,
        invited_by: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        status: "pending",
      })
      .select("id")
      .single();
    if (insertErr) {
      if (insertErr.code === PG_UNIQUE_VIOLATION) {
        // Extremely unlikely token-hash collision; treat as transient.
        return json({ error: "server" }, 500);
      }
      console.error("[invite-brand-member] insert failed", insertErr.message);
      return json({ error: "server" }, 500);
    }

    // Build the accept URL. business.usemingla.com is the canonical host;
    // mirror the env-from-platform pattern.
    const businessOrigin = Deno.env.get("MINGLA_BUSINESS_WEB_URL") ??
      "https://business.usemingla.com";
    const acceptUrl = `${
      businessOrigin.replace(/\/+$/, "")
    }/accept-brand-invitation?token=${encodeURIComponent(token)}`;

    const inviterDisplay = inviterEmail || "A teammate";
    const brandDisplay = brandRow.display_name as string ?? "your brand";

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!resendKey) {
      console.error(
        "[invite-brand-member] RESEND_API_KEY missing — rolling back insert",
      );
      await service.from("brand_invitations").delete().eq("id", inserted.id);
      return json({ error: "email_send_failed" }, 502);
    }

    const from = Deno.env.get("RESEND_INVITE_FROM") ??
      Deno.env.get("RESEND_MARKETING_FROM") ??
      "Mingla <noreply@usemingla.com>";

    const emailPayload = buildInviteEmail({
      inviteeName: payload.invitee_name,
      inviteeEmail: payload.invitee_email,
      brandName: brandDisplay,
      inviterName: inviterDisplay,
      role: payload.role,
      acceptUrl,
      from,
    });

    const sent = await sendInviteEmail(resendKey, emailPayload);
    if (!sent.ok) {
      console.error("[invite-brand-member] resend failed", sent.error);
      await service.from("brand_invitations").delete().eq("id", inserted.id);
      return json({ error: "email_send_failed" }, 502);
    }

    // Best-effort audit row — non-fatal if it errors.
    try {
      await service.from("audit_log").insert({
        user_id: userId,
        brand_id: payload.brand_id,
        action: "brand_team_invitation_sent",
        target_type: "brand_invitation",
        target_id: inserted.id,
        after: {
          role: payload.role,
          invitee_email: payload.invitee_email,
        },
      });
    } catch {
      /* ignore audit failures */
    }

    return json({ invitation_id: inserted.id }, 201);
  } catch (err) {
    console.error(
      "[invite-brand-member] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
