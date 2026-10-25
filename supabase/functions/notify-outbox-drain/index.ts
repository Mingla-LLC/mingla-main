import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  constantTimeEqual,
  deriveSourceRefundAttentionToken,
  readSourceRefundAttentionKeyRing,
} from "../_shared/sourceRefundAttentionToken.ts";
import {
  normalizeSourceRefundRecipient,
  readSourceRefundRecipientKeys,
  sourceRefundRecipientFingerprint,
} from "../_shared/sourceRefundNotificationRecipient.ts";
import { sourceRefundPayloadFingerprint } from "../_shared/sourceRefundNotifications.ts";
// #1529 — the source-refund pool is the ONE path whose outbox row can never
// carry a country (see the derivation comment in processSource below).
import { countryFromE164 } from "../_shared/e164Country.ts";
// #3988 — support and product alerts for Mingla teammates.
import {
  ISSUE_3988_ALERT_CATEGORIES,
  ISSUE_3988_EMAIL_CATEGORIES,
} from "../_shared/issue3988SupportAlerts.ts";
// #3392 — the venue booking confirmation email's "Manage or cancel" link.
import {
  readVenueReservationManageKeyRing,
  resolveVenueReservationManageLink,
  type VenueReservationManageKeyRing,
} from "../_shared/venueReservationManageToken.ts";
import {
  type BuyerLinkKind,
  resolveBuyerLink,
} from "../_shared/messageLinks.ts";
// #4111 — customer enquiry notifications.
import {
  ISSUE_4111_EMAIL_CATEGORIES,
  ISSUE_4111_ENQUIRY_CATEGORIES,
} from "../_shared/issue4111EnquiryNotifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const GENERIC_RESERVE = 15;
const SOURCE_RESERVE = 10;

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function interleave<T>(
  generic: T[],
  source: T[],
): Array<{ kind: "generic" | "source"; row: T }> {
  const result: Array<{ kind: "generic" | "source"; row: T }> = [];
  const max = Math.max(generic.length, source.length);
  for (let index = 0; index < max; index++) {
    if (generic[index]) result.push({ kind: "generic", row: generic[index] });
    if (source[index]) result.push({ kind: "source", row: source[index] });
  }
  return result;
}

export function dualPoolBorrowLimits(
  genericClaimed: number,
  sourceClaimed: number,
): { generic: number; source: number } {
  return {
    generic: Math.max(0, SOURCE_RESERVE - sourceClaimed),
    source: Math.max(0, GENERIC_RESERVE - genericClaimed),
  };
}

async function readBoundedSuccessEnvelope(
  response: Response,
): Promise<Record<string, unknown> | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 1024) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 1024) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISSUE_3720_CONTACT_CATEGORIES = new Set([
  "discover_city_plans_live",
  "business.community_announcement",
  "business.support_new_ticket",
  "admin.team_mention",
  ...ISSUE_3988_EMAIL_CATEGORIES,
  ...ISSUE_4111_EMAIL_CATEGORIES,
]);
const ISSUE_3720_DURABLE_CATEGORIES = new Set([
  ...ISSUE_3720_CONTACT_CATEGORIES,
  "business.community_reply",
  "business.community_roadmap_updated",
  "business.brand_group_message",
  "admin.team_mention",
  ...ISSUE_3988_ALERT_CATEGORIES,
  ...ISSUE_4111_ENQUIRY_CATEGORIES,
]);
const TERMINAL_DELIVERY_STATUSES = new Set([
  "sent",
  "delivered",
  "suppressed",
  "skipped",
]);

// #3720 — announcement/support email is resolved at send time from the same
// trusted auth identity used by the product. Producers never copy an address
// into the outbox, so preference changes and corrected addresses take effect
// before provider I/O without exposing auth.users to clients.
export async function resolveIssue3720Contact(
  // deno-lint-ignore no-explicit-any
  admin: any,
  row: Record<string, unknown>,
): Promise<string | null> {
  const category = String(row.category_key ?? "");
  const existing = typeof row.contact === "string" ? row.contact.trim() : "";
  if (existing) return existing;
  if (!ISSUE_3720_CONTACT_CATEGORIES.has(category) || !row.user_id) return null;
  const { data, error } = await admin.rpc("issue_3720_notification_email", {
    p_user_id: row.user_id,
  });
  if (error) throw new Error("notification_email_lookup_failed");
  return typeof data === "string" && EMAIL_RE.test(data.trim())
    ? data.trim().toLowerCase()
    : null;
}

