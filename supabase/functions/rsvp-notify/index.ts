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
import { eventLinkExpiry, resolveBuyerLink } from "../_shared/messageLinks.ts";
import { formatMessageTime } from "../_shared/messageTime.ts";
import {
  buildRsvpPassMessage,
  type RsvpPassReason,
} from "../_shared/rsvpPassMessage.ts";
import { purchaseEmailCopy } from "../_shared/email/purchaseCopy.ts";
import { renderBuyerSms } from "../_shared/sms/buyerSms.ts";
import { copyFor, type RsvpTemplateKey } from "./copy.ts";
import { renderTransactionalEmail } from "../_shared/email/index.ts";
import { eventUpdateReplyTo } from "../_shared/email/eventUpdatedEmail.ts";
import { buildCalendarLinks } from "../_shared/email/calendar.ts";
// Issue #4422 — one ops alert for a guest reached on no channel.
import { alertUnreachedGuests } from "../_shared/unreachedGuestAlert.ts";
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
type TemplateKey = RsvpTemplateKey;
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

/** null = the pass must not be sent. Otherwise the pass goes out, replying to
 * the brand's contact address. (#4422: the separate #871 "connect attendance"
 * link is gone; the /c/ claim link already claims attendance.) */
async function passStillEligible(
  admin: AdminClient,
  p: Record<string, unknown>,
): Promise<
  {
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
): Promise<{ passUrl: string } | null> {
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
    return {
      passUrl: rsvpRecoveryUrl(
        table === "event_rsvps" ? "primary" : "guest",
        entityId,
        token,
      ),
    };
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

/** Issue #4422 — park a text held by the Nigerian operator embargo until its
 * window reopens, without spending a try. A failed write is never swallowed:
 * it is logged and the lease is classified, so the row is retried. */
async function deferDelivery(
  admin: AdminClient,
  claim: Claim,
  safeCode: string | null,
  nextAttemptAt: string | null,
): Promise<void> {
  const { data, error } = await admin.rpc("defer_rsvp_notification_delivery", {
    p_delivery_id: claim.delivery_id,
    p_lease_id: claim.lease_id,
    p_safe_error_code: safeCode,
    p_next_attempt_at: nextAttemptAt,
  });
  if (error) {
    console.error(
      "[rsvp-notify] defer failed",
      claim.delivery_id,
      error.message,
    );
    await classifyFailure(admin, claim, "defer_write_failed");
  } else if (data !== true) {
    console.error("[rsvp-notify] defer lost its lease", claim.delivery_id);
  }
  console.info(JSON.stringify({
    event: "rsvp_notification_channel_result",
    notificationId: claim.notification_id,
    channel: claim.channel,
    outcome: "deferred",
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

/** #4422 — why the guest holds a pass: the stored enrichment, else the
 * template (a promotion is a spot that opened, rsvp_approved the host). */
function passReason(
  template: TemplateKey,
  p: Record<string, unknown>,
): RsvpPassReason {
  const stored = text(p.passReason);
  if (stored === "going" || stored === "approved" || stored === "spot_opened") {
    return stored;
  }
  return template === "rsvp_waitlist_promoted"
    ? "spot_opened"
    : template === "rsvp_approved"
    ? "approved"
    : "going";
}

type AcknowledgementState = "maybe" | "waitlisted" | "pending" | "not_going";

/** Same order as copy.ts's acknowledgementLabel. A going RSVP has no row here:
 * its pass is the message. */
function acknowledgementState(
  p: Record<string, unknown>,
): AcknowledgementState | null {
  const state = text(p.status);
  if (state === "waitlisted") return "waitlisted";
  if (text(p.approvalStatus) === "pending") return "pending";
  if (state === "maybe") return "maybe";
  if (state === "not_going") return "not_going";
  return null;
}

const ACKNOWLEDGEMENTS = {
  maybe: { sms: "S4M", lead: "Maybe saved:", template: "rsvp_maybe" },
  waitlisted: { sms: "S4W", lead: "Waitlisted:", template: "rsvp_waitlisted" },
  pending: { sms: "S4R", lead: "Request sent for", template: "rsvp_pending" },
  not_going: {
    sms: "S4N",
    lead: "Got it, you can't go to",
    template: "rsvp_not_going",
  },
} as const;

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
      update = await buildEventUpdateDispatch(
        loaded.context,
        p,
        claim.channel === "sms" ? admin : null,
        claim.channel === "sms",
      );
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
  const entityId = text(p.entityId);
  const startIso = text(p.eventStartAt);
  const timezone = text(p.eventTimezone);
  const eventTime = startIso && timezone
    ? formatMessageTime(startIso, timezone)
    : null;
  const eventName = text(p.eventName);
  const brandName = text(p.brandName);
  // #4422 — the live public page on host.usemingla.com (rsvp_messages_v2
  // enrichment). Older rows have none and keep their stored link.
  const eventUrl = text(p.eventUrl);
  const eventId = text(p.event_id) ?? text(p.eventId);
  const defaultLink = text(p.deepLink) ?? eventUrl ?? "https://usemingla.com";
  const canRenderV2 = isPassTemplate &&
    (claim.channel === "email" || claim.channel === "sms") &&
    entityId !== null && eventTime !== null &&
    eventName !== null && brandName !== null;
  const buyerLink = canRenderV2 && entityId !== null
    ? await resolveBuyerLink(admin, {
      kind: text(p.role) === "guest" ? "rsvp_guest" : "rsvp_primary",
      sourceId: entityId,
    })
    : null;
  const recipientEmail = text(p.recipientEmail);
  const recipientPhone = text(p.recipientPhone);
  const recipientPhoneLast4 = recipientPhone?.replace(/\D/g, "").slice(-4) ??
    null;
  const v2HasClaimContact = buyerLink?.claimed === true ||
    recipientEmail !== null || recipientPhoneLast4?.length === 4;
  const modernMessage = canRenderV2 && buyerLink !== null &&
      v2HasClaimContact && eventTime !== null && eventName !== null &&
      brandName !== null
    ? buildRsvpPassMessage({
      reason: passReason(claim.template_key, p),
      guest: text(p.role) === "guest",
      title: eventName,
      brandName,
      recipientName: text(p.recipientName),
      recipientEmail,
      recipientPhoneLast4,
      leadName: text(p.leadName),
      claimed: buyerLink.claimed,
      buttonUrl: buyerLink.url,
      smsLink: buyerLink.display,
      date: eventTime.date,
      time: eventTime.time,
      when: `${eventTime.date}, ${eventTime.time}`,
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
      entityId !== null && eventName !== null
    ? buildCalendarLinks({
      title: eventName,
      startAtIso: startIso,
      endAtIso: text(p.eventEndAt),
      locationText: text(p.venueLine),
      isOnline: false,
      description: `RSVP pass for ${eventName}`,
      uid: `mingla-rsvp-${entityId}@usemingla.com`,
    })
    : null;

  // #4422 — Maybe, waitlisted, pending and can't-go rows that carry the event
  // enrichment get the shared purchase email ("See the event") and a
  // one-segment text with the short event link.
  const ackState = claim.template_key === "rsvp_acknowledgement"
    ? acknowledgementState(p)
    : null;
  const ack = ackState !== null && eventTime !== null && eventUrl !== null &&
      eventName !== null && brandName !== null
    ? ACKNOWLEDGEMENTS[ackState]
    : null;
  const legacyEventUpdate = update === null &&
    claim.template_key === "rsvp_event_updated" && eventUrl !== null;
  const eventPageLink = claim.channel === "sms" && eventUrl !== null &&
      eventId !== null && (ack !== null || legacyEventUpdate)
    ? await resolveBuyerLink(admin, {
      kind: "event_page",
      sourceId: eventId,
      targetUrl: eventUrl,
      expiresAt: eventLinkExpiry({
        lastEndAt: text(p.eventLastEndAt),
        endAt: text(p.eventEndAt),
        startAt: startIso,
      }),
    })
    : null;
  const eventSmsLink = eventPageLink?.display ??
    eventUrl?.replace(/^https:\/\//, "") ?? null;
  let ackMessage:
    | {
      title: string;
      body: string;
      sms: string;
      rendered: ReturnType<typeof renderTransactionalEmail> | null;
    }
    | null = null;
  if (
    ack !== null && ackState !== null && eventTime !== null &&
    eventUrl !== null && eventName !== null && brandName !== null &&
    (claim.channel === "email" || claim.channel === "sms")
  ) {
    try {
      const emailCopy = purchaseEmailCopy({
        template: ack.template,
        title: eventName,
        date: eventTime.date,
      });
      let sms: string;
      try {
        sms = renderBuyerSms(ack.sms, {
          title: eventName,
          date: eventTime.date,
          link: eventSmsLink,
        });
      } catch (error) {
        if (
          !(error instanceof Error &&
            error.message.startsWith("sms_template_overflow"))
        ) throw error;
        // The full-page fallback link did not fit one segment.
        console.info(JSON.stringify({
          event: "rsvp_sms_link_omitted",
          notificationId: claim.notification_id,
          deliveryId: claim.delivery_id,
        }));
        sms = renderBuyerSms("S4L", {
          stateWord: ack.lead,
          title: eventName,
          date: eventTime.date,
        });
      }
      ackMessage = {
        title: emailCopy.subject,
        body: emailCopy.promise,
        sms,
        rendered: claim.channel === "email" && recipientEmail !== null
          ? renderTransactionalEmail({
            variant: "purchase_message",
            recipient: { name: text(p.recipientName), email: recipientEmail },
            body: {
              variant: "purchase_message",
              copy: emailCopy,
              buttonUrl: eventUrl,
              details: {
                title: eventName,
                hostOrVenue: brandName,
                when: `${eventTime.date}, ${eventTime.time}`,
                place: text(p.venueLine),
              },
              appLink: ackState === "maybe",
            },
          })
          : null,
      };
    } catch (error) {
      console.error(
        "[rsvp-notify] acknowledgement render failed",
        claim.delivery_id,
        error instanceof Error ? error.message : "unknown",
      );
      await complete(
        admin,
        claim,
        "failed_retryable",
        null,
        "rsvp_render_failed",
      );
      return;
    }
  }

  // Rows created before the Wave 2 payload enrichment keep their exact legacy
  // recovery link, PDF and copy. New rows have the canonical event instant and
  // use the shared message with a stable claim link, the calendar file and
  // (#4422) the QR pass PDF.
  const needsRecoveryLink = modernMessage === null &&
    claim.template_key === "rsvp_pass" &&
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
    : claim.template_key === "rsvp_acknowledgement" ||
        claim.template_key === "rsvp_event_updated"
    ? eventUrl ?? defaultLink
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
    : ackMessage
    ? { title: ackMessage.title, body: ackMessage.body, sms: ackMessage.sms }
    : copyFor(
      claim.template_key,
      p,
      link,
      legacyEventUpdate && eventSmsLink !== null ? eventSmsLink : link,
    );
  // #4422 (Seth, 13 Nov): everything goes through the app. The enriched pass
  // email carries the claim button, the date line and the calendar file and
  // NO QR PDF: the guest claims the pass and shows its QR in the app. Rows
  // without the enrichment (the switch off) keep the legacy QR PDF unchanged.
  const attachments: Array<{ filename: string; content: string }> = [];
  if (modernCalendar !== null) {
    attachments.push({
      filename: modernCalendar.icsFilename,
      content: bytesToBase64(modernCalendar.icsContent),
    });
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
      attachments.push({ filename: pdf.filename, content: pdf.contentBase64 });
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
        attachments,
        ...(renderedModernEmail !== null
          ? {
            email_override: {
              rendered: renderedModernEmail,
              replyTo: eventUpdateReplyTo(pass?.brandContactEmail),
            },
          }
          : ackMessage?.rendered
          ? {
            email_override: {
              rendered: ackMessage.rendered,
              replyTo: eventUpdateReplyTo(text(p.brandContactEmail)),
            },
          }
          : update && claim.channel === "email"
          ? { email_override: update.emailOverride }
          : {}),
        delivery_id: claim.delivery_id,
        lease_id: claim.lease_id,
      },
    );
    if (result.outcome === "deferred") {
      await deferDelivery(
        admin,
        claim,
        result.safeCode,
        result.nextAttemptAt,
      );
      return;
    }
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
  // Issue #4422 — on the every-minute tick, one ops alert for any guest this
  // worker reached on no channel and owes nothing more.
  if (!notificationId) {
    await alertUnreachedGuests(admin, "rsvp");
  }
  return json(200, { ok: true, claimed: claims.length });
});
