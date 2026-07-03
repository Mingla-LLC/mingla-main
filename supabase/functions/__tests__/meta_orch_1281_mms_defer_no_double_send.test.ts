// META-ORCH-1281 (ORCH-1282) — TESTER-authored adversarial regression.
//
// ANGLE (different from the implementor's source-contract tests AND from the
// existing ORCH-1270 fds1 unit, neither of which ever threads MMS media): drive
// the REAL shipped idempotency + disposition helpers together with the REAL
// smsAdapter across a full defer → in-window-send → lost-terminal-write →
// cron-re-pick sequence, WITH an MMS media_url present, over a mixed US/NG
// audience. Proves the ORCH-1270 anti-double-send machinery still holds when
// media rides the send (I-PROPOSED-1270 intact under 1282) and enforces the
// per-market media rule (I-PROPOSED-1282-MMS-NG-DROPS-MEDIA) end-to-end:
//   1. A deferred (out-of-window) recipient triggers NO provider call — media is
//      never sent early.
//   2. An in-window recipient is dispatched to Twilio EXACTLY ONCE with its
//      MediaUrl — even after a LOST terminal write leaves the row at the
//      non-terminal 'queued' status carrying a provider_message_id and cron
//      re-picks the campaign. The MediaUrl is transmitted exactly ONCE (no
//      double MMS-send).
//   3. The NG recipient in the same audience routes to Termii and NEVER carries
//      any media param (SMS-only).
//
// This composes the REAL exported functions (no re-implementation):
//   - shouldSkipDispatchedRecipient  (marketing-send/index.ts)  — the F-DS-1 guard
//   - decideSmsDisposition           (marketing-send/index.ts)  — defer/send/fail
//   - smsAdapter.send                (_shared/adapters/smsAdapter.ts) — MediaUrl
//
// Run:
//   deno test --allow-env --allow-net --allow-read --no-check \
//     supabase/functions/__tests__/meta_orch_1281_mms_defer_no_double_send.test.ts
//
// FAILS-ON-REVERT (cited points):
//   • Revert the `provider_message_id` branch of shouldSkipDispatchedRecipient
//     (marketing-send/index.ts ~line 116, back to a terminal-only check) → the
//     'queued'+provider_id orphan is NO LONGER skipped on the cron re-pick pass
//     → the US recipient is texted a SECOND time WITH its media →
//     `twilioMediaUrlSends === 1` FAILS (becomes 2). [double-send hole reopens]
//   • Revert the `params.append("MediaUrl", u)` loop in twilioSend
//     (smsAdapter.ts ~line 161) → the Twilio body never carries MediaUrl →
//     `twilioMediaUrlSends === 1` FAILS (becomes 0). [media stops riding]
//   • Revert the adapter's NG→Termii routing so NG hits Twilio with mediaUrls →
//     `ngHitTwilio === false` / `ngMediaParamSeen === false` FAIL. [NG leaks media]

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  decideSmsDisposition,
  shouldSkipDispatchedRecipient,
} from "../marketing-send/index.ts";
import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";

const t = (name: string, fn: () => void | Promise<void>) =>
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });

const MEDIA_URL =
  "https://x.supabase.co/storage/v1/object/public/brand_covers/brand-1/marketing-mms/tok.jpg";

// Deterministic clocks (UTC). +1 area code 212 → America/New_York.
//   OUT of window: 05:00 EDT  = 09:00Z (before the 08:00 local open) → DEFER.
//   IN  window:    10:00 EDT  = 14:00Z (inside 08:00–21:00 local)    → SEND.
const OUT_OF_WINDOW = new Date("2026-06-15T09:00:00Z");
const IN_WINDOW = new Date("2026-06-15T14:00:00Z");

function setDualEnv() {
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tokentest");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MGtest");
  Deno.env.set("SMS_LIVE_ENABLED_NG", "true");
  Deno.env.set("TERMII_API_KEY", "tk_test");
  Deno.env.set("TERMII_BASE_URL", "https://v3.api.termii.com");
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
}

interface MsgRow {
  status: string;
  provider_message_id: string | null;
  attempt_count?: number | null;
  created_at?: string | null;
}

/**
 * A faithful re-tracing of the marketing-send SMS loop's PER-RECIPIENT decision
 * order for ONE recipient (the parts that matter for media + idempotency),
 * using the REAL shipped helpers + the REAL adapter. Returns the action taken.
 * The in-memory `store` mimics the marketing_messages upsert(onConflict phone).
 */
async function sendLoopPass(
  store: Map<string, MsgRow>,
  contact: { phone: string; cc: string },
  mediaUrls: string[],
  now: Date,
): Promise<string> {
  const existing = store.get(contact.phone) ?? null;

  // Rule 1 (F-DS-1) — the REAL shipped guard. Terminal OR already-dispatched → skip.
  if (shouldSkipDispatchedRecipient(existing)) return "skipped";

  // Rules 2–4 — the REAL shipped disposition helper.
  const disp = decideSmsDisposition(contact.phone, contact.cc, now, existing);
  if (disp.action === "fail") {
    store.set(contact.phone, { status: "failed", provider_message_id: null });
    return "failed";
  }
  if (disp.action === "defer") {
    // Deferred rows carry NO provider call and NO media — held for next window.
    store.set(contact.phone, {
      status: "deferred",
      provider_message_id: null,
      attempt_count: disp.attempt_count,
      created_at: existing?.created_at ?? now.toISOString(),
    });
    return "defer";
  }

  // action === "send" — media rides here (US) / is dropped by the adapter (NG).
  const result = await smsAdapter.send({
    to: contact.phone,
    brandName: "Test Brand",
    message: "Look at this",
    countryCode: contact.cc,
    messageType: "marketing",
    mediaUrls,
  });
  if (result.status === "sent") {
    // NORMALLY this persists {status:'sent', provider_message_id}. The caller
    // decides whether to simulate the F-DS-1 lost-terminal-write orphan.
    store.set(contact.phone, {
      status: "sent",
      provider_message_id: result.providerMessageId,
    });
  } else {
    store.set(contact.phone, { status: "failed", provider_message_id: null });
  }
  return result.status;
}

