// ORCH-1220 [business-reviewer-bypass] — App-Store / Play reviewer email-login
// bypass for the BUSINESS app. REVIEWER-ONLY. This mints a real Supabase session
// for ONE configured reviewer email with NO email send, gated by a shared secret
// code, so an App-Store / Play reviewer can sign in without receiving the email
// OTP. It is NOT a "log in as anyone" oracle:
//
//   - The request's `email` must EXACTLY equal the env `REVIEWER_EMAIL`
//     (lowercased, trimmed) AND `code` must EXACTLY equal `REVIEWER_BYPASS_CODE`
//     (constant-time compare). Any mismatch → generic 401 { error: "invalid" }
//     that NEVER reveals which field failed.
//   - generate_link is ALWAYS called for the env `REVIEWER_EMAIL` — never for the
//     caller-supplied email beyond the equality gate. So even a future code leak
//     can only ever mint a session for the locked reviewer account.
//   - Without the secret `REVIEWER_BYPASS_CODE` the endpoint is useless.
//
// verify_jwt = false (config.toml): public endpoint, but the secret-code gate
// above is the real authentication. Nothing secret is hardcoded — REVIEWER_EMAIL
// and REVIEWER_BYPASS_CODE live in Supabase function secrets (set by orchestrator).
//
// Proven mechanism (verified live by the orchestrator against the backend):
//   1. service-role admin.generateLink(type: "magiclink", email: REVIEWER_EMAIL)
//      returns properties.email_otp WITHOUT sending an email.
//   2. POST /auth/v1/verify (type: "email", email + that otp, apikey = anon)
//      returns a real session { access_token, refresh_token }.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Constant-time string comparison — does not short-circuit on the first
// differing byte, so the response time does not leak how much of the secret
// code matched. Length is compared first via a length-padded XOR accumulator so
// even a length mismatch costs a full pass (no early `length !==` return).
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  // Fold the length difference into the result so unequal lengths still fail,
  // but iterate over the LONGER buffer so the loop count never depends on the
  // shorter (secret) string in a branch-predictable way.
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    const xa = i < ba.length ? ba[i] : 0;
    const xb = i < bb.length ? bb[i] : 0;
    diff |= xa ^ xb;
  }
  return diff === 0;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "invalid" }, 401);
  }

  // Required config — never hardcoded. Missing config is a server error (500),
  // NOT a 401, so we don't silently degrade into an open endpoint.
  const reviewerEmail = (Deno.env.get("REVIEWER_EMAIL") ?? "").trim().toLowerCase();
  const bypassCode = Deno.env.get("REVIEWER_BYPASS_CODE") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!reviewerEmail || !bypassCode || !supabaseUrl || !serviceRoleKey || !anonKey) {
    // Log WHICH config is missing (names only, never values) for operability.
    console.error(
      "[reviewer-signin] missing required env config:",
      [
        !reviewerEmail && "REVIEWER_EMAIL",
        !bypassCode && "REVIEWER_BYPASS_CODE",
        !supabaseUrl && "SUPABASE_URL",
        !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
        !anonKey && "SUPABASE_ANON_KEY",
      ]
        .filter(Boolean)
        .join(", "),
    );
    return json({ error: "server" }, 500);
  }

  // Parse the body defensively. A malformed body is an invalid request, not 500.
  let email = "";
  let code = "";
  try {
    const body = (await req.json()) as { email?: unknown; code?: unknown };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    code = typeof body.code === "string" ? body.code : "";
  } catch {
    return json({ error: "invalid" }, 401);
  }

  // ── SECURITY GATE ──────────────────────────────────────────────────────────
  // BOTH must hold: the email must be the locked reviewer email AND the code
  // must match the secret. Compute both checks then combine, so the response is
  // a single generic 401 that does not reveal which field failed. The code uses
  // a constant-time compare; the email uses an exact equality (it is not secret —
  // it is a fixed, publicly-knowable address — so timing on it leaks nothing).
  const emailOk = email === reviewerEmail;
  const codeOk = timingSafeEqual(code, bypassCode);
  if (!emailOk || !codeOk) {
    // Generic — never disclose which check failed. No code / email logged.
    console.warn("[reviewer-signin] rejected sign-in attempt (gate failed)");
    return json({ error: "invalid" }, 401);
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Step 1 — mint a magiclink for the LOCKED reviewer email (NEVER the
    // caller-supplied `email`; we use `reviewerEmail` from env). generateLink
    // returns the email_otp WITHOUT sending an email.
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: reviewerEmail,
    });
    const emailOtp = linkData?.properties?.email_otp;
    if (linkError || !emailOtp) {
      console.error(
        "[reviewer-signin] generateLink failed:",
        linkError?.message ?? "no email_otp returned",
      );
      return json({ error: "server" }, 500);
    }

    // Step 2 — exchange the otp for a real session via POST /auth/v1/verify
    // (type: "email"). apikey = anon (this is the public auth gateway). Again
    // the LOCKED reviewer email is used, never the caller-supplied one.
    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
      },
      body: JSON.stringify({
        type: "email",
        email: reviewerEmail,
        token: emailOtp,
      }),
    });
    if (!verifyRes.ok) {
      console.error(
        "[reviewer-signin] /auth/v1/verify failed with status",
        verifyRes.status,
      );
      return json({ error: "server" }, 500);
    }
    const session = (await verifyRes.json()) as {
      access_token?: string;
      refresh_token?: string;
    };
    if (!session.access_token || !session.refresh_token) {
      console.error("[reviewer-signin] verify response missing session tokens");
      return json({ error: "server" }, 500);
    }

    // Success — return ONLY the tokens the client needs to setSession().
    // Tokens are never logged.
    return json(
      {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      },
      200,
    );
  } catch (err) {
    console.error(
      "[reviewer-signin] unexpected error:",
      err instanceof Error ? err.message : "unknown",
    );
    return json({ error: "server" }, 500);
  }
}

// Run the HTTP server only when this module is the program entry point — NOT
// when imported by a test (which would otherwise try to bind a port).
if (import.meta.main) {
  serve(handler);
}
