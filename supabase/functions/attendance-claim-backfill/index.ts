import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  attendanceClaimUrls,
  bytesToPostgresHex,
  claimJson,
  hmacOrderClaimDigest,
  mintOrderClaimToken,
} from "../_shared/attendanceClaim.ts";
import {
  deriveRsvpRecoveryToken,
  rsvpRecoveryUrl,
  sha256Hex,
} from "../_shared/rsvpPass.ts";
import { EMAIL_SENDERS, formatSenderHeader } from "../_shared/email/index.ts";
import { renderAttendanceClaimAvailableEmail } from "../_shared/email/ticketBody.ts";
import { qrTokenPepper } from "../_shared/ticketCheckout.ts";
import {
  type AttendanceClaimPepperRing,
  resolveAttendanceClaimPepperRing,
} from "../_shared/governedAdSecret.ts";
import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";

type Delivery = {
  id: string;
  lease_id: string;
  kind: "order" | "rsvp";
  source_id: string;
  event_id: string;
  attempt_count: number;
};

const deliveryFrom = (value: unknown): Delivery | null => {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.lease_id === "string" &&
      (row.kind === "order" || row.kind === "rsvp") &&
      typeof row.source_id === "string" && typeof row.event_id === "string" &&
      typeof row.attempt_count === "number" &&
      Number.isInteger(row.attempt_count)
    ? {
      id: row.id,
      lease_id: row.lease_id,
      kind: row.kind,
      source_id: row.source_id,
      event_id: row.event_id,
      attempt_count: row.attempt_count,
    }
    : null;
};

type EmailDeliveryResult = "sent" | "retryable" | "terminal" | "ambiguous";

type RecoveryDelivery = {
  order_id: string;
  event_id: string;
  delivery_id: string;
  lease_id: string;
  channel: "email" | "sms";
  attempt_count: number;
  buyer_email: string | null;
  buyer_phone_e164: string | null;
  event_title: string;
};

const recoveryDeliveryFrom = (value: unknown): RecoveryDelivery | null => {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  return typeof row.order_id === "string" &&
      typeof row.event_id === "string" &&
      typeof row.delivery_id === "string" &&
      typeof row.lease_id === "string" &&
      (row.channel === "email" || row.channel === "sms") &&
      typeof row.attempt_count === "number" &&
      (typeof row.buyer_email === "string" || row.buyer_email === null) &&
      (typeof row.buyer_phone_e164 === "string" ||
        row.buyer_phone_e164 === null) &&
      typeof row.event_title === "string"
    ? row as RecoveryDelivery
    : null;
};

const recoverySmsMessage = (claimWebUrl: string): string =>
  "Your tickets are confirmed. You can open the app and sign in with your " +
  `checkout email or phone. ${claimWebUrl}`;

const smsOutcome = (
  result: Awaited<ReturnType<typeof smsAdapter.send>>,
): "accepted" | "ambiguous" | "retryable" | "terminal" => {
  if (result.status === "sent") return "accepted";
  if (result.status === "deferred") return "retryable";
  if (
    result.status === "failed" &&
    (result.error === "provider_unavailable" ||
      result.error === "provider_protocol_error")
  ) return "ambiguous";
  return "terminal";
};

export async function runIssue2979RecoveryWhenGoverned<T>(
  pepperRing: AttendanceClaimPepperRing,
  recoveryWork: () => Promise<T>,
): Promise<{ allowed: false } | { allowed: true; value: T }> {
  if (pepperRing.current.generation !== "governed_v2") {
    return { allowed: false };
  }
  return { allowed: true, value: await recoveryWork() };
}

