/**
 * resend-webhook (#2510) — the ear Mingla never had.
 *
 * Resend has always been willing to tell us what happened to an email:
 * delivered, opened, clicked, bounced, marked as spam. Nothing was listening,
 * so there was NO open rate anywhere in the product, bounces and complaints
 * vanished, and both campaign screens reported a "Delivered" figure they had
 * not earned.
 *
 * `verify_jwt` MUST be false — Resend sends no Supabase JWT. Authenticity
 * comes from the Svix signature instead, which is the only thing standing
 * between this endpoint and anyone who can POST a fabricated "opened" event.
 *
 * Docs:
 *   - Signing (Svix headers, raw body):
 *     https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 *   - Event types + payload shape:
 *     https://resend.com/docs/dashboard/webhooks/event-types
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveGovernedAdField } from "../_shared/governedAdSecret.ts";

/** Events we act on. Anything else is acked and ignored, never 500'd. */
const HANDLED = new Set([
  "email.sent",
  "email.delivered",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
]);

/**
 * Svix replay window. A signature stays valid for 5 minutes either side, which
 * is Svix's own recommendation — wide enough for clock skew, narrow enough
 * that a captured request cannot be replayed tomorrow.
 */
const TOLERANCE_SECONDS = 300;

/**
 * base64 → bytes, allocating the array so its type is `Uint8Array<ArrayBuffer>`.
 * `Uint8Array.from(atob(...))` infers `ArrayBufferLike`, which WebCrypto's
 * `importKey` overloads reject under the pinned TS.
 */
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> | null {
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    return null;
  }
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function timingSafeEqual(
  a: Uint8Array<ArrayBuffer>,
  b: Uint8Array<ArrayBuffer>,
): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Verify a Svix signature over the RAW body.
 *
 * The signed content is `${id}.${timestamp}.${body}` and the secret is base64
 * AFTER the `whsec_` prefix. The header carries a SPACE-SEPARATED list of
 * `v1,<sig>` pairs — plural because Svix supports key rotation, so checking
 * only the first would break every rotation.
 */
export async function verifySvixSignature(input: {
  secret: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
  rawBody: string;
  nowSeconds?: number;
}): Promise<boolean> {
  const ts = Number(input.svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) return false;

  const rawSecret = input.secret.startsWith("whsec_")
    ? input.secret.slice("whsec_".length)
    : input.secret;
  const keyBytes = b64ToBytes(rawSecret);
  if (keyBytes === null) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${input.svixId}.${input.svixTimestamp}.${input.rawBody}`;
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed)),
  ) as Uint8Array<ArrayBuffer>;

  for (const part of input.svixSignature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || sig === undefined) continue;
    const candidate = b64ToBytes(sig);
    if (candidate === null) continue;
    if (timingSafeEqual(mac, candidate)) return true;
  }
  return false;
}

/** Resend's envelope. `data.email_id` is what we stored as provider_message_id. */
export function providerMessageIdOf(payload: unknown): string | null {
  const data = (payload as { data?: { email_id?: unknown } } | null)?.data;
  const id = data?.email_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function eventTypeOf(payload: unknown): string | null {
  const t = (payload as { type?: unknown } | null)?.type;
  return typeof t === "string" && t.length > 0 ? t : null;
}

async function correlationHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest)).slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function handleResendWebhook(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const secret = resolveGovernedAdField(
    "RESEND_WEBHOOK_SECRET",
    "RESEND_WEBHOOK_SECRET",
  ) ?? "";
  if (secret.length === 0) {
    // Fail CLOSED. An unverified endpoint that writes engagement metrics is a
    // vandalism surface: anyone could inflate a brand's open rate, or worse,
    // suppress a real recipient by forging a bounce.
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET is not configured");
    return new Response(JSON.stringify({ error: "webhook_not_configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const svixId = req.headers.get("svix-id") ?? "";
  const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
  const svixSignature = req.headers.get("svix-signature") ?? "";
  // RAW body — parsing first and re-serialising would change bytes and break
  // the signature. Resend's docs call this out explicitly.
  const rawBody = await req.text();

  if (svixId === "" || svixTimestamp === "" || svixSignature === "") {
    return new Response(JSON.stringify({ error: "missing_signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ok = await verifySvixSignature({
    secret,
    svixId,
    svixTimestamp,
    svixSignature,
    rawBody,
  });
  if (!ok) {
    return new Response(JSON.stringify({ error: "invalid_signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // A 400 here is deliberate: the body is signed, so malformed JSON is our
    // bug or a provider change, and a retry would not help.
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const eventType = eventTypeOf(payload);
  if (eventType === null || !HANDLED.has(eventType)) {
    // ACK. Returning non-2xx makes Resend retry forever on an event we will
    // never care about (e.g. email.delivery_delayed, inbound mail).
    return new Response(JSON.stringify({ ok: true, ignored: eventType }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const providerMessageId = providerMessageIdOf(payload);
  if (providerMessageId === null) {
    return new Response(JSON.stringify({ ok: true, ignored: "no_email_id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase.rpc("mkt_ingest_email_event", {
    p_svix_id: svixId,
    p_event_type: eventType,
    p_provider_message_id: providerMessageId,
    p_payload: payload,
  });

  if (error !== null) {
    // 500 so Resend RETRIES — a dropped event is a permanently wrong metric,
    // and the ingest is idempotent on svix_id so a retry cannot double-count.
    console.error(`[resend-webhook] ingest failed: ${error.message}`);
    return new Response(JSON.stringify({ error: "ingest_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (data === "campaign_unmatched" || data === "campaign_unmatched_stale") {
    const ageBucket = data === "campaign_unmatched_stale"
      ? "at_least_5m"
      : "under_5m";
    const safeLog = JSON.stringify({
      event: "campaign_email_event_unmatched",
      event_type: eventType,
      age_bucket: ageBucket,
      correlation_hash: await correlationHash(svixId),
    });
    if (data === "campaign_unmatched_stale") console.error(safeLog);
    else console.warn(safeLog);
    return new Response(JSON.stringify({ error: "campaign_event_unmatched" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, outcome: data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

if (import.meta.main) {
  serve(handleResendWebhook);
}
