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
import { rsvpPassEventEligible } from "./passEligibility.ts";
import {
  deriveRsvpRecoveryToken,
  rsvpRecoveryUrl,
  sha256Hex,
} from "../_shared/rsvpPass.ts";
import { attendanceClaimUrls } from "../_shared/attendanceClaim.ts";
import { resolveBuyerLink } from "../_shared/messageLinks.ts";
import { formatMessageTime } from "../_shared/messageTime.ts";
import { buildRsvpPassMessage } from "../_shared/rsvpPassMessage.ts";
import { renderTransactionalEmail } from "../_shared/email/index.ts";
import { eventUpdateReplyTo } from "../_shared/email/eventUpdatedEmail.ts";
import { buildCalendarLinks } from "../_shared/email/calendar.ts";
// Issue #3827 — buyers and guests are told when a live listing changes.
import {
  buildEventUpdateDispatch,
  checkNoticeSend,
  createNoticeLoader,
  type EventUpdateDispatch,
  fanOutEventEditNotices,
  inGroupsOf,
  type NoticeAdminClient,
  type NoticeLoader,
} from "./eventUpdate.ts";

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
  // Issue #3827 — a ticket or experience buyer told about a live edit.
  | "buyer_event_updated"
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
    // Issue #3827 — only reached without a notice, which the worker refuses
    // before sending; the case keeps the switch exhaustive.
    case "buyer_event_updated":
      return {
        title: `Details changed: ${event}`,
        body: "The host changed the details of this event.",
        sms: `${brand}: ${event} has changed. ${link}`,
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

/** #871 + #4063 — may this pass also carry the "connect attendance" link?
 *
 * Visibility controls discovery, not ownership. The pass helper still decides
 * which RSVP messages may be sent; once one is eligible, the primary guest may
 * receive the contact-gated claim link regardless of public/unlisted status.
 */
function attendanceClaimStillEligible(
  event:
    | {
      status: string;
      visibility: string;
      deleted_at: string | null;
      event_type: string;
    }
    | null
    | undefined,
  brand: { deleted_at: string | null } | null | undefined,
): boolean {
  return !!event && event.deleted_at === null && brand?.deleted_at === null &&
    event.event_type === "rsvp" && ["scheduled", "live"].includes(event.status);
}

/** null = the pass must not be sent. Otherwise the pass goes out, and
 * `attendanceClaim` says whether it may carry the #871 attendance link. */
async function passStillEligible(
  admin: AdminClient,
  p: Record<string, unknown>,
): Promise<
  {
    attendanceClaim: boolean;
    brandContactEmail: string | null;
  } | null
> {
  const rsvpId = text(p.rsvpId) ?? text(p.rsvp_id);
  if (!rsvpId) return null;
  const { data: rsvp } = await admin.from("event_rsvps")
    .select("event_id,rsvp_status,approval_status")
    .eq("id", rsvpId).maybeSingle();
  if (
    !rsvp || rsvp.rsvp_status !== "going" || rsvp.approval_status !== "approved"
  ) return null;
  const { data: event } = await admin.from("events")
    .select(
      "status,visibility,deleted_at,event_type,brands(deleted_at,contact_email)",
    )
    .eq("id", rsvp.event_id).maybeSingle();
  const brand = Array.isArray(event?.brands) ? event.brands[0] : event?.brands;
  // Unlisted RSVP invite link — public AND unlisted RSVPs; see passEligibility.ts.
  if (!rsvpPassEventEligible(event, brand?.deleted_at)) return null;
  return {
    attendanceClaim: attendanceClaimStillEligible(event, brand),
    brandContactEmail: text(brand?.contact_email),
  };
}

function bytesToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + 0x8000),
    );
  }
  return btoa(binary);
}

