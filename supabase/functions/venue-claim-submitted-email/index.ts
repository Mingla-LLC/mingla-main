/**
 * Ve1 — transactional email when a venue brand is submitted (pending_review).
 * Invoked from mingla-business `createVenueBrandPendingReview` after RPC success.
 *
 * Auth: caller JWT must own the brand (account_id = auth.uid()).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
} from "../_shared/email/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const body = await req.json().catch(() => null) as {
      brand_id?: string;
    } | null;
    const brandId =
      typeof body?.brand_id === "string" ? body.brand_id.trim() : "";
    if (brandId.length === 0) {
      return json({ error: "brand_id required" }, 400);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: brandRow, error: brandErr } = await admin
      .from("brands")
      .select("id, name, account_id, claim_status, contact_email")
      .eq("id", brandId)
      .maybeSingle();

    if (brandErr) return json({ error: brandErr.message }, 500);
    if (!brandRow) return json({ error: "Brand not found" }, 404);
    if (brandRow.account_id !== user.id) {
      return json({ error: "Forbidden" }, 403);
    }
    if (brandRow.claim_status !== "pending_review") {
      return json({ error: "Not a pending venue submission" }, 400);
    }

    const to =
      (typeof user.email === "string" && user.email.length > 0
        ? user.email
        : null) ??
      (typeof brandRow.contact_email === "string" &&
          brandRow.contact_email.length > 0
        ? brandRow.contact_email
        : null);
    if (!to) {
      return json({ skipped: true, reason: "no_recipient_email" }, 200);
    }

    if (!RESEND_API_KEY) {
      console.warn("[venue-claim-submitted-email] RESEND_API_KEY missing");
      return json({ skipped: true, reason: "resend_not_configured" }, 200);
    }

    let sender = EMAIL_SENDERS.system;
    const legacyOverride = Deno.env.get("RESEND_FROM_EMAIL");
    if (legacyOverride && legacyOverride.trim().length > 0) {
      const m = legacyOverride.trim().match(
        /^(?:(.+?)\s*<)?([^<>\s]+@[^<>\s]+)>?$/,
      );
      if (m) {
        sender = { name: (m[1] ?? "Mingla").trim(), address: m[2] };
      }
    }
    try {
      assertNotResendSandbox(sender);
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : String(e) },
        500,
      );
    }

    const title = "Venue submitted — we’re reviewing it";
    const paragraphs = [
      `Thanks for submitting ${brandRow.name as string}.`,
      "Your venue is under review. We typically respond within 4 business hours.",
      "We’ll email you when it’s approved or if we need more information.",
    ];

    const rendered = renderTransactionalEmail({
      variant: "generic_notification",
      recipient: { name: null, email: to },
      body: {
        variant: "generic_notification",
        title,
        paragraphs,
        cta: null,
      },
    });

    // no-attachment: Ve1 venue submission confirmation is plain transactional HTML only.
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: formatSenderHeader(rendered.from),
        to: [to],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return json({ error: `Resend ${res.status}: ${t}` }, 502);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.error("[venue-claim-submitted-email]", e);
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
