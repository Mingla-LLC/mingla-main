import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
  type SenderIdentity,
} from "../_shared/email/index.ts";
import { signUnsubscribeToken } from "../_shared/marketingTokens.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

/** Sentinel IDs for admin bulk blasts (no marketing campaign row). */
const ADMIN_BLAST_CAMPAIGN_ID = "00000000-0000-4000-8000-372000000001";
const ADMIN_BLAST_BRAND_ID = "00000000-0000-4000-8000-372000000002";

const BRANDED_UNSUBSCRIBE_LINK_ORIGIN = "https://usemingla.com/unsubscribe";

/** Segments the edge actually filters. Anything else must 400 (fail closed). */
const SUPPORTED_SEGMENT_TYPES = new Set([
  "all",
  "country",
  "onboarding",
  "status",
]);

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

function getUnsubscribeOrigin(): string {
  const override = Deno.env.get("MINGLA_UNSUBSCRIBE_LINK_ORIGIN");
  if (override !== undefined && override.trim().length > 0) {
    return override.replace(/\/+$/, "");
  }
  return BRANDED_UNSUBSCRIBE_LINK_ORIGIN;
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

function assertSupportedSegment(
  segment: { type?: string } | null | undefined,
): string | null {
  const type = segment?.type ?? "all";
  if (!SUPPORTED_SEGMENT_TYPES.has(type)) {
    return `unsupported_segment:${type}`;
  }
  return null;
}

// deno-lint-ignore no-explicit-any
function applySegmentFilter(query: any, segment: Record<string, unknown> | null) {
  const type = (segment?.type as string | undefined) ?? "all";
  if (type === "country" && typeof segment?.country === "string") {
    return query.eq("country", segment.country);
  }
  if (type === "onboarding" && typeof segment?.onboarding === "string") {
    return query.eq(
      "has_completed_onboarding",
      segment.onboarding === "completed",
    );
  }
  if (type === "status" && typeof segment?.status === "string") {
    if (segment.status === "banned") return query.eq("is_banned", true);
    if (segment.status === "active") return query.eq("is_banned", false);
  }
  return query;
}

/** Lowercased emails suppressed for marketing/all email channel. */
// deno-lint-ignore no-explicit-any
async function loadSuppressedEmails(
  supabase: any,
): Promise<Set<string>> {
  const suppressed = new Set<string>();

  const { data: chanRows, error: chanErr } = await supabase
    .from("channel_suppressions")
    .select("contact")
    .eq("channel", "email")
    .in("scope", ["marketing", "all"])
    .not("contact", "is", null);
  if (chanErr) {
    throw new Error(`optout_channel_suppressions_failed:${chanErr.message}`);
  }
  for (const row of chanRows ?? []) {
    const c = typeof row.contact === "string" ? row.contact.toLowerCase().trim() : "";
    if (c) suppressed.add(c);
  }

  const { data: legacyRows, error: legacyErr } = await supabase
    .from("marketing_unsubscribes")
    .select("contact_email")
    .not("contact_email", "is", null);
  if (legacyErr) {
    // Table may be absent on some envs — fail closed only when present-and-erroring.
    if (!/does not exist|relation/i.test(legacyErr.message)) {
      throw new Error(`optout_marketing_unsubscribes_failed:${legacyErr.message}`);
    }
  } else {
    for (const row of legacyRows ?? []) {
      const c = typeof row.contact_email === "string"
        ? row.contact_email.toLowerCase().trim()
        : "";
      if (c) suppressed.add(c);
    }
  }

  return suppressed;
}

async function buildUnsubscribeHeaders(
  recipientEmail: string,
): Promise<Record<string, string> | null> {
  try {
    const token = await signUnsubscribeToken({
      campaign_id: ADMIN_BLAST_CAMPAIGN_ID,
      recipient_email: recipientEmail.toLowerCase().trim(),
      brand_id: ADMIN_BLAST_BRAND_ID,
    });
    const url = `${getUnsubscribeOrigin()}/${token}?scope=global`;
    return {
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  } catch (err) {
    // Missing UNSUBSCRIBE_TOKEN_SECRET must not silently send without headers.
    console.error(
      "[admin-send-email] unsubscribe token failed",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

interface SendOptions {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
  fromEmail?: string;
  useBrandShell?: boolean;
  cta?: { label: string; url: string };
  /** When true (bulk), attach List-Unsubscribe headers. */
  marketingHeaders?: boolean;
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

  let headers: Record<string, string> | undefined;
  if (opts.marketingHeaders) {
    const built = await buildUnsubscribeHeaders(opts.to);
    if (!built) {
      return {
        ok: false,
        error: "unsubscribe_headers_unavailable",
      };
    }
    headers = built;
  }

  let resendBody: Record<string, unknown>;
  if (opts.useBrandShell === false) {
    resendBody = {
      from: formatSenderHeader(sender),
      to: [opts.to],
      subject: opts.subject,
      text: opts.body,
      ...(headers ? { headers } : {}),
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
      ...(headers ? { headers } : {}),
    };
  }

  try {
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
      const unsupported = assertSupportedSegment(segment);
      if (unsupported) {
        return jsonResponse({ error: unsupported }, 400);
      }

      // Same 500 cap as send_bulk so estimate.will_receive matches what send
      // will actually attempt (minus live opt-outs among that window).
      let query = supabase.from("profiles").select("id, email", { count: "exact" })
        .not("email", "is", null);
      query = applySegmentFilter(query, segment ?? { type: "all" });

      const { data: rows, count, error } = await query.limit(500);
      if (error) return jsonResponse({ error: error.message }, 400);

      const windowRows = rows ?? [];
      const totalMatched = count ?? windowRows.length;
      let optedOut = 0;
      try {
        const suppressed = await loadSuppressedEmails(supabase);
        for (const r of windowRows) {
          const email = typeof r.email === "string"
            ? r.email.toLowerCase().trim()
            : "";
          if (email && suppressed.has(email)) optedOut += 1;
        }
      } catch (err) {
        return jsonResponse({
          error: err instanceof Error ? err.message : String(err),
        }, 500);
      }

      const windowSize = windowRows.length;
      return jsonResponse({
        total: totalMatched,
        opted_out: optedOut,
        will_receive: Math.max(windowSize - optedOut, 0),
      });
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

      // Individual admin compose is operational (may reach opted-out contacts);
      // still attach List-Unsubscribe so recipients can leave marketing lists.
      const result = await sendViaResend({
        to,
        subject,
        body: emailBody,
        fromName: fromName || EMAIL_SENDERS.admin.name,
        fromEmail: fromEmail || EMAIL_SENDERS.admin.address,
        useBrandShell: useBrandShell !== false,
        cta: cta && cta.label && cta.url ? { label: cta.label, url: cta.url } : undefined,
        marketingHeaders: true,
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
      const unsupported = assertSupportedSegment(segment);
      if (unsupported) {
        return jsonResponse({ error: unsupported }, 400);
      }

      let query = supabase.from("profiles").select("id, email, first_name")
        .not("email", "is", null);
      query = applySegmentFilter(query, segment ?? { type: "all" });

      const { data: recipients, error } = await query.limit(500);
      if (error) return jsonResponse({ error: error.message }, 400);

      let suppressed: Set<string>;
      try {
        suppressed = await loadSuppressedEmails(supabase);
      } catch (err) {
        return jsonResponse({
          error: err instanceof Error ? err.message : String(err),
        }, 500);
      }

      let sent = 0;
      let failed = 0;
      let skippedOptOut = 0;
      const errors: string[] = [];
      const eligible = (recipients || []).filter((r) => {
        const email = typeof r.email === "string" ? r.email.toLowerCase().trim() : "";
        if (!email) return false;
        if (suppressed.has(email)) {
          skippedOptOut += 1;
          return false;
        }
        return true;
      });

      for (const r of eligible) {
        if (!r.email) {
          failed++;
          continue;
        }
        const personalizedBody = emailBody.replace(/\{name\}/g, r.first_name || "there");
        const result = await sendViaResend({
          to: r.email,
          subject,
          body: personalizedBody,
          fromName: fromName || EMAIL_SENDERS.admin.name,
          fromEmail: fromEmail || EMAIL_SENDERS.admin.address,
          useBrandShell: useBrandShell !== false,
          cta: cta && cta.label && cta.url
            ? { label: cta.label, url: cta.url }
            : undefined,
          marketingHeaders: true,
        });
        if (result.ok) sent++;
        else {
          failed++;
          if (errors.length < 10) errors.push(`${r.email}: ${result.error}`);
        }
      }

      // Single writer — edge only (#3720 bug 6). Client must not insert.
      await supabase.from("admin_email_log").insert({
        subject,
        body: emailBody,
        from_name: fromName || EMAIL_SENDERS.admin.name,
        from_email: fromEmail || EMAIL_SENDERS.admin.address,
        recipient_type: "bulk",
        segment_filter: segment || null,
        recipient_count: eligible.length,
        sent_count: sent,
        failed_count: failed,
        status: failed === 0 ? "sent" : sent === 0 ? "failed" : "partial",
        sent_by: user.id,
      });

      return jsonResponse({
        sent,
        failed,
        skipped_opt_out: skippedOptOut,
        errors,
      });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return jsonResponse({
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
