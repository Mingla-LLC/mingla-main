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
// escapeHtml is the canonical escape; the escHtml alias below delegates to it.
import { escapeHtml as sharedEscapeHtml } from "../_shared/email/escape.ts";
// ORCH-1384 (SPEC §4.3) — MOVE-ONLY extraction: the email builder/sender +
// token minting + email constants now live in the shared module so
// partner-reissue-invitation and this fn share ONE email source of truth.
// Re-exported below so the existing __tests__ keep importing from ./index.ts.
import {
  buildInviteEmail,
  EMAIL_MAX,
  EMAIL_RE,
  EXPIRY_DAYS,
  makeToken,
  sendInviteEmail,
  sha256Hex,
} from "../_shared/brandInviteEmail.ts";

export { buildInviteEmail, sha256Hex };
// ORCH-1205 — use the shared CORS allow-list (it includes x-client-info, which
// supabase-js sends on EVERY request) so the browser preflight is not rejected.
// The shared object already uses "POST, OPTIONS", matching this function's
// methods, so behavior is unchanged except the widened allow-headers.
import { corsHeaders } from "../_shared/cors.ts";

const PERSONAL_NOTE_MAX = 280;

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
const NAME_MAX = 100;

const RANK_BRAND_ADMIN = 50;
const RANK_BRAND_OWNER = 60;

export interface InvitePayload {
  brand_id: string;
  invitee_email: string;
  invitee_name: string;
  role: string;
  // ORCH-1081 — optional partner-attribution payload. personal_note appears in
  // the email body when present. partner_setup tells the renderer to switch
  // to the "Set up for you by X" attribution + "Accept & set up X" CTA.
  personal_note?: string;
  partner_setup?: boolean;
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

  // ORCH-1081 — optional personal_note (≤280 chars) + partner_setup flag.
  const rawNote = typeof body.personal_note === "string" ? body.personal_note : "";
  const personalNote = rawNote.trim();
  if (personalNote.length > PERSONAL_NOTE_MAX) fields.push("personal_note");
  const partnerSetup = body.partner_setup === true;

  if (fields.length > 0) return { ok: false, fields };
  return {
    ok: true,
    payload: {
      brand_id: brandId,
      invitee_email: inviteeEmail,
      invitee_name: inviteeName,
      role,
      personal_note: personalNote.length > 0 ? personalNote : undefined,
      partner_setup: partnerSetup,
    },
  };
}

function escHtml(s: string): string {
  // Local alias kept in case existing tests reference it. Delegates to the
  // canonical shared escapeHtml so we don't ship two implementations.
  return sharedEscapeHtml(s);
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
    // ORCH-1081 — also pull cover_media_url + cover_media_type so the email
    // shell can render the brand cover as a hero banner; and partner_setup so
    // we know which copy variant the email should use even if the caller
    // forgot the partner_setup flag in the request body.
    const { data: brandRow, error: brandErr } = await service
      .from("brands")
      .select("id, name, cover_media_url, cover_media_type, partner_setup")
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
    // ISSUE-927: BUSINESS_WEB_ORIGIN is the canonical secret; the old name is
    // a fallback so its deletion is safely decoupled (same digest, audited).
    const businessOrigin = Deno.env.get("BUSINESS_WEB_ORIGIN") ??
      Deno.env.get("MINGLA_BUSINESS_WEB_URL") ??
      "https://business.usemingla.com";
    const acceptUrl = `${
      businessOrigin.replace(/\/+$/, "")
    }/accept-brand-invitation?token=${encodeURIComponent(token)}`;

    // ORCH-1081 — inviter display: pull the inviter's display_name from
    // creator_accounts when available so the email reads "Seth invited you"
    // rather than "seth@example.com invited you". Falls back to email.
    let inviterDisplay = inviterEmail || "A teammate";
    try {
      const { data: inviterRow } = await service
        .from("creator_accounts")
        .select("display_name, business_name")
        .eq("id", userId)
        .maybeSingle();
      const name = (inviterRow?.display_name as string | null) ??
        (inviterRow?.business_name as string | null) ?? null;
      if (name && name.trim().length > 0) inviterDisplay = name.trim();
    } catch {
      /* fall back to email */
    }

    const brandDisplay = brandRow.name as string ?? "your brand";
    const brandCoverUrl = (brandRow.cover_media_url as string | null) ?? null;
    const brandCoverMediaType = (brandRow.cover_media_type as string | null) ??
      null;
    // Effective partner_setup: client flag wins, but if brand has partner_setup
    // already persisted we respect that too (covers the case where an admin
    // toggles flag client-side without the wizard).
    const effectivePartnerSetup = payload.partner_setup === true ||
      brandRow.partner_setup === true;

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
      brandCoverUrl,
      brandCoverMediaType,
      personalNote: payload.personal_note ?? null,
      partnerSetup: effectivePartnerSetup,
      // ORCH-0785 shell env — share the same env keys the rest of the
      // transactional email pipeline uses.
      logoUrl: Deno.env.get("MINGLA_LOGO_URL") ?? undefined,
      supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? undefined,
      footerAddress: Deno.env.get("MINGLA_FOOTER_ADDRESS") ?? undefined,
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
          partner_setup: effectivePartnerSetup,
        },
      });
    } catch {
      /* ignore audit failures */
    }

    // ORCH-1081 — partner_brand_links insert. Only when this is an OWNERSHIP
    // invite (role=brand_owner) for a partner-setup brand. ON CONFLICT
    // DO NOTHING handles re-invite-after-cancel races (the unique index is
    // partial WHERE cancelled_at IS NULL, so two cancelled rows coexist).
    if (effectivePartnerSetup && payload.role === "brand_owner") {
      try {
        const { error: linkErr } = await service
          .from("partner_brand_links")
          .insert({
            partner_account_id: userId,
            brand_id: payload.brand_id,
            invited_owner_email: payload.invitee_email,
            personal_note: payload.personal_note ?? null,
          });
        if (linkErr && linkErr.code !== PG_UNIQUE_VIOLATION) {
          console.warn(
            "[invite-brand-member] partner_brand_links insert non-fatal failure",
            linkErr.message,
          );
        }
      } catch (linkThrow) {
        console.warn(
          "[invite-brand-member] partner_brand_links insert threw (non-fatal)",
          linkThrow instanceof Error ? linkThrow.message : String(linkThrow),
        );
      }
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
