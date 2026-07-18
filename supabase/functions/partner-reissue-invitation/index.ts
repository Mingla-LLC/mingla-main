// ORCH-1384 [partner brand-management verbs] — reissue endpoint.
//
// AUTHENTICATED edge function (verify_jwt=true in config.toml). The Business
// app POSTs a resend / correct-email reissue from the PartnerLinkDetailSheet.
// The function:
//   1. extracts auth.uid() from the JWT,
//   2. validates the optional corrected address (shared EMAIL_RE/EMAIL_MAX),
//   3. reads the link via service role and maps 404/403/409 BEFORE any write,
//   4. mints a fresh 32-byte token (shared makeToken/sha256Hex; EXPIRY_DAYS=7)
//      and calls the service_role-only partner_reissue_brand_invitation RPC —
//      which atomically EXPIRES old pending tokens (never revokes —
//      I-PROPOSED-1384-REISSUE-EXPIRES-NEVER-REVOKES), inserts the fresh
//      invitation, and updates the link's email VALUE + invited_at,
//   5. ships the invite via the shared brand-invite email builder; if the
//      send fails the new invitation row is DELETEd (a DELETE cannot fire the
//      invite-kill UPDATE trigger) and 502 is returned. The degraded state
//      after a 502 (link email/invited_at already updated, no live token) is
//      recoverable: the row detail still offers Resend and a retry fully
//      cures (SC-16).
//
// NO partner_brand_links INSERT anywhere in this fn — reissue mutates the
// EXISTING row via the RPC; the invite-brand-member 23505-swallow class is
// structurally unreachable on this path (F-7 cure).
//
// HTTP contract (SPEC §4.2):
//   POST { link_id: uuid, new_email?: string }
//   → 201 { invitation_id }
//   → 400 { error:'validation', fields?:string[] }
//   → 401 { error:'unauthenticated' }
//   → 403 { error:'forbidden' }
//   → 404 { error:'link_not_found' | 'brand_not_found' }
//   → 409 { error:'link_not_pending' }
//   → 502 { error:'email_send_failed' }
//   → 500 { error:'server' }
//
// External API — Resend "Send Email" (COMMS-0003 docs cited):
//   POST https://api.resend.com/emails
//   https://resend.com/docs/api-reference/emails/send-email
//   (via the shared sendInviteEmail — same call invite-brand-member ships.)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/cors.ts";
import {
  buildInviteEmail,
  EMAIL_MAX,
  EMAIL_RE,
  EXPIRY_DAYS,
  makeToken,
  sendInviteEmail,
  sha256Hex,
} from "../_shared/brandInviteEmail.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface ReissuePayload {
  link_id: string;
  new_email?: string;
}

export type ReissueValidationOutcome =
  | { ok: true; payload: ReissuePayload }
  | { ok: false; fields: string[] };

export function validateReissue(raw: unknown): ReissueValidationOutcome {
  const fields: string[] = [];
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const linkId = str(body.link_id).trim();
  // Loose UUID shape check (DB will hard-reject malformed UUIDs).
  if (!/^[0-9a-f-]{32,36}$/i.test(linkId)) fields.push("link_id");

  // Optional corrected address — validate ONLY when present (shared
  // EMAIL_RE/EMAIL_MAX, same semantics the invite endpoint enforces).
  let newEmail: string | undefined;
  if (body.new_email !== undefined && body.new_email !== null) {
    const candidate = str(body.new_email).trim().toLowerCase();
    if (!EMAIL_RE.test(candidate) || candidate.length > EMAIL_MAX) {
      fields.push("new_email");
    } else {
      newEmail = candidate;
    }
  }

  if (fields.length > 0) return { ok: false, fields };
  return {
    ok: true,
    payload: { link_id: linkId, new_email: newEmail },
  };
}

