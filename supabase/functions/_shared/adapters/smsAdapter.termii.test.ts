// ORCH-1227 (DEC-192) — Nigeria SMS via Termii.
//
// Proves the country-routed dual-provider seam: NG numbers go to Termii (with
// the dnd/generic channel mapping by messageType), every other country stays on
// Twilio, the SMS_LIVE_ENABLED_NG kill-switch makes NG text-dark with ZERO HTTP,
// and missing Termii env FAIL-CLOSED returns failed without a throw.
//
// fails-on-revert: verified — reverting the NG→termiiSend branch (so NG falls
// through to twilioSend) makes the "NG happy path" test hit api.twilio.com
// instead of {TERMII_BASE_URL}/api/sms/send → the
// `assert(capturedUrl.includes("/api/sms/send"))` (and the "never twilio")
// assertion FAIL. Confirmed by tracing the assertions against the reverted
// routing in §send().

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { smsAdapter } from "./smsAdapter.ts";

const TERMII_BASE = "https://v3.api.termii.com";
const NG_INPUT = {
  to: "+2348012345678",
  brandName: "Test Brand",
  message: "Hello from Test Brand",
  countryCode: "NG",
};

function setTermiiEnv() {
  Deno.env.set("TERMII_API_KEY", "tk_test");
  Deno.env.set("TERMII_BASE_URL", TERMII_BASE);
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
}

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

const ALL_KEYS = [
  "SMS_LIVE_ENABLED_NG",
  "TERMII_API_KEY",
  "TERMII_BASE_URL",
  "TERMII_SENDER_ID",
];

Deno.test("smsAdapter NG: transactional → Termii /api/sms/send with channel 'dnd'", async () => {
  const snap = snapshotEnv(ALL_KEYS);
  setTermiiEnv();
  Deno.env.set("SMS_LIVE_ENABLED_NG", "true");

  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(
      new Response(JSON.stringify({ code: "ok", message_id: "tm_123" }), { status: 200 }),
    );
  }) as typeof fetch;

  try {
    const result = await smsAdapter.send({ ...NG_INPUT, messageType: "transactional" });
    assert(
      capturedUrl.includes("/api/sms/send") && capturedUrl.startsWith(TERMII_BASE),
      `expected Termii send URL, got: ${capturedUrl}`,
    );
    assert(!capturedUrl.includes("api.twilio.com"), "NG must NOT hit Twilio");
    assertEquals(capturedBody.channel, "dnd");
    assertEquals(capturedBody.from, "Mingla");
    assertEquals(result.status, "sent");
    assertEquals(result.providerMessageId, "tm_123");
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv(snap);
  }
});

Deno.test("smsAdapter NG: marketing → Termii channel 'generic'", async () => {
  const snap = snapshotEnv(ALL_KEYS);
  setTermiiEnv();
  Deno.env.set("SMS_LIVE_ENABLED_NG", "true");

  let capturedBody: Record<string, unknown> = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(
      new Response(JSON.stringify({ code: "ok", message_id: "tm_456" }), { status: 200 }),
    );
  }) as typeof fetch;

  try {
    const result = await smsAdapter.send({ ...NG_INPUT, messageType: "marketing" });
    assertEquals(capturedBody.channel, "generic");
    assertEquals(result.status, "sent");
    assertEquals(result.providerMessageId, "tm_456");
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv(snap);
  }
});

Deno.test("smsAdapter NG: kill-switch OFF → skipped, ZERO HTTP", async () => {
  const snap = snapshotEnv(ALL_KEYS);
  setTermiiEnv();
  Deno.env.delete("SMS_LIVE_ENABLED_NG"); // unset → off

  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((..._args: unknown[]) => {
    fetchCalls += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;

  try {
    const result = await smsAdapter.send(NG_INPUT);
    assertEquals(result.status, "skipped");
    assert((result.error ?? "").includes("kill_switch_off"), `got: ${result.error}`);
    assertEquals(fetchCalls, 0, "Termii fetch must NOT fire when SMS_LIVE_ENABLED_NG is off");
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv(snap);
  }
});

Deno.test("smsAdapter NG: missing Termii env (switch ON) → failed termii_env_missing, no throw, ZERO HTTP", async () => {
  const snap = snapshotEnv(ALL_KEYS);
  Deno.env.set("SMS_LIVE_ENABLED_NG", "true");
  Deno.env.delete("TERMII_API_KEY");
  Deno.env.delete("TERMII_BASE_URL");
  Deno.env.delete("TERMII_SENDER_ID");

  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((..._args: unknown[]) => {
    fetchCalls += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;

  try {
    const result = await smsAdapter.send(NG_INPUT);
    assertEquals(result.status, "failed");
    assertEquals(result.error, "termii_env_missing");
    assertEquals(fetchCalls, 0, "FAIL-CLOSED: no HTTP when Termii env is missing");
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv(snap);
  }
});

Deno.test("smsAdapter US: regression guard — still hits Twilio, never Termii", async () => {
  const keys = [
    "SMS_LIVE_ENABLED_US",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_MESSAGING_SERVICE_SID",
  ];
  const snap = snapshotEnv(keys);
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tokentest");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MGtest");

  let capturedUrl = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: unknown) => {
    capturedUrl = String(url);
    return Promise.resolve(new Response(JSON.stringify({ sid: "SMtest" }), { status: 201 }));
  }) as typeof fetch;

  try {
    const result = await smsAdapter.send({
      to: "+15551112222",
      brandName: "Test Brand",
      message: "Hello US",
      countryCode: "US",
    });
    assert(capturedUrl.includes("api.twilio.com"), `expected Twilio URL, got: ${capturedUrl}`);
    assert(!capturedUrl.includes("/api/sms/send"), "US must NOT hit Termii");
    assertEquals(result.status, "sent");
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv(snap);
  }
});
