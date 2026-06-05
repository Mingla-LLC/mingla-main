// ORCH-1050 [Brand team invite + accept + ownership transfer] — accept endpoint.
//
// AUTHENTICATED edge function (verify_jwt=true in config.toml). The Business
// app POSTs the raw token from /accept-brand-invitation?token=…. The function:
//   1. extracts auth.uid() from the JWT,
//   2. resolves auth.uid() → creator_accounts.id (RPC needs the account id),
//   3. computes SHA-256(token),
//   4. calls accept_invite_and_transfer_brand_ownership(token_hash, account_id).
//      The RPC performs the atomic accept + (when role=brand_owner) ownership
//      transfer in a single SQL transaction with FOR UPDATE locking on the
//      invitation row so concurrent accepts cannot double-spend the token.
//   5. maps RPC ERRCODEs (P0001..P0005) to clean HTTP responses.
//
// HTTP contract:
//   POST { token }
//   → 200 { brand_id, role, transferred, previous_owner_account_id,
//           new_owner_account_id }
//   → 400 { error:'validation' }
//   → 401 { error:'unauthenticated' }
//   → 403 { error:'invite_email_mismatch' }
//   → 404 { error:'invite_not_found' }
//   → 409 { error:'invite_currency_mismatch', reason, brand_currency, partner_currencies }
//   → 410 { error:'invite_already_used' | 'invite_expired' | 'invite_revoked' }
//   → 500 { error:'server' }
//
// ORCH-1052: P0006 invite_currency_mismatch surfaces when the accepting
// account is a flagged Mingla partner whose partner Stripe Connect account
// either isn't connected or can't settle in the brand's default_currency. The
// RPC carries the partner-gate payload in the exception DETAIL (JSON); we
// parse it and surface to the client.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// META-ORCH-1074 Sub-A: notify the EXISTING owner/admins that a teammate
// joined (excluding the just-joined member). business.* routes to the business
// OneSignal app automatically via notify-dispatch.
import {
  dispatchNotification,
  getBrandTeamUserIdsByRoles,
} from "../_shared/stripeEdgeAuth.ts";

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

