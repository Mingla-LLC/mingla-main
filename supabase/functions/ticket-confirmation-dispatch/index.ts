// ORCH-0788 — Buyer notification dispatcher (formerly ORCH-0785
// "ticket confirmation" dispatcher).
//
// Routes by `payload->>'template_key'` per notification row:
//   - NULL or missing → "buyer_ticket_confirmation" (legacy default,
//     preserves the W1 enqueue path from biz_ticket_checkout_finalize_session
//     which never sets template_key). Renders ticket body + PDF + .ics
//     attachment exactly as the ORCH-0785 baseline did.
//   - "buyer_refund_issued" → renders refund notification via
//     refundIssuedToGenericBody adapter through the existing
//     generic_notification variant; sender override to EMAIL_SENDERS.tickets.
//     No PDF, no calendar.
//   - "buyer_order_cancelled" → same shape with cancel adapter.
//   - "waitlist_spot_open" → renders a no-attachment claim-link email/SMS
//     for waitlist_entries rows whose notification has no parent order.
//   - Unknown template_key → immediate failed_terminal with
//     last_error="unknown_template_key:<value>" (defensive, I-PROPOSED-BA).
//
// Per SPEC §5.4: NO new EmailVariant union members. Refund/cancel ride
// through the existing generic_notification variant using adapter
// functions and a sender override.
//
// Service-role auth + ledger transition + rollup recompute behaviour
// preserved from ORCH-0777 baseline. PDF render failure remains RETRYABLE.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  classifyNotificationProviderFailure,
  jsonResponse,
  ProviderFailure,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";
import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
  type TicketBodyInput,
} from "../_shared/email/index.ts";
import { buildTicketPdf } from "../_shared/ticketPdf.ts";
// issue #2347 — the ONE chosen-day resolver, shared with ticket-pdf-fetch.
import { resolveChosenOccurrence } from "../_shared/chosenOccurrence.ts";
// issue #2347 — ONE storage-path authority, shared with ticket-pdf-fetch, so
// the two writers can never disagree about where an order's PDF lives.
import { ticketPdfStoragePath } from "../_shared/ticketPdfPath.ts";
// ORCH-0859 (Tr2): trip-shaped confirmation email helper. Used only when
// event_type='trip' — event_type='event' path unchanged.
import { renderTripConfirmationEmail } from "../_shared/email/tripConfirmationEmail.ts";
// ORCH-1195 FIX 4 — experience-shaped confirmation (includes the itinerary/stops).
import { renderExperienceConfirmationEmail } from "../_shared/email/experienceConfirmationEmail.ts";
import { renderAttendanceClaimAvailableEmail } from "../_shared/email/ticketBody.ts";
import { buildCalendarLinks } from "../_shared/email/calendar.ts";
// ORCH-0869 (Tr3) Stage 1b: installment-kind renderers. Routed via body.kind
// from installmentWebhookHandlers.ts and process-scheduled-installments.
import { renderInstallmentDunningEmail } from "../_shared/email/installmentDunningEmail.ts";
import { renderInstallmentPlanPaidInFullEmail } from "../_shared/email/installmentPlanPaidInFullEmail.ts";
import { renderWaitlistSpotOpenEmail } from "../_shared/email/templates/waitlistSpotOpen.ts";
import { renderWaitlistSpotOpenSms } from "../_shared/sms/templates/waitlistSpotOpen.ts";
import {
  type BuyerContext,
  type IntakeFormReAnswerRequiredPayloadShape,
  intakeFormReAnswerRequiredToGenericBody,
  type OrderCancelledPayloadShape,
  orderCancelledToGenericBody,
  type RefundIssuedPayloadShape,
  refundIssuedToGenericBody,
} from "../_shared/email/buyerLifecycleAdapters.ts";
// ISSUE-1001 — canonical logo resolution. Was `?? null` → text-only PDF
// wordmark when the secret was unset; PDFs now always embed the logo
// (ticketPdf.ts still degrades to text if the fetch itself fails).
import { minglaLogoUrl } from "../_shared/brandAssets.ts";
// #1541 — THE SOLE SMS SEND PATH. This function used to own a private Twilio
// client (`sendTwilioMessage`), which meant no market kill switch and no country
// routing stood between a paid order and the provider. Every SMS now leaves
// through smsAdapter, which owns SMS_LIVE_ENABLED_*, the Twilio/Termii routing
// decision, the fail-closed contract and the STOP footer.
// I-PROPOSED-1541-SMS-PROVIDER-EGRESS-ALLOWLIST.
import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";
// #1541 (F-6) — LEDGER ATTRIBUTION ONLY, NEVER ROUTING. Routing belongs to the
// adapter and to it alone; this import exists so the `provider` column stops
// lying.
import { countryFromE164 } from "../_shared/e164Country.ts";
import {
  attendanceClaimUrls,
  bytesToPostgresHex,
  hmacOrderClaimDigest,
  mintOrderClaimToken,
  shouldIssueOrderAttendanceClaimForNotification,
} from "../_shared/attendanceClaim.ts";
import { resolveAttendanceClaimPepperRing } from "../_shared/governedAdSecret.ts";

const MINGLA_LOGO_URL = minglaLogoUrl();

// #1541 (F-6) — `ticket_order_notifications.provider` was a hardcoded "twilio"
// literal at both SMS write sites, so a Twilio->Termii cutover was unauditable
// on the money-path ledger: a Termii send and a Twilio send were indistinguishable
// in the exact table that carries buyer notifications.
//
// This shares `countryFromE164` with the adapter, so the two CANNOT disagree
// about the COUNTRY; only the one-line country->provider mapping is duplicated,
// and that duplication is pinned by a test (SC-9) that drives real destinations
// through both this helper and the adapter and asserts they agree.
//
// [TRANSITIONAL] — superseded when #1537 lands an adapter-RETURNED provider on
// AdapterResult. Exit condition: `result.provider` exists on AdapterResult ->
// delete this helper and stamp the returned value. #1541 must not edit
// smsAdapter.ts (#1537 is in flight against that exact file).
const providerForLedger = (to: string): string =>
  countryFromE164(to) === "NG" ? "termii" : "twilio";

function icsToBase64(ics: string): string {
  const bytes = new TextEncoder().encode(ics);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

class ProviderSendError extends Error {
  retryable: boolean;
  /**
   * #2218 — the instant this row becomes attemptable again, when the reason it
   * could not be sent is a KNOWN, TIMED refusal rather than a fault (today:
   * the Nigerian 20:00–08:00 WAT `generic` operator embargo).
   *
   * It exists because the ORCH-0788 backoff cannot express this. That ladder is
   * 2^attempt × 60s capped at three attempts — at most ~6 minutes of patience —
   * so a message held at 06:10 WAT would exhaust every retry hours before the
   * network would carry it and land on `failed_terminal`. Carrying the deadline
   * on the error lets ONE catch clause serve every template.
   */
  nextAttemptAt: string | null;
  constructor(failure: ProviderFailure & { nextAttemptAt?: string | null }) {
    super(failure.detail);
    this.name = "ProviderSendError";
    this.retryable = failure.retryable;
    this.nextAttemptAt = failure.nextAttemptAt ?? null;
  }
}

// #2218 — the ONE shape a deferred SMS takes on this dispatcher. A deferral is
// NOT a failure (nothing broke, nothing was spent) and NOT a skip (the message
// is still owed to the buyer). Both call sites raise it identically so the
// single catch below writes one honest row: `deferred`, holding until
// `next_attempt_at`, attempt_count untouched.
function deferredSmsError(
  result: { error?: string; retryAfter?: string },
): ProviderSendError {
  return new ProviderSendError({
    retryable: true,
    detail: `sms_deferred:${result.error ?? "ng_operator_embargo"}`,
    status: 0,
    nextAttemptAt: result.retryAfter ?? null,
  });
}

async function sendResendEmailWithAttachment(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: Array<{ filename: string; content: string }>;
}): Promise<{ id: string | null }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("resend_api_key_missing");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = classifyNotificationProviderFailure(
      "resend",
      response.status,
      json,
    );
    throw new ProviderSendError(failure);
  }
  return { id: typeof json.id === "string" ? json.id : null };
}

// #1541 — `sendTwilioMessage()` lived here. It POSTed straight to the Twilio
// Messages REST endpoint with its own TWILIO_* env reads, so
// `sms_live_enabled.ng` gated nothing on this path and a Nigerian buyer's
// confirmation was attempted (and geo-rejected by Twilio, 21408) on a money
// path with no switch anyone could throw. Deleted, not wrapped — subtract
// before adding. Its replacement is `smsAdapter.send()` at the two call sites
// below, which is the ONLY sanctioned egress.

