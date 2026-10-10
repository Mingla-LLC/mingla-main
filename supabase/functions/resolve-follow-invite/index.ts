/**
 * #3682 Wave 2.5 — resolve / attach a follow_invite token after OTP verify.
 * GET (auth optional): returns { email, brandId, brandName, brandSlug, expired } without consuming.
 * POST (auth): attaches brand_follows with source web_follow_invite via atomic claim RPC.
 * verify_jwt: false — POST checks JWT in-code; GET may be anonymous (WelcomeScreen peek).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import {
  hashWebFollowToken,
  verifyWebFollowEmailToken,
} from "../_shared/webFollowEmailTokens.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const url = new URL(req.url);
  let token = url.searchParams.get("token")?.trim() ?? "";
  if (req.method === "POST") {
    try {
      const body = await req.json() as { token?: unknown };
      if (typeof body.token === "string") token = body.token.trim();
    } catch {
      /* keep query token */
    }
  }
  if (token.length === 0) {
    return json({ error: "token_required" }, 400);
  }

  let userId: string | null = null;
  let userEmail = "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    userId = userData.user?.id ?? null;
    userEmail = (userData.user?.email ?? "").trim().toLowerCase();
  }
  if (req.method === "POST" && !userId) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: Awaited<ReturnType<typeof verifyWebFollowEmailToken>>;
  try {
    payload = await verifyWebFollowEmailToken(token);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (reason.includes("expired")) {
      return json({ error: "expired", expired: true }, 410);
    }
    return json({ error: "invalid_token" }, 400);
  }
  if (payload.kind !== "invite") {
    return json({ error: "wrong_kind" }, 400);
  }

  const supabase = serviceClient();
  const tokenHash = await hashWebFollowToken(token);
  const { data: pending } = await supabase
    .from("brand_follow_email_pending")
    .select("id, consumed_at, expires_at, email_normalized, brand_id")
    .eq("token_hash", tokenHash)
    .eq("kind", "invite")
    .maybeSingle();

  const { data: brandRow } = await supabase
    .from("brands")
    .select("id, name, slug")
    .eq("id", payload.brand_id)
    .maybeSingle();
  const brandName = (brandRow?.name as string | null)?.trim() || "this brand";
  const brandSlug = (brandRow?.slug as string | null) ?? null;
  // Email is ledger-only (invite JWT subject is opaque).
  const email = (pending?.email_normalized as string | null) ?? null;

  if (!pending || new Date(pending.expires_at as string).getTime() < Date.now()) {
    return json({
      error: "expired",
      expired: true,
      email: null,
      brandId: payload.brand_id,
      brandName,
      brandSlug,
    }, 410);
  }

  if (req.method === "GET") {
    return json({
      email,
      brandId: payload.brand_id,
      brandName,
      brandSlug,
      expired: false,
      consumed: pending.consumed_at !== null,
      // O6 hint for clients comparing to the signed-in session.
      emailMismatch: userEmail.length > 0 && email !== null &&
        userEmail !== email,
    });
  }

  if (pending.consumed_at) {
    return json({
      ok: true,
      already: true,
      brandId: payload.brand_id,
      brandName,
      brandSlug,
    });
  }

  if (!userId) {
    return json({ error: "unauthorized" }, 401);
  }

  // O6 — different signed-in email requires client confirm before POST.
  // Server still attaches to the calling user when they POST (follow on this account).
  void userEmail;

  const { data: claim, error: claimErr } = await supabase.rpc(
    "biz_claim_web_follow_invite",
    { p_token_hash: tokenHash, p_user_id: userId },
  );
  if (claimErr) {
    console.error("[resolve-follow-invite] claim failed", claimErr.message);
    return json({ error: "attach_failed" }, 500);
  }
  const claimObj = (claim ?? {}) as {
    ok?: boolean;
    error?: string;
    already?: boolean;
    brand_id?: string;
  };
  if (claimObj.ok !== true) {
    if (claimObj.error === "expired") {
      return json({ error: "expired", expired: true }, 410);
    }
    return json({ error: claimObj.error ?? "attach_failed" }, 400);
  }

  return json({
    ok: true,
    already: claimObj.already === true,
    brandId: claimObj.brand_id ?? payload.brand_id,
    brandName,
    brandSlug,
  });
});

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...ticketCorsHeaders, "Content-Type": "application/json" },
  });
}