export async function sendEmail(input: {
  to: string;
  eventTitle: string;
  claimUrl: string;
  deliveryKey: string;
  passUrl?: string;
  beforeProviderIo?: () => Promise<void>;
  retryOnNetworkAmbiguity?: boolean;
}): Promise<EmailDeliveryResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return "terminal";
  const rendered = renderAttendanceClaimAvailableEmail({
    eventTitle: input.eventTitle,
    claimUrl: input.claimUrl,
    rsvpPassUrl: input.passUrl,
  });
  const payload = JSON.stringify({
    from: formatSenderHeader(EMAIL_SENDERS.tickets),
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  // no-attachment: attendance-claim recovery notices are secure link-only transactional email; RSVP pass files remain owned by rsvp-notify.
  const request = async (): Promise<Response> => {
    await input.beforeProviderIo?.();
    return await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.deliveryKey,
      },
      body: payload,
    });
  };
  let response: Response;
  try {
    response = await request();
  } catch {
    if (input.retryOnNetworkAmbiguity === false) return "ambiguous";
    // Retry only while the same plaintext and provider idempotency key remain
    // in memory. If both responses are ambiguous, preserve the issued proof and
    // terminalize as provider-ambiguous rather than rotate a possibly delivered link.
    try {
      response = await request();
    } catch {
      return "ambiguous";
    }
    return response.ok ? "sent" : "ambiguous";
  }
  if (response.ok) return "sent";
  return response.status === 429 || response.status >= 500
    ? "retryable"
    : "terminal";
}

