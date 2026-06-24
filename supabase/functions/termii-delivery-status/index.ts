// ORCH-1227 (DEC-192) — termii-delivery-status: the Nigeria SMS delivery webhook.
//
// MIRRORS twilio-message-status: reconcile the cross-channel delivery ledger
// (notification_deliveries) keyed by provider_message_id + channel='sms', and —
// on a DND / opt-out / rejected status — write a channel_suppressions row using
// the SAME scope/reason convention twilio-inbound-sms uses for STOP.
//
// AUTH (FAIL-CLOSED): Termii cannot present a Supabase JWT (verify_jwt=false).
// Termii POSTs signed JSON; the signature is an HMAC-SHA512 of the RAW request
// body using the Termii API key (or an explicit override) as the signing secret,
// in header `X-Termii-Signature` (matched case-insensitively). If the secret env
// is missing OR the header is absent OR it mismatches → 403. Same posture as the
// twilio webhooks, upgraded to a real HMAC because Termii signs the body.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";

// Statuses Termii reports (case-insensitive). DELIVERED / "Message Sent" =
// success; the rest are terminal failures, and the DND/opt-out/rejected family
// also triggers app-side suppression.
function classifyStatus(statusRaw: string): {
  delivered: boolean;
  failed: boolean;
  suppress: boolean;
} {
  const s = statusRaw.trim().toLowerCase();
  const delivered = s === "delivered" || s === "message sent" || s === "sent";
  // DND Active / Rejected / blacklist / opt-out → suppress + fail.
  const suppress = s.includes("dnd") || s.includes("reject") ||
    s.includes("blacklist") ||
    s.includes("opt out") || s.includes("opt-out");
  const failed = !delivered && (suppress || s === "expired" || s === "failed" ||
    s === "undelivered" || s === "undeliverable");
  return { delivered, failed, suppress };
}

// Constant-time-ish hex compare (length check + char loop) to avoid trivial
// early-exit timing leaks on the signature.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ORCH-1227 — DB-client injection seam (pure refactor, no behavior change):
// production uses serviceClient(); tests inject a stub so the fail-closed AUTH
// gate (403/400 paths) and the suppression-insert path can be exercised without
// a live DB. Defaults to serviceClient — identical runtime behavior.
type ServiceClientFactory = () => ReturnType<typeof serviceClient>;
let _clientFactory: ServiceClientFactory = serviceClient;
export function __setServiceClientFactory(
  factory: ServiceClientFactory | null,
) {
  _clientFactory = factory ?? serviceClient;
}

export async function handleTermiiStatus(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // FAIL-CLOSED signature verification over the RAW body.
  const signingSecret = Deno.env.get("TERMII_WEBHOOK_SECRET") ??
    Deno.env.get("TERMII_API_KEY");
  const provided = req.headers.get("x-termii-signature"); // Headers lookup is case-insensitive.
  if (!signingSecret || !provided) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const rawBody = await req.text();
  const expected = await hmacSha512Hex(signingSecret, rawBody);
  if (!timingSafeEqual(provided.trim().toLowerCase(), expected.toLowerCase())) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "termii_status_payload_invalid" }, 400);
  }

  const messageId = String(payload.message_id ?? payload.id ?? "").trim();
  const status = String(payload.status ?? "").trim();
  if (!messageId || !status) {
    return jsonResponse({ error: "termii_status_payload_invalid" }, 400);
  }
  // Termii payloads carry the recipient as `receiver` (E.164); fall back to
  // `to`/`phone_number` defensively for suppression keying.
  const recipient = String(
    payload.receiver ?? payload.to ?? payload.phone_number ?? "",
  ).trim();

  const { delivered, failed, suppress } = classifyStatus(status);
  const supabase = _clientFactory();

  // Reconcile the cross-channel delivery ledger by provider_message_id + channel,
  // exactly as twilio-message-status does (META-ORCH-1161 §5.6).
  {
    const ledgerStatus = delivered ? "delivered" : failed ? "failed" : "sent";
    const failedReason = failed ? `termii_${status}` : null;
    const { error: deliveryErr } = await supabase
      .from("notification_deliveries")
      .update({
        status: ledgerStatus,
        delivered_at: delivered ? new Date().toISOString() : null,
        failed_reason: failedReason,
      })
      .eq("provider_message_id", messageId)
      .eq("channel", "sms");
    if (deliveryErr) {
      console.warn(
        "[termii-delivery-status] notification_deliveries reconcile note:",
        deliveryErr.message,
      );
    }
  }

  // DND / opt-out / rejected → write a channel_suppressions row using the SAME
  // scope/reason convention twilio-inbound-sms uses for STOP (scope='all',
  // reason='stop_keyword'). The unique index is expression-based, so guard with
  // an existence check then insert — idempotent across re-deliveries.
  if (suppress && recipient) {
    const { data: existing } = await supabase
      .from("channel_suppressions")
      .select("id")
      .eq("contact", recipient)
      .eq("channel", "sms")
      .eq("scope", "all")
      .is("brand_id", null)
      .maybeSingle();
    if (existing === null) {
      const { error: suppErr } = await supabase
        .from("channel_suppressions")
        .insert({
          user_id: null,
          contact: recipient,
          channel: "sms",
          scope: "all",
          reason: "stop_keyword",
          brand_id: null,
        });
      if (suppErr) {
        console.warn(
          "[termii-delivery-status] suppression insert note:",
          suppErr.message,
        );
      }
    }
  }

  return jsonResponse({ ok: true });
}

// Only bind the HTTP listener when run as the function entrypoint; importing the
// module (e.g. from tests) does NOT start a server. Deno deploy/edge runs the
// file as main, so production behavior is unchanged.
if (import.meta.main) {
  serve(handleTermiiStatus);
}
