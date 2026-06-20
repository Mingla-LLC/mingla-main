// META-ORCH-1161 Sub-A (thin slice) — Step 0.5 happy-path regression test.
//
// Proves the buyer_reservation_changed moment end-to-end at the dispatcher core:
//   - reservation-change category fans out IN-APP + PUSH + EMAIL simultaneously
//     (DEC-185: no waterfall — every allowed channel fires);
//   - SMS fires ONLY when SMS_LIVE_ENABLED_US=true AND consent present AND not
//     suppressed; with the kill-switch OFF the smsAdapter returns 'skipped'
//     WITHOUT any Twilio HTTP call;
//   - a STOP suppression (can_send → false for sms) skips the next SMS;
//   - the GSM-7 sanitizer + segment count run on the SMS body.
//
// fails-on-revert: deleting the kill-switch guard in smsAdapter (the
// `if (!envTrue(killSwitch))` block) makes the OFF case attempt a Twilio HTTP
// call → the "no HTTP when off" assertion fails. See the report's Regression
// Test section for the verified commit hash.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  composeSmsBody,
  computeSegments,
  resolveMarketKillSwitch,
  sanitizeGsm7,
  smsAdapter,
} from "../_shared/adapters/smsAdapter.ts";
import { renderCategoryMessage } from "../_shared/notifyTemplates.ts";
import { dispatchV2, type MinimalClient } from "../_shared/notifyV2.ts";

// ── A fake supabase client modeling can_send + capturing deliveries ──────────
interface FakeState {
  category: Record<string, unknown> | null;
  // suppressions: set of `${channel}` that are suppressed for sms scope
  smsSuppressed: boolean;
  // explicit per-channel opt-out (enabled=false)
  optOutChannels: Set<string>;
  isTransactional: boolean;
  deliveries: Array<Record<string, unknown>>;
  insertedNotification: boolean;
}

function makeClient(state: FakeState): MinimalClient {
  return {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table === "notification_categories") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.category, error: null }),
            }),
          }),
        };
      }
      if (table === "notifications") {
        return {
          insert: () => ({
            select: () => ({
              single: () => {
                state.insertedNotification = true;
                return Promise.resolve({ data: { id: "notif-1" }, error: null });
              },
            }),
          }),
        };
      }
      if (table === "notification_deliveries") {
        return {
          insert: (row: Record<string, unknown>) => {
            state.deliveries.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      // default no-op
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        insert: () => Promise.resolve({ data: null, error: null }),
      };
    },
    rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
      if (fn === "can_send") {
        const channel = args.p_channel as string;
        // Mirror can_send() logic for the test fake.
        const cat = state.category as { default_channels: string[] } | null;
        if (!cat) return Promise.resolve({ data: false, error: null });
        if (!cat.default_channels.includes(channel)) {
          return Promise.resolve({ data: false, error: null });
        }
        if (state.optOutChannels.has(channel)) {
          return Promise.resolve({ data: false, error: null });
        }
        if (channel === "sms" && state.smsSuppressed) {
          return Promise.resolve({ data: false, error: null });
        }
        if (!state.isTransactional) {
          // marketing requires explicit enable — fake denies by default
          return Promise.resolve({ data: false, error: null });
        }
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as MinimalClient;
}

const RESERVATION_CHANGED_CATEGORY = {
  key: "buyer_reservation_changed",
  is_transactional: true,
  urgency: "high",
  default_channels: ["inapp", "push", "email", "sms"],
  active: true,
};

const PAYLOAD = {
  reservation_id: "res-1",
  status: "confirmed",
  date: "Jun 20",
  time: "7:30 PM",
  party_size: 4,
  brand_name: "Lantern & Vine",
};

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    category: RESERVATION_CHANGED_CATEGORY,
    smsSuppressed: false,
    optOutChannels: new Set(),
    isTransactional: true,
    deliveries: [],
    insertedNotification: false,
    ...overrides,
  };
}