export const handler = async (req: Request): Promise<Response> => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const pepperRing = resolveAttendanceClaimPepperRing();
  if (
    !serviceKey || !url || !pepperRing ||
    req.headers.get("authorization") !== `Bearer ${serviceKey}`
  ) {
    return claimJson(401, { ok: false, error: "unauthorized" });
  }
  const body = await req.json().catch(() => ({})) as {
    limit?: unknown;
    mode?: unknown;
  };
  const limit = Math.min(Math.max(Number(body.limit ?? 25), 1), 50);

  if (body.mode === "issue_2979_recovery") {
    const gated = await runIssue2979RecoveryWhenGoverned(
      pepperRing,
      async (): Promise<Response> => {
        const admin = createClient(url, serviceKey, {
          auth: { persistSession: false },
        });
        if (pepperRing.previous === null) {
          const { data: preview, error: previewError } = await admin.rpc(
            "preview_issue_2979_attendance_claim_recovery",
          );
          const legacyProofs =
            typeof preview === "object" && preview !== null &&
              "legacyProofs" in preview &&
              typeof preview.legacyProofs === "number"
              ? preview.legacyProofs
              : null;
          if (previewError || legacyProofs === null || legacyProofs > 0) {
            return claimJson(503, {
              ok: false,
              error: "recovery_temporarily_unavailable",
            });
          }
        }
        const { data: claimed, error: claimError } = await admin.rpc(
          "claim_issue_2979_attendance_claim_recovery_batch",
          { p_limit: limit },
        );
        if (claimError) {
          return claimJson(500, { ok: false, error: "recovery_claim_failed" });
        }
        let deliverySafe = 0;
        let retryable = 0;
        let attentionRequired = 0;
        const markProviderAttempt = async (
          orderId: string,
          deliveryId: string,
          leaseId: string,
        ): Promise<void> => {
          const { data, error } = await admin.rpc(
            "mark_issue_2979_attendance_claim_provider_attempt",
            {
              p_order_id: orderId,
              p_delivery_id: deliveryId,
              p_lease_id: leaseId,
            },
          );
          if (error || data !== true) {
            throw new Error("recovery_provider_boundary_failed");
          }
        };
        for (const raw of Array.isArray(claimed) ? claimed : []) {
          const delivery = recoveryDeliveryFrom(raw);
          if (!delivery) continue;
          const minted = mintOrderClaimToken();
          const digest = await hmacOrderClaimDigest(
            minted.raw,
            pepperRing.current.secret,
          );
          const { data: issuance, error: issuanceError } = await admin.rpc(
            "issue_order_attendance_claim_proof_v2",
            {
              p_order_id: delivery.order_id,
              p_event_id: delivery.event_id,
              p_digest: bytesToPostgresHex(digest),
              p_generation: pepperRing.current.generation,
              p_allow_retry_rotation: true,
            },
          );
          const issueResult =
            typeof issuance === "object" && issuance !== null &&
              "result" in issuance && typeof issuance.result === "string"
              ? issuance.result
              : "invalid";
          if (issuanceError || issueResult !== "issued") {
            await admin.rpc("complete_issue_2979_attendance_claim_delivery", {
              p_order_id: delivery.order_id,
              p_delivery_id: delivery.delivery_id,
              p_lease_id: delivery.lease_id,
              p_outcome: issueResult === "ineligible"
                ? "terminal"
                : "retryable",
              p_error_code: issueResult === "ineligible"
                ? "source_ineligible"
                : "issuance_retryable",
            });
            if (issueResult === "ineligible") attentionRequired += 1;
            else retryable += 1;
            continue;
          }

          const claimWebUrl = attendanceClaimUrls({
            kind: "order",
            eventId: delivery.event_id,
            sourceId: delivery.order_id,
            token: minted.token,
          }).webClaimUrl;
          let outcome: "accepted" | "ambiguous" | "retryable" | "terminal";
          let errorCode: string | null = null;
          if (delivery.channel === "email") {
            if (!delivery.buyer_email) {
              outcome = "terminal";
              errorCode = "email_unavailable";
            } else {
              const result = await sendEmail({
                to: delivery.buyer_email,
                eventTitle: delivery.event_title,
                claimUrl: claimWebUrl,
                deliveryKey:
                  `issue-2979-${delivery.delivery_id}-${delivery.attempt_count}`,
                retryOnNetworkAmbiguity: false,
                beforeProviderIo: () =>
                  markProviderAttempt(
                    delivery.order_id,
                    delivery.delivery_id,
                    delivery.lease_id,
                  ),
              });
              outcome = result === "sent" ? "accepted" : result;
              errorCode = result === "ambiguous"
                ? "provider_acceptance_ambiguous"
                : result === "retryable"
                ? "email_retryable"
                : result === "terminal"
                ? "email_terminal"
                : null;
            }
          } else if (delivery.buyer_phone_e164) {
            const result = await smsAdapter.send({
              to: delivery.buyer_phone_e164,
              brandName: "Mingla",
              message: recoverySmsMessage(claimWebUrl),
              beforeProviderIo: () =>
                markProviderAttempt(
                  delivery.order_id,
                  delivery.delivery_id,
                  delivery.lease_id,
                ),
            });
            outcome = smsOutcome(result);
            errorCode = outcome === "accepted" ? null : `sms_${outcome}`;
          } else {
            outcome = "terminal";
            errorCode = "sms_unavailable";
          }

          const { data: completed } = await admin.rpc(
            "complete_issue_2979_attendance_claim_delivery",
            {
              p_order_id: delivery.order_id,
              p_delivery_id: delivery.delivery_id,
              p_lease_id: delivery.lease_id,
              p_outcome: outcome,
              p_error_code: errorCode,
            },
          );
          const completion = typeof completed === "object" && completed !== null
            ? completed as Record<string, unknown>
            : {};

          if (
            completion.result === "secondary_required" &&
            typeof completion.deliveryId === "string" &&
            typeof completion.leaseId === "string" &&
            delivery.buyer_phone_e164
          ) {
            const result = await smsAdapter.send({
              to: delivery.buyer_phone_e164,
              brandName: "Mingla",
              message: recoverySmsMessage(claimWebUrl),
              beforeProviderIo: () =>
                markProviderAttempt(
                  delivery.order_id,
                  completion.deliveryId as string,
                  completion.leaseId as string,
                ),
            });
            const secondaryOutcome = smsOutcome(result);
            const { data: secondaryCompleted } = await admin.rpc(
              "complete_issue_2979_attendance_claim_delivery",
              {
                p_order_id: delivery.order_id,
                p_delivery_id: completion.deliveryId,
                p_lease_id: completion.leaseId,
                p_outcome: secondaryOutcome,
                p_error_code: secondaryOutcome === "accepted"
                  ? null
                  : `sms_${secondaryOutcome}`,
              },
            );
            const secondaryResult = typeof secondaryCompleted === "object" &&
                secondaryCompleted !== null && "result" in secondaryCompleted
              ? secondaryCompleted.result
              : null;
            if (secondaryResult === "delivery_safe") deliverySafe += 1;
            else if (secondaryResult === "retryable") retryable += 1;
            else attentionRequired += 1;
          } else if (completion.result === "delivery_safe") deliverySafe += 1;
          else if (completion.result === "retryable") retryable += 1;
          else attentionRequired += 1;
        }
        return claimJson(200, {
          ok: true,
          mode: "issue_2979_recovery",
          claimed: Array.isArray(claimed) ? claimed.length : 0,
          deliverySafe,
          retryable,
          attentionRequired,
        });
      },
    );
    return gated.allowed ? gated.value : claimJson(503, {
      ok: false,
      error: "recovery_temporarily_unavailable",
    });
  }

  const rsvpPepper = qrTokenPepper();
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const orderPepper = pepperRing.current.secret;

  const { data: enqueued, error: enqueueError } = await admin.rpc(
    "enqueue_attendance_claim_deliveries",
    { p_limit: limit },
  );
  if (enqueueError) {
    return claimJson(500, { ok: false, error: "backfill_enqueue_failed" });
  }
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_attendance_delivery_batch",
    { p_limit: limit },
  );
  if (claimError) {
    return claimJson(500, { ok: false, error: "backfill_claim_failed" });
  }

  let sent = 0;
  let retryable = 0;
  let terminal = 0;
  for (const raw of Array.isArray(claimed) ? claimed : []) {
    const delivery = deliveryFrom(raw);
    if (!delivery) continue;
    let finalStatus: "sent" | "failed_retryable" | "failed_terminal" =
      "failed_terminal";
    let safeCode: string | null = "source_ineligible";
    try {
      if (delivery.kind === "order") {
        const { data: order } = await admin.from("orders")
          .select("buyer_email,event_id,events!inner(title)")
          .eq("id", delivery.source_id).eq("event_id", delivery.event_id)
          .is("buyer_user_id", null).maybeSingle();
        const eventValue =
          order && typeof order.events === "object" && order.events !== null
            ? (Array.isArray(order.events) ? order.events[0] : order.events)
            : null;
        const eventTitle = eventValue && typeof eventValue === "object" &&
            "title" in eventValue && typeof eventValue.title === "string"
          ? eventValue.title
          : null;
        if (order && typeof order.buyer_email === "string" && eventTitle) {
          const minted = mintOrderClaimToken();
          const digest = await hmacOrderClaimDigest(minted.raw, orderPepper);
          const { data: issuance } = await admin.rpc(
            "issue_order_attendance_claim_proof_v2",
            {
              p_order_id: delivery.source_id,
              p_event_id: delivery.event_id,
              p_digest: bytesToPostgresHex(digest),
              p_generation: pepperRing.current.generation,
              // The queue lease is the intentional issuance/rotation boundary.
              // Only definite provider rejection reaches another attempt; an
              // ambiguous attempt is terminalized with this proof still valid.
              p_allow_retry_rotation: true,
            },
          );
          const issued = typeof issuance === "object" && issuance !== null &&
            "result" in issuance && issuance.result === "issued";
          if (issued) {
            const claimUrl = attendanceClaimUrls({
              kind: "order",
              eventId: delivery.event_id,
              sourceId: delivery.source_id,
              token: minted.token,
            }).webClaimUrl;
            const emailResult = await sendEmail({
              to: order.buyer_email,
              eventTitle,
              claimUrl,
              deliveryKey:
                `attendance-claim-${delivery.id}-${delivery.attempt_count}`,
            });
            if (emailResult === "sent" || emailResult === "ambiguous") {
              finalStatus = "sent";
              safeCode = emailResult === "ambiguous"
                ? "provider_ambiguous"
                : null;
            } else if (emailResult === "retryable") {
              finalStatus = "failed_retryable";
              safeCode = "email_retryable";
            } else {
              finalStatus = "failed_terminal";
              safeCode = "email_terminal";
            }
          }
        }
      } else {
        const { data: rsvp } = await admin.from("event_rsvps")
          .select(
            "guest_email,event_id,pass_recovery_token_hash,pass_recovery_token_created_at,events!inner(title)",
          )
          .eq("id", delivery.source_id).eq("event_id", delivery.event_id)
          .is("user_id", null).eq("rsvp_status", "going")
          .eq("approval_status", "approved").maybeSingle();
        const eventValue =
          rsvp && typeof rsvp.events === "object" && rsvp.events !== null
            ? (Array.isArray(rsvp.events) ? rsvp.events[0] : rsvp.events)
            : null;
        const eventTitle = eventValue && typeof eventValue === "object" &&
            "title" in eventValue && typeof eventValue.title === "string"
          ? eventValue.title
          : null;
        if (rsvp && typeof rsvp.guest_email === "string" && eventTitle) {
          const createdAt =
            typeof rsvp.pass_recovery_token_created_at === "string"
              ? rsvp.pass_recovery_token_created_at
              : new Date().toISOString();
          const token = await deriveRsvpRecoveryToken({
            entityId: delivery.source_id,
            createdAtIso: createdAt,
            pepper: rsvpPepper,
          });
          const tokenHash = await sha256Hex(token);
          if (
            rsvp.pass_recovery_token_hash !== tokenHash ||
            rsvp.pass_recovery_token_created_at !== createdAt
          ) {
            const { error } = await admin.from("event_rsvps").update({
              pass_recovery_token_hash: tokenHash,
              pass_recovery_token_created_at: createdAt,
            }).eq("id", delivery.source_id).is("user_id", null);
            if (error) throw new Error("rsvp_proof_update_failed");
          }
          const claimUrl = attendanceClaimUrls({
            kind: "rsvp",
            eventId: delivery.event_id,
            sourceId: delivery.source_id,
            token,
          }).webClaimUrl;
          const passUrl = rsvpRecoveryUrl("primary", delivery.source_id, token);
          const emailResult = await sendEmail({
            to: rsvp.guest_email,
            eventTitle,
            claimUrl,
            passUrl,
            deliveryKey:
              `attendance-claim-${delivery.id}-${delivery.attempt_count}`,
          });
          if (emailResult === "sent" || emailResult === "ambiguous") {
            finalStatus = "sent";
            safeCode = emailResult === "ambiguous"
              ? "provider_ambiguous"
              : null;
          } else if (emailResult === "retryable") {
            finalStatus = "failed_retryable";
            safeCode = "email_retryable";
          } else {
            finalStatus = "failed_terminal";
            safeCode = "email_terminal";
          }
        }
      }
    } catch {
      finalStatus = "failed_retryable";
      safeCode = "delivery_retryable";
    }
    await admin.rpc("complete_attendance_claim_delivery", {
      p_delivery_id: delivery.id,
      p_lease_id: delivery.lease_id,
      p_status: finalStatus,
      p_error_code: safeCode,
    });
    if (finalStatus === "sent") sent += 1;
    else if (finalStatus === "failed_retryable") retryable += 1;
    else terminal += 1;
  }
  return claimJson(200, {
    ok: true,
    enqueued: typeof enqueued === "object" && enqueued !== null ? enqueued : {},
    claimed: Array.isArray(claimed) ? claimed.length : 0,
    sent,
    retryable,
    terminal,
  });
};

if (import.meta.main) serve(handler);
