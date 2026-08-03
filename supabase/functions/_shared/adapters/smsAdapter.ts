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
// existing region seam: Twilio for US/RoW, Termii for NG. Every other country
// keeps Twilio unchanged. NG ships text-dark behind SMS_LIVE_ENABLED_NG.
// Invariant: I-PROPOSED-1227-NG-SMS-VIA-TERMII. The Twilio path MUST keep its
// MessagingServiceSid usage, the SMS_LIVE_ENABLED_ kill-switch, and the
// no-raw-`From` discipline — the I-PROPOSED-1161 CI gate still enforces all three.
//
// ===========================================================================
// #1518 (2026-08-03) — INTERIM NG CHANNEL ROUTING. READ BEFORE CHANGING IT.
// ===========================================================================
// DEC-192 originally mapped NG transactional → Termii `dnd` and NG marketing →
// `generic`. THAT MAPPING IS DEAD. Live provider probe against the production
// Termii account (#1480, 2026-08-03 19:19-19:20 WAT):
//   - channel "dnd"     → HTTP 400 {"code":400,"message":"Country Inactive.
//                         Contact Administrator to activate country.",
//                         "status":"error"}. The DND route was NEVER activated
//                         on this account; every Delivered row in provider
//                         history is sms_type: generic.
//   - channel "generic" → code "ok", message_id 3017857812138224517130997,
//                         ₦5.00 balance debit, terminal provider status
//                         "Delivered".
// Because `messageType` defaults to "transactional", the old mapping sent 100%
// of Nigerian booking confirmations to the channel that 400s.
//
// So BOTH NG message classes now send over `generic`, and NO NG code path emits
// `dnd`. THIS IS NOT THE INTENDED DESIGN — it is an ACCEPTED OPERATOR DECISION
// (Seth, 2026-08-03, issue #1518) and it is INTERIM. Three facts a future
// reader MUST carry, because each is a real cost that was chosen knowingly:
//
//   (a) NIGHTLY MTN BLACKOUT. Termii restricts `generic` for Nigerian MTN
//       numbers 20:00-08:00 WAT. Transactional SMS to MTN recipients WILL FAIL
//       every night inside that window. Expected behaviour here, not a bug.
//   (b) DND-REGISTERED RECIPIENTS MAY NEVER BE REACHED. `generic` is NOT the
//       NCC Do-Not-Disturb corporate route. Recipients on the DND register may
//       not receive transactional texts at all. Nothing in this file makes NG
//       transactional reach DND-registered numbers; any comment claiming
//       otherwise is stale. The honest signal is the `blacklisted` classifier
//       in termiiSend — it reads provider ERROR STRINGS, never our channel.
//   (c) THIS KNOWINGLY DEPARTS FROM TERMII'S DOCUMENTED GUIDANCE. Termii's
//       Messaging API docs state `generic` is for promotional messages and
//       numbers NOT on DND, and that it "should not be used for OTPs or
//       transactional content". Mingla carries transactional traffic on it
//       anyway. Two VERIFIED mitigations bound the blast radius: login /
//       verification codes do NOT ride this path (`send-otp` uses Twilio
//       Verify, never Termii), and SMS is never the sole confirmation — the
//       guest confirmation EMAIL is an independent `notification_outbox`
//       insert that does not depend on the SMS row succeeding.
//
// REVERT CONDITION: when Termii activates the DND route for Nigeria (tracked in
// #1480 — country activation and DND sender-ID whitelisting are SEPARATE
// provider steps; note Termii's DND corporate delivery still excludes 9mobile),
// restore the messageType mapping (transactional → "dnd", marketing →
// "generic") and revert the invariant + strict-grep gate with it. The DND route
// remains the correct design; this interim exists only because it is unavailable.
// ===========================================================================
import { resolveDeliveryFlagValue } from "../secretBundle.ts";
import { resolveRuntimeConfigValue } from "../runtimeConfig.ts";

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
  // ORCH-1227 (DEC-192) — message class for the NG/Termii route.
  // #1518 INTERIM: this field NO LONGER selects the NG channel. Both
  // "transactional" (default) and "marketing" send over Termii's `generic`
  // channel, because `dnd` returns 400 "Country Inactive" (see the #1518 block
  // at the top of this file). It does NOT mean transactional reaches
  // DND-registered numbers — it currently cannot. The field is retained because
  // callers already thread it and because it is the exact attachment point the
  // #1480 revert re-hangs the `dnd` mapping on. The Twilio (US/RoW) path
  // IGNORES it; reputation isolation there is via `messagingServiceSid`.
  messageType?: "transactional" | "marketing";
  // ORCH-1282 — MMS media. Publicly-fetchable HTTPS URL(s) Twilio attaches via
  // the `MediaUrl` param (presence promotes the message to MMS). US/Twilio ONLY;
  // the NG/Termii path IGNORES media and sends SMS-only (Termii `/api/sms/send`
  // `type:"plain"` carries no media param). ORCH-1289 — up to 10 per message.
  mediaUrls?: string[];
  // ORCH-1289 — marketing sends render the STOP footer on its OWN line (blank
  // line + STOP line) so the delivered SMS matches the composer preview.
  // Transactional sends omit this (default false → single-space footer,
  // byte-identical to the prior behavior + every existing transactional test).
  stopFooterOwnLine?: boolean;
  beforeProviderIo?: () => Promise<void>;
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
export function composeSmsBody(
  message: string,
  stopFooterOwnLine = false,
): string {
  let body = message.trim();
  if (!/reply stop/i.test(body)) {
    // ORCH-1289 — marketing sends put the STOP footer on its OWN line (blank
    // line + STOP line, `\n\n`) so the delivered SMS matches the composer
    // preview (bodyWithFooter). Transactional callers keep the single-space
    // form (default) — `\n` is a GSM-7 char, so segmentation is unaffected.
    const sep = stopFooterOwnLine ? "\n\n" : " ";
    body = `${body}${sep}${STOP_FOOTER}`;
  }
  return sanitizeGsm7(body);
}