interface OrderJoin {
  id: string;
  event_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_user_id: string | null;
  total_cents: number;
  tax_amount_cents: number | null;
  tax_breakdown: unknown[] | null;
  currency: string;
  payment_method: string | null;
  payment_status: string | null;
  confirmed_at: string | null;
  notification_status: string | null;
  events: {
    id: string;
    title: string | null;
    cover_media_url: string | null;
    cover_media_type: string | null;
    location_text: string | null;
    is_online: boolean | null;
    timezone: string | null;
    brand_id: string;
    // ORCH-0859 (Tr2): event_type discriminator + theme jsonb for trip-specific
    // confirmation branching. event_type='trip' rows carry trip details in
    // theme.business_trip.{startAt,endAt,destinationLocationText,capacity}.
    event_type: string | null;
    theme: Record<string, unknown> | null;
    brands: {
      id: string;
      name: string | null;
      profile_photo_url: string | null;
      // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]: brand contact_email
      // surfaced to refund/cancel email body adapters via BuyerContext.organizerEmail.
      contact_email: string | null;
    };
  };
}

interface RenderContext {
  bodyInput: TicketBodyInput;
  ticketsForPdf: Array<{
    ticketId: string;
    ticketName: string;
    qrPayload: string;
  }>;
}

interface NotificationRow {
  id: string;
  channel: string;
  recipient: string;
  status: string;
  attempt_count: number | null;
  payload: Record<string, unknown> | null;
}

function shortId(id: string): string {
  return String(id).slice(0, 8);
}

function publicBuyerBaseUrl(): string {
  // ISSUE-927: PUBLIC_BUYER_BASE_URL stays the deliberate per-surface override;
  // BUSINESS_WEB_ORIGIN is the canonical origin secret and the old
  // MINGLA_BUSINESS_WEB_URL name is a fallback so its deletion is safely
  // decoupled (same digest, audited).
  const raw = Deno.env.get("PUBLIC_BUYER_BASE_URL") ??
    Deno.env.get("BUSINESS_WEB_ORIGIN") ??
    Deno.env.get("MINGLA_BUSINESS_WEB_URL") ??
    "https://host.usemingla.com";
  return raw.replace(/\/+$/, "");
}

async function markNotificationTerminal(
  supabase: ReturnType<typeof serviceClient>,
  notificationId: string,
  lastError: string,
): Promise<void> {
  await supabase.from("ticket_order_notifications").update({
    status: "failed_terminal",
    last_error: lastError,
    updated_at: new Date().toISOString(),
  }).eq("id", notificationId);
}

// ===========================================================================
// #1541 §4.2 — OQ-1 OPERATOR DECISION (Seth, 2026-08-04).
// RETURN A GATED GUEST'S SPOT TO THE POOL. READ BEFORE CHANGING THE ORDER.
// ===========================================================================
// `waitlist_spot_open` enqueues EITHER an email row OR an SMS row, never both
// (fn_waitlist_drain_on_capacity_freed: IF email ... ELSIF phone ... ELSE
// CONTINUE). So an SMS row on this template exists ONLY for a guest with a
// phone and no email — for that guest SMS is the SOLE channel, and its body
// carries a claim URL that expires in 24 hours. The trigger has ALREADY flipped
// the entry to 'invited' before this dispatcher runs, so a plain gated skip
// would burn both the guest's claim window and the freed seat, in silence.
//
// The decision: if we cannot tell someone their spot is open, we have not
// offered it. The entry returns to 'waiting' and the spot flows to the next
// eligible guest on the next trigger pass.
//
// ATOMICITY — the release must not be separable from the skip.
// There is no cross-table transaction available from an edge function (and
// #1541 authors no migration, so there is no RPC to lean on). Atomicity is
// therefore achieved by ORDERING plus a fail-closed throw, and the ordering is
// the whole mechanism:
//
//   RELEASE FIRST, THEN RECORD THE SKIP.
//
//   - The release is ONE statement (a single PATCH setting all four fields), so
//     it cannot itself half-apply.
//   - If the release fails or matches nothing, this THROWS before the
//     notification is touched. Nothing has changed: the entry is exactly as the
//     trigger left it and the row is not 'skipped', so the sweeper retries.
//   - If the release succeeds and the notification write then fails, the spot is
//     ALREADY back in the pool — the guest keeps their place and the next guest
//     is offered the seat. The bookkeeping row is retried; the release is
//     idempotent.
//
// The state the reverse order would permit — notification 'skipped' (the system
// believes it is finished) while the entry is still 'invited' (the seat is
// consumed and the guest was never told) — IS UNREACHABLE, because the skip is
// only ever written after the release has been verified. That is the property,
// and it holds under failure, not merely on the happy path.
//
// VACUITY GUARD (#1529 discipline): an UPDATE that matched ZERO rows is not a
// release. We assert the returned row count is > 0 AND re-read the four fields
// off the returned row before believing it — a lookup that proves nothing by
// matching nothing is the exact failure mode this chain of work exists to close.
// ===========================================================================
// #1541 tester T-1541-WAITLIST-RELEASE-SCOPE (P2) — THE COMPARE-AND-SET.
// ===========================================================================
// The release used to be scoped by ENTRY ID ALONE, with no predicate binding it
// to the invitation this notification actually represents. `
// handleWaitlistNotificationDispatch` claims the row with an UNCONDITIONAL
// update, so two dispatches of the same notification both proceed — and then:
//
//   1. Worker A (dark market) releases the entry     -> waiting, all NULL
//   2. The drain trigger re-offers the seat          -> invited, notification_id = B
//   3. Worker A' (a duplicate/slow dispatch of the SAME original notification)
//      reaches its release and PATCHes the entry back to waiting, CLOBBERING
//      invitation B
//
// Net: the seat returns to the pool while a live notification for the NEXT
// guest is already in flight — the same seat offered twice. That is the exact
// inverse of the harm this release was built to prevent, and the reversal is
// what makes it reachable.
//
// THE FIX IS THE PREDICATE. Scoping the UPDATE to `notification_id = <this
// notification>` makes it a compare-and-set: a stale worker matches ZERO rows
// and falls into the EXISTING `waitlist_release_matched_no_rows` throw, which
// already refuses to record the skip. So a duplicate dispatch cannot clobber an
// invitation it does not own, and — because the throw is retryable and the row
// is never marked skipped — it also cannot silently lose one.
//
// Live exposure today is ZERO (`waitlist_entries.email` is NOT NULL, so an SMS
// waitlist_spot_open row cannot be enqueued at all — see Discovery 1). That is a
// data-shape accident, not a guarantee, and this is the guest-fairness path
// Seth ruled on in OQ-1.
async function releaseWaitlistEntryToPool(
  supabase: ReturnType<typeof serviceClient>,
  waitlistEntryId: string,
  notificationId: string,
): Promise<void> {
  // NOTE: `waitlist_entries` has NO `updated_at` column (verified against
  // production information_schema, 2026-08-04). Do not add one here.
  const { data, error } = await supabase
    .from("waitlist_entries")
    .update({
      status: "waiting",
      invited_at: null,
      notified_at: null,
      notification_id: null,
    })
    .eq("id", waitlistEntryId)
    // COMPARE-AND-SET: release ONLY the invitation this notification owns.
    .eq("notification_id", notificationId)
    .select("id,status,invited_at,notified_at,notification_id");

  if (error !== null) {
    throw new ProviderSendError({
      retryable: true,
      detail: `waitlist_release_failed:${error.message}`,
      status: 0,
    });
  }
  const rows = (Array.isArray(data) ? data : []) as Array<{
    status: string | null;
    invited_at: string | null;
    notified_at: string | null;
    notification_id: string | null;
  }>;
  if (rows.length === 0) {
    // Either the entry is gone, or — with the compare-and-set above — this
    // notification no longer owns the invitation: another dispatch already
    // released it and the drain trigger re-offered the seat to the next guest.
    // Refusing here is correct in BOTH readings: we do not clobber an
    // invitation we do not own, and we do not record a skip we did not perform.
    throw new ProviderSendError({
      retryable: true,
      detail: `waitlist_release_matched_no_rows:${waitlistEntryId}`,
      status: 0,
    });
  }
  const row = rows[0];
  if (
    row.status !== "waiting" || row.invited_at !== null ||
    row.notified_at !== null || row.notification_id !== null
  ) {
    throw new ProviderSendError({
      retryable: true,
      detail: `waitlist_release_unverified:${waitlistEntryId}`,
      status: 0,
    });
  }
}