/** Map partner_reissue_brand_invitation RAISE messages → HTTP responses. */
function rpcErrorResponse(message: string): Response {
  if (message.includes("link_not_found")) {
    return json({ error: "link_not_found" }, 404);
  }
  if (message.includes("forbidden")) {
    return json({ error: "forbidden" }, 403);
  }
  if (message.includes("link_not_pending")) {
    return json({ error: "link_not_pending" }, 409);
  }
  if (message.includes("validation")) {
    return json({ error: "validation" }, 400);
  }
  return json({ error: "server" }, 500);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // Auth — verify_jwt=true means the gateway already authenticated. We still
  // need auth.uid() to scope the link ownership check, so we instantiate a
  // client bound to the caller JWT and read it back via supabase.auth.getUser().
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
  const validated = validateReissue(raw);
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

    // Link read — full 404/403/409 mapping BEFORE any write.
    const { data: linkRow, error: linkErr } = await service
      .from("partner_brand_links")
      .select(
        "id, partner_account_id, brand_id, invited_owner_email, personal_note, accepted_at, cancelled_at",
      )
      .eq("id", payload.link_id)
      .maybeSingle();
    if (linkErr) {
      console.error(
        "[partner-reissue-invitation] link lookup failed",
        linkErr.message,
      );
      return json({ error: "server" }, 500);
    }
    if (!linkRow) {
      return json({ error: "link_not_found" }, 404);
    }
    if (linkRow.partner_account_id !== userId) {
      return json({ error: "forbidden" }, 403);
    }
    if (linkRow.cancelled_at !== null || linkRow.accepted_at !== null) {
      return json({ error: "link_not_pending" }, 409);
    }

    // Brand lookup for the email template + 404 surface.
    const { data: brandRow, error: brandErr } = await service
      .from("brands")
      .select("id, name, cover_media_url, cover_media_type, partner_setup")
      .eq("id", linkRow.brand_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (brandErr) {
      console.error(
        "[partner-reissue-invitation] brand lookup failed",
        brandErr.message,
      );
      return json({ error: "server" }, 500);
    }
    if (!brandRow) {
      return json({ error: "brand_not_found" }, 404);
    }

    // Mint token + hash (shared constants: TOKEN_BYTES=32, EXPIRY_DAYS=7).
    const token = makeToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(
      Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const effectiveEmail = payload.new_email ??
      (linkRow.invited_owner_email as string);

    // Atomic reissue: expire-now old tokens + fresh invitation + link email
    // VALUE update + invited_at refresh — all inside the RPC's transaction.
    const { data: rpcResult, error: rpcErr } = await service.rpc(
      "partner_reissue_brand_invitation",
      {
        p_link_id: payload.link_id,
        p_partner_account_id: userId,
        p_new_email: effectiveEmail,
        p_token_hash: tokenHash,
        p_expires_at: expiresAt,
      },
    );
    if (rpcErr) {
      console.error(
        "[partner-reissue-invitation] rpc failed",
        rpcErr.message,
      );
      return rpcErrorResponse(rpcErr.message ?? "");
    }
    const result = (rpcResult ?? {}) as {
      invitation_id?: string;
      invitee_name?: string;
    };
    const invitationId = result.invitation_id ?? "";
    const inviteeName = result.invitee_name ??
      effectiveEmail.split("@")[0];
    if (invitationId.length === 0) {
      console.error(
        "[partner-reissue-invitation] rpc returned no invitation_id",
      );
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

    // Inviter display: pull the partner's display_name from creator_accounts
    // when available (mirrors invite-brand-member). Falls back to email.
    let inviterDisplay = inviterEmail || "Your Mingla partner";
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

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!resendKey) {
      console.error(
        "[partner-reissue-invitation] RESEND_API_KEY missing — rolling back invitation",
      );
      // DELETE, never revoke — a status flip would fire the invite-kill
      // trigger and terminally cancel the link being reissued
      // (I-PROPOSED-1384-REISSUE-EXPIRES-NEVER-REVOKES compensation rule).
      await service.from("brand_invitations").delete().eq("id", invitationId);
      return json({ error: "email_send_failed" }, 502);
    }

    const from = Deno.env.get("RESEND_INVITE_FROM") ??
      Deno.env.get("RESEND_MARKETING_FROM") ??
      "Mingla <noreply@usemingla.com>";

    const emailPayload = buildInviteEmail({
      inviteeName,
      inviteeEmail: effectiveEmail,
      brandName: (brandRow.name as string) ?? "your brand",
      inviterName: inviterDisplay,
      role: "brand_owner",
      acceptUrl,
      from,
      brandCoverUrl: (brandRow.cover_media_url as string | null) ?? null,
      brandCoverMediaType: (brandRow.cover_media_type as string | null) ??
        null,
      personalNote: (linkRow.personal_note as string | null) ?? null,
      // Partner-attribution copy variant — every reissued link is a
      // partner-setup ownership invite by construction.
      partnerSetup: true,
      logoUrl: Deno.env.get("MINGLA_LOGO_URL") ?? undefined,
      supportEmail: Deno.env.get("SUPPORT_EMAIL") ?? undefined,
      footerAddress: Deno.env.get("MINGLA_FOOTER_ADDRESS") ?? undefined,
    });

    const sent = await sendInviteEmail(resendKey, emailPayload);
    if (!sent.ok) {
      console.error("[partner-reissue-invitation] resend failed", sent.error);
      // Same compensation rule: DELETE the fresh row (cannot fire the
      // AFTER UPDATE OF status trigger), leave the link un-cancelled.
      await service.from("brand_invitations").delete().eq("id", invitationId);
      return json({ error: "email_send_failed" }, 502);
    }

    return json({ invitation_id: invitationId }, 201);
  } catch (err) {
    console.error(
      "[partner-reissue-invitation] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