// Region routing seam (SPEC §8.4). Today only the US route is live; NG is phased.
// Returns the env var name of the per-market kill-switch for the resolved route.
//
// ===========================================================================
// #1529 — WHY THE `?? "US"` BELOW STILL EXISTS. DO NOT "TIDY" IT AWAY.
// ===========================================================================
// This default, and its twin in send() below, are what turned a MISSING
// country into an AMERICAN one. `notification_outbox.country_code` was written
// by NO producer (proven: 6/6 production rows NULL), so every notification
// arrived here as null, became "US", and every Nigerian text went to Twilio
// under the US kill-switch while `sms_live_enabled.ng` — the switch meant to
// hold Nigeria back — governed nothing at all.
//
// #1529 FIXES THE CAUSE, NOT THIS LINE. Every producer now writes a real
// country (migration 20270211001529_issue_1529_notification_country_code.sql),
// and the Stay producers now enqueue a `+`-prefixed E.164 contact, so an
// SMS-eligible row reaching this adapter carries its true country: a Nigerian
// handset genuinely resolves NG → Termii → `sms_live_enabled.ng`. This
// fallback is therefore no longer LOAD-BEARING for any populated row — it is
// reachable only for a caller that passes no country at all.
//
// IT IS RETAINED DELIBERATELY, NOT OVERLOOKED. #1529's SPEC §4.5 asked for it
// to be deleted, with routing derived from the destination number instead.
// That change WAS implemented and then REVERTED, because it is mutually
// exclusive with the shipped #1518 contract:
// `smsAdapter.issue1518.adversarial.test.ts` ADV B-2 and ADV B-3 pin the
// OPPOSITE rule — that the `countryCode` LABEL is the routing authority, so a
// `+234` destination labelled "US" must be gated by the (dark) US switch
// rather than routed to the (live) NG one. Deriving from `to` fails both of
// those, plus `orch_1161_notify_dispatch_v2.test.ts`'s
// `resolveMarketKillSwitch(null) === "SMS_LIVE_ENABLED_US"`. All three run in
// the `notification-deno-tests` CI job and the #1518 suites are DO-NOT-TOUCH.
// Proven by RUNNING them, not by reading them — see the #1529 implementation
// report for the captured failure output.
//
// THE OPEN QUESTION FOR WHOEVER ADJUDICATES THIS: when the destination number
// and the asserted country disagree, which wins? #1518 says the LABEL, so a
// dark market can never be lit by a mislabelled row. #1529 says the NUMBER, so
// a mislabelled row can never hand a Nigerian handset to Twilio. Both are
// defensible safety postures; they cannot both hold. Pick one deliberately and
// revert the other's test with it — do NOT let the two drift into an
// accidental answer, which is precisely the class of bug that produced #1529.
// ===========================================================================
export function resolveMarketKillSwitch(countryCode?: string | null): string {
  const cc = (countryCode ?? "US").toUpperCase();
  if (cc === "NG") return "SMS_LIVE_ENABLED_NG";
  return "SMS_LIVE_ENABLED_US";
}

function envTrue(name: string): boolean {
  const field = name === "SMS_LIVE_ENABLED_NG"
    ? "sms_live_enabled.ng"
    : "sms_live_enabled.us";
  const raw = resolveDeliveryFlagValue(field, name);
  if (typeof raw === "boolean") return raw;
  return raw === "true" || raw === "1";
}

async function twilioSend(
  to: string,
  body: string,
  messagingServiceSidOverride?: string | null,
  mediaUrls?: string[],
): Promise<
  { ok: boolean; sid?: string; error?: string; blacklisted?: boolean }
> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  // Marketing send passes a separate marketing Messaging Service SID
  // (§12 Q2). When absent, fall back to the approved transactional toll-free.
  const messagingServiceSid =
    messagingServiceSidOverride && messagingServiceSidOverride.length > 0
      ? messagingServiceSidOverride
      : Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  if (!accountSid || !authToken || !messagingServiceSid) {
    return { ok: false, error: "twilio_env_missing" };
  }
  const statusSecret = Deno.env.get("TWILIO_STATUS_CALLBACK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const statusCallback = statusSecret && supabaseUrl
    ? `${supabaseUrl}/functions/v1/twilio-message-status?secret=${
      encodeURIComponent(statusSecret)
    }`
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
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ORCH-1227 (DEC-192) — Termii (Nigeria) sender. Mirrors twilioSend's shape and
// return contract ({ ok, sid?, error?, blacklisted? }). FAIL-CLOSED: if ANY of
// TERMII_API_KEY / TERMII_BASE_URL / TERMII_SENDER_ID is missing, return
// { ok:false, error:"termii_env_missing" } WITHOUT any HTTP call.
//   - POST {TERMII_BASE_URL}/api/sms/send  body { api_key, to, from, sms, type, channel }
//   - `from` is the env sender id (TERMII_SENDER_ID, NCC-approved "Mingla") — a
//     lowercase JSON key, NOT a Twilio raw `From` (the 1161 gate forbids that).
//   - channel: ALWAYS "generic" for every NG send today. #1518 INTERIM — the
//     `dnd` arm of this union is UNREACHABLE (no call site passes it) and is
//     retained ONLY as the #1480 revert target; `dnd` currently returns 400
//     "Country Inactive". See the #1518 block at the top of this file for the
//     nightly-MTN, DND-register and provider-guidance trade-offs this carries.
//   - Success = HTTP 200 with a JSON `message_id` (and/or code:"ok"); map
//     message_id → sid (providerMessageId upstream). Non-200 or missing
//     message_id → failed with the response text in `error`. `blacklisted` true
//     when the response indicates a DND/opt-out rejection.
async function termiiSend(
  to: string,
  body: string,
  channel: "dnd" | "generic",
): Promise<
  { ok: boolean; sid?: string; error?: string; blacklisted?: boolean }
> {
  const apiKey = Deno.env.get("TERMII_API_KEY");
  const baseUrl = resolveRuntimeConfigValue(
    "termii_base_url",
    "TERMII_BASE_URL",
  );
  const senderId = Deno.env.get("TERMII_SENDER_ID");
  if (!apiKey || typeof baseUrl !== "string" || !baseUrl || !senderId) {
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
    const blacklisted = lower.includes("dnd") || lower.includes("blacklist") ||
      lower.includes("opt out") || lower.includes("opt-out");
    if (
      res.ok && typeof data.message_id === "string" &&
      data.message_id.length > 0
    ) {
      return { ok: true, sid: data.message_id };
    }
    return { ok: false, error: `Termii ${res.status}: ${text}`, blacklisted };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const smsAdapter = {
  async send(input: SmsSendInput): Promise<AdapterResult> {
    const to = input.to?.trim() ?? "";
    if (!isValidE164(to)) {
      return {
        ok: false,
        status: "failed",
        providerMessageId: null,
        error: "invalid_recipient",
      };
    }

    // Per-market kill-switch — return skipped WITHOUT any HTTP call when off.
    const killSwitch = resolveMarketKillSwitch(input.countryCode);
    if (!envTrue(killSwitch)) {
      return {
        ok: false,
        status: "skipped",
        providerMessageId: null,
        error: "provider_kill_switch_off",
      };
    }

    const body = composeSmsBody(
      input.message,
      input.stopFooterOwnLine === true,
    );
    const segments = computeSegments(body);

    // ORCH-1227 (DEC-192) — country-routed dual provider behind the region seam.
    // #1518 INTERIM: NG → Termii on `generic` for BOTH transactional and
    // marketing. No NG path emits `dnd` (it 400s "Country Inactive"). Accepted
    // operator decision, NOT the intended design: nightly MTN 20:00-08:00 WAT
    // blackout, DND-registered recipients may never be reached, and it departs
    // from Termii's documented guidance for transactional traffic. Full
    // rationale + revert condition (#1480) in the block at the top of this file.
    // Everything else → Twilio, unchanged.
    //
    // #1529 — SECOND COPY of the `?? "US"` default (the first is inside
    // resolveMarketKillSwitch above, which has the full explanation). These two
    // copies independently decide WHICH MARKET'S KILL SWITCH GOVERNS and WHICH
    // PROVIDER RECEIVES THE MESSAGE, and they can drift apart — #1518's
    // adversarial ADV B-3 exists specifically to catch that split-brain. Keep
    // them normalising identically. #1529 makes this line non-load-bearing by
    // populating country_code at every producer rather than by deleting the
    // default; deleting it is blocked by the #1518 contract described above.
    const cc = (input.countryCode ?? "US").toUpperCase();
    await input.beforeProviderIo?.();
    const result = cc === "NG"
      // NG/Termii is SMS-only — media is intentionally NOT passed (ORCH-1282).
      ? await termiiSend(to, body, "generic")
      : await twilioSend(to, body, input.messagingServiceSid, input.mediaUrls);
    if (!result.ok || !result.sid) {
      return {
        ok: false,
        status: "failed",
        providerMessageId: null,
        segments,
        blacklisted: result.blacklisted ?? false,
        error: result.blacklisted
          ? "recipient_opted_out"
          : result.ok
          ? "provider_protocol_error"
          : result.error?.endsWith("_env_missing")
          ? "provider_config_missing"
          : "provider_unavailable",
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
