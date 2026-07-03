// META-ORCH-1161 Sub-A — SMS adapter.
//
// GENERALIZED from send-venue-sms's sendTwilioSms. The dispatcher never touches
// provider HTTP directly; it calls smsAdapter.send(). Responsibilities (SPEC §5.5):
//   - Send via TWILIO_MESSAGING_SERVICE_SID (the approved toll-free) — NEVER a
//     raw From number (I-PROPOSED-1161-SMS-FROM-APPROVED-SENDER-ONLY).
//   - StatusCallback wired to twilio-message-status?secret=… (reuse existing).
//   - GSM-7 sanitizer (smart quotes/em-dash/ellipsis → ASCII) before send; flag
//     UCS-2 fall-through; compute + record segment count.
//   - Brand-name sender identity + "Reply STOP to opt out" footer (CTIA).
//   - Region-routing seam (country_code → US route / NG route).
//   - Per-market kill-switch SMS_LIVE_ENABLED_US / SMS_LIVE_ENABLED_NG (default
//     false) → return { ok:false, status:'skipped' } WITHOUT any HTTP call when
//     off (I-PROPOSED-1161-SMS-MARKET-KILL-SWITCH).
//
// ORCH-1227 (DEC-192) — SUPERSEDES the original "DO NOT introduce a new provider
// — hard guard". The adapter is now DUAL-PROVIDER, country-routed behind the
// existing region seam: Twilio for US/RoW, Termii for NG. NG transactional sends
// hit Termii's `dnd` channel (reaches DND-registered numbers, the NCC corporate
// route); NG marketing sends hit Termii's `generic` channel. Every other country
// keeps Twilio unchanged. NG ships text-dark behind SMS_LIVE_ENABLED_NG.
// Invariant: I-PROPOSED-1227-NG-SMS-VIA-TERMII. The Twilio path MUST keep its
// MessagingServiceSid usage, the SMS_LIVE_ENABLED_ kill-switch, and the
// no-raw-`From` discipline — the I-PROPOSED-1161 CI gate still enforces all three.

export interface AdapterResult {
  ok: boolean;
  status: "sent" | "skipped" | "failed";
  providerMessageId: string | null;
  segments?: number;
  blacklisted?: boolean;
  error?: string;
}

export interface SmsSendInput {
  to: string; // E.164
  brandName: string; // sender identity in the body (CTIA brand-name-in-body)
  message: string; // the body WITHOUT the STOP footer (footer is appended here)
  countryCode?: string | null; // ISO-2 for region routing (default US)
  // META-ORCH-1161 Sub-B (§12 Q2) — optional Messaging Service SID override so a
  // SEPARATE marketing sender (reputation isolation; a marketing STOP must not
  // touch transactional) can be used. When omitted, the adapter uses the
  // approved transactional toll-free TWILIO_MESSAGING_SERVICE_SID. NEVER a raw
  // From number either way (I-PROPOSED-1161-SMS-FROM-APPROVED-SENDER-ONLY).
  messagingServiceSid?: string | null;
  // ORCH-1227 (DEC-192) — message class for the NG/Termii route. "transactional"
  // (default) → Termii `dnd` channel (reaches DND-registered NG numbers);
  // "marketing" → Termii `generic` channel. The Twilio (US/RoW) path IGNORES
  // this field; reputation isolation there is via `messagingServiceSid`.
  messageType?: "transactional" | "marketing";
  // ORCH-1282 — MMS media. Publicly-fetchable HTTPS URL(s) Twilio attaches via
  // the `MediaUrl` param (presence promotes the message to MMS). US/Twilio ONLY;
  // the NG/Termii path IGNORES media and sends SMS-only (Termii `/api/sms/send`
  // `type:"plain"` carries no media param). The composer sets exactly one.
  mediaUrls?: string[];
}

const E164_RE = /^\+[1-9][0-9]{1,14}$/;

export const isValidE164 = (v: string): boolean => E164_RE.test(v.trim());