// META-ORCH-1074 Sub-A (Sub-D §3.11): humanize the brand role for copy.
// Falls back to "a teammate" for unknown/missing roles.
export function humanizeRole(role: string | null | undefined): string {
  switch (role) {
    case "brand_owner":
      return "owner";
    case "brand_admin":
      return "admin";
    case "finance_manager":
      return "finance manager";
    case "event_manager":
      return "event manager";
    case "marketing_manager":
      return "marketing manager";
    case "scanner":
      return "scanner";
    default:
      return "a teammate";
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Maps Postgres ERRCODE → HTTP envelope.
export function mapRpcError(code: string | undefined): {
  status: number;
  error: string;
} | null {
  switch (code) {
    case "P0001":
      return { status: 404, error: "invite_not_found" };
    case "P0002":
      return { status: 410, error: "invite_already_used" };
    case "P0003":
      return { status: 410, error: "invite_expired" };
    case "P0004":
      return { status: 403, error: "invite_email_mismatch" };
    case "P0005":
      return { status: 410, error: "invite_revoked" };
    case "P0006":
      return { status: 409, error: "invite_currency_mismatch" };
    default:
      return null;
  }
}

// ORCH-1052: parse the partner-gate payload that the RPC packs into the
// EXCEPTION DETAIL. Falls back to a minimal object when DETAIL is missing /
// not JSON so the client always gets a stable envelope.
export function parsePartnerGateDetail(
  detail: string | undefined,
): Record<string, unknown> | null {
  if (typeof detail !== "string" || detail.length === 0) return null;
  try {
    const parsed = JSON.parse(detail);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON — fall through.
  }
  return null;
}

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
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (token.length < 16 || token.length > 256) {
    return json({ error: "validation" }, 400);
  }

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

    const service = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Resolve creator_accounts.id for this auth user.
    const { data: account, error: accountErr } = await service
      .from("creator_accounts")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (accountErr) {
      console.error(
        "[accept-brand-invitation] account lookup failed",
        accountErr.message,
      );
      return json({ error: "server" }, 500);
    }
    if (!account) {
      // No creator_accounts row → can't be the rightful invitee.
      return json({ error: "invite_email_mismatch" }, 403);
    }

    const tokenHash = await sha256Hex(token);

    const { data: rpcResult, error: rpcErr } = await service.rpc(
      "accept_invite_and_transfer_brand_ownership",
      { p_token_hash: tokenHash, p_accepting_account_id: account.id },
    );

    if (rpcErr) {
      const mapped = mapRpcError(rpcErr.code);
      if (mapped) {
        if (mapped.error === "invite_currency_mismatch") {
          // ORCH-1052: surface the partner-gate payload (brand_currency,
          // partner_currencies, reason) so the client can render a useful
          // money-gate message and link out to partner-Stripe onboarding.
          const partnerGate = parsePartnerGateDetail(
            (rpcErr as { details?: string }).details ??
              (rpcErr as { detail?: string }).detail,
          );
          return json(
            { error: mapped.error, partner_gate: partnerGate },
            mapped.status,
          );
        }
        return json({ error: mapped.error }, mapped.status);
      }
      // Sometimes pgrest surfaces the message instead of the code.
      const msg = rpcErr.message ?? "";
      if (msg.includes("invite_currency_mismatch")) {
        const partnerGate = parsePartnerGateDetail(
          (rpcErr as { details?: string }).details ??
            (rpcErr as { detail?: string }).detail,
        );
        return json(
          { error: "invite_currency_mismatch", partner_gate: partnerGate },
          409,
        );
      }
      if (msg.includes("invite_not_found")) {
        return json({ error: "invite_not_found" }, 404);
      }
      if (msg.includes("invite_already_used")) {
        return json({ error: "invite_already_used" }, 410);
      }
      if (msg.includes("invite_expired")) {
        return json({ error: "invite_expired" }, 410);
      }
      if (msg.includes("invite_email_mismatch")) {
        return json({ error: "invite_email_mismatch" }, 403);
      }
      if (msg.includes("invite_revoked")) {
        return json({ error: "invite_revoked" }, 410);
      }
      console.error(
        "[accept-brand-invitation] rpc failed",
        rpcErr.code,
        rpcErr.message,
      );
      return json({ error: "server" }, 500);
    }

    // META-ORCH-1074 Sub-A: business.team_member_joined — notify the existing
    // owner + admins (EXCLUDING the member who just joined). Idempotent on
    // brandId:memberUserId. Best-effort: a notify failure never fails the
    // accept (the invitation is already committed by the RPC above).
    try {
      const result = (rpcResult ?? {}) as Record<string, unknown>;
      const brandId = typeof result.brand_id === "string" ? result.brand_id : null;
      const memberRole = typeof result.role === "string" ? result.role : null;
      if (brandId) {
        // Resolve the joining member's display name (nicer copy; falls back to
        // the anonymous form when unavailable per Sub-D F1).
        let memberName: string | null = null;
        const { data: nameRow } = await service
          .from("creator_accounts")
          .select("display_name, business_name")
          .eq("id", account.id)
          .maybeSingle();
        memberName = (nameRow?.display_name as string | null) ??
          (nameRow?.business_name as string | null) ?? null;

        const { data: brandRow } = await service
          .from("brands")
          .select("name")
          .eq("id", brandId)
          .maybeSingle();
        const brandName = (brandRow?.name as string | null) ?? "your brand";
        const roleLabel = humanizeRole(memberRole);

        const recipients = await getBrandTeamUserIdsByRoles(
          service as never,
          brandId,
          ["brand_owner", "brand_admin"],
        );
        const namePart = memberName ?? "A new teammate";
        const title = "Teammate joined";
        const body = memberName
          ? `${memberName} joined ${brandName} as ${roleLabel}.`
          : `Someone joined ${brandName} as ${roleLabel}.`;
        for (const recipientId of recipients) {
          if (recipientId === account.id) continue; // exclude the just-joined member
          await dispatchNotification({
            userId: recipientId,
            brandId,
            type: "business.team_member_joined",
            title,
            body,
            data: {
              memberUserId: account.id,
              memberRole,
              memberName: memberName ?? undefined,
              brandName,
            },
            relatedId: account.id,
            relatedType: "team_member",
            idempotencyKey:
              `business.team_member_joined:${brandId}:${account.id}:${recipientId}`,
            deepLink: `mingla-business://brand/${brandId}/team`,
          });
        }
        // namePart kept for parity with Sub-D fallback copy intent.
        void namePart;
      }
    } catch (teamNotifyErr) {
      console.warn(
        "[accept-brand-invitation] team_member_joined notify threw (non-fatal):",
        teamNotifyErr instanceof Error
          ? teamNotifyErr.message
          : String(teamNotifyErr),
      );
    }

    return json(rpcResult ?? {}, 200);
  } catch (err) {
    console.error(
      "[accept-brand-invitation] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
