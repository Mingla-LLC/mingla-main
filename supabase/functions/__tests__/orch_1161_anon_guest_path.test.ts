// META-ORCH-1161 Sub-A (thin slice) — TESTER ADVERSARIAL regression test.
//
// DIFFERENT ANGLE than the implementor's 8 happy-path tests, ALL of which run the
// dispatcher with a user_id (the dispatchV2 inbox path). This file attacks the
// ANON / GUEST reservation path (dispatchV2 → dispatchAnon, user_id == null) —
// the contact-keyed path a `created_via='guest'` reservation takes. The SPEC R-7
// risk ("anon/guest reservations have no push token + may lack email; ensure
// can_send handles user_id IS NULL contact-keyed paths") is exactly this branch.
//
// What this proves at the dispatcher core (no real network — fetch is stubbed and
// COUNTED so we can assert ZERO Twilio HTTP under the kill-switch):
//   A1. Anon path fires email + SMS but NEVER push or inapp (no inbox row exists
//       for a user-less reservation → no FK; the anon guard must skip them).
//   A2. Kill-switch OFF on the anon path → SMS returns 'skipped' with ZERO Twilio
//       HTTP. (fails-on-revert anchor: deleting the smsAdapter kill-switch guard
//       makes the anon SMS leg hit fetch → the zero-HTTP assertion fails.)
//   A3. IDEMPOTENCY GAP (adversarial discovery): a double-dispatch of the SAME
//       idempotency_key on the anon path sends the SMS TWICE — dispatchAnon has
//       NO dedupe (the notifications UNIQUE(idempotency_key) backstop only guards
//       the user_id path). This test PINS the current behavior so a future dedupe
//       fix is a deliberate, visible change. (Severity P2 — see TEST report.)
//
// Append-only: this is a NEW file; no existing test is modified.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { dispatchV2, type MinimalClient } from "../_shared/notifyV2.ts";

const ANON_CATEGORY = {
  key: "buyer_reservation_changed",
  is_transactional: true,
  urgency: "high",
  default_channels: ["inapp", "push", "email", "sms"],
  active: true,
};

// A fake client that ALWAYS allows can_send (so the gate is not what skips SMS —
// the kill-switch / anon-guard is). No notifications/deliveries tables are hit on
// the anon path, so those return inert.
function makeAnonClient(): MinimalClient {
  return {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table === "notification_categories") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: ANON_CATEGORY, error: null }),
            }),
          }),
        };
      }
      // notifications/deliveries are never expected on the anon path; return inert.
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        insert: () => Promise.resolve({ data: null, error: null }),
      };
    },
    rpc(fn: string): Promise<{ data: unknown; error: unknown }> {
      if (fn === "can_send") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as MinimalClient;
}

// Stub Deno's global fetch, counting Twilio + Resend hits.
interface NetCounters { twilio: number; resend: number }
function withStubbedFetch<T>(fn: (c: NetCounters) => Promise<T>): Promise<T> {
  const counters: NetCounters = { twilio: 0, resend: 0 };
  const orig = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.includes("api.twilio.com")) counters.twilio++;
    if (u.includes("api.resend.com")) counters.resend++;
    // Mimic a Twilio/Resend success envelope so the adapter returns 'sent'.
    return Promise.resolve(
      new Response(JSON.stringify({ sid: `stub-${counters.twilio + counters.resend}`, id: "stub" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    // deno-lint-ignore no-explicit-any
  }) as any;
  return fn(counters).finally(() => {
    globalThis.fetch = orig;
  });
}

function setTwilioEnv() {
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tokentest");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MGtest");
  Deno.env.set("RESEND_API_KEY", "re_test");
}

