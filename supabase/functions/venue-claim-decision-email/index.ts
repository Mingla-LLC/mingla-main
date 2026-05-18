/**
 * Ve1 — notify venue operator when an admin approves or rejects a claim.
 * Invoked from mingla-admin ClaimsPage after `biz_review_venue_claim`.
 *
 * Auth: caller must pass `is_admin_user()` (admin JWT).
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
      decision?: string;
      rejection_reason?: string;
    } | null;

    const brandId =
      typeof body?.brand_id === "string" ? body.brand_id.trim() : "";
    const decision =
      typeof body?.decision === "string" ? body.decision.trim() : "";
    const rejectionReason =
      typeof body?.rejection_reason === "string"
        ? body.rejection_reason.trim()
        : "";

    if (brandId.length === 0) {
      return json({ error: "brand_id required" }, 400);
    }
    if (decision !== "approved" && decision !== "rejected") {
      return json({ error: "decision must be approved or rejected" }, 400);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin, error: adminErr } = await userClient.rpc(
      "is_admin_user",
    );
    if (adminErr) return json({ error: adminErr.message }, 500);
    if (isAdmin !== true) return json({ error: "Forbidden" }, 403);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: brandRow, error: brandErr } = await admin
      .from("brands")
      .select("id, name, account_id, claim_status, contact_email")
      .eq("id", brandId)
      .maybeSingle();

    if (brandErr) return json({ error: brandErr.message }, 500);
    if (!brandRow) return json({ error: "Brand not found" }, 404);

    const expectedStatus = decision === "approved" ? "verified" : "rejected";
    if (brandRow.claim_status !== expectedStatus) {
      return json({ error: "Brand claim status mismatch" }, 400);
    }

    const { data: ownerAuth, error: ownerErr } = await admin.auth.admin
      .getUserById(brandRow.account_id as string);
    if (ownerErr) {
      return json({ error: ownerErr.message }, 500);
    }

    const to =
      (typeof ownerAuth.user?.email === "string" &&
          ownerAuth.user.email.length > 0
        ? ownerAuth.user.email
        : null) ??
      (typeof brandRow.contact_email === "string" &&
          brandRow.contact_email.length > 0
        ? brandRow.contact_email
        : null);

    if (!to) {
      return json({ skipped: true, reason: "no_recipient_email" }, 200);
    }

    if (!RESEND_API_KEY) {
      console.warn("[venue-claim-decision-email] RESEND_API_KEY missing");
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

    const brandName = brandRow.name as string;
    const approved = decision === "approved";
    const title = approved
      ? "Your venue is live on Mingla"
      : "Update on your venue submission";
    const paragraphs = approved
      ? [
        `Good news — ${brandName} has been approved.`,
        "Your venue profile is now visible to guests. Sign in to Mingla Business to manage events and your profile.",
      ]
      : [
        `We couldn't approve ${brandName} at this time.`,
        rejectionReason.length > 0
          ? `Reason: ${rejectionReason}`
          : "Our team will follow up if we need more information.",
        "You can submit a new claim with updated details when you're ready.",
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
    console.error("[venue-claim-decision-email]", e);
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