async function recoveryLinkFor(
  admin: AdminClient,
  p: Record<string, unknown>,
  attendanceClaimAllowed: boolean,
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
    if (
      table === "event_rsvps" && current?.event_id && attendanceClaimAllowed
    ) {
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

async function processClaim(
  admin: AdminClient,
  claim: Claim,
  loadNotice: NoticeLoader,
): Promise<void> {
  const p = claim.payload ?? {};
  // Issue #3827 — a row that carries a notice id is rendered from the notice.
  // A buyer row with no notice has nothing truthful to say and is not sent.
  // Legacy `rsvp_event_updated` rows (no notice id) skip this block entirely.
  const noticeId = text(p.noticeId);
  let update: EventUpdateDispatch | null = null;
  if (noticeId) {
    const loaded = await loadNotice(noticeId);
    if (loaded.state === "unavailable") {
      await complete(
        admin,
        claim,
        "failed_retryable",
        null,
        "event_notice_unavailable",
      );
      return;
    }
    if (loaded.state === "not_live") {
      await complete(admin, claim, "failed_terminal", null, "event_not_live");
      return;
    }
    // Rework F4 — the switches are re-read for every copy: a copy fanned out
    // before the feature was switched off (or its address left the allowlist)
    // is completed as held, with no provider call.
    const check = await checkNoticeSend(
      admin as unknown as NoticeAdminClient,
      noticeId,
      text(p.recipientEmail),
    );
    if (check === "unavailable") {
      await complete(
        admin,
        claim,
        "failed_retryable",
        null,
        "event_notice_check_unavailable",
      );
      return;
    }
    if (check !== "ok") {
      // Rework D1/D2 — a going guest this copy will not reach gets today's
      // alert instead (the database gives it at most once per change).
      const rsvpId = text(p.rsvp_id) ?? text(p.rsvpId);
      if (rsvpId && check !== "notice_missing") {
        const { error: alertError } = await admin.rpc(
          "event_edit_notice_legacy_alert",
          {
            p_notice_id: noticeId,
            p_rsvp_id: rsvpId,
          },
        );
        if (alertError) {
          // Keep the copy for a retry rather than leave the guest with nothing.
          await complete(
            admin,
            claim,
            "failed_retryable",
            null,
            "event_notice_alert_unavailable",
          );
          return;
        }
      }
      await complete(
        admin,
        claim,
        "failed_terminal",
        null,
        check === "notice_missing" ? "event_notice_missing" : check,
      );
      return;
    }
    try {
      update = buildEventUpdateDispatch(loaded.context, p);
    } catch (error) {
      // Nothing printable in the notice is final. Anything else (for example
      // a missing footer address) is configuration: keep the row and retry.
      const empty = error instanceof Error &&
        error.message === "event_update_email_nothing_to_say";
      await complete(
        admin,
        claim,
        empty ? "failed_terminal" : "failed_retryable",
        null,
        empty ? "event_notice_empty" : "event_notice_render_failed",
      );
      return;
    }
  } else if (claim.template_key === "buyer_event_updated") {
    await complete(
      admin,
      claim,
      "failed_terminal",
      null,
      "event_notice_missing",
    );
    return;
  }
  const isPassTemplate = claim.template_key === "rsvp_pass" ||
    claim.template_key === "rsvp_waitlist_promoted" ||
    claim.template_key === "rsvp_approved";
  const pass = isPassTemplate ? await passStillEligible(admin, p) : null;
  if (isPassTemplate && !pass) {
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
  const entityId = text(p.entityId);
  const startIso = text(p.eventStartAt);
  const timezone = text(p.eventTimezone);
  const eventTime = startIso && timezone
    ? formatMessageTime(startIso, timezone)
    : null;
  const canRenderV2 = isPassTemplate &&
    (claim.channel === "email" || claim.channel === "sms") &&
    entityId !== null && eventTime !== null &&
    text(p.eventName) !== null && text(p.brandName) !== null;
  const buyerLink = canRenderV2
    ? await resolveBuyerLink(admin, {
      kind: text(p.role) === "guest" ? "rsvp_guest" : "rsvp_primary",
      sourceId: entityId!,
    })
    : null;
  const recipientEmail = text(p.recipientEmail);
  const recipientPhone = text(p.recipientPhone);
  const recipientPhoneLast4 = recipientPhone?.replace(/\D/g, "").slice(-4) ??
    null;
  const v2HasClaimContact = buyerLink?.claimed === true ||
    recipientEmail !== null || recipientPhoneLast4?.length === 4;
  const modernMessage = canRenderV2 && buyerLink !== null && v2HasClaimContact
    ? buildRsvpPassMessage({
      promoted: claim.template_key === "rsvp_waitlist_promoted",
      guest: text(p.role) === "guest",
      title: text(p.eventName)!,
      brandName: text(p.brandName)!,
      recipientName: text(p.recipientName),
      recipientEmail,
      recipientPhoneLast4,
      leadName: text(p.leadName),
      claimed: buyerLink.claimed,
      buttonUrl: buyerLink.url,
      smsLink: buyerLink.display,
      date: eventTime!.date,
      time: eventTime!.time,
      when: `${eventTime!.date}, ${eventTime!.time}`,
      place: text(p.venueLine),
    })
    : null;
  const renderedModernEmail = modernMessage !== null &&
      claim.channel === "email" && recipientEmail !== null
    ? renderTransactionalEmail({
      variant: "purchase_message",
      recipient: {
        name: text(p.recipientName),
        email: recipientEmail,
      },
      body: modernMessage.body,
    })
    : null;
  const modernCalendar = renderedModernEmail !== null && startIso !== null &&
      entityId !== null
    ? buildCalendarLinks({
      title: text(p.eventName)!,
      startAtIso: startIso,
      endAtIso: text(p.eventEndAt),
      locationText: text(p.venueLine),
      isOnline: false,
      description: `RSVP pass for ${text(p.eventName)!}`,
      uid: `mingla-rsvp-${entityId}@usemingla.com`,
    })
    : null;

  // Rows created before the Wave 2 payload enrichment keep their exact legacy
  // recovery link, PDF and copy. New rows have the canonical event instant and
  // use the QR-free shared message with a stable claim link and ICS attachment.
  const needsRecoveryLink = modernMessage === null &&
    claim.template_key === "rsvp_pass" &&
    (claim.channel === "email" || claim.channel === "sms");
  const recoveryLink = needsRecoveryLink
    ? await recoveryLinkFor(admin, p, pass?.attendanceClaim === true)
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
  const link = buyerLink?.url ?? update?.link ?? recoveryLink?.passUrl ??
    authenticatedPassLink;
  const copy = modernMessage
    ? {
      title: modernMessage.body.copy.subject,
      body: modernMessage.body.copy.promise,
      sms: modernMessage.sms,
    }
    : update
    ? { title: update.title, body: update.body, sms: update.sms }
    : copyFor(claim.template_key, p, link);
  if (
    modernMessage === null && claim.template_key === "rsvp_pass" &&
    recoveryLink?.attendanceClaimUrl
  ) {
    copy.body =
      `${copy.body}\n\nConnect this RSVP to your Mingla account to see who’s going: ${recoveryLink.attendanceClaimUrl}`;
    copy.sms =
      `${copy.sms} Connect attendance: ${recoveryLink.attendanceClaimUrl}`;
  }
  let attachment: { filename: string; content: string } | null = null;
  if (modernCalendar !== null) {
    attachment = {
      filename: modernCalendar.icsFilename,
      content: bytesToBase64(modernCalendar.icsContent),
    };
  } else if (
    modernMessage === null && claim.template_key === "rsvp_pass" &&
    claim.channel === "email"
  ) {
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
          : claim.template_key === "buyer_event_updated"
          ? "buyer_event_updated"
          : "rsvp_acknowledgement",
        payload: p,
        idempotency_key: claim.idempotency_key,
        title: copy.title,
        body: copy.body,
        sms_body: copy.sms,
        deep_link: link,
        attachment,
        ...(renderedModernEmail !== null
          ? {
            email_override: {
              rendered: renderedModernEmail,
              replyTo: eventUpdateReplyTo(pass?.brandContactEmail),
            },
          }
          : update && claim.channel === "email"
          ? { email_override: update.emailOverride }
          : {}),
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
  // Issue #3827 — on the every-minute tick (no single notification asked for),
  // turn due edit notices into delivery rows before claiming. A database that
  // does not have the function yet is "nothing to do".
  if (!notificationId) {
    await fanOutEventEditNotices(admin as unknown as NoticeAdminClient);
  }
  const { data, error } = await admin.rpc(
    "claim_rsvp_notification_deliveries",
    {
      p_notification_id: notificationId,
      p_limit: notificationId ? 8 : 50,
    },
  );
  if (error) return json(500, { error: "delivery_claim_failed" });
  const claims = (data ?? []) as Claim[];
  // Issue #3827 — edit-notice rows go out five at a time, so a large audience
  // never opens fifty provider calls at once. Every other row is processed
  // exactly as before.
  const loadNotice = createNoticeLoader(admin as unknown as NoticeAdminClient);
  const isEditNotice = (claim: Claim): boolean =>
    text(claim.payload?.noticeId) !== null;
  await Promise.all([
    ...claims.filter((claim) => !isEditNotice(claim))
      .map((claim) => processClaim(admin, claim, loadNotice)),
    inGroupsOf(
      claims.filter(isEditNotice),
      5,
      (claim) => processClaim(admin, claim, loadNotice),
    ),
  ]);
  return json(200, { ok: true, claimed: claims.length });
});