// ── 1. GSM-7 + segment + kill-switch unit assertions ─────────────────────────
Deno.test("smsAdapter: GSM-7 sanitizer normalizes smart punctuation", () => {
  const dirty = "Café ‘Bar’ — now … done";
  const clean = sanitizeGsm7(dirty);
  assert(!clean.includes("‘"), "left smart quote should be normalized");
  assert(!clean.includes("’"), "right smart quote should be normalized");
  assert(!clean.includes("—"), "em dash should be normalized");
  assert(!clean.includes("…"), "ellipsis should be normalized");
  assert(clean.includes("'Bar'"), "should produce straight quotes");
  assert(clean.includes("..."), "ellipsis should become three dots");
});

Deno.test("smsAdapter: composeSmsBody appends STOP footer + computes >=1 segment", () => {
  const body = composeSmsBody("Lantern & Vine: Your reservation changed - now Jun 20 7:30 PM, party of 4.");
  assert(/reply stop to opt out\.?$/i.test(body), "STOP footer appended");
  assertEquals(computeSegments(body) >= 1, true);
});

Deno.test("smsAdapter: kill-switch OFF returns skipped WITHOUT an HTTP call", async () => {
  Deno.env.delete("SMS_LIVE_ENABLED_US");
  // Force a fetch failure if the adapter ever tries to call out — proves no HTTP.
  const origFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (() => {
    fetchCalled = true;
    throw new Error("HTTP should not be called when kill-switch is OFF");
  }) as typeof fetch;
  try {
    Deno.env.set("TWILIO_ACCOUNT_SID", "AC_test");
    Deno.env.set("TWILIO_AUTH_TOKEN", "tok");
    Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG_test");
    const r = await smsAdapter.send({
      to: "+14155550123",
      brandName: "Lantern & Vine",
      message: "test",
      countryCode: "US",
    });
    assertEquals(r.status, "skipped");
    assertEquals(r.ok, false);
    assertEquals(fetchCalled, false, "no Twilio HTTP call when kill-switch off");
  } finally {
    globalThis.fetch = origFetch;
  }
});

Deno.test("smsAdapter: resolveMarketKillSwitch routes NG vs US", () => {
  assertEquals(resolveMarketKillSwitch("US"), "SMS_LIVE_ENABLED_US");
  assertEquals(resolveMarketKillSwitch("NG"), "SMS_LIVE_ENABLED_NG");
  assertEquals(resolveMarketKillSwitch(null), "SMS_LIVE_ENABLED_US");
});

// ── 2. Templates carry the verbatim COPY §3.1 ────────────────────────────────
Deno.test("templates: buyer_reservation_changed SMS matches COPY §3.1", () => {
  const r = renderCategoryMessage("buyer_reservation_changed", PAYLOAD);
  assertEquals(
    r.sms,
    "Lantern & Vine: Your reservation changed - now Jun 20 7:30 PM, party of 4.",
  );
  assertEquals(r.push.title, "Reservation updated");
  assertEquals(r.push.body, "Lantern & Vine: now Jun 20 7:30 PM, party of 4.");
});

