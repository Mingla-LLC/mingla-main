// META-ORCH-1161 Sub-B — per-market SMS kill-switch.
//
// Proves: with SMS_LIVE_ENABLED_US unset/false, smsAdapter.send() returns
// status='skipped' WITHOUT making any Twilio HTTP call (ZERO fetch). With it
// set true, the Twilio HTTP path IS exercised.
//
// Fails-on-revert: delete the `if (!envTrue(killSwitch)) return skipped` guard
// in smsAdapter.send() → fetch fires even when the switch is off → the
// "fetch never called" assertion FAILS.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { smsAdapter } from "./smsAdapter.ts";

const VALID_INPUT = {
  to: "+15551112222",
  brandName: "Test Brand",
  message: "Hello from Test Brand",
  countryCode: "US",
};

Deno.test("smsAdapter: kill-switch OFF → skipped, ZERO Twilio HTTP", async () => {
  const prev = Deno.env.get("SMS_LIVE_ENABLED_US");
  Deno.env.delete("SMS_LIVE_ENABLED_US"); // unset → off by default

  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((..._args: unknown[]) => {
    fetchCalls += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;

  try {
    const result = await smsAdapter.send(VALID_INPUT);
    assertEquals(result.status, "skipped");
    assertEquals(result.ok, false);
    assert(
      (result.error ?? "").includes("kill_switch_off"),
      `expected kill_switch_off error, got: ${result.error}`,
    );
    // The contract: NO Twilio HTTP when the market switch is off.
    assertEquals(fetchCalls, 0, "Twilio fetch must NOT be called when kill-switch is off");
  } finally {
    globalThis.fetch = realFetch;
    if (prev === undefined) Deno.env.delete("SMS_LIVE_ENABLED_US");
    else Deno.env.set("SMS_LIVE_ENABLED_US", prev);
  }
});

Deno.test("smsAdapter: kill-switch ON → Twilio HTTP IS attempted", async () => {
  const prevSwitch = Deno.env.get("SMS_LIVE_ENABLED_US");
  const prevAcct = Deno.env.get("TWILIO_ACCOUNT_SID");
  const prevToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const prevMsid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tokentest");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MGtest");

  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((..._args: unknown[]) => {
    fetchCalls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ sid: "SMtest" }), { status: 201 }),
    );
  }) as typeof fetch;

  try {
    const result = await smsAdapter.send(VALID_INPUT);
    assertEquals(result.status, "sent");
    assertEquals(fetchCalls, 1, "Twilio fetch MUST be called when kill-switch is on");
  } finally {
    globalThis.fetch = realFetch;
    const restore = (k: string, v: string | undefined) =>
      v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    restore("SMS_LIVE_ENABLED_US", prevSwitch);
    restore("TWILIO_ACCOUNT_SID", prevAcct);
    restore("TWILIO_AUTH_TOKEN", prevToken);
    restore("TWILIO_MESSAGING_SERVICE_SID", prevMsid);
  }
});

Deno.test("smsAdapter: marketing SID override is used over the transactional SID", async () => {
  const prevSwitch = Deno.env.get("SMS_LIVE_ENABLED_US");
  const prevAcct = Deno.env.get("TWILIO_ACCOUNT_SID");
  const prevToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const prevMsid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tokentest");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG_transactional");

  let capturedBody = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    return Promise.resolve(
      new Response(JSON.stringify({ sid: "SMtest" }), { status: 201 }),
    );
  }) as typeof fetch;

  try {
    await smsAdapter.send({ ...VALID_INPUT, messagingServiceSid: "MG_marketing" });
    assert(
      capturedBody.includes("MG_marketing"),
      `expected marketing SID in request body, got: ${capturedBody}`,
    );
    assert(
      !capturedBody.includes("MG_transactional"),
      "transactional SID must NOT be used when a marketing override is passed",
    );
  } finally {
    globalThis.fetch = realFetch;
    const restore = (k: string, v: string | undefined) =>
      v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    restore("SMS_LIVE_ENABLED_US", prevSwitch);
    restore("TWILIO_ACCOUNT_SID", prevAcct);
    restore("TWILIO_AUTH_TOKEN", prevToken);
    restore("TWILIO_MESSAGING_SERVICE_SID", prevMsid);
  }
});
