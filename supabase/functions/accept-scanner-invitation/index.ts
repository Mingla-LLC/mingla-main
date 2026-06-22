// ORCH-1051 [Scanner invite + brand-scoped scanner] — accept endpoint.
// META-ORCH-1048 sub-C.
//
// AUTHENTICATED edge function (verify_jwt=true in config.toml). The Business
// app POSTs the raw token from /accept-scanner-invitation?token=…. The function:
//   1. extracts auth.uid() from the JWT,
//   2. resolves auth.uid() → creator_accounts.id. PROBED 2026-06-02:
//      creator_accounts.id IS auth.users.id (no separate user_id column).
//   3. computes SHA-256(token),
//   4. calls accept_scanner_invitation(token_hash, account_id). The RPC
//      performs the atomic accept with FOR UPDATE locking on the invitation
//      row so concurrent accepts cannot double-spend the token, and branches
//      on scope to upsert either event_scanners (scope=event) or
//      brand_team_members (scope=brand).
//   5. maps RPC ERRCODEs (P0001..P0005) to clean HTTP responses.
//
// HTTP contract:
//   POST { token }
//   → 200 { scope, brand_id, event_id?, user_id }
//   → 400 { error:'validation' }
//   → 401 { error:'unauthenticated' }
//   → 403 { error:'invite_email_mismatch' }
//   → 404 { error:'invite_not_found' }
//   → 410 { error:'invite_already_used' | 'invite_expired' | 'invite_revoked' }
//   → 500 { error:'server' }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ORCH-1205 — use the shared CORS allow-list (it includes x-client-info, which
// supabase-js sends on EVERY request) so the browser preflight is not rejected.
// The shared object already uses "POST, OPTIONS", matching this function's
// methods, so behavior is unchanged except the widened allow-headers.
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    default:
      return null;
  }
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
    // creator_accounts.id IS auth.users.id (probed 2026-06-02). Lookup by id.
    const { data: account, error: accountErr } = await service
      .from("creator_accounts")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (accountErr) {
      console.error(
        "[accept-scanner-invitation] account lookup failed",
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
      "accept_scanner_invitation",
      { p_token_hash: tokenHash, p_accepting_account_id: account.id },
    );

    if (rpcErr) {
      const mapped = mapRpcError(rpcErr.code);
      if (mapped) {
        return json({ error: mapped.error }, mapped.status);
      }
      // Sometimes pgrest surfaces the message instead of the code.
      const msg = rpcErr.message ?? "";
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
        "[accept-scanner-invitation] rpc failed",
        rpcErr.code,
        rpcErr.message,
      );
      return json({ error: "server" }, 500);
    }

    return json(rpcResult ?? {}, 200);
  } catch (err) {
    console.error(
      "[accept-scanner-invitation] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