// ── 3. Dispatcher fan-out: kill-switch OFF → push+inapp+email, SMS skipped ───
Deno.test("dispatchV2: kill-switch OFF — inapp+push+email fire, SMS skipped (no fallback)", async () => {
  Deno.env.delete("SMS_LIVE_ENABLED_US");
  const origFetch = globalThis.fetch;
  // push (OneSignal) + email (Resend) have no creds → adapters return failed,
  // but the IMPORTANT assertion is that they were ATTEMPTED (a delivery row each)
  // and that NO Twilio HTTP happens. Stub fetch to fail loudly on Twilio.
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("api.twilio.com")) {
      throw new Error("Twilio must not be called when kill-switch off");
    }
    // Simulate provider success for push/email so deliveries are 'sent'.
    return Promise.resolve(new Response(JSON.stringify({ id: "pm-1" }), { status: 200 }));
  }) as typeof fetch;
  try {
    Deno.env.set("ONESIGNAL_APP_ID", "os-app");
    Deno.env.set("ONESIGNAL_REST_API_KEY", "os-key");
    Deno.env.set("RESEND_API_KEY", "re_test");
    Deno.env.set("MINGLA_LOGO_URL", "https://usemingla.com/logo.png");
    Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");

    const state = baseState();
    const client = makeClient(state);
    const res = await dispatchV2(client, {
      user_id: "user-1",
      contact: "+14155550123",
      category_key: "buyer_reservation_changed",
      payload: PAYLOAD,
      idempotency_key: "buyer_reservation_changed:res-1:t1",
    });

    assertEquals(res.success, true);
    const byChannel = Object.fromEntries(
      (res.deliveries ?? []).map((d) => [d.channel, d.status]),
    );
    assertEquals(byChannel["inapp"], "delivered");
    assert("push" in byChannel, "push attempted");
    assert("email" in byChannel, "email attempted");
    assertEquals(byChannel["sms"], "skipped", "SMS skipped when kill-switch off");
    // No SMS HTTP happened (the throw above would have failed the test).
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ── 4. Dispatcher: kill-switch ON + consent + no suppression → SMS sent ──────
Deno.test("dispatchV2: kill-switch ON + not suppressed → SMS sent with segments", async () => {
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  const origFetch = globalThis.fetch;
  let twilioCalled = false;
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("api.twilio.com")) {
      twilioCalled = true;
      return Promise.resolve(new Response(JSON.stringify({ sid: "SM_test" }), { status: 201 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ id: "pm-1" }), { status: 200 }));
  }) as typeof fetch;
  try {
    Deno.env.set("ONESIGNAL_APP_ID", "os-app");
    Deno.env.set("ONESIGNAL_REST_API_KEY", "os-key");
    Deno.env.set("RESEND_API_KEY", "re_test");
    Deno.env.set("MINGLA_LOGO_URL", "https://usemingla.com/logo.png");
    Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");
    Deno.env.set("TWILIO_ACCOUNT_SID", "AC_test");
    Deno.env.set("TWILIO_AUTH_TOKEN", "tok");
    Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG_test");

    const state = baseState();
    const client = makeClient(state);
    const res = await dispatchV2(client, {
      user_id: "user-1",
      contact: "+14155550123",
      category_key: "buyer_reservation_changed",
      payload: PAYLOAD,
      idempotency_key: "buyer_reservation_changed:res-1:t2",
      country_code: "US",
    });

    const sms = (res.deliveries ?? []).find((d) => d.channel === "sms");
    assert(sms, "sms delivery row present");
    assertEquals(sms!.status, "sent");
    assertEquals(twilioCalled, true, "Twilio HTTP called when kill-switch on");
    assert((sms!.segments ?? 0) >= 1, "segment count recorded");
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ── 5. STOP suppression → next SMS skipped even with kill-switch ON ──────────
Deno.test("dispatchV2: STOP suppression → SMS suppressed (can_send denies)", async () => {
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("api.twilio.com")) {
      throw new Error("Twilio must NOT be called for a suppressed recipient");
    }
    return Promise.resolve(new Response(JSON.stringify({ id: "pm-1" }), { status: 200 }));
  }) as typeof fetch;
  try {
    Deno.env.set("ONESIGNAL_APP_ID", "os-app");
    Deno.env.set("ONESIGNAL_REST_API_KEY", "os-key");
    Deno.env.set("RESEND_API_KEY", "re_test");
    Deno.env.set("MINGLA_LOGO_URL", "https://usemingla.com/logo.png");
    Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");
    Deno.env.set("TWILIO_ACCOUNT_SID", "AC_test");
    Deno.env.set("TWILIO_AUTH_TOKEN", "tok");
    Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG_test");

    const state = baseState({ smsSuppressed: true }); // simulate a STOP row
    const client = makeClient(state);
    const res = await dispatchV2(client, {
      user_id: "user-1",
      contact: "+14155550123",
      category_key: "buyer_reservation_changed",
      payload: PAYLOAD,
      idempotency_key: "buyer_reservation_changed:res-1:t3",
      country_code: "US",
    });

    const byChannel = Object.fromEntries(
      (res.deliveries ?? []).map((d) => [d.channel, d.status]),
    );
    assertEquals(byChannel["sms"], "suppressed", "STOP → SMS suppressed");
    // The Twilio throw above proves no HTTP was attempted for the suppressed sms.
  } finally {
    globalThis.fetch = origFetch;
  }
});