export function dispatchEnvelopeIsTerminal(
  envelope: Record<string, unknown> | null,
): boolean {
  if (
    !envelope || envelope.success !== true ||
    !Array.isArray(envelope.deliveries)
  ) {
    return false;
  }
  return envelope.deliveries.length > 0 &&
    envelope.deliveries.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      return TERMINAL_DELIVERY_STATUSES.has(
        String((entry as Record<string, unknown>).status ?? ""),
      );
    });
}

/**
 * #3392 — who a venue booking confirmation goes to, and its manage link.
 *
 * RECIPIENT. The reservation trigger addresses the outbox row to
 * COALESCE(guest_phone_e164, guest_email). Since #1857 every booking carries a
 * phone, and `buyer_reservation_confirmed` has no SMS channel (DEC-185), so a
 * guest's confirmation EMAIL was skipped as "no contact": the dispatcher only
 * emails a contact that is an email address. The trigger-written payload holds
 * the booking's own guest email; this category is addressed to it.
 *
 * LINK. Re-derived here, at send time, from the governed key — never read from
 * storage, never written to the outbox, the payload, the inbox or the delivery
 * ledger. It rides only in this request's body to notify-dispatch, which
 * accepts it from the service role alone and re-validates its shape. Any
 * failure omits the link and the email still sends.
 */
export async function resolveReservationConfirmationDispatch(
  // deno-lint-ignore no-explicit-any
  admin: any,
  row: Record<string, unknown>,
  ring: VenueReservationManageKeyRing = readVenueReservationManageKeyRing(),
): Promise<{ contact: string | null; manageUrl: string | null }> {
  const payload = (row.payload as Record<string, unknown> | null) ?? {};
  const rowContact = typeof row.contact === "string" ? row.contact : null;
  const guestEmail = typeof payload.guest_email === "string"
    ? payload.guest_email.trim()
    : "";
  const dedicatedSmsRow = typeof rowContact === "string" &&
    /^\+[1-9][0-9]{1,14}$/.test(rowContact) &&
    (payload.channel_hint === "sms" ||
      String(row.idempotency_key ?? "").endsWith(":sms"));
  if (dedicatedSmsRow) {
    return { contact: rowContact, manageUrl: null };
  }
  // The link is a credential: it only ever goes to the booking's own email.
  if (!EMAIL_RE.test(guestEmail)) {
    return { contact: rowContact, manageUrl: null };
  }
  const contact = guestEmail;
  try {
    const link = await resolveVenueReservationManageLink(admin, {
      reservationId: String(payload.reservation_id ?? ""),
      ring,
    });
    if (
      link.reason === "manage_key_absent" ||
      link.reason === "manage_key_invalid" ||
      link.reason === "session_lookup_failed"
    ) {
      console.warn(
        "[notify-outbox-drain] venue_reservation_manage_link_omitted",
        { outbox_id: row.id ?? null, reason: link.reason },
      );
    }
    return { contact, manageUrl: link.url };
  } catch {
    console.warn(
      "[notify-outbox-drain] venue_reservation_manage_link_omitted",
      { outbox_id: row.id ?? null, reason: "manage_link_failed" },
    );
    return { contact, manageUrl: null };
  }
}

interface GenericBuyerLinkRequest {
  kind: BuyerLinkKind;
  sourceId: string;
}

export function genericBuyerLinkRequest(
  row: Record<string, unknown>,
): GenericBuyerLinkRequest | null {
  const payload = (row.payload as Record<string, unknown> | null) ?? {};
  const category = String(row.category_key ?? "");
  const from = (key: string): string => String(payload[key] ?? "").trim();
  const hasMessageTimezone = typeof payload.timezone === "string" &&
    payload.timezone.trim().length > 0;

  if (
    hasMessageTimezone &&
    (category === "buyer_event_reminder" ||
      category === "buyer_event_updated" ||
      category === "buyer_purchase_confirmation")
  ) {
    const sourceId = from("order_id");
    return sourceId ? { kind: "order", sourceId } : null;
  }
  if (
    hasMessageTimezone &&
    [
      "buyer_reservation_confirmed",
      "buyer_reservation_changed",
      "buyer_reservation_cancelled",
      "buyer_reservation_reminder",
    ].includes(category)
  ) {
    const sourceId = from("reservation_id");
    return sourceId ? { kind: "reservation", sourceId } : null;
  }
  if (category === "buyer_venue_order_receipt") {
    const sourceId = from("venue_order_id");
    return sourceId ? { kind: "venue_order", sourceId } : null;
  }
  return null;
}