async function deliverWaitlistSpotOpenNotification(
  supabase: ReturnType<typeof serviceClient>,
  notification: NotificationRow,
): Promise<"sent" | "failed_terminal" | "skipped"> {
  const payload = notification.payload ?? {};
  const waitlistEntryId = typeof payload.waitlist_entry_id === "string"
    ? payload.waitlist_entry_id
    : "";
  const eventId = typeof payload.event_id === "string" ? payload.event_id : "";
  const ticketTypeId = typeof payload.ticket_type_id === "string"
    ? payload.ticket_type_id
    : "";
  const qtyRequested = Number.isInteger(payload.qty_requested)
    ? Number(payload.qty_requested)
    : 1;
  const inviteExpiresAt = typeof payload.invite_expires_at === "string"
    ? payload.invite_expires_at
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  if (!waitlistEntryId || !eventId || !ticketTypeId) {
    await markNotificationTerminal(
      supabase,
      notification.id,
      "waitlist_payload_invalid",
    );
    return "failed_terminal";
  }

  const { data: eventRaw, error: eventError } = await supabase
    .from("events")
    .select("id,title,brands!inner(id,name)")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError !== null || eventRaw === null) {
    throw new ProviderSendError({
      retryable: true,
      detail: eventError?.message ?? "waitlist_event_not_found",
      status: 0,
    });
  }

  const { data: ticketTypeRaw, error: ticketTypeError } = await supabase
    .from("ticket_types")
    .select("id,name")
    .eq("id", ticketTypeId)
    .maybeSingle();
  if (ticketTypeError !== null || ticketTypeRaw === null) {
    throw new ProviderSendError({
      retryable: true,
      detail: ticketTypeError?.message ?? "waitlist_ticket_type_not_found",
      status: 0,
    });
  }

  const event = eventRaw as unknown as {
    title: string | null;
    brands: { name: string | null };
  };
  const ticketType = ticketTypeRaw as unknown as { name: string | null };
  const claimUrl = `${publicBuyerBaseUrl()}/checkout/${eventId}?wl=${
    encodeURIComponent(waitlistEntryId)
  }`;

  if (notification.channel === "email") {
    const email = renderWaitlistSpotOpenEmail({
      brand: { name: event.brands.name ?? "Mingla" },
      event: { title: event.title ?? "your event" },
      ticketType: { name: ticketType.name ?? "ticket" },
      qtyRequested,
      expiresAt: inviteExpiresAt,
      claimUrl,
    });
    assertNotResendSandbox(EMAIL_SENDERS.tickets);
    const sent = await sendResendEmailWithAttachment({
      from: formatSenderHeader(EMAIL_SENDERS.tickets),
      to: notification.recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [],
    });
    await supabase.from("ticket_order_notifications").update({
      status: "sent",
      provider: "resend",
      provider_message_id: sent.id,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", notification.id);
    return "sent";
  }

  if (notification.channel === "sms") {
    // #1541 §4.0 — the ONE call shape. countryCode, messagingServiceSid,
    // messageType, stopFooterOwnLine, mediaUrls and beforeProviderIo are all
    // OMITTED deliberately: this path has no authoritative country label (per
    // #1529 the destination number is the routing authority, and a guessed
    // label would only emit spurious sms_country_assertion_mismatch warnings),
    // and omitting the SID selects the approved transactional toll-free.
    const result = await smsAdapter.send({
      to: notification.recipient,
      brandName: event.brands.name ?? "Mingla",
      message: renderWaitlistSpotOpenSms({
        eventTitle: event.title ?? "your event",
        ticketTypeName: ticketType.name ?? "ticket",
        claimUrl,
      }),
    });

    // #2218 — a Nigerian `generic` send inside the 20:00–08:00 WAT operator
    // embargo is HELD, not attempted. Raised BEFORE the `failed` branch so it
    // can never be mistaken for a provider fault, and before the `skipped`
    // branch so it never releases the waitlist seat: the guest IS still going
    // to be told, just after the window opens.
    if (result.status === "deferred") {
      throw deferredSmsError(result);
    }

    // `ok` is false for BOTH skipped and failed — branch on `status`, never on
    // `ok`. A market-gated skip is not an error.
    if (result.status === "failed") {
      throw new ProviderSendError({
        retryable: true,
        detail: result.error ?? "sms_send_failed",
        status: 0,
      });
    }

    const nowIso = new Date().toISOString();
    if (result.status === "skipped") {
      // ORDER IS THE ATOMICITY MECHANISM — release the seat BEFORE recording
      // the skip. See the block above releaseWaitlistEntryToPool. This throws
      // on failure, so the row is never marked 'skipped' over a consumed spot.
      await releaseWaitlistEntryToPool(
        supabase,
        waitlistEntryId,
        notification.id,
      );
      await supabase.from("ticket_order_notifications").update({
        status: "skipped",
        provider: providerForLedger(notification.recipient),
        provider_message_id: null,
        last_error: `sms_market_dark:${
          result.error ?? "provider_kill_switch_off"
        }`,
        updated_at: nowIso,
      }).eq("id", notification.id);
      return "skipped";
    }

    await supabase.from("ticket_order_notifications").update({
      status: "sent",
      provider: providerForLedger(notification.recipient),
      provider_message_id: result.providerMessageId,
      sent_at: nowIso,
      updated_at: nowIso,
    }).eq("id", notification.id);
    return "sent";
  }

  await supabase.from("ticket_order_notifications").update({
    status: "skipped",
    last_error: "channel_not_supported_for_template",
    updated_at: new Date().toISOString(),
  }).eq("id", notification.id);
  return "skipped";
}

async function handleWaitlistNotificationDispatch(
  supabase: ReturnType<typeof serviceClient>,
  notificationId: string,
): Promise<Response> {
  const { data, error } = await supabase
    .from("ticket_order_notifications")
    .select("id, channel, recipient, status, attempt_count, payload")
    .eq("id", notificationId)
    .maybeSingle();
  if (error !== null || data === null) {
    return jsonResponse(
      { error: "notification_not_found", detail: error?.message },
      404,
    );
  }

  const notification = data as unknown as NotificationRow;
  const rawPayload = notification.payload ?? {};
  if (rawPayload.template_key !== "waitlist_spot_open") {
    await markNotificationTerminal(
      supabase,
      notification.id,
      `unknown_template_key:${String(rawPayload.template_key)}`,
    );
    return jsonResponse({
      notificationId,
      outcomes: [{
        channel: notification.channel,
        status: "failed_terminal",
        templateKey: String(rawPayload.template_key),
      }],
    });
  }

  await supabase
    .from("ticket_order_notifications")
    .update({
      status: "sending",
      attempt_count: Number(notification.attempt_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", notification.id);

  try {
    const status = await deliverWaitlistSpotOpenNotification(
      supabase,
      notification,
    );
    return jsonResponse({
      notificationId,
      outcomes: [{
        channel: notification.channel,
        status,
        templateKey: "waitlist_spot_open",
      }],
    });
  } catch (err) {
    // #2218 — same rule as the per-order loop: a timed operator refusal is a
    // HOLD, not a spent attempt. See the essay on the catch clause there.
    const deferredUntil = err instanceof ProviderSendError
      ? err.nextAttemptAt
      : null;
    if (deferredUntil !== null) {
      const { error: deferErr } = await supabase
        .from("ticket_order_notifications").update({
          status: "deferred",
          last_error: err instanceof Error ? err.message : String(err),
          next_attempt_at: deferredUntil,
          attempt_count: Number(notification.attempt_count ?? 0),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
      if (deferErr !== null) {
        // Same deploy-order safety net as the per-order loop — see the essay
        // there. A rejected `deferred` write strands the row at `sending`,
        // which no sweeper selects.
        console.error(
          JSON.stringify({
            event: "ticket_notification_defer_write_rejected",
            notificationId: notification.id,
            detail: deferErr.message,
            note:
              "#2218 apply migration 20270421002218 before deploying this function",
          }),
        );
        await supabase.from("ticket_order_notifications").update({
          status: "failed_retryable",
          last_error: err instanceof Error ? err.message : String(err),
          attempt_count: Number(notification.attempt_count ?? 0),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
        return jsonResponse({
          notificationId,
          outcomes: [{
            channel: notification.channel,
            status: "failed_retryable",
            templateKey: "waitlist_spot_open",
          }],
        });
      }
      return jsonResponse({
        notificationId,
        outcomes: [{
          channel: notification.channel,
          status: "deferred",
          templateKey: "waitlist_spot_open",
        }],
      });
    }
    const attemptCount = Number(notification.attempt_count ?? 0) + 1;
    const retryable = err instanceof ProviderSendError ? err.retryable : true;
    const terminal = !retryable || attemptCount >= 3;
    await supabase.from("ticket_order_notifications").update({
      status: terminal ? "failed_terminal" : "failed_retryable",
      last_error: err instanceof Error ? err.message : String(err),
      updated_at: new Date().toISOString(),
    }).eq("id", notification.id);
    return jsonResponse({
      notificationId,
      outcomes: [{
        channel: notification.channel,
        status: terminal ? "failed_terminal" : "failed_retryable",
        templateKey: "waitlist_spot_open",
      }],
    });
  }
}

// ══ issue #2162 — WHICH DAY DOES THIS ORDER'S CONFIRMATION NAME? ═══════════
// The resolver and its full contract now live in `../_shared/chosenOccurrence.ts`.
//
// issue #2347 MOVED IT, VERBATIM, AND CHANGED NOTHING ABOUT IT. The reason is
// the second surface: `ticket-pdf-fetch` — the wallet's "Download ticket"
// endpoint — still read `is_master`, handed a multi-day guest the wrong day's
// PDF, and then CACHED that PDF onto `orders.ticket_pdf_path` forever. The fix
// for that is this exact resolver, not a second copy of it, so it is imported
// by both functions and lives in neither.
//
// The precedence pinned by #2162's C-6 is unchanged and still enforced at the
// call site below: `chosenDate ?? masterDate`. `masterDate ?? chosenDate` would
// compile and re-ship #2162 verbatim.

function buildRenderContext(args: {
  order: OrderJoin;
  lineItems: Array<{
    quantity: number | null;
    unit_price_cents: number | null;
    total_cents: number | null;
    ticket_types: { name: string | null };
  }>;
  ticketRows: Array<{
    id: string;
    qr_code: string;
    ticket_types: { name: string | null };
  }>;
  masterDate: {
    start_at: string | null;
    // ORCH-0877 — master end_at carried into the email body input so the
    // ticket confirmation can render a real date range + ICS DTEND.
    end_at: string | null;
    timezone: string | null;
    // issue #2162 — this may now be the occurrence the GUEST CHOSE rather than
    // the master. The shape is unchanged, so nothing downstream had to move.
  } | null;
}): RenderContext {
  const { order, lineItems, ticketRows, masterDate } = args;
  const eventTitle = order.events.title ?? "your event";
  const eventTimezone =
    (masterDate?.timezone && masterDate.timezone.length > 0
      ? masterDate.timezone
      : order.events.timezone) ?? "UTC";
  const variant: TicketBodyInput["variant"] = order.payment_method === "free"
    ? "ticket_confirmation_free"
    : "ticket_confirmation_paid";

  const bodyInput: TicketBodyInput = {
    variant,
    event: {
      title: eventTitle,
      coverMediaUrl: order.events.cover_media_url ?? null,
      coverMediaType: ((): "image" | "video" | "gif" | null => {
        const t = order.events.cover_media_type;
        if (t === "image" || t === "video" || t === "gif") return t;
        return null;
      })(),
      locationText: order.events.location_text ?? null,
      isOnline: Boolean(order.events.is_online),
      startAt: masterDate?.start_at ?? null,
      // ORCH-0877 — carry the real master end_at into the email body so the
      // date line renders as a true range and the ICS attachment gets a
      // real DTEND (closes the 3-hour fabrication Constitution #9 violation).
      endAt: masterDate?.end_at ?? null,
      timezone: eventTimezone,
    },
    brand: {
      name: order.events.brands.name ?? "your host",
      profilePhotoUrl: order.events.brands.profile_photo_url ?? null,
    },
    order: {
      id: order.id,
      shortId: shortId(order.id),
      totalCents: Number(order.total_cents ?? 0),
      taxAmountCents: Number(order.tax_amount_cents ?? 0),
      taxBreakdown: Array.isArray(order.tax_breakdown)
        ? order.tax_breakdown
        : null,
      currency: order.currency ?? "GBP",
      buyerName: order.buyer_name,
      lineItems: (lineItems ?? []).map((li) => ({
        ticketName: li.ticket_types?.name ?? "Ticket",
        quantity: Number(li.quantity ?? 0),
        unitPriceCents: Number(li.unit_price_cents ?? 0),
        totalCents: Number(li.total_cents ?? 0),
      })),
      tickets: (ticketRows ?? []).map((t) => ({
        ticketId: t.id,
        ticketName: t.ticket_types?.name ?? "Ticket",
      })),
    },
  };

  const ticketsForPdf = (ticketRows ?? []).map((t) => ({
    ticketId: t.id,
    ticketName: t.ticket_types?.name ?? "Ticket",
    qrPayload: t.qr_code,
  }));

  return { bodyInput, ticketsForPdf };
}

// ORCH-0869 (Tr3) Stage 1b helpers — kind-routed installment email senders.
// Shared shape: fetch order + event + brand once, render the appropriate
// template, send via Resend with NO attachments + NO calendar link (dunning
// and paid-in-full are notification emails, not ticket emails).

interface InstallmentEmailOrderJoin {
  id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  total_cents: number;
  currency: string;
  events: {
    title: string | null;
    brand_id: string;
    brands: {
      name: string | null;
      contact_email: string | null;
    };
  };
}

async function fetchInstallmentEmailContext(
  supabase: ReturnType<typeof serviceClient>,
  orderId: string,
): Promise<InstallmentEmailOrderJoin | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      id,
      buyer_name,
      buyer_email,
      buyer_user_id,
      total_cents,
      tax_amount_cents,
      tax_breakdown,
      currency,
      events!inner (
        title,
        brand_id,
        brands!inner ( name, contact_email )
      )
    `)
    .eq("id", orderId)
    .maybeSingle();
  if (error || data === null) return null;
  return data as unknown as InstallmentEmailOrderJoin;
}

async function handleInstallmentDunning(
  supabase: ReturnType<typeof serviceClient>,
  orderId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const installmentId = typeof body.installmentId === "string"
    ? body.installmentId
    : "";
  if (installmentId === "") {
    return jsonResponse({ error: "installment_id_required" }, 400);
  }
  const ordinal = Number(body.installmentOrdinal ?? 0);
  const failureReason = typeof body.failureReason === "string"
    ? body.failureReason
    : "payment_failed_no_detail";

  const order = await fetchInstallmentEmailContext(supabase, orderId);
  if (order === null) return jsonResponse({ error: "order_not_found" }, 404);
  if (order.buyer_email === null || order.buyer_email === "") {
    // Buyers without an email on file silently no-op rather than error —
    // the order still exists, the dispatcher should not 500 the webhook
    // handler upstream.
    return jsonResponse({
      kind: "installment_dunning",
      skipped: "no_buyer_email",
    });
  }

  const { data: installment, error: installmentError } = await supabase
    .from("order_installments")
    .select("id, ordinal, amount_cents, currency, retry_count, next_retry_at")
    .eq("id", installmentId)
    .maybeSingle();
  if (installmentError !== null || installment === null) {
    return jsonResponse({ error: "installment_not_found" }, 404);
  }
  const inst = installment as {
    id: string;
    ordinal: number;
    amount_cents: number;
    currency: string;
    retry_count: number;
    next_retry_at: string | null;
  };

  const rendered = renderInstallmentDunningEmail({
    recipient: { name: order.buyer_name, email: order.buyer_email },
    trip: { title: order.events.title ?? "your trip" },
    installment: {
      ordinal: Number(inst.ordinal ?? ordinal),
      amountCents: Number(inst.amount_cents),
      currency: inst.currency,
      failureReason,
      retryCount: Number(inst.retry_count ?? 0),
      nextRetryAt: inst.next_retry_at,
    },
    brand: {
      name: order.events.brands.name ?? "your host",
      contactEmail: order.events.brands.contact_email,
    },
    order: { shortId: shortId(order.id) },
  });

  assertNotResendSandbox(rendered.from);
  const sent = await sendResendEmailWithAttachment({
    from: formatSenderHeader(rendered.from),
    to: order.buyer_email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments: [],
  });

  return jsonResponse({
    kind: "installment_dunning",
    orderId,
    installmentId,
    providerMessageId: sent.id,
  });
}

async function handleInstallmentPaidInFull(
  supabase: ReturnType<typeof serviceClient>,
  orderId: string,
): Promise<Response> {
  const order = await fetchInstallmentEmailContext(supabase, orderId);
  if (order === null) return jsonResponse({ error: "order_not_found" }, 404);
  if (order.buyer_email === null || order.buyer_email === "") {
    return jsonResponse({
      kind: "installment_plan_paid_in_full",
      skipped: "no_buyer_email",
    });
  }

  const rendered = renderInstallmentPlanPaidInFullEmail({
    recipient: { name: order.buyer_name, email: order.buyer_email },
    trip: { title: order.events.title ?? "your trip" },
    brand: {
      name: order.events.brands.name ?? "your host",
      contactEmail: order.events.brands.contact_email,
    },
    order: {
      shortId: shortId(order.id),
      totalCents: Number(order.total_cents ?? 0),
      currency: order.currency ?? "GBP",
    },
  });

  assertNotResendSandbox(rendered.from);
  const sent = await sendResendEmailWithAttachment({
    from: formatSenderHeader(rendered.from),
    to: order.buyer_email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments: [],
  });

  return jsonResponse({
    kind: "installment_plan_paid_in_full",
    orderId,
    providerMessageId: sent.id,
  });
}

// #1541 §4.7 — EXPORTED so the runtime companion test can drive a real Request
// through the real handler and assert on CAPTURED provider HTTP rather than on
// source text. `serve(handler)` below is the same call this module always made.
export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (req.headers.get("authorization") !== `Bearer ${serviceKey}`) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const supabase = serviceClient();
  const notificationId = typeof body.notificationId === "string"
    ? body.notificationId
    : "";
  if (notificationId) {
    return await handleWaitlistNotificationDispatch(supabase, notificationId);
  }

  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  if (!orderId) return jsonResponse({ error: "order_id_required" }, 400);

  // ORCH-1188 FIX 4a: render-only mode. Historical reconciliation
  // (reconcile-stuck-checkouts) needs the ticket PDF rendered + stored on
  // `orders.ticket_pdf_path` so the consumer ticket renders — but MUST NOT
  // email/SMS the buyer (these are old/test sessions; no notification spam).
  // When `skipNotify` is true we render + upload the PDF, then return BEFORE
  // the notification send loop. The webhook path passes no flag → unchanged.
  const skipNotify = body.skipNotify === true;

  // ORCH-0869 (Tr3) Stage 1b: kind-based routing. When `kind` is one of the
  // Tr3 installment kinds, bypass the legacy ticket_order_notifications
  // polling loop and render+send directly. Non-installment kinds (the legacy
  // ticket-confirmation flow used by every existing caller) fall through to
  // the existing implementation unchanged.
  const kind = typeof body.kind === "string" ? body.kind : null;
  if (kind === "installment_dunning") {
    return await handleInstallmentDunning(supabase, orderId, body);
  }
  if (kind === "installment_plan_paid_in_full") {
    return await handleInstallmentPaidInFull(supabase, orderId);
  }
  if (kind !== null) {
    // Defensive: unknown kind. Surface as 400 so the caller's logs make the
    // misroute obvious — silent fall-through to legacy would render a ticket
    // confirmation email for a webhook that meant something else entirely.
    return jsonResponse(
      { error: "unknown_kind", kind },
      400,
    );
  }

  const { data: orderRaw, error: orderError } = await supabase
    .from("orders")
    .select(`
      id,
      event_id,
      buyer_name,
      buyer_email,
      total_cents,
      currency,
      payment_method,
      payment_status,
      confirmed_at,
      notification_status,
      event_date_id,
      events!inner (
        id,
        title,
        cover_media_url,
        cover_media_type,
        location_text,
        is_online,
        timezone,
        brand_id,
        event_type,
        theme,
        brands!inner ( id, name, profile_photo_url, contact_email )
      )
    `)
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !orderRaw) {
    return jsonResponse(
      { error: "order_not_found", detail: orderError?.message },
      404,
    );
  }
  const order = orderRaw as unknown as OrderJoin;

  const { data: lineItems } = await supabase
    .from("order_line_items")
    .select(
      "quantity, unit_price_cents, total_cents, ticket_types!inner ( name )",
    )
    .eq("order_id", orderId)
    .order("id", { ascending: true });

  const { data: ticketRows } = await supabase
    .from("tickets")
    .select("id, qr_code, ticket_types!inner ( name )")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  // ═══════════════════════════════════════════════════════════════════════
  // issue #2162 — THE CONFIRMATION MUST NAME THE DAY THE GUEST CHOSE.
  // ═══════════════════════════════════════════════════════════════════════
  // Live defect, since #2135 shipped day selection: this dispatch read the
  // MASTER occurrence (`is_master = true`, the earliest day), so every guest
  // who picked day 2 of a multi-day exhibition was emailed day 1. The pass and
  // the roster were right; only the message the guest actually reads was wrong,
  // which is the worst place for it to be wrong.
  //
  // THE CONTRACT (SPEC §4.6):
  //   * If this order's tickets carry days (issue #2160's `ticket_event_dates`),
  //     the date line names them — the earliest for `startAt`, the latest for
  //     `endAt`, so a two-day reservation reads as the range it is.
  //   * Else if the order carries `event_date_id` (a #2135 single-select
  //     reservation, or a #2160 order's anchor), that occurrence is named.
  //   * Else — legacy, single-date, no selection — behaviour is VERBATIM
  //     master. A NULL here is legitimate, not an error, and is asserted
  //     explicitly rather than assumed.
  const { data: masterDate } = await supabase
    .from("event_dates")
    .select("start_at, end_at, timezone, is_master")
    .eq("event_id", order.events.id)
    .eq("is_master", true)
    .maybeSingle();

  const chosenDate = await resolveChosenOccurrence(
    supabase,
    orderId,
    order.events.id,
    (order as unknown as { event_date_id?: string | null }).event_date_id ??
      null,
    "[ticket-confirmation-dispatch]",
  );

  const context = buildRenderContext({
    order,
    lineItems: (lineItems ?? []) as unknown as Array<{
      quantity: number | null;
      unit_price_cents: number | null;
      total_cents: number | null;
      ticket_types: { name: string | null };
    }>,
    ticketRows: (ticketRows ?? []) as unknown as Array<{
      id: string;
      qr_code: string;
      ticket_types: { name: string | null };
    }>,
    // issue #2162 — the CHOSEN day wins; master is the documented fallback and
    // nothing else. `buildRenderContext` is unchanged: it still receives one
    // occurrence-shaped object, it is simply the right one now.
    masterDate: (chosenDate ?? masterDate ?? null) as
      | {
        start_at: string | null;
        // ORCH-0877 — end_at carried through to email body (already selected
        // at line 541; type narrowed here so buildRenderContext compiles).
        end_at: string | null;
        timezone: string | null;
      }
      | null,
  });

  const ticketCount = context.bodyInput.order.tickets.length;
  const eventTitle = context.bodyInput.event.title;
  // ORCH-0859 (Tr2): trip-shaped SMS copy when event_type='trip'. Event copy
  // is byte-equivalent for event_type='event' (the default branch).
  const isTrip = order.events.event_type === "trip";
  // ORCH-1195 FIX 4 — experiences get an itinerary-shaped email (the stops).
  const isExperience = order.events.event_type === "experience";
  const smsBody = isTrip
    ? `Mingla: you're booked on ${eventTitle}. Order ${shortId(order.id)}.`
    : isExperience
    ? `Mingla: you're reserved for ${eventTitle}. Order ${shortId(order.id)}.`
    : `Mingla: your ${ticketCount} ticket${
      ticketCount === 1 ? "" : "s"
    } for ${eventTitle} are confirmed. Order ${shortId(order.id)}.`;

  // Render email + PDF once per dispatch; reused across email ledger rows.
  let renderedEmail: ReturnType<typeof renderTransactionalEmail> | null = null;
  let renderedPdf: Awaited<ReturnType<typeof buildTicketPdf>> | null = null;
  let renderError: { code: string; message: string } | null = null;

  try {
    // ORCH-0859 (Tr2): branch by event_type. Trip orders use trip-shaped
    // template; event orders use the existing renderTransactionalEmail
    // (byte-equivalent for event_type='event' — the new branch is fully
    // gated on isTrip).
    if (isTrip) {
      // Fetch trip-specific sidecar data for the email body.
      const [tripDaysResp, tripInclusionsResp] = await Promise.all([
        supabase
          .from("trip_days")
          .select("ordinal, title")
          .eq("event_id", order.events.id)
          .order("ordinal"),
        supabase
          .from("trip_inclusions")
          .select("kind, item, ordinal")
          .eq("event_id", order.events.id)
          .order("kind")
          .order("ordinal"),
      ]);
      const tripDays = (tripDaysResp.data ?? []) as Array<{
        ordinal: number;
        title: string;
      }>;
      const tripInclusions = (tripInclusionsResp.data ?? []) as Array<{
        kind: "included" | "excluded";
        item: string;
      }>;
      const themeBT = ((order.events.theme as Record<string, unknown> | null)
        ?.business_trip as
          | Record<string, unknown>
          | undefined) ?? {};
      renderedEmail = renderTripConfirmationEmail({
        recipient: {
          name: order.buyer_name,
          email: order.buyer_email ?? "",
        },
        trip: {
          title: context.bodyInput.event.title,
          startAtIso: typeof themeBT.startAt === "string"
            ? themeBT.startAt
            : null,
          endAtIso: typeof themeBT.endAt === "string" ? themeBT.endAt : null,
          destinationText: typeof themeBT.destinationLocationText === "string"
            ? themeBT.destinationLocationText
            : null,
          timezone: context.bodyInput.event.timezone,
          days: tripDays,
          inclusions: tripInclusions,
        },
        brand: {
          name: context.bodyInput.brand.name,
          profilePhotoUrl: context.bodyInput.brand.profilePhotoUrl,
        },
        order: {
          id: context.bodyInput.order.id,
          shortId: context.bodyInput.order.shortId,
          totalCents: order.total_cents,
          currency: order.currency,
        },
      });
    } else if (isExperience) {
      // ORCH-1195 FIX 4 — experiences emailed via the generic event template
      // before this, so the itinerary/stops were missing. Fetch the stops and
      // render the experience-shaped email (graceful no-itinerary fallback when
      // an experience has no authored stops — e.g. an Ari no-stops experience).
      const stopsResp = await supabase
        .from("experience_stops")
        .select("stop_order, place_name, address, start_time, price_cents")
        .eq("event_id", order.events.id)
        .order("stop_order");
      const expStops = (stopsResp.data ?? []) as Array<{
        stop_order: number;
        place_name: string | null;
        address: string | null;
        start_time: string | null;
        price_cents: number | null;
      }>;
      renderedEmail = renderExperienceConfirmationEmail({
        recipient: {
          name: order.buyer_name,
          email: order.buyer_email ?? "",
        },
        experience: {
          title: context.bodyInput.event.title,
          dateIso: context.bodyInput.event.startAt,
          timezone: context.bodyInput.event.timezone,
          venueText: context.bodyInput.event.locationText,
          stops: expStops.map((s) => ({
            stopOrder: s.stop_order,
            placeName: s.place_name,
            address: s.address,
            startTime: s.start_time,
            priceCents: s.price_cents,
          })),
        },
        brand: {
          name: context.bodyInput.brand.name,
          profilePhotoUrl: context.bodyInput.brand.profilePhotoUrl,
        },
        order: {
          id: context.bodyInput.order.id,
          shortId: context.bodyInput.order.shortId,
          totalCents: order.total_cents,
          currency: order.currency,
        },
      });
    } else {
      renderedEmail = renderTransactionalEmail({
        variant: context.bodyInput.variant,
        recipient: {
          name: order.buyer_name,
          email: order.buyer_email ?? "",
        },
        body: context.bodyInput,
      });
    }
    assertNotResendSandbox(renderedEmail.from);
    renderedPdf = await buildTicketPdf({
      event: {
        title: context.bodyInput.event.title,
        startAtIso: context.bodyInput.event.startAt,
        // ORCH-0877 — propagate master end_at into the PDF date line.
        endAtIso: context.bodyInput.event.endAt,
        timezone: context.bodyInput.event.timezone,
        locationText: context.bodyInput.event.locationText,
        brandName: context.bodyInput.brand.name,
      },
      order: { shortId: context.bodyInput.order.shortId },
      tickets: context.ticketsForPdf,
      attendeeNameHint: order.buyer_name,
      logoUrl: MINGLA_LOGO_URL ?? undefined,
    });
    console.log(
      `[ticket-confirmation-dispatch] order=${context.bodyInput.order.shortId} html_bytes=${renderedEmail.html.length} pdf_bytes=${renderedPdf.byteLength}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    renderError = {
      code: message.startsWith("ticket_pdf_")
        ? message
        : `email_render_input_incomplete:${message}`,
      message,
    };
  }

  // ORCH-0842: persist the rendered PDF to the private `ticket-pdfs` bucket
  // so the consumer app can fetch it on demand via `ticket-pdf-fetch`.
  // Failure is logged + swallowed; the email is the customer-facing artifact
  // and the fetch endpoint can lazy-backfill on first open. `upsert: true`
  // makes this safe under Resend retry (same bytes, same path).
  if (renderedPdf) {
    try {
      const pdfBytes = Uint8Array.from(
        atob(renderedPdf.contentBase64),
        (c) => c.charCodeAt(0),
      );
      // issue #2347 — versioned path. This renderer has been day-correct
      // since #2162; the version exists so `ticket-pdf-fetch` can tell a
      // day-aware object from an is_master-era one, which it could not when
      // both writers used the same name.
      const pdfPath = ticketPdfStoragePath(order.id);
      const { error: uploadError } = await supabase.storage
        .from("ticket-pdfs")
        .upload(pdfPath, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (uploadError) {
        console.warn(
          `[ticket-confirmation-dispatch] storage upload failed for order=${order.id}: ${uploadError.message}`,
        );
      } else {
        const { error: updateError } = await supabase
          .from("orders")
          .update({
            ticket_pdf_path: pdfPath,
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);
        if (updateError) {
          console.warn(
            `[ticket-confirmation-dispatch] orders.ticket_pdf_path update failed for order=${order.id}: ${updateError.message}`,
          );
        }
      }
    } catch (uploadErr) {
      const message = uploadErr instanceof Error
        ? uploadErr.message
        : String(uploadErr);
      console.warn(
        `[ticket-confirmation-dispatch] storage upload threw for order=${order.id}: ${message}`,
      );
    }
  }

  // ORCH-1188 FIX 4a: render-only short-circuit. The PDF is now rendered +
  // uploaded + persisted to orders.ticket_pdf_path above; in skipNotify mode we
  // return here WITHOUT entering the email/SMS send loop. Surface renderError so
  // the reconcile caller can see if the PDF failed to render (e.g. trip/exp
  // shape) rather than silently leaving ticket_pdf_path NULL.
  if (skipNotify) {
    return jsonResponse({
      orderId,
      skipNotify: true,
      pdfStored: Boolean(renderedPdf) && !renderError,
      renderError,
    });
  }

  // ORCH-0788: SELECT payload so we can route by template_key per row.
  const { data: notifications, error: notificationError } = await supabase
    .from("ticket_order_notifications")
    .select("id, channel, recipient, status, attempt_count, payload")
    .eq("order_id", orderId)
    // #2218 — `deferred` rows are IN SCOPE for a dispatch pass. The sweeper
    // only calls this function once `next_attempt_at` has passed, so a row that
    // reaches here is a held message whose window has opened. Omitting the
    // status here would leave the sweeper waking up for an order and then
    // selecting nothing — a retry loop that can never retry.
    .in("status", ["pending", "failed_retryable", "deferred"]);
  if (notificationError) {
    return jsonResponse(
      {
        error: "notification_lookup_failed",
        detail: notificationError.message,
      },
      500,
    );
  }

  // ORCH-0788: BuyerContext shared by refund/cancel adapters. Built once
  // from the order join; cheap to materialise even on rows that don't use it.
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]: extended with
  // organizerEmail (from existing brands.contact_email join) + cardLast4
  // (null in v1 — we don't store the card last4 locally; Tr4 adapters
  // gracefully fall back to "your original payment method" when null).
  const buyerContext: BuyerContext = {
    buyerName: order.buyer_name,
    eventTitle: context.bodyInput.event.title,
    brandName: context.bodyInput.brand.name,
    orderShortId: context.bodyInput.order.shortId,
    organizerEmail: order.events?.brands?.contact_email ?? null,
    cardLast4: null,
  };

  const outcomes: Array<
    { channel: string; status: string; templateKey: string }
  > = [];
  for (const notification of notifications ?? []) {
    // ORCH-0788 I-PROPOSED-BA: COALESCE template_key with legacy default.
    const rawPayload = (notification.payload ?? {}) as Record<string, unknown>;
    const templateKey = typeof rawPayload.template_key === "string"
      ? rawPayload.template_key
      : "buyer_ticket_confirmation";

    await supabase
      .from("ticket_order_notifications")
      .update({
        status: "sending",
        attempt_count: Number(notification.attempt_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", notification.id);

    try {
      if (templateKey === "buyer_ticket_confirmation") {
        // #1541 — the outcome is no longer hardcoded "sent": an SMS row can now
        // legitimately come back "skipped" when its market is dark, and that is
        // NOT a failure and NOT a send.
        let outcomeStatus = "sent";
        // Legacy path — preserved exactly as ORCH-0785 baseline.
        if (notification.channel === "email") {
          if (!renderedEmail || !renderedPdf) {
            // Render failure surfaces as retryable. Either render input is
            // transiently incomplete (missing event/brand row) or the PDF
            // library hit a recoverable issue.
            throw new ProviderSendError({
              retryable: true,
              detail: renderError?.code ?? "email_render_unknown_failure",
              status: 0,
            });
          }
          const attachments: Array<{ filename: string; content: string }> = [{
            filename: renderedPdf.filename,
            content: renderedPdf.contentBase64,
          }];
          const calendarLinks = buildCalendarLinks({
            title: context.bodyInput.event.title,
            startAtIso: context.bodyInput.event.startAt,
            // ORCH-0877 — pass real master end_at instead of fabricating a
            // 3h default. Closes the latent Constitution #9 violation.
            endAtIso: context.bodyInput.event.endAt,
            locationText: context.bodyInput.event.locationText,
            isOnline: context.bodyInput.event.isOnline,
            description:
              `${context.bodyInput.event.title} — hosted by ${context.bodyInput.brand.name}. Order #${context.bodyInput.order.shortId}.`,
          });
          if (calendarLinks) {
            attachments.push({
              filename: calendarLinks.icsFilename,
              content: icsToBase64(calendarLinks.icsContent),
            });
          }
          let attendanceWebClaimUrl: string | null = null;
          if (
            shouldIssueOrderAttendanceClaimForNotification({
              templateKey,
              channel: notification.channel,
              buyerUserId: order.buyer_user_id,
              paymentStatus: order.payment_status,
            })
          ) {
            const pepperRing = resolveAttendanceClaimPepperRing();
            if (!pepperRing) {
              throw new Error("attendance_claim_pepper_missing");
            }
            const minted = mintOrderClaimToken();
            const digest = await hmacOrderClaimDigest(
              minted.raw,
              pepperRing.current.secret,
            );
            const { data: issuance, error: issuanceError } = await supabase.rpc(
              "issue_order_attendance_claim_proof_v2",
              {
                p_order_id: order.id,
                p_event_id: order.event_id,
                p_digest: bytesToPostgresHex(digest),
                p_generation: pepperRing.current.generation,
                // A replay may finish the existing notification lease but may
                // never rotate a proof that could already be in the buyer's
                // possession.
                p_allow_retry_rotation: false,
              },
            );
            if (issuanceError) throw new Error("attendance_claim_issue_failed");
            if (
              typeof issuance === "object" && issuance !== null &&
              "result" in issuance && issuance.result === "issued"
            ) {
              attendanceWebClaimUrl = attendanceClaimUrls({
                kind: "order",
                eventId: order.event_id,
                sourceId: order.id,
                token: minted.token,
              }).webClaimUrl;
            }
          }
          const sent = await sendResendEmailWithAttachment({
            from: formatSenderHeader(renderedEmail.from),
            to: notification.recipient,
            subject: renderedEmail.subject,
            html: attendanceWebClaimUrl
              ? `${renderedEmail.html}${
                renderAttendanceClaimAvailableEmail({
                  eventTitle: context.bodyInput.event.title,
                  claimUrl: attendanceWebClaimUrl,
                }).html
              }`
              : renderedEmail.html,
            text: attendanceWebClaimUrl
              ? `${renderedEmail.text}\n\n${
                renderAttendanceClaimAvailableEmail({
                  eventTitle: context.bodyInput.event.title,
                  claimUrl: attendanceWebClaimUrl,
                }).text
              }`
              : renderedEmail.text,
            attachments,
          });
          await supabase.from("ticket_order_notifications").update({
            status: "sent",
            provider: "resend",
            provider_message_id: sent.id,
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", notification.id);
        } else {
          // #1541 §4.0 — the ONE call shape (see the waitlist branch for why
          // every optional field is deliberately omitted). The buyer's TICKET
          // rides the sibling EMAIL row — PDF + QR + .ics — which is
          // structurally guaranteed by ticket_checkout_sessions.buyer_email
          // being NOT NULL. This SMS is text-only: no link, no QR, no claim.
          // Gating it cannot cost a paying customer their ticket.
          const result = await smsAdapter.send({
            to: notification.recipient,
            brandName: context.bodyInput.brand.name,
            message: smsBody,
          });
          // #2218 — the buyer confirmation is the exact path that produced the
          // false `sent`. Inside the Nigerian operator embargo it is held to
          // the next 08:00 WAT instead of being handed to a route the network
          // will not carry. The sibling EMAIL row is unaffected and still goes
          // out immediately, so the ticket itself is never delayed.
          if (result.status === "deferred") {
            throw deferredSmsError(result);
          }
          if (result.status === "failed") {
            // Preserve today's retry/backoff semantics EXACTLY — a real
            // provider failure is still a retryable ProviderSendError handled
            // by the catch below.
            throw new ProviderSendError({
              retryable: true,
              detail: result.error ?? "sms_send_failed",
              status: 0,
            });
          }
          const nowIso = new Date().toISOString();
          if (result.status === "skipped") {
            // An honest skip, with ZERO provider HTTP. `sent_at` is left
            // untouched — nothing was sent.
            await supabase.from("ticket_order_notifications").update({
              status: "skipped",
              provider: providerForLedger(notification.recipient),
              provider_message_id: null,
              last_error: result.error ?? "provider_kill_switch_off",
              updated_at: nowIso,
            }).eq("id", notification.id);
            outcomeStatus = "skipped";
          } else {
            await supabase.from("ticket_order_notifications").update({
              status: "sent",
              provider: providerForLedger(notification.recipient),
              provider_message_id: result.providerMessageId,
              sent_at: nowIso,
              updated_at: nowIso,
            }).eq("id", notification.id);
          }
        }
        outcomes.push({
          channel: notification.channel,
          status: outcomeStatus,
          templateKey,
        });
      } else if (templateKey === "buyer_refund_issued") {
        // ORCH-0788 §5: refund email via generic_notification adapter.
        // Email-only per SPEC §10.1 (CF-1 SMS deferred).
        if (notification.channel !== "email") {
          await supabase.from("ticket_order_notifications").update({
            status: "skipped",
            last_error: "channel_not_supported_for_template",
            updated_at: new Date().toISOString(),
          }).eq("id", notification.id);
          outcomes.push({
            channel: notification.channel,
            status: "skipped",
            templateKey,
          });
          continue;
        }
        const refundBody = refundIssuedToGenericBody(
          rawPayload as unknown as RefundIssuedPayloadShape,
          buyerContext,
        );
        const refundEmail = renderTransactionalEmail({
          variant: "generic_notification",
          recipient: { name: order.buyer_name, email: order.buyer_email ?? "" },
          body: refundBody,
          sender: EMAIL_SENDERS.tickets, // ORCH-0788 §5.2 — same sender as purchase
        });
        assertNotResendSandbox(refundEmail.from);
        const sent = await sendResendEmailWithAttachment({
          from: formatSenderHeader(refundEmail.from),
          to: notification.recipient,
          subject: refundEmail.subject,
          html: refundEmail.html,
          text: refundEmail.text,
          attachments: [], // ORCH-0788 §5.3 — no PDF, no calendar
        });
        await supabase.from("ticket_order_notifications").update({
          status: "sent",
          provider: "resend",
          provider_message_id: sent.id,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
        outcomes.push({
          channel: notification.channel,
          status: "sent",
          templateKey,
        });
      } else if (templateKey === "buyer_order_cancelled") {
        // ORCH-0788 §5: cancel email via generic_notification adapter.
        if (notification.channel !== "email") {
          await supabase.from("ticket_order_notifications").update({
            status: "skipped",
            last_error: "channel_not_supported_for_template",
            updated_at: new Date().toISOString(),
          }).eq("id", notification.id);
          outcomes.push({
            channel: notification.channel,
            status: "skipped",
            templateKey,
          });
          continue;
        }
        const cancelBody = orderCancelledToGenericBody(
          rawPayload as unknown as OrderCancelledPayloadShape,
          buyerContext,
        );
        const cancelEmail = renderTransactionalEmail({
          variant: "generic_notification",
          recipient: { name: order.buyer_name, email: order.buyer_email ?? "" },
          body: cancelBody,
          sender: EMAIL_SENDERS.tickets,
        });
        assertNotResendSandbox(cancelEmail.from);
        const sent = await sendResendEmailWithAttachment({
          from: formatSenderHeader(cancelEmail.from),
          to: notification.recipient,
          subject: cancelEmail.subject,
          html: cancelEmail.html,
          text: cancelEmail.text,
          attachments: [],
        });
        await supabase.from("ticket_order_notifications").update({
          status: "sent",
          provider: "resend",
          provider_message_id: sent.id,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
        outcomes.push({
          channel: notification.channel,
          status: "sent",
          templateKey,
        });
      } else if (templateKey === "buyer_intake_form_re_answer_required") {
        // ORCH-0880 [Tr5 Traveler Intake Forms] — re-answer notification via
        // generic_notification adapter. Email-only in v1 (push deferred to a
        // follow-up once push token plumbing for anon buyers exists).
        // Triggered by the `tg_trip_intake_schemas_re_answer_dispatch` trigger
        // after planner edits a published-trip tier's schema in a way that
        // changes question shape; the trigger INSERTs a ticket_order_
        // notifications row per affected order which this dispatcher then
        // delivers via the standard ORCH-0788 retry-cron loop.
        if (notification.channel !== "email") {
          await supabase.from("ticket_order_notifications").update({
            status: "skipped",
            last_error: "channel_not_supported_for_template",
            updated_at: new Date().toISOString(),
          }).eq("id", notification.id);
          outcomes.push({
            channel: notification.channel,
            status: "skipped",
            templateKey,
          });
          continue;
        }
        const reAnswerBody = intakeFormReAnswerRequiredToGenericBody(
          rawPayload as unknown as IntakeFormReAnswerRequiredPayloadShape,
          buyerContext,
        );
        const reAnswerEmail = renderTransactionalEmail({
          variant: "generic_notification",
          recipient: { name: order.buyer_name, email: order.buyer_email ?? "" },
          body: reAnswerBody,
          sender: EMAIL_SENDERS.tickets,
        });
        assertNotResendSandbox(reAnswerEmail.from);
        const sent = await sendResendEmailWithAttachment({
          from: formatSenderHeader(reAnswerEmail.from),
          to: notification.recipient,
          subject: reAnswerEmail.subject,
          html: reAnswerEmail.html,
          text: reAnswerEmail.text,
          attachments: [],
        });
        await supabase.from("ticket_order_notifications").update({
          status: "sent",
          provider: "resend",
          provider_message_id: sent.id,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
        outcomes.push({
          channel: notification.channel,
          status: "sent",
          templateKey,
        });
      } else if (templateKey === "waitlist_spot_open") {
        const status = await deliverWaitlistSpotOpenNotification(
          supabase,
          notification as unknown as NotificationRow,
        );
        outcomes.push({ channel: notification.channel, status, templateKey });
      } else {
        // ORCH-0788 I-PROPOSED-BA defensive: unknown template_key flips to
        // failed_terminal immediately so the row surfaces visibly via the
        // brand-team SELECT RLS policy instead of silently rendering the
        // wrong template. No retry attempts consumed.
        await supabase.from("ticket_order_notifications").update({
          status: "failed_terminal",
          last_error: `unknown_template_key:${templateKey}`,
          updated_at: new Date().toISOString(),
        }).eq("id", notification.id);
        outcomes.push({
          channel: notification.channel,
          status: "failed_terminal",
          templateKey,
        });
      }
    } catch (err) {
      // =====================================================================
      // #2218 — A TIMED REFUSAL IS NOT AN ATTEMPT, AND MUST NOT SPEND ONE.
      // =====================================================================
      // A deferral takes its own arm BEFORE the attempt ladder is touched:
      // `attempt_count` is left where it was, so a Nigerian confirmation held
      // three times across one night does not arrive at `failed_terminal` at
      // 06:14 WAT having never once been offered to the network. The row
      // records WHEN it becomes attemptable; notification-retry-sweeper honours
      // that instant instead of its own ~6-minute ladder.
      const deferredUntil = err instanceof ProviderSendError
        ? err.nextAttemptAt
        : null;
      if (deferredUntil !== null) {
        const { error: deferErr } = await supabase
          .from("ticket_order_notifications").update({
            status: "deferred",
            last_error: err instanceof Error ? err.message : String(err),
            next_attempt_at: deferredUntil,
            // The claim above optimistically stamped `attempt_count + 1`. Give
            // it back: no attempt was made. Left in place, twelve hours of
            // embargo would burn the whole ladder without one provider call.
            attempt_count: Number(notification.attempt_count ?? 0),
            updated_at: new Date().toISOString(),
          }).eq("id", notification.id);
        if (deferErr !== null) {
          // DEPLOY-ORDER SAFETY NET, and it is not hypothetical. `deferred` is
          // only a legal status once migration 20270421002218 has widened the
          // CHECK. If the function ships ahead of the migration, PostgREST
          // returns the violation in `error` rather than throwing — the update
          // is a silent no-op and the row is stranded at `sending`, which NO
          // sweeper selects. That is a worse outcome than the bug being fixed:
          // a confirmation lost forever rather than merely late. Fall back to
          // the vocabulary that has always existed, so the message is still
          // owed and still retried.
          console.error(
            JSON.stringify({
              event: "ticket_notification_defer_write_rejected",
              notificationId: notification.id,
              detail: deferErr.message,
              note:
                "#2218 apply migration 20270421002218 before deploying this function",
            }),
          );
          await supabase.from("ticket_order_notifications").update({
            status: "failed_retryable",
            last_error: err instanceof Error ? err.message : String(err),
            attempt_count: Number(notification.attempt_count ?? 0),
            updated_at: new Date().toISOString(),
          }).eq("id", notification.id);
          outcomes.push({
            channel: notification.channel,
            status: "failed_retryable",
            templateKey,
          });
          continue;
        }
        outcomes.push({
          channel: notification.channel,
          status: "deferred",
          templateKey,
        });
        continue;
      }
      const attemptCount = Number(notification.attempt_count ?? 0) + 1;
      const retryable = err instanceof ProviderSendError ? err.retryable : true;
      const terminal = !retryable || attemptCount >= 3;
      await supabase.from("ticket_order_notifications").update({
        status: terminal ? "failed_terminal" : "failed_retryable",
        last_error: err instanceof Error ? err.message : String(err),
        updated_at: new Date().toISOString(),
      }).eq("id", notification.id);
      outcomes.push({
        channel: notification.channel,
        status: terminal ? "failed_terminal" : "failed_retryable",
        templateKey,
      });
    }
  }

  // ===========================================================================
  // #1541 — THE ROLLUP MUST NOT CLAIM A SUCCESS IT DID NOT EARN.
  // (tester T-1541-ROLLUP-VACUITY)
  // ===========================================================================
  // AN INTENTIONAL SKIP IS NOT A FAILURE. A market-gated "skipped" outcome
  // counts as NEITHER `failed` NOR `sent`: an order whose email sent and whose
  // SMS was deliberately gated is `sent`, not `partial`. That part is SC-6 and
  // is unchanged.
  //
  // WHAT WAS WRONG: the else-arm was an UNCONDITIONAL "sent", so an outcome set
  // containing NO successful send still stamped the order a full success —
  // every outcome `skipped`, or zero outcomes at all because the
  // `.in(["pending","failed_retryable"])` query selected nothing. A dispatch
  // pass that sent NOTHING reported success. With Nigeria about to go dark that
  // is not latent: an NG ticket order whose only channel is a skipped SMS would
  // read `sent` on a money path, and it activates the moment the kill switch
  // does.
  //
  // This is the same shape as `?? "US"`, a hardcoded `provider`, and a lookup
  // that passes by matching nothing — a value asserting success it never
  // earned. Constitution rule 3.
  //
  // THE VOCABULARY IS FIXED AND NOT MINE TO EXTEND. `orders_notification_status_check`
  // permits exactly: not_required | pending | sent | partial | failed (verified
  // against production pg_constraint). `skipped` IS NOT A MEMBER — writing it
  // would throw at runtime, so the tester's suggested literal is not available.
  // `not_required` is the existing term for "this leg had nothing to deliver",
  // which is precisely a fully-gated dispatch: nothing sent, nothing failed,
  // nothing pending a retry (the sweeper never selects `skipped`).
  const failed = outcomes.some((row) => row.status.startsWith("failed"));
  const sent = outcomes.some((row) => row.status === "sent");
  // #2218 — a DEFERRED leg is still owed. It is neither a success to report nor
  // a failure to alarm on, and stamping the order `sent` because its email went
  // out would be the same unearned success #1541 removed from the else-arm
  // below. `pending` is the existing term for "work outstanding" in this
  // column's fixed vocabulary (not_required|pending|sent|partial|failed), and
  // it is literally true: the sweeper will come back for this row.
  const deferred = outcomes.some((row) => row.status === "deferred");

  if (outcomes.length === 0) {
    // OBSERVED NOTHING -> ASSERT NOTHING. There were no notification rows to
    // process, so this pass learned nothing about the order and must not
    // overwrite whatever the previous, informed pass concluded. Stamping a
    // verdict derived from an empty set is the vacuity itself.
    console.info(
      JSON.stringify({
        event: "ticket_notification_rollup_skipped",
        orderId,
        reason: "no_notification_rows_selected",
      }),
    );
  } else {
    await supabase.from("orders").update({
      notification_status: failed
        ? (sent ? "partial" : "failed")
        : deferred
        ? "pending"
        : (sent ? "sent" : "not_required"),
      updated_at: new Date().toISOString(),
    }).eq("id", orderId);
  }

  // EMAIL_SENDERS reference kept live so dead-code elimination can't drop it.
  void EMAIL_SENDERS;

  return jsonResponse({ orderId, outcomes });
};

serve(handler);
