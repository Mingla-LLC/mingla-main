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
// #1529 — the single source of truth for E.164 → ISO-2. The DESTINATION NUMBER
// is the routing authority (operator decision, Seth 2026-08-03).
import { countryFromE164 } from "../e164Country.ts";

export interface AdapterResult {
  ok: boolean;
  status: "sent" | "skipped" | "failed";
  providerMessageId: string | null;
  segments?: number;
  blacklisted?: boolean;
  error?: string;
}

// #1537 — the provider identities this adapter can select between. These are the
// exact strings written to `notification_deliveries.provider`; the column is
// `text NULL` with no CHECK, and both delivery webhooks reconcile by
// `provider_message_id` + `channel`, never by `provider`, so widening the set of
// observed values breaks no reader.
export type SmsProvider = "termii" | "twilio";

// #1537 — the SMS adapter's result carries the provider REQUIRED, not optional.
// Requiring it is the point: `deno check` then refuses to compile a `send()`
// return path that forgets to say who handled (or would have handled) the send,
// which is precisely how the ledger came to describe every Nigerian text as
// Twilio. `null` is reserved for the two outcomes where no provider was ever
// selected (an invalid E.164, and a well-formed number whose calling code is
// unmapped) — there, null is the honest answer and `failed_reason` carries the
// attribution instead.
export interface SmsAdapterResult extends AdapterResult {
  provider: SmsProvider | null;
}

