// Issue #1518 — Nigeria transactional SMS rides Termii's `generic` channel.
//
// IMPLEMENTOR HAPPY-PATH REGRESSION TEST.
//
// WHY THIS EXISTS. DEC-192 (ORCH-1227) routed NG transactional SMS to Termii's
// `dnd` channel. A live probe against the production Termii account (#1480,
// 2026-08-03 19:19-19:20 WAT) proved `dnd` returns HTTP 400 {"code":400,
// "message":"Country Inactive. Contact Administrator to activate country.",
// "status":"error"} — the DND route was never activated — while the identical
// request on `generic` returned message_id 3017857812138224517130997 with a
// ₦5.00 debit and terminal provider status "Delivered". Because `messageType`
// defaults to "transactional", 100% of Nigerian booking confirmations were
// hitting the dead channel.
//
// WHAT THIS PINS. Four contracts, per #1518 Acceptance:
//   T-1  NG transactional  → channel "generic" (explicit messageType).
//   T-2  NG marketing      → channel "generic".
//   T-2b NG default class  → channel "generic" (messageType OMITTED — this is
//        the real production shape, and the case DEC-192 broke).
//   T-3  non-NG            → Twilio, byte-identical: MessagingServiceSid, no
//        raw From, no `channel` param, and Termii never contacted.
//   T-4  transactional STOP-footer semantics UNCHANGED — single-space footer,
//        never the marketing own-line "\n\n" form. Footer rendering keys off
//        `stopFooterOwnLine`/`messageType`, NEVER off the provider channel, so
//        moving the channel must not bleed a marketing footer into
//        transactional. T-4b proves the marketing own-line form still works.
//
// THIS IS AN INTERIM, NOT THE INTENDED DESIGN. Accepted operator decision
// (Seth, 2026-08-03). It carries a nightly MTN blackout (generic is restricted
// for Nigerian MTN numbers 20:00-08:00 WAT), it is NOT the NCC Do-Not-Disturb
// corporate route so DND-registered recipients may never be reached, and it
// departs from Termii's documented guidance against transactional traffic on
// `generic`. When #1480 lands DND activation, T-1 reverts to "dnd" alongside
// the adapter mapping, the strict-grep gate, and the invariant.
//
// fails-on-revert: restoring `input.messageType === "marketing" ? "generic"
// : "dnd"` at the NG call site in smsAdapter.ts makes T-1 and T-2b FAIL
// (channel "dnd" !== "generic"). Proven by true line deletion, not comment-out
// — hash recorded in the #1518 implementation report.

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { smsAdapter } from "./smsAdapter.ts";

// ===========================================================================
// #2218 — PIN THE CLOCK. ADDITIVE; NO ASSERTION BELOW IS CHANGED OR REMOVED.
// ===========================================================================
// Nigerian operators refuse Termii's `generic` route 20:00-08:00 WAT
// (https://developers.termii.com/campaign), and since #2218 the adapter DEFERS
// a Nigerian send inside that window instead of handing it to a route that
// cannot carry it. Every assertion in this file that expects a +234 send to
// reach Termii was therefore, before this line, silently also asserting "…and
// CI happens to be running between 08:00 and 20:00 WAT" — true for thirteen
// hours a day and red for the other eleven.
//
// Pinning the module clock to 12:00 WAT makes those assertions mean what they
// were always written to mean: given the network is carrying traffic, this is
// the route, the channel and the payload. The complementary behaviour — that
// the SAME call DEFERS at 21:00 and at 03:00 — is asserted in
// smsAdapter.issue2218.test.ts, which pins its own instants per case.
import { __pinNgClockInsideWindow } from "../ngSmsEmbargo.ts";
__pinNgClockInsideWindow();


const TERMII_BASE = "https://v3.api.termii.com";
const MESSAGE = "Hello from Test Brand";
const NG_INPUT = {
  to: "+2348012345678",
  brandName: "Test Brand",
  message: MESSAGE,
  countryCode: "NG",
};

