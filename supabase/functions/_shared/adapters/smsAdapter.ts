// META-ORCH-1161 Sub-A — SMS adapter.
//
// GENERALIZED from send-venue-sms's sendTwilioSms (DO NOT introduce a new
// provider — hard guard). The dispatcher never touches Twilio HTTP directly; it
// calls smsAdapter.send(). Responsibilities (SPEC §5.5):
//   - Send via TWILIO_MESSAGING_SERVICE_SID (the approved toll-free) — NEVER a
//     raw From number (I-PROPOSED-1161-SMS-FROM-APPROVED-SENDER-ONLY).
//   - StatusCallback wired to twilio-message-status?secret=… (reuse existing).
//   - GSM-7 sanitizer (smart quotes/em-dash/ellipsis → ASCII) before send; flag
//     UCS-2 fall-through; compute + record segment count.
//   - Brand-name sender identity + "Reply STOP to opt out" footer (CTIA).
//   - Region-routing seam (country_code → US route today; NG route is a phase).
//   - Per-market kill-switch SMS_LIVE_ENABLED_US (default false) → return
//     { ok:false, status:'skipped' } WITHOUT any HTTP call when off
//     (I-PROPOSED-1161-SMS-MARKET-KILL-SWITCH).

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
): Promise<{ ok: boolean; sid?: string; error?: string; blacklisted?: boolean }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
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

    const result = await twilioSend(to, body);
    if (!result.ok) {
      return {
        ok: false,
        status: "failed",
        providerMessageId: null,
        segments,
        blacklisted: result.blacklisted ?? false,
        error: result.error ?? "twilio_error",
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
