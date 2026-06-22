// META-ORCH-1222 [Careers site] — admin CV signed-URL endpoint.
//
// Returns a 60-second signed URL to an applicant's CV in the PRIVATE
// `career-cvs` bucket. ADMIN-gated: only an active admin (admin_users) may
// fetch it. The bucket has NO client storage policy, so this service-role
// edge fn is the ONLY way the private CV is reachable; anon and non-admin
// authed callers get 403 (SC-11 / T20).
//
// verify_jwt = true (config.toml): the platform rejects callers without a JWT
// before this code runs; we additionally re-verify the JWT belongs to a real
// user AND that the user is an active admin (mirrors admin-place-search).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "career-cvs";
const SIGNED_URL_TTL_SECONDS = 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // ── Verify the caller JWT belongs to a real user. ──────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return json({ error: "unauthorized" }, 401);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return json({ error: "unauthorized" }, 401);
  }

  // ── ADMIN CHECK — only active admins may fetch a CV. ───────────────────────
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) {
    return json({ error: "forbidden" }, 403);
  }

  // ── Resolve cv_path: prefer the application_id lookup (so the admin never
  //    hand-passes a raw storage path), fall back to a vetted explicit path. ──
  const body = await req.json().catch(() => ({})) as {
    application_id?: string;
    cv_path?: string;
  };

  let cvPath = typeof body.cv_path === "string" ? body.cv_path : "";
  if (body.application_id) {
    const { data: appRow, error: appErr } = await supabase
      .from("job_applications")
      .select("cv_path")
      .eq("id", body.application_id)
      .maybeSingle();
    if (appErr) {
      console.error("[careers-cv-signed-url] application lookup failed", appErr.message);
      return json({ error: "server" }, 500);
    }
    if (!appRow?.cv_path) {
      return json({ error: "not_found" }, 404);
    }
    cvPath = appRow.cv_path;
  }

  if (!cvPath || cvPath.length < 1) {
    return json({ error: "bad_request", field: "application_id" }, 400);
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(cvPath, SIGNED_URL_TTL_SECONDS);
  if (signError || !signedData?.signedUrl) {
    console.error(
      "[careers-cv-signed-url] sign failed",
      signError?.message ?? "no_url",
    );
    return json({ error: "server", detail: signError?.message ?? "sign_failed" }, 500);
  }

  return json({
    url: signedData.signedUrl,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  });
});
