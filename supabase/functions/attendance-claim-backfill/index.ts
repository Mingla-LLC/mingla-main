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
import {
  EMAIL_SENDERS,
  formatSenderHeader,
} from "../_shared/email/index.ts";
import { renderAttendanceClaimAvailableEmail } from "../_shared/email/ticketBody.ts";
import { qrTokenPepper } from "../_shared/ticketCheckout.ts";
import { resolveGovernedAdField } from "../_shared/governedAdSecret.ts";

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
      typeof row.attempt_count === "number" && Number.isInteger(row.attempt_count)
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

async function sendEmail(input: {
  to: string;
  eventTitle: string;
  claimUrl: string;
  deliveryKey: string;
  passUrl?: string;
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
  const request = (): Promise<Response> => fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": input.deliveryKey,
    },
    body: payload,
  });
  let response: Response;
  try {
    response = await request();
  } catch {
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

serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const orderPepper = resolveGovernedAdField(
    "ATTENDANCE_CLAIM_PEPPER",
    "ATTENDANCE_CLAIM_PEPPER",
  );
  if (!serviceKey || !url || !orderPepper ||
    req.headers.get("authorization") !== `Bearer ${serviceKey}`) {
    return claimJson(401, { ok: false, error: "unauthorized" });
  }
  const body = await req.json().catch(() => ({})) as { limit?: unknown };
  const limit = Math.min(Math.max(Number(body.limit ?? 25), 1), 50);
  const rsvpPepper = qrTokenPepper();
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: enqueued, error: enqueueError } = await admin.rpc(
    "enqueue_attendance_claim_deliveries",
    { p_limit: limit },
  );
  if (enqueueError) return claimJson(500, { ok: false, error: "backfill_enqueue_failed" });
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_attendance_delivery_batch",
    { p_limit: limit },
  );
  if (claimError) return claimJson(500, { ok: false, error: "backfill_claim_failed" });

  let sent = 0;
  let retryable = 0;
  let terminal = 0;
  for (const raw of Array.isArray(claimed) ? claimed : []) {
    const delivery = deliveryFrom(raw);
    if (!delivery) continue;
    let finalStatus: "sent" | "failed_retryable" | "failed_terminal" = "failed_terminal";
    let safeCode: string | null = "source_ineligible";
    try {
      if (delivery.kind === "order") {
        const { data: order } = await admin.from("orders")
          .select("buyer_email,event_id,events!inner(title)")
          .eq("id", delivery.source_id).eq("event_id", delivery.event_id)
          .is("buyer_user_id", null).maybeSingle();
        const eventValue = order && typeof order.events === "object" && order.events !== null
          ? (Array.isArray(order.events) ? order.events[0] : order.events)
          : null;
        const eventTitle = eventValue && typeof eventValue === "object" &&
            "title" in eventValue && typeof eventValue.title === "string"
          ? eventValue.title
          : null;
        if (order && typeof order.buyer_email === "string" && eventTitle) {
          const minted = mintOrderClaimToken();
          const digest = await hmacOrderClaimDigest(minted.raw, orderPepper);
          const { data: issuance } = await admin.rpc("issue_order_attendance_claim_proof", {
            p_order_id: delivery.source_id,
            p_event_id: delivery.event_id,
            p_digest: bytesToPostgresHex(digest),
            // The queue lease is the intentional issuance/rotation boundary.
            // Only definite provider rejection reaches another attempt; an
            // ambiguous attempt is terminalized with this proof still valid.
            p_allow_retry_rotation: true,
          });
          const issued = typeof issuance === "object" && issuance !== null &&
            "result" in issuance && issuance.result === "issued";
          if (issued) {
            const claimUrl = attendanceClaimUrls({
              kind: "order", eventId: delivery.event_id,
              sourceId: delivery.source_id, token: minted.token,
            }).webClaimUrl;
            const emailResult = await sendEmail({
              to: order.buyer_email,
              eventTitle,
              claimUrl,
              deliveryKey: `attendance-claim-${delivery.id}-${delivery.attempt_count}`,
            });
            if (emailResult === "sent" || emailResult === "ambiguous") {
              finalStatus = "sent";
              safeCode = emailResult === "ambiguous" ? "provider_ambiguous" : null;
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
          .select("guest_email,event_id,pass_recovery_token_hash,pass_recovery_token_created_at,events!inner(title)")
          .eq("id", delivery.source_id).eq("event_id", delivery.event_id)
          .is("user_id", null).eq("rsvp_status", "going")
          .eq("approval_status", "approved").maybeSingle();
        const eventValue = rsvp && typeof rsvp.events === "object" && rsvp.events !== null
          ? (Array.isArray(rsvp.events) ? rsvp.events[0] : rsvp.events)
          : null;
        const eventTitle = eventValue && typeof eventValue === "object" &&
            "title" in eventValue && typeof eventValue.title === "string"
          ? eventValue.title
          : null;
        if (rsvp && typeof rsvp.guest_email === "string" && eventTitle) {
          const createdAt = typeof rsvp.pass_recovery_token_created_at === "string"
            ? rsvp.pass_recovery_token_created_at
            : new Date().toISOString();
          const token = await deriveRsvpRecoveryToken({
            entityId: delivery.source_id, createdAtIso: createdAt, pepper: rsvpPepper,
          });
          const tokenHash = await sha256Hex(token);
          if (rsvp.pass_recovery_token_hash !== tokenHash ||
            rsvp.pass_recovery_token_created_at !== createdAt) {
            const { error } = await admin.from("event_rsvps").update({
              pass_recovery_token_hash: tokenHash,
              pass_recovery_token_created_at: createdAt,
            }).eq("id", delivery.source_id).is("user_id", null);
            if (error) throw new Error("rsvp_proof_update_failed");
          }
          const claimUrl = attendanceClaimUrls({
            kind: "rsvp", eventId: delivery.event_id,
            sourceId: delivery.source_id, token,
          }).webClaimUrl;
          const passUrl = rsvpRecoveryUrl("primary", delivery.source_id, token);
          const emailResult = await sendEmail({
            to: rsvp.guest_email,
            eventTitle,
            claimUrl,
            passUrl,
            deliveryKey: `attendance-claim-${delivery.id}-${delivery.attempt_count}`,
          });
          if (emailResult === "sent" || emailResult === "ambiguous") {
            finalStatus = "sent";
            safeCode = emailResult === "ambiguous" ? "provider_ambiguous" : null;
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
});