// GSM-7 sanitizer — normalize the common UTF-8 punctuation that forces UCS-2
// (and inflates segments) down to GSM-7-safe ASCII. Mirrors COPY §4 discipline.
// I-PROPOSED-1161-GSM7-SANITIZED-TEMPLATES.
export function sanitizeGsm7(input: string): string {
  return input
    .replace(/[‘’‚‛′]/g, "'") // curly/prime single quotes → '
    .replace(/[“”„‟″]/g, '"') // curly/prime double quotes → "
    .replace(/[–—―]/g, "-") // en/em dash, horiz bar → -
    .replace(/…/g, "...") // ellipsis → ...
    .replace(/[   ]/g, " ") // non-breaking spaces → space
    .replace(/[•]/g, "-"); // bullet → -
}

// The GSM-7 default + basic extended alphabet (chars outside it force UCS-2).
// https://en.wikipedia.org/wiki/GSM_03.38
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (GSM7_BASIC.indexOf(ch) === -1 && GSM7_EXT.indexOf(ch) === -1) {
      return false;
    }
  }
  return true;
}

// Segment count: GSM-7 = 160 single / 153 concatenated; UCS-2 = 70 / 67.
// Extended GSM-7 chars count as 2; we approximate by length (the dispatcher only
// needs cost observability, not billing precision).
export function computeSegments(text: string): number {
  const gsm7 = isGsm7(text);
  const len = text.length;
  if (gsm7) {
    return len <= 160 ? 1 : Math.ceil(len / 153);
  }
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

const STOP_FOOTER = "Reply STOP to opt out.";

// Compose the final body: brand-name identity is the caller's responsibility in
// `message` (the COPY templates already lead with "{Brand}:"). We append the
// STOP footer only if not already present, then GSM-7-sanitize the whole thing.
export function composeSmsBody(message: string): string {
  let body = message.trim();
  if (!/reply stop/i.test(body)) {
    body = `${body} ${STOP_FOOTER}`;
  }
  return sanitizeGsm7(body);
}

// Region routing seam (SPEC §8.4). Today only the US route is live; NG is phased.
// Returns the env var name of the per-market kill-switch for the resolved route.
export function resolveMarketKillSwitch(countryCode?: string | null): string {
  const cc = (countryCode ?? "US").toUpperCase();
  if (cc === "NG") return "SMS_LIVE_ENABLED_NG";
  return "SMS_LIVE_ENABLED_US";
}

function envTrue(name: string): boolean {
  const raw = Deno.env.get(name);
  return raw === "true" || raw === "1";
}

async function twilioSend(
  to: string,
  body: string,
  messagingServiceSidOverride?: string | null,
  mediaUrls?: string[],
): Promise<{ ok: boolean; sid?: string; error?: string; blacklisted?: boolean }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  // Marketing send passes a separate marketing Messaging Service SID
  // (§12 Q2). When absent, fall back to the approved transactional toll-free.
  const messagingServiceSid = messagingServiceSidOverride && messagingServiceSidOverride.length > 0
    ? messagingServiceSidOverride
    : Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  if (!accountSid || !authToken || !messagingServiceSid) {
    return { ok: false, error: "twilio_env_missing" };
  }
  const statusSecret = Deno.env.get("TWILIO_STATUS_CALLBACK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const statusCallback =
    statusSecret && supabaseUrl
      ? `${supabaseUrl}/functions/v1/twilio-message-status?secret=${encodeURIComponent(statusSecret)}`
      : undefined;
  const params = new URLSearchParams({
    To: to,
    MessagingServiceSid: messagingServiceSid, // NEVER a raw From number.
    Body: body,
  });
  if (statusCallback) params.set("StatusCallback", statusCallback);
  // ORCH-1282 — MMS: `MediaUrl` is an optional, REPEATABLE param; a publicly
  // accessible URL Twilio fetches server-side, and its presence promotes the
  // message to MMS. Ref: https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource
  // (param `MediaUrl`). Single-image v1 appends one; append() keeps the repeat
  // semantics for forward-compat.
  if (mediaUrls) {
    for (const u of mediaUrls) {
      if (u && u.length > 0) params.append("MediaUrl", u);
    }
  }
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      const blacklisted = text.includes("21610"); // recipient opted out
      return { ok: false, error: `Twilio ${res.status}: ${text}`, blacklisted };
    }
    const data = (await res.json()) as { sid?: string };
    return { ok: true, sid: data.sid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ORCH-1227 (DEC-192) — Termii (Nigeria) sender. Mirrors twilioSend's shape and
// return contract ({ ok, sid?, error?, blacklisted? }). FAIL-CLOSED: if ANY of
// TERMII_API_KEY / TERMII_BASE_URL / TERMII_SENDER_ID is missing, return
// { ok:false, error:"termii_env_missing" } WITHOUT any HTTP call.
//   - POST {TERMII_BASE_URL}/api/sms/send  body { api_key, to, from, sms, type, channel }
//   - `from` is the env sender id (TERMII_SENDER_ID, NCC-approved "Mingla") — a
//     lowercase JSON key, NOT a Twilio raw `From` (the 1161 gate forbids that).
//   - channel: "dnd" (transactional, reaches DND) | "generic" (marketing).
//   - Success = HTTP 200 with a JSON `message_id` (and/or code:"ok"); map
//     message_id → sid (providerMessageId upstream). Non-200 or missing
//     message_id → failed with the response text in `error`. `blacklisted` true
//     when the response indicates a DND/opt-out rejection.
async function termiiSend(
  to: string,
  body: string,
  channel: "dnd" | "generic",
): Promise<{ ok: boolean; sid?: string; error?: string; blacklisted?: boolean }> {
  const apiKey = Deno.env.get("TERMII_API_KEY");
  const baseUrl = Deno.env.get("TERMII_BASE_URL");
  const senderId = Deno.env.get("TERMII_SENDER_ID");
  if (!apiKey || !baseUrl || !senderId) {
    return { ok: false, error: "termii_env_missing" };
  }
  const payload = {
    api_key: apiKey,
    to,
    from: senderId, // env sender id (NOT a Twilio raw From param).
    sms: body,
    type: "plain",
    channel,
  };
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/sms/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data: { message_id?: string; code?: string; message?: string } = {};
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      // non-JSON body — treat as failure below (message_id absent).
    }
    // DND / opt-out style rejections — surface as blacklisted so the ledger can
    // suppress (mirrors Twilio's 21610 mapping).
    const lower = `${data.message ?? ""} ${text}`.toLowerCase();
    const blacklisted =
      lower.includes("dnd") || lower.includes("blacklist") ||
      lower.includes("opt out") || lower.includes("opt-out");
    if (res.ok && typeof data.message_id === "string" && data.message_id.length > 0) {
      return { ok: true, sid: data.message_id };
    }
    return { ok: false, error: `Termii ${res.status}: ${text}`, blacklisted };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const smsAdapter = {
  async send(input: SmsSendInput): Promise<AdapterResult> {
    const to = input.to?.trim() ?? "";
    if (!isValidE164(to)) {
      return { ok: false, status: "failed", providerMessageId: null, error: "invalid_e164" };
    }

    // Per-market kill-switch — return skipped WITHOUT any HTTP call when off.
    const killSwitch = resolveMarketKillSwitch(input.countryCode);
    if (!envTrue(killSwitch)) {
      return {
        ok: false,
        status: "skipped",
        providerMessageId: null,
        error: `kill_switch_off:${killSwitch}`,
      };
    }

    const body = composeSmsBody(input.message);
    const segments = computeSegments(body);

    // ORCH-1227 (DEC-192) — country-routed dual provider behind the region seam.
    // NG → Termii (transactional→dnd, marketing→generic); everything else → Twilio.
    const cc = (input.countryCode ?? "US").toUpperCase();
    const result = cc === "NG"
      // NG/Termii is SMS-only — media is intentionally NOT passed (ORCH-1282).
      ? await termiiSend(to, body, input.messageType === "marketing" ? "generic" : "dnd")
      : await twilioSend(to, body, input.messagingServiceSid, input.mediaUrls);
    if (!result.ok) {
      return {
        ok: false,
        status: "failed",
        providerMessageId: null,
        segments,
        blacklisted: result.blacklisted ?? false,
        error: result.error ?? (cc === "NG" ? "termii_error" : "twilio_error"),
      };
    }
    return {
      ok: true,
      status: "sent",
      providerMessageId: result.sid ?? null,
      segments,
    };
  },
};
