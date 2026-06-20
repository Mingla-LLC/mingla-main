// META-ORCH-1161 Sub-B — TESTER ADVERSARIAL (different angle than the implementor).
//
// The implementor's smsAdapter.killswitch.test.ts proves the kill-switch for a
// SINGLE recipient in isolation, and marketingAudience.sms-suppression.test.ts
// proves audience-level reach exclusion. NEITHER proves:
//
//   (A) PARTIAL-BATCH / PER-RECIPIENT KILL-SWITCH ROUTING — a marketing blast is
//       a per-recipient loop where the kill-switch is resolved from EACH
//       recipient's countryCode (marketing-send/index.ts sendSms -> smsAdapter
//       .send({ countryCode })). A mixed US+NG batch where only one market is
//       enabled must dispatch ONLY the enabled market and emit ZERO Twilio HTTP
//       for the disabled one. A naive "global switch" implementation would pass
//       the implementor's single-recipient test yet leak the other market.
//
//   (B) KILL-SWITCH x LIVE-FLAG DEFENSE-IN-DEPTH — even with the equivalent of
//       MARKETING_SEND_LIVE_ENABLED=true (i.e. we DO reach smsAdapter.send),
//       the per-market switch OFF must still produce status='skipped' with ZERO
//       HTTP across an ENTIRE batch. This is the "live but text-dark" contract.
//
//   (C) DIGITS-ONLY-KEY PARTIAL-BATCH SUPPRESSION ISOLATION — a suppression key
//       stored as bare digits ("15553334444", no '+') must suppress EXACTLY the
//       matching E.164 number in a 3-recipient batch and leave the OTHER two
//       reachable. Proves phoneKeysOf normalization does not over- or
//       under-match across a batch (the implementor's test is a 2-row
//       email-vs-sms check, not a 3-row cross-number isolation check).
//
// Fails-on-revert:
//   - Delete the `if (!envTrue(killSwitch)) return skipped` guard in
//     smsAdapter.send() -> (A) and (B) FAIL (fetch fires for the disabled market
//     / the whole batch).
//   - Delete the `!phoneSuppressed` clause in aggregate() -> (C) FAILS (the
//     digits-only-suppressed phone counts as reachable_sms again).

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { smsAdapter } from "./smsAdapter.ts";
import { aggregate } from "../marketingAudience.ts";

const realFetch = globalThis.fetch;

function stubFetch(): { count: () => number; bodies: string[]; restore: () => void } {
  let calls = 0;
  const bodies: string[] = [];
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    calls += 1;
    bodies.push(String(init?.body ?? ""));
    return Promise.resolve(
      new Response(JSON.stringify({ sid: `SM${calls}` }), { status: 201 }),
    );
  }) as typeof fetch;
  return { count: () => calls, bodies, restore: () => { globalThis.fetch = realFetch; } };
}

function snapshotEnv(keys: string[]): () => void {
  const prev = new Map<string, string | undefined>();
  for (const k of keys) prev.set(k, Deno.env.get(k));
  return () => {
    for (const [k, v] of prev) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  };
}

const ENV_KEYS = [
  "SMS_LIVE_ENABLED_US",
  "SMS_LIVE_ENABLED_NG",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
];