t("MMS media survives defer→send→lost-write→cron-repick with NO double-send; NG drops media", async () => {
  setDualEnv();

  // Instrument the provider HTTP. Count how many Twilio POSTs carried a MediaUrl,
  // and capture whether NG ever hit Twilio / carried any media param.
  let twilioMediaUrlSends = 0;
  let twilioSendsTotal = 0;
  let ngHitTwilio = false;
  let ngMediaParamSeen = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    const u = String(url);
    const bodyStr = String(init?.body ?? "");
    if (u.includes("api.twilio.com")) {
      twilioSendsTotal += 1;
      if (bodyStr.includes("MediaUrl=")) twilioMediaUrlSends += 1;
      // Detect NG (+234…) leaking into the Twilio path.
      if (bodyStr.includes("To=%2B234") || bodyStr.includes("To=+234")) {
        ngHitTwilio = true;
        if (bodyStr.includes("MediaUrl=")) ngMediaParamSeen = true;
      }
      return Promise.resolve(
        new Response(JSON.stringify({ sid: `SM${twilioSendsTotal}` }), { status: 201 }),
      );
    }
    // Termii (NG). Assert the JSON payload never smuggles media in any key.
    if (u.includes("/api/sms/send")) {
      const parsed = JSON.parse(bodyStr || "{}");
      if ("MediaUrl" in parsed || "media_urls" in parsed || "media" in parsed) {
        ngMediaParamSeen = true;
      }
      return Promise.resolve(
        new Response(JSON.stringify({ code: "ok", message_id: "tm_1" }), { status: 200 }),
      );
    }
    return realFetch(url as string, init);
  }) as typeof fetch;

  try {
    const store = new Map<string, MsgRow>();
    const us = { phone: "+12125551234", cc: "US" }; // NY area code → America/New_York
    const ng = { phone: "+2348012345678", cc: "NG" };

    // ── PASS 1 — campaign fires while the US recipient is OUT of window ─────────
    const p1 = await sendLoopPass(store, us, [MEDIA_URL], OUT_OF_WINDOW);
    assertEquals(p1, "defer"); // held; no provider call yet
    assertEquals(twilioSendsTotal, 0, "deferred recipient must NOT hit Twilio");
    assertEquals(store.get(us.phone)?.provider_message_id ?? null, null);

    // ── PASS 2 — cron re-pick in-window → send WITH media (the dispatch) ────────
    const p2 = await sendLoopPass(store, us, [MEDIA_URL], IN_WINDOW);
    assertEquals(p2, "sent");
    assertEquals(twilioSendsTotal, 1, "exactly one Twilio dispatch so far");
    assertEquals(twilioMediaUrlSends, 1, "the MMS MediaUrl rode the send once");

    // ── SIMULATE the F-DS-1 orphan: the post-send terminal UPDATE was LOST, so
    //    the row lingers NON-terminal ('queued') but STILL carries provider_id.
    const dispatchedId = store.get(us.phone)?.provider_message_id ?? null;
    assert(dispatchedId !== null, "dispatch must have produced a provider_message_id");
    store.set(us.phone, { status: "queued", provider_message_id: dispatchedId });

    // ── PASS 3 — a deferred sibling re-parked the campaign to 'scheduled'; cron
    //    re-picks it IN-WINDOW. The orphan MUST be skipped (never re-texted). ───
    const p3 = await sendLoopPass(store, us, [MEDIA_URL], IN_WINDOW);
    assertEquals(p3, "skipped", "already-dispatched (provider_id) orphan must be SKIPPED");

    // The core anti-double-send + media invariant: across the whole sequence the
    // US recipient hit Twilio ONCE and the MediaUrl was transmitted ONCE.
    assertEquals(twilioSendsTotal, 1, "NO double-send: exactly one Twilio POST for the US recipient");
    assertEquals(twilioMediaUrlSends, 1, "the MMS media rode Twilio EXACTLY once (no duplicate MMS)");

    // ── NG recipient in the same audience → Termii, SMS-only, no media ─────────
    const ngResult = await sendLoopPass(store, ng, [MEDIA_URL], IN_WINDOW);
    assertEquals(ngResult, "sent");
    assertEquals(ngHitTwilio, false, "NG must NOT route through Twilio");
    assertEquals(ngMediaParamSeen, false, "NG/Termii must carry NO media param (SMS-only)");
    // Twilio dispatch count is unchanged by the NG send.
    assertEquals(twilioSendsTotal, 1, "NG send must not add a Twilio POST");
  } finally {
    globalThis.fetch = realFetch;
  }
});
