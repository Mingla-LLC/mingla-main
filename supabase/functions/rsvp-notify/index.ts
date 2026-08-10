/** Issue #1447 — durable RSVP notification delivery worker.
 *
 * Claims one row per applicable channel with SKIP LOCKED, routes every send
 * through the unified notification dispatcher, and completes each lease
 * independently. Required email/SMS/in-app rows determine parent completion;
 * push remains a best-effort companion. No destination or provider status is
 * exposed to guest clients.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchRsvpChannel } from "../_shared/notifyV2.ts";
import { buildRsvpPassPdf } from "../_shared/ticketPdf.ts";
import { qrTokenPepper } from "../_shared/ticketCheckout.ts";
import { isRsvpNotifyServiceRequest } from "./rsvpNotifyAuth.ts";
import {
  deriveRsvpRecoveryToken,
  rsvpRecoveryUrl,
  sha256Hex,
} from "../_shared/rsvpPass.ts";
import { attendanceClaimUrls } from "../_shared/attendanceClaim.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Channel = "email" | "sms" | "in_app" | "push";
type TemplateKey =
  | "rsvp_acknowledgement"
  | "rsvp_pass"
  | "rsvp_event_updated"
  | "rsvp_waitlist_promoted"
  | "rsvp_approved"
  | "rsvp_denied"
  | "rsvp_removed";
interface Claim {
  delivery_id: string;
  notification_id: string;
  channel: Channel;
  attempt_count: number;
  lease_id: string;
  template_key: TemplateKey;
  payload: Record<string, unknown>;
  idempotency_key: string;
}
// deno-lint-ignore no-explicit-any
type AdminClient = ReturnType<typeof createClient<any, "public", any>>;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

function copyFor(
  template: TemplateKey,
  p: Record<string, unknown>,
  link: string,
) {
  const event = text(p.eventName) ?? "your event";
  const brand = text(p.brandName) ?? "Mingla";
  const state = text(p.status);
  const approval = text(p.approvalStatus);
  switch (template) {
    case "rsvp_pass":
      return {
        title: `You're going to ${event}`,
        body: [event, text(p.dateLine), text(p.venueLine), `Hosted by ${brand}`]
          .filter(Boolean).join("\n\n"),
        sms:
          `${brand}: your RSVP for ${event} is confirmed. Open your secure invite: ${link}`,
      };
    case "rsvp_acknowledgement": {
      const label = state === "waitlisted"
        ? "You're on the waitlist"
        : approval === "pending"
        ? "Your RSVP is pending host approval"
        : state === "maybe"
        ? "We saved your Maybe"
        : state === "not_going"
        ? "Your RSVP is updated"
        : "Your RSVP is confirmed";
      return {
        title: `${label}: ${event}`,
        body: `${label} for ${event}.`,
        sms: `${brand}: ${label.toLowerCase()} for ${event}. ${link}`,
      };
    }
    case "rsvp_event_updated":
      return {
        title: `Plans changed: ${event}`,
        body: "The host updated this event.",
        sms: `${brand}: ${event} was updated. ${link}`,
      };
    case "rsvp_waitlist_promoted":
      return {
        title: `You're in! ${event}`,
        body: "A spot opened — you're going.",
        sms: `${brand}: a spot opened at ${event}. ${link}`,
      };
    case "rsvp_approved":
      return {
        title: `You're approved: ${event}`,
        body: "The host approved your RSVP.",
        sms: `${brand}: you're approved for ${event}. ${link}`,
      };
    case "rsvp_denied":
      return {
        title: `RSVP update: ${event}`,
        body: "The host couldn't fit your RSVP this time.",
        sms: `${brand}: the host couldn't fit your RSVP for ${event}.`,
      };
    case "rsvp_removed":
      return {
        title: `Update: ${event}`,
        body: "The host removed you from this event.",
        sms: `${brand}: the host removed you from ${event}.`,
      };
  }
}

async function passStillEligible(
  admin: AdminClient,
  p: Record<string, unknown>,
): Promise<boolean> {
  const rsvpId = text(p.rsvpId) ?? text(p.rsvp_id);
  if (!rsvpId) return false;
  const { data: rsvp } = await admin.from("event_rsvps")
    .select("event_id,rsvp_status,approval_status")
    .eq("id", rsvpId).maybeSingle();
  if (
    !rsvp || rsvp.rsvp_status !== "going" || rsvp.approval_status !== "approved"
  ) return false;
  const { data: event } = await admin.from("events")
    .select("status,visibility,deleted_at,event_type,brands(deleted_at)")
    .eq("id", rsvp.event_id).maybeSingle();
  const brand = Array.isArray(event?.brands) ? event.brands[0] : event?.brands;
  return !!event && event.deleted_at === null && brand?.deleted_at === null &&
    event.visibility === "public" && event.event_type === "rsvp" &&
    ["scheduled", "live"].includes(event.status);
}

async function recoveryLinkFor(
  admin: AdminClient,
  p: Record<string, unknown>,
): Promise<{ passUrl: string; attendanceClaimUrl: string | null } | null> {
  const entityId = text(p.entityId);
  if (!entityId) return null;
  const table = text(p.role) === "guest" ? "event_rsvp_guests" : "event_rsvps";
  try {
    const { data: row } = await admin.from(table)
      .select(
        "event_id,pass_recovery_token_hash,pass_recovery_token_created_at",
      )
      .eq("id", entityId).maybeSingle();
    const current = row as {
      pass_recovery_token_hash?: string | null;
      pass_recovery_token_created_at?: string | null;
      event_id?: string | null;
    } | null;
    const createdAt = current?.pass_recovery_token_created_at ??
      text(p.recoveryCreatedAt) ?? new Date().toISOString();
    const token = await deriveRsvpRecoveryToken({
      entityId,
      createdAtIso: createdAt,
      pepper: qrTokenPepper(),
    });
    const tokenHash = await sha256Hex(token);
    if (
      current?.pass_recovery_token_created_at !== createdAt ||
      current?.pass_recovery_token_hash !== tokenHash
    ) {
      const { error } = await admin.from(table).update({
        pass_recovery_token_hash: tokenHash,
        pass_recovery_token_created_at: createdAt,
      }).eq("id", entityId);
      if (error) return null;
    }
    const passUrl = rsvpRecoveryUrl(
      table === "event_rsvps" ? "primary" : "guest",
      entityId,
      token,
    );
    if (table === "event_rsvps" && current?.event_id) {
      return {
        passUrl,
        attendanceClaimUrl: attendanceClaimUrls({
          kind: "rsvp",
          eventId: current.event_id,
          sourceId: entityId,
          token,
        }).webClaimUrl,
      };
    }
    return { passUrl, attendanceClaimUrl: null };
  } catch {
    return null;
  }
}

async function complete(
  admin: AdminClient,
  claim: Claim,
  status: "sent" | "failed_retryable" | "failed_terminal" | "ambiguous",
  providerId: string | null,
  safeCode: string | null,
) {
  const { error } = await admin.rpc("finish_rsvp_notification_delivery", {
    p_delivery_id: claim.delivery_id,
    p_lease_id: claim.lease_id,
    p_status: status,
    p_provider_message_id: providerId,
    p_safe_error_code: safeCode,
  });
  if (error) {
    console.error(
      "[rsvp-notify] finish failed",
      claim.delivery_id,
      error.message,
    );
  }
  console.info(JSON.stringify({
    event: "rsvp_notification_channel_result",
    notificationId: claim.notification_id,
    channel: claim.channel,
    outcome: status,
    attempt: claim.attempt_count,
    providerCode: safeCode,
  }));
}

async function classifyFailure(
  admin: AdminClient,
  claim: Claim,
  safeCode: string,
): Promise<void> {
  const { error } = await admin.rpc("classify_rsvp_notification_failure", {
    p_delivery_id: claim.delivery_id,
    p_lease_id: claim.lease_id,
    p_safe_error_code: safeCode,
  });
  if (error) {
    console.error(
      "[rsvp-notify] classify failed",
      claim.delivery_id,
      error.message,
    );
  }
}

async function processClaim(admin: AdminClient, claim: Claim): Promise<void> {
  const p = claim.payload ?? {};
  if (
    claim.template_key === "rsvp_pass" && !(await passStillEligible(admin, p))
  ) {
    await complete(admin, claim, "failed_terminal", null, "rsvp_not_eligible");
    return;
  }
  const userId = text(p.matchedUserId) ?? text(p.primaryUserId);
  const contact = claim.channel === "email"
    ? text(p.recipientEmail)
    : claim.channel === "sms"
    ? text(p.recipientPhone)
    : null;
  const defaultLink = text(p.deepLink) ?? "https://usemingla.com";
  const needsRecoveryLink = claim.template_key === "rsvp_pass" &&
    (claim.channel === "email" || claim.channel === "sms");
  const recoveryLink = needsRecoveryLink
    ? await recoveryLinkFor(admin, p)
    : null;
  if (
    claim.template_key === "rsvp_pass" && needsRecoveryLink &&
    !recoveryLink
  ) {
    await complete(
      admin,
      claim,
      "failed_retryable",
      null,
      "rsvp_recovery_unavailable",
    );
    return;
  }
  const authenticatedPassLink = claim.template_key === "rsvp_pass" && userId
    ? `mingla://calendar/${
      encodeURIComponent(text(p.rsvpId) ?? text(p.rsvp_id) ?? "")
    }`
    : defaultLink;
  const link = recoveryLink?.passUrl ?? authenticatedPassLink;
  const copy = copyFor(claim.template_key, p, link);
  if (claim.template_key === "rsvp_pass" && recoveryLink?.attendanceClaimUrl) {
    copy.body =
      `${copy.body}\n\nConnect this RSVP to your Mingla account to see who’s going: ${recoveryLink.attendanceClaimUrl}`;
    copy.sms =
      `${copy.sms} Connect attendance: ${recoveryLink.attendanceClaimUrl}`;
  }
  let attachment: { filename: string; content: string } | null = null;
  if (claim.template_key === "rsvp_pass" && claim.channel === "email") {
    const qrCode = text(p.qrCode);
    if (!qrCode) {
      await complete(admin, claim, "failed_retryable", null, "rsvp_qr_missing");
      return;
    }
    try {
      const pdf = await buildRsvpPassPdf({
        eventTitle: text(p.eventName) ?? "your event",
        dateLine: text(p.dateLine),
        venueLine: text(p.venueLine),
        brandName: text(p.brandName) ?? "Mingla",
        attendeeName: text(p.recipientName),
        qrPayload: qrCode,
      });
      attachment = { filename: pdf.filename, content: pdf.contentBase64 };
    } catch {
      await complete(admin, claim, "failed_retryable", null, "rsvp_pdf_failed");
      return;
    }
  }
  try {
    const result = await dispatchRsvpChannel(
      admin as unknown as Parameters<typeof dispatchRsvpChannel>[0],
      {
        channel: claim.channel,
        user_id: userId,
        contact,
        category_key: claim.template_key === "rsvp_pass"
          ? "rsvp_pass"
          : "rsvp_acknowledgement",
        payload: p,
        idempotency_key: claim.idempotency_key,
        title: copy.title,
        body: copy.body,
        sms_body: copy.sms,
        deep_link: link,
        attachment,
        delivery_id: claim.delivery_id,
        lease_id: claim.lease_id,
      },
    );
    await complete(
      admin,
      claim,
      result.outcome === "sent"
        ? "sent"
        : result.outcome === "ambiguous"
        ? "ambiguous"
        : result.outcome === "terminal"
        ? "failed_terminal"
        : "failed_retryable",
      result.providerMessageId,
      result.safeCode,
    );
  } catch {
    await classifyFailure(admin, claim, "dispatch_unavailable");
  }
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "server_misconfigured" });
  }
  const authorization = req.headers.get("Authorization");
  if (!isRsvpNotifyServiceRequest(authorization, serviceKey)) {
    return json(401, { error: "unauthorized" });
  }
  let notificationId: string | null = null;
  try {
    const body = await req.json() as { notificationId?: unknown };
    notificationId = text(body.notificationId);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc(
    "claim_rsvp_notification_deliveries",
    {
      p_notification_id: notificationId,
      p_limit: notificationId ? 8 : 50,
    },
  );
  if (error) return json(500, { error: "delivery_claim_failed" });
  const claims = (data ?? []) as Claim[];
  await Promise.all(claims.map((claim) => processClaim(admin, claim)));
  return json(200, { ok: true, claimed: claims.length });
});