// (A) + (B): mixed-market batch, only US enabled. NG recipient must skip with
// ZERO HTTP; US recipient dispatches exactly one HTTP. Simulates the per-recipient
// send loop in marketing-send/sendSms.
Deno.test("ADVERSARIAL: mixed US+NG batch, only US enabled -> NG skipped with ZERO HTTP, US sent once", async () => {
  const restoreEnv = snapshotEnv(ENV_KEYS);
  const f = stubFetch();
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  Deno.env.delete("SMS_LIVE_ENABLED_NG"); // NG market still text-dark
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MGtest");

  try {
    const batch = [
      { to: "+15551112222", countryCode: "US" },
      { to: "+2348012345678", countryCode: "NG" },
    ];
    const results = [];
    for (const r of batch) {
      results.push(
        await smsAdapter.send({ to: r.to, brandName: "Acme", message: "Hi", countryCode: r.countryCode }),
      );
    }
    const us = results[0];
    const ng = results[1];

    assertEquals(us.status, "sent", "US recipient should dispatch when US switch is on");
    assertEquals(ng.status, "skipped", "NG recipient must be skipped — NG switch is off");
    assert(
      (ng.error ?? "").includes("SMS_LIVE_ENABLED_NG"),
      `NG skip must cite the NG kill-switch, got: ${ng.error}`,
    );
    // EXACTLY ONE Twilio HTTP across the whole batch — the NG number leaked NOTHING.
    assertEquals(f.count(), 1, "only the US recipient may produce a Twilio HTTP call");
  } finally {
    f.restore();
    restoreEnv();
  }
});

// (B) hardened: BOTH markets off (true text-dark) across a multi-recipient batch
// even with valid Twilio creds present -> ZERO HTTP, every result skipped.
Deno.test("ADVERSARIAL: both markets OFF -> entire batch skipped, ZERO HTTP even with creds set", async () => {
  const restoreEnv = snapshotEnv(ENV_KEYS);
  const f = stubFetch();
  Deno.env.delete("SMS_LIVE_ENABLED_US");
  Deno.env.delete("SMS_LIVE_ENABLED_NG");
  // Creds present — proves the gate is the switch, not missing creds.
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MGtest");

  try {
    const batch = ["+15551110000", "+15552220000", "+2348011112222"];
    let skipped = 0;
    for (const to of batch) {
      const r = await smsAdapter.send({ to, brandName: "Acme", message: "Hi", countryCode: to.startsWith("+234") ? "NG" : "US" });
      if (r.status === "skipped") skipped += 1;
    }
    assertEquals(skipped, batch.length, "every recipient must be skipped when both switches are off");
    assertEquals(f.count(), 0, "ZERO Twilio HTTP may escape when the kill-switch is off");
  } finally {
    f.restore();
    restoreEnv();
  }
});

// (C): digits-only suppression key in a 3-recipient batch — suppress EXACTLY one.
function order(email: string, phone: string): unknown {
  return {
    id: crypto.randomUUID(),
    event_id: "11111111-1111-1111-1111-111111111111",
    buyer_email: email,
    buyer_name: "Buyer",
    buyer_phone: null,
    buyer_phone_e164: phone,
    total_cents: 1000,
    currency: "USD",
    payment_status: "paid",
    confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    events: { id: "11111111-1111-1111-1111-111111111111", title: "E", brand_id: "22222222-2222-2222-2222-222222222222" },
  };
}

Deno.test("ADVERSARIAL: digits-only suppression key suppresses EXACTLY one of three phones (partial-batch isolation)", () => {
  const orders = [
    order("a@example.com", "+15551110001"),
    order("b@example.com", "+15551110002"), // suppressed via BARE digits key (no '+')
    order("c@example.com", "+15551110003"),
  ];
  // Stored as digits-only, as a STOP/webhook write or legacy row might be.
  const suppressed = new Set<string>(["15551110002"]);

  // deno-lint-ignore no-explicit-any
  const result = aggregate(orders as any, [], "22222222-2222-2222-2222-222222222222", suppressed);

  assertEquals(result.reach.total, 3);
  // Exactly TWO reachable on SMS — the bare-digits key matched only +15551110002.
  assertEquals(result.reach.reachable_sms, 2, "only the digit-matched phone is excluded");

  const find = (p: string) => result.rows.find((r) => r.raw_phone === p);
  assertEquals(find("+15551110001")?.sms_marketing_ok, true);
  assertEquals(find("+15551110002")?.sms_marketing_ok, false, "digits-only key must suppress the E.164 match");
  assertEquals(find("+15551110003")?.sms_marketing_ok, true, "a non-matching phone must NOT be over-suppressed");
});
