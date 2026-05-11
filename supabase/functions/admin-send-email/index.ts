import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
  type SenderIdentity,
} from "../_shared/email/index.ts";

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

function resolveSenderFromInput(
  fromName: string | undefined,
  fromEmail: string | undefined,
): SenderIdentity {
  if (fromEmail && fromEmail.includes("@")) {
    return {
      name: (fromName ?? "Mingla").trim() || "Mingla",
      address: fromEmail.trim(),
    };
  }
  return EMAIL_SENDERS.admin;
}

interface SendOptions {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
  fromEmail?: string;
  useBrandShell?: boolean;
  cta?: { label: string; url: string };
}

async function sendViaResend(opts: SendOptions): Promise<{
  ok: boolean;
  error?: string;
}> {
  const sender = resolveSenderFromInput(opts.fromName, opts.fromEmail);
  try {
    assertNotResendSandbox(sender);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let resendBody: Record<string, unknown>;
  if (opts.useBrandShell === false) {
    resendBody = {
      from: formatSenderHeader(sender),
      to: [opts.to],
      subject: opts.subject,
      text: opts.body,
      // no-attachment: admin compose plain-text mode.
    };
  } else {
    let rendered;
    try {
      rendered = renderTransactionalEmail({
        variant: "admin_compose",
        recipient: { name: null, email: opts.to },
        body: {
          variant: "admin_compose",
          title: opts.subject,
          paragraphs: opts.body.split("\n\n"),
          cta: opts.cta ?? null,
        },
        sender,
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    resendBody = {
      from: formatSenderHeader(rendered.from),
      to: [opts.to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      // no-attachment: admin compose has no PDF.
    };
  }

  try {
    // no-attachment: admin compose (both brand-shell and plain-text modes)
    // ships subject + body only; PDFs are exclusive to ticket confirmation.
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendBody),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${errBody}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "No authorization header" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

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
      return jsonResponse({
        provider: "resend",
        configured: !!RESEND_API_KEY,
        from_domain: body.fromEmail || EMAIL_SENDERS.admin.address,
      });
    }

    if (action === "estimate") {
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
      const {
        to,
        subject,
        body: emailBody,
        fromName,
        fromEmail,
        useBrandShell,
        cta,
      } = body;
      if (!to || !subject || !emailBody) {
        return jsonResponse({ error: "to, subject, body are required" }, 400);
      }

      const result = await sendViaResend({
        to,
        subject,
        body: emailBody,
        fromName: fromName || EMAIL_SENDERS.admin.name,
        fromEmail: fromEmail || EMAIL_SENDERS.admin.address,
        useBrandShell: useBrandShell !== false,
        cta: cta && cta.label && cta.url ? { label: cta.label, url: cta.url } : undefined,
      });

      await supabase.from("admin_email_log").insert({
        subject,
        body: emailBody,
        from_name: fromName || EMAIL_SENDERS.admin.name,
        from_email: fromEmail || EMAIL_SENDERS.admin.address,
        recipient_type: "individual",
        recipient_email: to,
        recipient_count: 1,
        sent_count: result.ok ? 1 : 0,
        failed_count: result.ok ? 0 : 1,
        status: result.ok ? "sent" : "failed",
        sent_by: user.id,
      });

      return jsonResponse({
        sent: result.ok ? 1 : 0,
        failed: result.ok ? 0 : 1,
        errors: result.error ? [result.error] : [],
      });
    }

    if (action === "send_bulk") {
      const {
        segment,
        subject,
        body: emailBody,
        fromName,
        fromEmail,
        useBrandShell,
        cta,
      } = body;
      if (!subject || !emailBody) {
        return jsonResponse({ error: "subject, body are required" }, 400);
      }

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
        const personalizedBody = emailBody.replace(/\{name\}/g, r.first_name || "there");
        const result = await sendViaResend({
          to: r.email,
          subject,
          body: personalizedBody,
          fromName: fromName || EMAIL_SENDERS.admin.name,
          fromEmail: fromEmail || EMAIL_SENDERS.admin.address,
          useBrandShell: useBrandShell !== false,
          cta: cta && cta.label && cta.url ? { label: cta.label, url: cta.url } : undefined,
        });
        if (result.ok) sent++;
        else {
          failed++;
          if (errors.length < 10) errors.push(`${r.email}: ${result.error}`);
        }
      }

      await supabase.from("admin_email_log").insert({
        subject,
        body: emailBody,
        from_name: fromName || EMAIL_SENDERS.admin.name,
        from_email: fromEmail || EMAIL_SENDERS.admin.address,
        recipient_type: "bulk",
        segment_filter: segment || null,
        recipient_count: (recipients || []).length,
        sent_count: sent,
        failed_count: failed,
        status: failed === 0 ? "sent" : sent === 0 ? "failed" : "partial",
        sent_by: user.id,
      });

      return jsonResponse({ sent, failed, errors });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
