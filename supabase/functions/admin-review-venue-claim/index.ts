/**
 * Ve3 — orchestrate admin venue claim review (RPC + email + push + audit).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildClaimApprovedEmail,
  defaultVenuePublicUrl,
} from "../_shared/email/claimApprovedEmail.ts";
import { buildClaimRejectedEmail } from "../_shared/email/claimRejectedEmail.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
} from "../_shared/email/index.ts";
import { sendPush } from "../_shared/push-utils.ts";
import {
  auditActionForReview,
  normalizeReviewBody,
  pushCopyForReview,
} from "./reviewLogic.ts";

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

    const parsed = normalizeReviewBody(await req.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, 400);

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

    const { data: rpcResult, error: rpcErr } = await userClient.rpc(
      "biz_review_venue_claim",
      {
        p_brand_id: parsed.brandId,
        p_action: parsed.action,
        p_rejection_reason: parsed.action === "reject"
          ? parsed.rejectionReason
          : null,
      },
    );
    if (rpcErr) return json({ error: rpcErr.message }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: brandRow, error: brandErr } = await admin
      .from("brands")
      .select(
        "id, name, slug, account_id, claim_status, contact_email, rejection_reason, claim_decision_emailed_at",
      )
      .eq("id", parsed.brandId)
      .maybeSingle();

    if (brandErr) return json({ error: brandErr.message }, 500);
    if (!brandRow) return json({ error: "Brand not found" }, 404);

    const noop = rpcResult?.noop === true;
    const brandName = brandRow.name as string;

    await admin.from("admin_audit_log").insert({
      admin_email: user.email ?? "unknown",
      action: auditActionForReview(parsed.action),
      target_type: "venue_claim",
      target_id: parsed.brandId,
      metadata: {
        noop,
        rpc_result: rpcResult ?? null,
      },
    });

    let emailSent = false;
    let pushSent = false;

    const shouldNotify = (parsed.action === "approve" ||
      parsed.action === "reject") &&
      !noop &&
      brandRow.claim_decision_emailed_at == null;

    if (shouldNotify) {
      const { data: ownerAuth, error: ownerErr } = await admin.auth.admin
        .getUserById(brandRow.account_id as string);
      if (ownerErr) {
        console.warn("[admin-review-venue-claim] owner lookup", ownerErr.message);
      }

      const to =
        (typeof ownerAuth?.user?.email === "string" &&
            ownerAuth.user.email.length > 0
          ? ownerAuth.user.email
          : null) ??
        (typeof brandRow.contact_email === "string" &&
            brandRow.contact_email.length > 0
          ? brandRow.contact_email
          : null);

      if (to && RESEND_API_KEY) {
        const slug = typeof brandRow.slug === "string" ? brandRow.slug : "";
        const bodyInput = parsed.action === "approve"
          ? buildClaimApprovedEmail({
            brandName,
            publicVenueUrl: defaultVenuePublicUrl(slug),
          })
          : buildClaimRejectedEmail({
            brandName,
            rejectionReason: (brandRow.rejection_reason as string) ??
              parsed.rejectionReason,
          });

        const sender = EMAIL_SENDERS.system;
        try {
          assertNotResendSandbox(sender);
        } catch (e) {
          return json(
            { error: e instanceof Error ? e.message : String(e) },
            500,
          );
        }

        const rendered = renderTransactionalEmail({
          variant: "generic_notification",
          recipient: { name: null, email: to },
          body: bodyInput,
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

        emailSent = true;
        await admin
          .from("brands")
          .update({ claim_decision_emailed_at: new Date().toISOString() })
          .eq("id", parsed.brandId);
      }
    }

    const pushCopy = pushCopyForReview(parsed.action, brandName);
    if (pushCopy && !noop && typeof brandRow.account_id === "string") {
      pushSent = await sendPush({
        targetUserId: brandRow.account_id,
        title: pushCopy.title,
        body: pushCopy.body,
        data: {
          type: "venue_claim_review",
          brand_id: parsed.brandId,
          action: parsed.action,
        },
        androidChannelId: "system",
      });
    }

    return json({
      ok: true,
      result: rpcResult,
      email_sent: emailSent,
      push_sent: pushSent,
    });
  } catch (e) {
    console.error("[admin-review-venue-claim]", e);
    return json(
      { error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
