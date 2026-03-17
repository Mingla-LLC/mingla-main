import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendViaResend(
  to: string,
  subject: string,
  body: string,
  fromName: string,
  fromEmail: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [to],
        subject,
        text: body,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${errBody}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "No authorization header" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    // Admin check
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", user.email)
      .eq("status", "active")
      .maybeSingle();
    if (!adminRow) return jsonResponse({ error: "Forbidden: admin access required" }, 403);

    const body = await req.json();
    const { action } = body;

    if (action === "check_provider") {
      // EmailPage calls this on mount to verify Resend is configured
      return jsonResponse({
        provider: "resend",
        configured: !!RESEND_API_KEY,
        from_domain: body.fromEmail || "noreply@usemingla.com",
      });
    }

    if (action === "estimate") {
      // Estimate recipient count for a segment
      const { segment } = body;
      let query = supabase.from("profiles").select("id", { count: "exact", head: true });

      if (segment?.type === "country") {
        query = query.eq("country", segment.country);
      } else if (segment?.type === "onboarding") {
        query = query.eq("has_completed_onboarding", segment.onboarding === "completed");
      } else if (segment?.type === "status") {
        if (segment.status === "banned") query = query.eq("is_banned", true);
        else if (segment.status === "active") query = query.eq("is_banned", false);
      }

      const { count, error } = await query;
      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ will_receive: count || 0 });
    }

    if (action === "send") {
      // Individual email
      const { to, subject, body: emailBody, fromName, fromEmail } = body;
      if (!to || !subject || !emailBody) {
        return jsonResponse({ error: "to, subject, body are required" }, 400);
      }

      const result = await sendViaResend(
        to,
        subject,
        emailBody,
        fromName || "Mingla",
        fromEmail || "noreply@usemingla.com"
      );

      return jsonResponse({
        sent: result.ok ? 1 : 0,
        failed: result.ok ? 0 : 1,
        errors: result.error ? [result.error] : [],
      });
    }

    if (action === "send_bulk") {
      // Bulk email to segment
      const { segment, subject, body: emailBody, fromName, fromEmail } = body;
      if (!subject || !emailBody) {
        return jsonResponse({ error: "subject, body are required" }, 400);
      }

      // Fetch recipients
      let query = supabase.from("profiles").select("id, email, first_name").not("email", "is", null);

      if (segment?.type === "country") {
        query = query.eq("country", segment.country);
      } else if (segment?.type === "onboarding") {
        query = query.eq("has_completed_onboarding", segment.onboarding === "completed");
      } else if (segment?.type === "status") {
        if (segment.status === "banned") query = query.eq("is_banned", true);
        else if (segment.status === "active") query = query.eq("is_banned", false);
      }

      const { data: recipients, error } = await query.limit(500);
      if (error) return jsonResponse({ error: error.message }, 400);

      let sent = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const r of recipients || []) {
        if (!r.email) { failed++; continue; }
        const personalizedBody = emailBody.replace(/{name}/g, r.first_name || "there");
        const result = await sendViaResend(
          r.email,
          subject,
          personalizedBody,
          fromName || "Mingla",
          fromEmail || "noreply@usemingla.com"
        );
        if (result.ok) sent++;
        else {
          failed++;
          if (errors.length < 10) errors.push(`${r.email}: ${result.error}`);
        }
      }

      return jsonResponse({ sent, failed, errors });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