export interface SmsSendInput {
  to: string; // E.164
  brandName: string; // sender identity in the body (CTIA brand-name-in-body)
  message: string; // the body WITHOUT the STOP footer (footer is appended here)
  // #1529 — an OPTIONAL AUDIT ASSERTION, never the routing authority. The
  // market is derived from `to` (the destination handset) and cross-checked
  // against this value; on disagreement the DESTINATION WINS and a warning is
  // logged. Do NOT "restore" this field as primary — a stale or missing label
  // sending a Nigerian handset to Twilio is exactly the #1529 defect.
  countryCode?: string | null;
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
// #1529 — THE DESTINATION NUMBER IS THE ROUTING AUTHORITY. NEVER A DEFAULT.
// ===========================================================================
// WHAT WAS BROKEN: this function used to read `(countryCode ?? "US")`, and
// `notification_outbox.country_code` was written by NO producer (proven: 6/6
// production rows NULL). So every notification arrived as null, became "US",
// and every Nigerian text went to Twilio under the US kill-switch while
// `sms_live_enabled.ng` — the switch meant to hold Nigeria back — governed
// nothing at all. Nigeria was never actually dark.
//
// THE RULE NOW (operator decision, Seth 2026-08-03, issue #1529): when the
// destination number and the asserted `countryCode` label disagree, THE NUMBER
// WINS. Routing follows the physical handset. The label is derived metadata
// and can be stale, missing, or wrong — production proved exactly that with a
// Miami Beach venue under a US-region brand notifying an owner on a Nigerian
// handset.
//
// THIS DOES NOT WEAKEN THE DARK-MARKET GUARANTEE, and that is the crux. Route
// selection and kill-switch selection still share ONE normalization: a `+234`
// number resolves NG, selects `SMS_LIVE_ENABLED_NG`, and while that flag is
// false the send is SKIPPED WITH ZERO HTTP. A dark market still cannot be lit.
// What changed is only which input feeds that single normalization.
//
// NULL IS NOT A COUNTRY. This function no longer invents one — it returns null
// when it is not told a country, and send() below refuses to transmit when the
// destination's calling code is unmapped. Reintroducing a `?? "US"` anywhere in
// this file restores #1529.
// ===========================================================================
export function resolveMarketKillSwitch(
  countryCode: string | null | undefined,
): string | null {
  // #1529 — no country means NO MARKET, not the US market.
  if (countryCode === null || countryCode === undefined) return null;
  const cc = countryCode.toUpperCase();
  if (cc === "NG") return "SMS_LIVE_ENABLED_NG";
  return "SMS_LIVE_ENABLED_US";
}

// ===========================================================================
// #1537 — THE ONE PLACE A COUNTRY BECOMES A PROVIDER NAME.
// ===========================================================================
// WHAT WAS BROKEN: `notifyV2` stamped `notification_deliveries.provider` from a
// per-CHANNEL constant (`sms: "twilio"`) that no send ever consulted. Nigeria
// routes to Termii; the ledger recorded Twilio on every row, and there was not
// one `termii` row in the entire table. The #1529 SC-11 live-fire — a `+234`
// contact held back by the NIGERIA kill switch — recorded `provider=twilio`,
// so the skip could not be attributed to the market that caused it.
//
// THE RULE NOW: routing and reporting read the SAME mapping. `send()` below
// selects its sender through this function, and every non-send outcome reports
// through it too, so "which provider would have handled this" is answerable for
// a kill-switch skip and a policy suppression, not only for a completed send.
// A second, independent country→provider derivation anywhere else re-creates
// the split-brain this removes — call this instead.
export function smsProviderForCountry(countryCode: string): SmsProvider {
  // Normalized on its own line, exactly as `resolveMarketKillSwitch` above does
  // it — the two must agree on what "NG" means, and keeping the literal off the
  // `countryCode` line also keeps the I-PROPOSED-T Stripe-country gate happy
  // without an exemption tag (this is an SMS route, not a payout country).
  const cc = countryCode.toUpperCase();
  return cc === "NG" ? "termii" : "twilio";
}

// #1537 — provider attribution for a DESTINATION, for callers (notifyV2) that
// must label a ledger row on a path where no send was attempted: `can_send`
// denial and the no-contact skip. It runs the SAME validation and the SAME
// derivation `send()` runs, so a caller cannot disagree with the adapter about
// which market a handset belongs to. Returns null exactly where `send()` itself
// refuses to pick a provider — an invalid E.164, or an unmapped calling code.
export function smsProviderForDestination(
  to: string | null | undefined,
): SmsProvider | null {
  const trimmed = to?.trim() ?? "";
  if (!isValidE164(trimmed)) return null;
  const derived = countryFromE164(trimmed);
  if (derived === null) return null;
  return smsProviderForCountry(derived);
}

function envTrue(name: string): boolean {
  const field = name === "SMS_LIVE_ENABLED_NG"
    ? "sms_live_enabled.ng"
    : "sms_live_enabled.us";
  const raw = resolveDeliveryFlagValue(field, name);
  if (typeof raw === "boolean") return raw;
  return raw === "true" || raw === "1";
}

// #1537 — every sender NAMES ITSELF on every return path. `provider` is required
// here, so a sender physically cannot report a result without saying who it is,
// and `send()` reads the name off the RESULT for any outcome that reached a
// sender rather than off the pre-computed selection. That distinction is what
// makes the regression tests falsifiable: if the country→sender branch were
// miswired so a Nigerian number went to `twilioSend`, the row would read
// `twilio` and the NG test would FAIL — whereas a row labelled from the
// selection alone would read `termii` and pass while Twilio did the work.
interface SenderResult {
  ok: boolean;
  provider: SmsProvider;
  sid?: string;
  error?: string;
  blacklisted?: boolean;
}

async function twilioSend(
  to: string,
  body: string,
  messagingServiceSidOverride?: string | null,
  mediaUrls?: string[],
): Promise<SenderResult> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  // Marketing send passes a separate marketing Messaging Service SID
  // (§12 Q2). When absent, fall back to the approved transactional toll-free.
  const messagingServiceSid =
    messagingServiceSidOverride && messagingServiceSidOverride.length > 0
      ? messagingServiceSidOverride
      : Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  if (!accountSid || !authToken || !messagingServiceSid) {
    return { ok: false, provider: "twilio", error: "twilio_env_missing" };
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
      return {
        ok: false,
        provider: "twilio",
        error: `Twilio ${res.status}: ${text}`,
        blacklisted,
      };
    }
    const data = (await res.json()) as { sid?: string };
    return { ok: true, provider: "twilio", sid: data.sid };
  } catch (err) {
    return {
      ok: false,
      provider: "twilio",
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
): Promise<SenderResult> {
  const apiKey = Deno.env.get("TERMII_API_KEY");
  const baseUrl = resolveRuntimeConfigValue(
    "termii_base_url",
    "TERMII_BASE_URL",
  );
  const senderId = Deno.env.get("TERMII_SENDER_ID");
  if (!apiKey || typeof baseUrl !== "string" || !baseUrl || !senderId) {
    return { ok: false, provider: "termii", error: "termii_env_missing" };
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
      return { ok: true, provider: "termii", sid: data.message_id };
    }
    return {
      ok: false,
      provider: "termii",
      error: `Termii ${res.status}: ${text}`,
      blacklisted,
    };
  } catch (err) {
    return {
      ok: false,
      provider: "termii",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const smsAdapter = {
  async send(input: SmsSendInput): Promise<SmsAdapterResult> {
    const to = input.to?.trim() ?? "";
    if (!isValidE164(to)) {
      return {
        ok: false,
        status: "failed",
        providerMessageId: null,
        // #1537 — no provider was selected and none would have been: the input
        // is not a routable destination. `failed_reason=invalid_recipient` is
        // the attribution here; a market label would be fabricated.
        provider: null,
        error: "invalid_recipient",
      };
    }

    // #1529 — resolve the market from the DESTINATION NUMBER. `to` has already
    // passed isValidE164 immediately above, so this derives from a value the
    // adapter has itself validated rather than from a caller-supplied label.
    const derived = countryFromE164(to);
    if (derived === null) {
      // Unreachable for any mapped calling code, because isValidE164 has
      // already passed — this fires only for a well-formed E.164 whose calling
      // code is not in the e164Country table. On a money-adjacent path the
      // correct answer to "we do not know which market governs this handset"
      // is to NOT SEND. Fail closed, before the kill-switch check and before
      // beforeProviderIo, with zero provider HTTP.
      return {
        ok: false,
        status: "skipped",
        providerMessageId: null,
        // #1537 — the market is unknown, so the provider is genuinely unknown.
        // Naming one here would be the same fabrication this issue removes.
        provider: null,
        error: "country_unresolved",
      };
    }
    // `input.countryCode` is an ASSERTION, cross-checked and logged, never the
    // authority. A wrong label must never be able to move a handset onto the
    // wrong provider — that is the #1529 defect — and it must equally never be
    // able to take live SMS down, so a mismatch WARNS and continues.
    if (
      input.countryCode !== null && input.countryCode !== undefined &&
      input.countryCode.toUpperCase() !== derived
    ) {
      console.warn(
        JSON.stringify({
          event: "sms_country_assertion_mismatch",
          asserted: input.countryCode,
          derived,
          note: "#1529 destination number wins; label is advisory",
        }),
      );
    }
    const cc = derived;
    // #1537 — decided ONCE, from the same `cc` that picks the kill switch, and
    // used for BOTH the ledger label and the sender selection below. A skip must
    // still be attributable to a market, so this is computed BEFORE the
    // kill-switch check rather than inside the send branch.
    const selectedProvider = smsProviderForCountry(cc);

    // Per-market kill-switch — return skipped WITHOUT any HTTP call when off.
    // Same single normalization feeds BOTH this and the provider choice below.
    const killSwitch = resolveMarketKillSwitch(cc);
    if (killSwitch === null || !envTrue(killSwitch)) {
      return {
        ok: false,
        status: "skipped",
        providerMessageId: null,
        // #1537 — the provider that WOULD have handled this send. Reporting it
        // is the whole point of the skip case: the #1529 SC-11 probe recorded
        // `twilio` on a `+234` contact gated by the NIGERIA switch, which made
        // the kill switch's own effect unprovable from the ledger.
        provider: selectedProvider,
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
    // #1529 — there is now exactly ONE `cc`, derived once from the destination
    // number above and used for BOTH the kill-switch and this provider choice.
    // The two independent `(input.countryCode ?? "US")` copies that used to sit
    // here and in resolveMarketKillSwitch are GONE: they could drift apart and
    // route a message as one market while gating it under another, which is the
    // split-brain #1518's ADV B-3 exists to catch.
    //
    // #1537 — the branch now switches on `selectedProvider`, the SAME value
    // reported to the ledger, so route and label cannot drift apart. The
    // reported name on the two paths below is taken off `result`, i.e. from the
    // sender that actually ran, not from this selection.
    await input.beforeProviderIo?.();
    const result = selectedProvider === "termii"
      // NG/Termii is SMS-only — media is intentionally NOT passed (ORCH-1282).
      ? await termiiSend(to, body, "generic")
      : await twilioSend(to, body, input.messagingServiceSid, input.mediaUrls);
    if (!result.ok || !result.sid) {
      return {
        ok: false,
        status: "failed",
        providerMessageId: null,
        segments,
        provider: result.provider,
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
      // #1537 — reported by the sender that produced `result.sid`, so the
      // ledger's provider and its provider_message_id always come from the
      // same place. The two delivery webhooks reconcile by
      // provider_message_id + channel, so this pairing is what makes a Termii
      // callback land against a row that admits it is a Termii row.
      provider: result.provider,
    };
  },
};