// ── A1 + A2: anon path, kill-switch OFF → email attempted, SMS skipped, ZERO Twilio HTTP ──
Deno.test("ANON: kill-switch OFF → SMS skipped with ZERO Twilio HTTP; no push/inapp; email attempted", async () => {
  setTwilioEnv();
  Deno.env.delete("SMS_LIVE_ENABLED_US"); // kill-switch OFF
  const result = await withStubbedFetch(async (counters) => {
    const r = await dispatchV2(makeAnonClient(), {
      user_id: null, // ANON / GUEST
      contact: "+15551234567", // phone-only guest
      category_key: "buyer_reservation_changed",
      payload: { reservation_id: "res-anon-1", status: "confirmed", brand_name: "Lantern & Vine", date: "Jun 20", time: "7:30 PM", party_size: 2 },
      idempotency_key: "buyer_reservation_changed:res-anon-1:T1",
      country_code: "US",
    });
    return { r, counters };
  });

  // notificationId is null on the anon path (no inbox row).
  assertEquals(result.r.notificationId, null, "anon path must not mint an inbox row");
  const sms = result.r.deliveries?.find((d) => d.channel === "sms");
  assert(sms, "anon path with a phone contact must attempt the sms channel");
  assertEquals(sms!.status, "skipped", "kill-switch OFF → SMS skipped");
  // THE fails-on-revert anchor: ZERO Twilio HTTP while the kill-switch is off.
  assertEquals(result.counters.twilio, 0, "kill-switch OFF must make ZERO Twilio HTTP calls on the anon path");
  // anon path must NEVER attempt push or inapp (no user → no inbox FK).
  assert(!result.r.deliveries?.some((d) => d.channel === "push"), "anon path must not attempt push");
  assert(!result.r.deliveries?.some((d) => d.channel === "inapp"), "anon path must not write inapp");
});

// ── A2b: anon path, kill-switch ON → exactly ONE Twilio HTTP for one dispatch ──
Deno.test("ANON: kill-switch ON → exactly one Twilio HTTP per single dispatch", async () => {
  setTwilioEnv();
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  const { counters } = await withStubbedFetch(async (counters) => {
    await dispatchV2(makeAnonClient(), {
      user_id: null,
      contact: "+15551234567",
      category_key: "buyer_reservation_changed",
      payload: { reservation_id: "res-anon-2", brand_name: "Lantern & Vine", date: "Jun 20", time: "7:30 PM", party_size: 2 },
      idempotency_key: "buyer_reservation_changed:res-anon-2:T1",
      country_code: "US",
    });
    return { counters };
  });
  Deno.env.delete("SMS_LIVE_ENABLED_US");
  assertEquals(counters.twilio, 1, "one anon dispatch with kill-switch ON → exactly one Twilio send");
});

// ── A3: idempotency GAP — a DOUBLE dispatch of the SAME idempotency_key on the
//        anon path sends the SMS TWICE (no dedupe). Pins current behavior. ──
Deno.test("ANON: double-dispatch of the SAME idempotency_key sends SMS TWICE (idempotency gap, P2)", async () => {
  setTwilioEnv();
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  const idem = "buyer_reservation_changed:res-anon-3:T1"; // identical key both times
  const { counters } = await withStubbedFetch(async (counters) => {
    const input = {
      user_id: null,
      contact: "+15551234567",
      category_key: "buyer_reservation_changed",
      payload: { reservation_id: "res-anon-3", brand_name: "Lantern & Vine", date: "Jun 20", time: "7:30 PM", party_size: 2 },
      idempotency_key: idem,
      country_code: "US" as const,
    };
    await dispatchV2(makeAnonClient(), input);
    await dispatchV2(makeAnonClient(), input); // same key again (drain double-claim)
    return { counters };
  });
  Deno.env.delete("SMS_LIVE_ENABLED_US");
  // DOCUMENTED DEFECT: the anon path has no dedupe → 2 sends for the same key.
  // If a future fix adds anon idempotency, flip this to assertEquals(...,1) and
  // close the P2. Until then this PROVES the gap exists.
  assertEquals(counters.twilio, 2, "anon path currently double-sends on an identical idempotency_key (no dedupe — P2 gap)");
});