export async function resolveGenericBuyerMessageLink(
  // deno-lint-ignore no-explicit-any
  admin: any,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const request = genericBuyerLinkRequest(row);
  if (request === null) return {};
  const link = await resolveBuyerLink(admin, request);
  return {
    message_link_url: link.url,
    message_link_display: link.display,
    message_link_claimed: link.claimed,
    message_link_fallback: link.fallback,
  };
}

// deno-lint-ignore no-explicit-any
export async function processGeneric(
  admin: any,
  row: Record<string, unknown>,
  url: string,
  key: string,
) {
  const id = row.id as string;
  // #3720 Slice B — deferred legacy push after quiet hours. Payload carries the
  // original type/title/body body under `legacy`; re-drive the legacy contract
  // (not v2 category_key) with quietHoursRetry so the in-app row is reused.
  if (row.category_key === "legacy_quiet_hours_push") {
    const stored = (row.payload as { legacy?: Record<string, unknown> } | null)
      ?.legacy;
    if (!stored || typeof stored !== "object") {
      await admin.from("notification_outbox").update({
        status: "failed",
        last_error: "legacy_quiet_hours_payload_missing",
        processed_at: new Date().toISOString(),
      }).eq("id", id);
      return false;
    }
    try {
      const res = await fetch(`${url}/functions/v1/notify-dispatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ ...stored, quietHoursRetry: true }),
      });
      const result = await res.json().catch(() => ({})) as {
        reason?: unknown;
        retryPending?: unknown;
        next_attempt_at?: unknown;
        success?: unknown;
      };
      if (
        result.reason === "quiet_hours" && result.retryPending === true
      ) {
        const nextAt = typeof result.next_attempt_at === "string"
          ? result.next_attempt_at
          : new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await admin.from("notification_outbox").update({
          status: "retry_wait",
          next_attempt_at: nextAt,
          last_error: "quiet_hours",
        }).eq("id", id);
        return false;
      }
      if (!res.ok || result.success === false) {
        throw new Error(
          `notify-dispatch ${res.status}: ${
            typeof result.reason === "string" ? result.reason : "failed"
          }`,
        );
      }
      await admin.from("notification_outbox").update({
        status: "done",
        processed_at: new Date().toISOString(),
        next_attempt_at: null,
        last_error: null,
      }).eq("id", id);
      return true;
    } catch (err) {
      const attempts = ((row.attempts as number) ?? 0) + 1;
      await admin.from("notification_outbox").update({
        status: attempts >= 3 ? "failed" : "retry_wait",
        attempts,
        next_attempt_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        last_error: err instanceof Error ? err.message : String(err),
      }).eq("id", id);
      console.error(
        "[notify-outbox-drain] quiet-hours retry failed for",
        id,
        err,
      );
      return false;
    }
  }

  let brandName = "Mingla";
  if (row.brand_id) {
    const { data: brand } = await admin.from("brands").select("name")
      .eq("id", row.brand_id).maybeSingle();
    if (brand?.name && typeof brand.name === "string") brandName = brand.name;
  }
  const payload: Record<string, unknown> = {
    ...((row.payload as Record<string, unknown>) ?? {}),
    brand_name: brandName,
    ...await resolveGenericBuyerMessageLink(admin, row),
  };
  let contact = (row.contact as string | null | undefined) ?? null;
  let reservationManageUrl: string | null = null;
  try {
    contact = await resolveIssue3720Contact(admin, row);
    if (row.category_key === "buyer_reservation_confirmed") {
      const confirmation = await resolveReservationConfirmationDispatch(
        admin,
        row,
      );
      contact = confirmation.contact;
      reservationManageUrl = confirmation.manageUrl;
    }
    const deepLink = typeof payload.deep_link === "string"
      ? payload.deep_link
      : null;
    const res = await fetch(`${url}/functions/v1/notify-dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        category_key: row.category_key,
        user_id: row.user_id ?? null,
        contact,
        payload,
        idempotency_key: row.idempotency_key,
        country_code: row.country_code ?? null,
        deep_link: deepLink,
        // #3392 — in transit only; see resolveReservationConfirmationDispatch.
        ...(reservationManageUrl
          ? { reservation_manage_url: reservationManageUrl }
          : {}),
      }),
    });
    const envelope = await readBoundedSuccessEnvelope(res);
    const requiresDurableTerminalEnvelope = ISSUE_3720_DURABLE_CATEGORIES.has(
      String(row.category_key ?? ""),
    );
    if (
      !res.ok ||
      (requiresDurableTerminalEnvelope && !dispatchEnvelopeIsTerminal(envelope))
    ) {
      const reason = typeof envelope?.reason === "string"
        ? envelope.reason
        : "non_terminal_delivery";
      throw new Error(`notify-dispatch ${res.status}: ${reason}`);
    }
    await admin.from("notification_outbox").update({
      status: "done",
      processed_at: new Date().toISOString(),
      next_attempt_at: null,
      last_error: null,
    }).eq("id", id);
    return true;
  } catch (err) {
    const attempts = ((row.attempts as number) ?? 0) + 1;
    const terminal = attempts >= 3;
    await admin.from("notification_outbox").update({
      status: terminal ? "failed" : "retry_wait",
      attempts,
      next_attempt_at: terminal
        ? null
        : new Date(Date.now() + Math.min(15 * 60_000, 60_000 * 2 ** attempts))
          .toISOString(),
      processed_at: terminal ? new Date().toISOString() : null,
      last_error: err instanceof Error ? err.message : String(err),
    }).eq("id", id);
    console.error("[notify-outbox-drain] dispatch failed for", id, err);
    return false;
  }
}