const NG_KEYS = [
  "SMS_LIVE_ENABLED_NG",
  "TERMII_API_KEY",
  "TERMII_BASE_URL",
  "TERMII_SENDER_ID",
];
const US_KEYS = [
  "SMS_LIVE_ENABLED_US",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
];

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of keys) snap[k] = Deno.env.get(k);
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
}

function setNgEnvLive() {
  Deno.env.set("TERMII_API_KEY", "tk_test");
  Deno.env.set("TERMII_BASE_URL", TERMII_BASE);
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
  Deno.env.set("SMS_LIVE_ENABLED_NG", "true");
}

interface Captured {
  urls: string[];
  bodies: Record<string, unknown>[];
}

// Stub fetch, run the send, hand back everything the adapter put on the wire.
async function captureSend(
  input: Parameters<typeof smsAdapter.send>[0],
  providerResponse: Response,
): Promise<{ captured: Captured; result: Awaited<ReturnType<typeof smsAdapter.send>> }> {
  const captured: Captured = { urls: [], bodies: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    captured.urls.push(String(url));
    const raw = String(init?.body ?? "");
    try {
      captured.bodies.push(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      // Twilio sends URLSearchParams (form-encoded), not JSON.
      const parsed: Record<string, unknown> = {};
      for (const [k, v] of new URLSearchParams(raw)) parsed[k] = v;
      captured.bodies.push(parsed);
    }
    return Promise.resolve(providerResponse.clone());
  }) as typeof fetch;
  try {
    const result = await smsAdapter.send(input);
    return { captured, result };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const termiiOk = () =>
  new Response(
    JSON.stringify({ code: "ok", message_id: "tm_1518", message: "Successfully Sent" }),
    { status: 200 },
  );

// ---------------------------------------------------------------------------
// T-1 — NG transactional rides `generic`. The whole point of #1518.
// ---------------------------------------------------------------------------
Deno.test("#1518 T-1: NG transactional POSTs channel 'generic' to Termii, never 'dnd'", async () => {
  const snap = snapshotEnv(NG_KEYS);
  setNgEnvLive();
  try {
    const { captured, result } = await captureSend(
      { ...NG_INPUT, messageType: "transactional" },
      termiiOk(),
    );

    assertEquals(captured.urls.length, 1, "exactly one provider call");
    assert(
      captured.urls[0].startsWith(TERMII_BASE) &&
        captured.urls[0].includes("/api/sms/send"),
      `expected Termii send URL, got: ${captured.urls[0]}`,
    );
    assertEquals(captured.bodies[0].channel, "generic");
    // The provider-proven negative: `dnd` 400s "Country Inactive" (#1480).
    assertNotEquals(
      captured.bodies[0].channel,
      "dnd",
      "NG transactional must NOT emit the dead `dnd` channel",
    );
    assertEquals(captured.bodies[0].from, "Mingla");
    assertEquals(result.status, "sent");
    assertEquals(result.providerMessageId, "tm_1518");
  } finally {
    restoreEnv(snap);
  }
});

// ---------------------------------------------------------------------------
// T-2 — NG marketing stays on `generic` (unchanged by #1518, pinned explicitly
// so a future edit cannot "fix" one class and silently move the other).
// ---------------------------------------------------------------------------
Deno.test("#1518 T-2: NG marketing POSTs channel 'generic'", async () => {
  const snap = snapshotEnv(NG_KEYS);
  setNgEnvLive();
  try {
    const { captured, result } = await captureSend(
      { ...NG_INPUT, messageType: "marketing" },
      termiiOk(),
    );
    assertEquals(captured.bodies[0].channel, "generic");
    assertNotEquals(captured.bodies[0].channel, "dnd");
    assertEquals(result.status, "sent");
  } finally {
    restoreEnv(snap);
  }
});

// ---------------------------------------------------------------------------
// T-2b — messageType OMITTED. This is the shape production actually sends
// (booking confirmations never set it), and the exact case DEC-192 broke:
// the default fell through to `dnd`, so 100% of NG confirmations 400'd.
// ---------------------------------------------------------------------------
Deno.test("#1518 T-2b: NG with messageType omitted (production default) POSTs 'generic'", async () => {
  const snap = snapshotEnv(NG_KEYS);
  setNgEnvLive();
  try {
    const { captured, result } = await captureSend({ ...NG_INPUT }, termiiOk());
    assertEquals(captured.bodies[0].channel, "generic");
    assertNotEquals(
      captured.bodies[0].channel,
      "dnd",
      "the default (transactional) class must not fall through to `dnd`",
    );
    assertEquals(result.status, "sent");
  } finally {
    restoreEnv(snap);
  }
});

// ---------------------------------------------------------------------------
// T-3 — the Twilio (US/RoW) path is untouched by #1518. Hard guard.
// ---------------------------------------------------------------------------
Deno.test("#1518 T-3: non-NG still routes to Twilio with MessagingServiceSid, no channel param, never Termii", async () => {
  const snap = snapshotEnv(US_KEYS);
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tokentest");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MGtest");
  try {
    const { captured, result } = await captureSend(
      {
        to: "+15551112222",
        brandName: "Test Brand",
        message: "Hello US",
        countryCode: "US",
        messageType: "transactional",
      },
      new Response(JSON.stringify({ sid: "SMtest" }), { status: 201 }),
    );

    assert(
      captured.urls[0].includes("api.twilio.com"),
      `expected Twilio URL, got: ${captured.urls[0]}`,
    );
    assert(!captured.urls[0].includes("/api/sms/send"), "non-NG must NOT hit Termii");
    // Byte-identical Twilio contract: approved sender, never a raw From, and no
    // Termii channel vocabulary leaking across the seam.
    assertEquals(captured.bodies[0].MessagingServiceSid, "MGtest");
    assertEquals(captured.bodies[0].From, undefined, "never a raw From number");
    assertEquals(captured.bodies[0].channel, undefined, "Twilio carries no `channel` param");
    assertEquals(captured.bodies[0].generic, undefined);
    assertEquals(result.status, "sent");
    assertEquals(result.providerMessageId, "SMtest");
  } finally {
    restoreEnv(snap);
  }
});

// ---------------------------------------------------------------------------
// T-4 — STOP-footer semantics. Explicitly OUT of scope for #1518, pinned here
// so the channel move cannot change it as a side effect. Footer shape keys off
// `stopFooterOwnLine` (a messageType-driven caller decision), NEVER the channel.
// ---------------------------------------------------------------------------
Deno.test("#1518 T-4: NG transactional keeps the single-space STOP footer (no marketing own-line bleed)", async () => {
  const snap = snapshotEnv(NG_KEYS);
  setNgEnvLive();
  try {
    const { captured } = await captureSend(
      { ...NG_INPUT, messageType: "transactional" },
      termiiOk(),
    );
    const sms = String(captured.bodies[0].sms);
    assertEquals(sms, `${MESSAGE} Reply STOP to opt out.`);
    assert(
      !sms.includes("\n\n"),
      `transactional must NOT get the marketing own-line footer, got: ${JSON.stringify(sms)}`,
    );
  } finally {
    restoreEnv(snap);
  }
});

Deno.test("#1518 T-4b: NG marketing still renders the own-line STOP footer when requested", async () => {
  const snap = snapshotEnv(NG_KEYS);
  setNgEnvLive();
  try {
    const { captured } = await captureSend(
      { ...NG_INPUT, messageType: "marketing", stopFooterOwnLine: true },
      termiiOk(),
    );
    assertEquals(
      String(captured.bodies[0].sms),
      `${MESSAGE}\n\nReply STOP to opt out.`,
    );
  } finally {
    restoreEnv(snap);
  }
});
