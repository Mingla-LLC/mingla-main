// ISSUE-1003 [Venue Website Grader] — token-gated full-report read.
//
// PUBLIC edge function (verify_jwt=false), but access requires the report_token
// that growth-tools-gate emailed to the verified address. Entering an email on
// the page does NOT reveal the report; only the tokenized link in the email
// does — so the full feature is shown only to people whose email we own.
//
// POST {run_id, token} → 200 {report}
//   → 400 {error:"validation"} | 403 {error:"forbidden"} | 404 {error:"not_found"}
//   → 500 {error:"server"} · OPTIONS → 200 "ok" + CORS

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Constant-time-ish string compare (avoids trivial early-exit timing leaks).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  } catch {
    return json({ error: "validation" }, 400);
  }
  const runId = body.run_id;
  const token = typeof body.token === "string" ? body.token : "";
  if (!isUuid(runId) || token.length < 16 || token.length > 128) {
    return json({ error: "validation" }, 400);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "server" }, 500);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: lead, error } = await supabase
      .from("tool_leads")
      .select("report, report_token")
      .eq("id", runId as string)
      .maybeSingle();
    if (error) {
      console.error("[growth-tools-report] lookup failed", error.message);
      return json({ error: "server" }, 500);
    }
    if (!lead) return json({ error: "not_found" }, 404);
    const storedToken = typeof (lead as { report_token?: unknown }).report_token === "string"
      ? (lead as { report_token: string }).report_token
      : "";
    const report = (lead as { report: unknown }).report;
    if (storedToken.length < 16 || !safeEqual(storedToken, token)) {
      return json({ error: "forbidden" }, 403);
    }
    if (report === null || typeof report !== "object") {
      return json({ error: "not_found" }, 404);
    }
    return json({ report });
  } catch (err) {
    console.error(
      "[growth-tools-report] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