// deno-lint-ignore no-explicit-any
async function completeSource(admin: any, input: {
  deliveryId: string;
  claimId: string;
  outcome: string;
  providerMessageId: string | null;
  safeCode: string | null;
}) {
  await admin.rpc("complete_source_refund_notification_delivery", {
    p_delivery_id: input.deliveryId,
    p_claim_id: input.claimId,
    p_outcome: input.outcome,
    p_provider_message_id: input.providerMessageId,
    p_safe_code: input.safeCode,
    p_now: new Date().toISOString(),
  });
}

// deno-lint-ignore no-explicit-any
// #1529 — EXPORTED so the country-derivation and policy-skip behaviour can be
// driven directly by a test with a fake client, instead of being asserted from
// source text. A grep-style check on this file would pass vacuously; only
// executing it proves the dispatch body actually carries the derived country.
export async function processSource(
  admin: any,
  row: Record<string, unknown>,
  url: string,
  key: string,
) {
  const claimId = crypto.randomUUID();
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_source_refund_notification_delivery",
    {
      p_outbox_id: row.id,
      p_claim_id: claimId,
      p_contract_version: 9,
      p_now: new Date().toISOString(),
    },
  );
  if (claimError || claim?.outcome !== "claimed") {
    if (claim?.outcome === "already_accepted") {
      await admin.from("notification_outbox").update({
        status: "done",
        processed_at: new Date().toISOString(),
      }).eq("id", row.id);
    }
    return false;
  }
  const deliveryId = String(claim.deliveryId);
  try {
    const actualPayloadFingerprint = await sourceRefundPayloadFingerprint({
      payload: (row.payload as Record<string, unknown>) ?? {},
      category: String(row.category_key ?? ""),
      audience: String(claim.audience) as "buyer" | "brand" | "ops",
      channel: String(claim.channel) as "inapp" | "push" | "email" | "sms",
      serializerVersion: Number(claim.serializerVersion),
    });
    if (
      !constantTimeEqual(
        actualPayloadFingerprint,
        String(claim.payloadFingerprint),
      )
    ) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "payload_changed",
        providerMessageId: null,
        safeCode: "payload_changed",
      });
      return false;
    }
    const { data: resolved, error: resolveError } = await admin.rpc(
      "resolve_source_refund_notification_recipient",
      { p_delivery_id: deliveryId, p_claim_id: claimId },
    );
    if (resolveError || !resolved) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "terminal_unsent",
        providerMessageId: null,
        safeCode: "invalid_recipient",
      });
      return false;
    }
    const channel = String(claim.channel) as "inapp" | "push" | "email" | "sms";
    const contact = (channel === "email" || channel === "sms") &&
        typeof resolved.recipient === "string"
      ? normalizeSourceRefundRecipient(
        channel === "sms" ? "sms" : "email",
        resolved.recipient,
      )
      : null;
    if ((channel === "email" || channel === "sms") && !contact) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "skipped",
        providerMessageId: null,
        safeCode: "no_contact",
      });
      return true;
    }
    if (contact) {
      const recipientKeys = readSourceRefundRecipientKeys();
      const recipientKey = [
        recipientKeys.current,
        recipientKeys.previous,
      ].find((slot) => slot?.kid === claim.recipientKeyId);
      if (!recipientKey) throw new Error("recipient_key_unavailable");
      const actual = await sourceRefundRecipientFingerprint({
        key: recipientKey,
        channel: channel as "email" | "sms",
        recipient: contact,
      });
      if (!constantTimeEqual(actual, String(claim.recipientFingerprint))) {
        await completeSource(admin, {
          deliveryId,
          claimId,
          outcome: "terminal_unsent",
          providerMessageId: null,
          safeCode: "invalid_recipient",
        });
        return false;
      }
    }

    let attentionUrl: string | null = null;
    if (
      (row.payload as Record<string, unknown> | null)?.state ===
        "needs_attention" &&
      typeof resolved.keyId === "string"
    ) {
      const tokenKeys = readSourceRefundAttentionKeyRing();
      const tokenKey = [tokenKeys.current, tokenKeys.previous].find((slot) =>
        slot?.kid === resolved.keyId
      );
      if (!tokenKey) throw new Error("attention_key_unavailable");
      const token = await deriveSourceRefundAttentionToken({
        refundId: String(claim.refundId),
        generation: Number(claim.generation),
        key: tokenKey,
      });
      attentionUrl = `https://host.usemingla.com/refund/${
        String(claim.refundId)
      }/attention#attentionToken=${encodeURIComponent(token)}`;
    }
    let response: Response;
    try {
      response = await fetch(`${url}/functions/v1/notify-dispatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          contract_version: 9,
          category_key: row.category_key,
          user_id: row.user_id ?? null,
          contact,
          payload: {
            ...((row.payload as Record<string, unknown>) ?? {}),
            brand_name: row.brand_name_snapshot ?? "Mingla",
          },
          idempotency_key: row.idempotency_key,
          // #1529 — DERIVE AT THE DRAIN, because this pool structurally cannot
          // carry a country on the outbox row. #1221 deliberately writes
          // `contact: null` for source-refund notifications and keeps the
          // plaintext recipient out of the outbox entirely — only an HMAC
          // fingerprint is persisted, and the real recipient is recovered here
          // by `resolve_source_refund_notification_recipient` and normalised a
          // few lines above. Writing a country at enqueue would mean putting
          // recipient PII into a table that was built to hold none, which would
          // regress #1221's privacy design. So `row.country_code` is ALWAYS
          // NULL for this pool and deriving from the resolved contact is the
          // only correct answer. Non-SMS channels keep the column as-is.
          country_code: channel === "sms"
            ? countryFromE164(contact)
            : row.country_code ?? null,
          requested_channel: channel,
          delivery_id: deliveryId,
          delivery_claim_id: claimId,
          attention_url: attentionUrl,
        }),
      });
    } catch {
      await admin.rpc("classify_source_refund_notification_failure", {
        p_delivery_id: deliveryId,
        p_claim_id: claimId,
        p_safe_code: "dispatch_unavailable",
        p_certainty: "derive",
        p_now: new Date().toISOString(),
      });
      return false;
    }
    if (response.status === 503) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "definitive_unsent_retryable",
        providerMessageId: null,
        safeCode: "dispatch_unavailable",
      });
      return false;
    }
    if (response.status === 422) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "terminal_unsent",
        providerMessageId: null,
        safeCode: "dispatch_rejected",
      });
      return false;
    }
    if (response.status === 409) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "definitive_unsent_retryable",
        providerMessageId: null,
        safeCode: "delivery_in_progress",
      });
      return false;
    }
    if (response.status === 500 || !response.ok) {
      await admin.rpc("classify_source_refund_notification_failure", {
        p_delivery_id: deliveryId,
        p_claim_id: claimId,
        p_safe_code: response.status === 500
          ? "source_dispatch_failed"
          : "dispatch_protocol_error",
        p_certainty: "derive",
        p_now: new Date().toISOString(),
      });
      return false;
    }
    const result = await readBoundedSuccessEnvelope(response);
    // #1529 — a POLICY SKIP terminates cleanly and must NOT touch ops_status.
    //
    // notify-dispatch now answers 200 {success:true, outcome:"skipped"} when a
    // market kill-switch (or a can_send suppression) deliberately stopped the
    // send. Without this branch that envelope falls through to the
    // `!accepted && !ambiguous` protocol-error path below and is recorded as a
    // delivery failure, which escalates the refund to `needs_review`.
    //
    // No SQL change is needed to make this correct:
    // `complete_source_refund_notification_delivery` already handles
    // p_outcome='skipped' properly — it sets the delivery to `skipped` and the
    // outbox row to `failed`, and crucially 'skipped' is NOT in the
    // ('ambiguous','failed_terminal') set that triggers the
    // `source_refunds.ops_status='needs_review'` update. The function was
    // always right; it was simply never handed the right outcome.
    const policySkipped = response.status === 200 &&
      result?.success === true &&
      result?.outcome === "skipped";
    if (policySkipped) {
      await completeSource(admin, {
        deliveryId,
        claimId,
        outcome: "skipped",
        providerMessageId: null,
        safeCode: typeof result?.reason === "string"
          ? result.reason
          : "provider_kill_switch_off",
      });
      return true;
    }
    const accepted = response.status === 200 &&
      result?.success === true &&
      (result?.outcome === "accepted" ||
        result?.outcome === "already_accepted");
    const ambiguous = response.status === 202 &&
      result?.success === false &&
      result?.outcome === "ambiguous_parked" &&
      result?.reason === "delivery_ambiguous";
    if (!accepted && !ambiguous) {
      await admin.rpc("classify_source_refund_notification_failure", {
        p_delivery_id: deliveryId,
        p_claim_id: claimId,
        p_safe_code: "dispatch_protocol_error",
        p_certainty: "derive",
        p_now: new Date().toISOString(),
      });
      return false;
    }
    await completeSource(admin, {
      deliveryId,
      claimId,
      outcome: accepted ? "accepted" : "acceptance_unknown",
      providerMessageId: accepted &&
          typeof result?.providerMessageId === "string"
        ? result.providerMessageId
        : null,
      safeCode: accepted ? null : "delivery_ambiguous",
    });
    return accepted;
  } catch {
    await admin.rpc("classify_source_refund_notification_failure", {
      p_delivery_id: deliveryId,
      p_claim_id: claimId,
      p_safe_code: "source_dispatch_failed",
      p_certainty: "derive",
      p_now: new Date().toISOString(),
    });
    return false;
  }
}

export async function handleNotifyOutboxDrain(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return json({ error: "server_misconfigured" }, 500);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!constantTimeEqual(authHeader, `Bearer ${key}`)) {
    return json({ error: "unauthorized" }, 401);
  }
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) return json({ error: "server_misconfigured" }, 500);
  const admin = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const [{ data: firstGeneric, error: genericError }, {
    data: firstSource,
    error: sourceError,
  }] = await Promise.all([
    admin.rpc("claim_notification_outbox", { p_limit: GENERIC_RESERVE }),
    admin.rpc("claim_source_refund_notification_outbox", {
      p_limit: SOURCE_RESERVE,
      p_contract_version: 9,
      p_worker_id: crypto.randomUUID(),
      p_now: new Date().toISOString(),
    }),
  ]);
  const generic = genericError
    ? []
    : [...(firstGeneric ?? [])] as Array<Record<string, unknown>>;
  const source = sourceError
    ? []
    : [...(firstSource ?? [])] as Array<Record<string, unknown>>;
  const borrow = dualPoolBorrowLimits(generic.length, source.length);
  if (borrow.source > 0 && !sourceError) {
    const { data } = await admin.rpc(
      "claim_source_refund_notification_outbox",
      {
        p_limit: borrow.source,
        p_contract_version: 9,
        p_worker_id: crypto.randomUUID(),
        p_now: new Date().toISOString(),
      },
    );
    source.push(...(data ?? []));
  }
  if (borrow.generic > 0 && !genericError) {
    const { data } = await admin.rpc("claim_notification_outbox", {
      p_limit: borrow.generic,
    });
    generic.push(...(data ?? []));
  }
  if (generic.length + source.length === 0) {
    return json({ ok: true, processed: 0, failed: 0 });
  }
  let processed = 0;
  let failed = 0;
  for (const item of interleave(generic, source)) {
    const ok = item.kind === "generic"
      ? await processGeneric(admin, item.row, url, key)
      : await processSource(admin, item.row, url, key);
    if (ok) processed++;
    else failed++;
  }
  return json({
    ok: true,
    processed,
    failed,
    generic_claimed: generic.length,
    source_claimed: source.length,
  });
}

if (import.meta.main) {
  serve(handleNotifyOutboxDrain);
}
