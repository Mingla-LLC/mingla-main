// Issue #1529 T-3 — ADAPTER ROUTING AND ZERO-HTTP.
//
// IMPLEMENTOR HAPPY-PATH REGRESSION TEST for SPEC §4.5, built after the
// operator decision (Seth, 2026-08-03): **the DESTINATION NUMBER is the routing
// authority, not the `countryCode` label.**
//
// WHY THIS EXISTS. `notification_outbox.country_code` was read by four places
// and written by none — 6/6 production rows NULL. Every notification therefore
// presented as American: `smsAdapter` turned the missing country into "US" via
// `?? "US"`, and Nigerian handsets were handed to Twilio under the LIVE US
// kill-switch while `sms_live_enabled.ng` — the switch meant to hold Nigeria
// back — governed nothing at all. Nigeria was never actually dark.
//
// WHAT THIS PINS (SPEC §7):
//   SC-4  +234 with a NULL label  → NG route, zero Twilio HTTP, skipped.
//   SC-5  +234 with a WRONG "US" label → still the NG route. The destination
//         beats the assertion. This is the assertion that directly encodes the
//         bug: a wrong label must not be able to send a Nigerian handset to
//         Twilio.
//   SC-6  +1 with a NULL label → Twilio, byte-identical to before, with the
//         MessagingServiceSid parameter shape intact.
//   plus  an unmapped calling code fails closed with zero HTTP to BOTH
//         providers, and the assertion mismatch is WARNED, never fatal.
//
// The companion adversarial group `#1529 ADV B-4/B-4b/B-4c` in
// smsAdapter.issue1518.adversarial.test.ts attacks the same contract through
// the real MINGLA_DELIVERY_FLAGS_JSON secret bundle.
//
// fails-on-revert: restoring either `(input.countryCode ?? "US")` copy sends
// T-3-1 and T-3-2 to Twilio (the US switch is live in those cases), failing the
// zero-Twilio assertions. Restoring the `resolveMarketKillSwitch` default makes
// T-3-5 resolve a market it should refuse to.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { resolveMarketKillSwitch, smsAdapter } from "./smsAdapter.ts";

const TWILIO_HOST = "api.twilio.com";
const TERMII_HOST = "v3.api.termii.com";
const NG_NUMBER = "+2348012345678";
const US_NUMBER = "+14155550123";

const OWNED_KEYS = [
  "MINGLA_DELIVERY_FLAGS_JSON",
  "MINGLA_RUNTIME_CONFIG_JSON",
  "SMS_LIVE_ENABLED_NG",
  "SMS_LIVE_ENABLED_US",
  "TERMII_API_KEY",
  "TERMII_BASE_URL",
  "TERMII_SENDER_ID",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_STATUS_CALLBACK_SECRET",
  "SUPABASE_URL",
];

interface Capture {
  url: string;
  init: RequestInit;
}

let captures: Capture[] = [];

/**
 * Run `fn` with a hard-reset env and a RECORDING fetch, so "zero HTTP" is an
 * assertion about observed traffic rather than an inference.
 */
async function withHarness(
  setup: () => void,
  fn: () => Promise<void>,
): Promise<void> {
  const snap: Record<string, string | undefined> = {};
  for (const k of OWNED_KEYS) snap[k] = Deno.env.get(k);
  const realFetch = globalThis.fetch;
  captures = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    captures.push({ url, init: init ?? {} });
    if (url.includes(TERMII_HOST)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ code: "ok", message_id: "tm_1529" }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ sid: "SM_1529" }), { status: 201 }),
    );
  }) as unknown as typeof fetch;
  try {
    for (const k of OWNED_KEYS) Deno.env.delete(k);
    setup();
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

function bundle(ng: boolean, us: boolean): string {
  return JSON.stringify({
    schema_version: 1,
    marketing_send_live_enabled: false,
    sms_live_enabled: { ng, us },
  });
}

function setAllCreds(): void {
  Deno.env.set("TERMII_API_KEY", "tk_1529");
  Deno.env.set("TERMII_BASE_URL", `https://${TERMII_HOST}`);
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC_1529");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok_1529");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG_1529");
}

const twilioCalls = () => captures.filter((c) => c.url.includes(TWILIO_HOST));
const termiiCalls = () => captures.filter((c) => c.url.includes(TERMII_HOST));

const baseInput = {
  brandName: "Test Brand",
  message: "Your booking at Test Brand is confirmed.",
};

// ---------------------------------------------------------------------------
// T-3-1 (SC-4) — the production shape: a Nigerian handset with NO label.
// NG dark, US LIVE — the exact combination that used to transmit over Twilio.
// ---------------------------------------------------------------------------
Deno.test("#1529 T-3-1: +234 with a NULL country resolves NG and makes ZERO Twilio calls", async () => {
  await withHarness(() => {
    setAllCreds();
    Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(false, true));
  }, async () => {
    const result = await smsAdapter.send({
      ...baseInput,
      to: NG_NUMBER,
      countryCode: null,
    });
    assertEquals(result.status, "skipped");
    assertEquals(result.error, "provider_kill_switch_off");
    assertEquals(twilioCalls().length, 0, "a +234 handset must NEVER reach Twilio");
    assertEquals(captures.length, 0, "the kill switch must fire before any HTTP");
  });
});

// ---------------------------------------------------------------------------
// T-3-2 (SC-5) — THE ASSERTION THAT ENCODES THE BUG.
// A deliberately WRONG "US" label on a Nigerian handset. The destination wins.
// ---------------------------------------------------------------------------
Deno.test("#1529 T-3-2: +234 labelled 'US' still resolves NG — the destination beats the assertion", async () => {
  await withHarness(() => {
    setAllCreds();
    // US live, NG dark. Under label-primacy this SENT over Twilio.
    Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(false, true));
  }, async () => {
    const result = await smsAdapter.send({
      ...baseInput,
      to: NG_NUMBER,
      countryCode: "US",
    });
    assertEquals(result.status, "skipped");
    assertEquals(result.error, "provider_kill_switch_off");
    assertEquals(
      twilioCalls().length,
      0,
      "a wrong country label must not be able to send a Nigerian handset to Twilio",
    );
    assertEquals(captures.length, 0);
  });
});

// ---------------------------------------------------------------------------
// T-3-3 — positive control for T-3-1/T-3-2: with NG live, the very same
// unlabelled/mislabelled call DOES reach Termii. Without this, the two tests
// above could be passing because the NG route is broken rather than gated.
// ---------------------------------------------------------------------------
Deno.test("#1529 T-3-3: with NG live, the same +234 calls reach Termii on 'generic'", async () => {
  for (const label of [null, "US", "NG"]) {
    await withHarness(() => {
      setAllCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(true, true));
    }, async () => {
      const result = await smsAdapter.send({
        ...baseInput,
        to: NG_NUMBER,
        countryCode: label,
      });
      const where = `label=${JSON.stringify(label)}`;
      assertEquals(result.status, "sent", where);
      assertEquals(termiiCalls().length, 1, where);
      assertEquals(twilioCalls().length, 0, where);
      const payload = JSON.parse(String(termiiCalls()[0].init.body));
      // #1518's channel contract is untouched by #1529.
      assertEquals(payload.channel, "generic", where);
    });
  }
});

// ---------------------------------------------------------------------------
// T-3-4 (SC-6) — the Twilio path is byte-identical for a genuine US handset.
// ---------------------------------------------------------------------------
Deno.test("#1529 T-3-4: +1 with a NULL country routes to Twilio with the MessagingServiceSid shape intact", async () => {
  await withHarness(() => {
    setAllCreds();
    Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(false, true));
  }, async () => {
    const result = await smsAdapter.send({
      ...baseInput,
      to: US_NUMBER,
      countryCode: null,
    });
    assertEquals(result.status, "sent");
    assertEquals(twilioCalls().length, 1);
    assertEquals(termiiCalls().length, 0);
    const params = new URLSearchParams(String(twilioCalls()[0].init.body));
    assertEquals(params.get("MessagingServiceSid"), "MG_1529");
    assertEquals(params.get("To"), US_NUMBER);
    // I-PROPOSED-1161: never a raw From number.
    assertEquals(params.get("From"), null);
    assertEquals(params.get("channel"), null);
  });
});

// ---------------------------------------------------------------------------
// T-3-5 — an unmapped calling code FAILS CLOSED, with zero HTTP to BOTH
// providers even when both markets are live.
// ---------------------------------------------------------------------------
Deno.test("#1529 T-3-5: an unmapped calling code returns country_unresolved with ZERO HTTP", async () => {
  await withHarness(() => {
    setAllCreds();
    Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(true, true));
  }, async () => {
    for (const to of ["+4915112345678", "+41441234567", "+233201234567"]) {
      captures = [];
      const result = await smsAdapter.send({
        ...baseInput,
        to,
        countryCode: "US", // a label that would previously have transmitted
      });
      assertEquals(result.status, "skipped", to);
      assertEquals(result.error, "country_unresolved", to);
      assertEquals(result.providerMessageId, null, to);
      assertEquals(captures.length, 0, `${to} made an HTTP call`);
    }
  });
});

// ---------------------------------------------------------------------------
// T-3-6 — the kill-switch resolver never invents a market.
// ---------------------------------------------------------------------------
Deno.test("#1529 T-3-6: resolveMarketKillSwitch returns null for an absent country, never the US switch", () => {
  assertEquals(resolveMarketKillSwitch(null), null);
  assertEquals(resolveMarketKillSwitch(undefined), null);
  assertEquals(resolveMarketKillSwitch("NG"), "SMS_LIVE_ENABLED_NG");
  assertEquals(resolveMarketKillSwitch("ng"), "SMS_LIVE_ENABLED_NG");
  assertEquals(resolveMarketKillSwitch("US"), "SMS_LIVE_ENABLED_US");
  assertEquals(resolveMarketKillSwitch("GB"), "SMS_LIVE_ENABLED_US");
});

// ---------------------------------------------------------------------------
// T-3-7 — a mismatched label WARNS but never fails the send.
//
// A wrong column value must not be able to take live SMS down; that is the same
// class of harm #1529 exists to fix, pointed the other way.
// ---------------------------------------------------------------------------
Deno.test("#1529 T-3-7: a label that disagrees with the destination warns, and the send still completes", async () => {
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    await withHarness(() => {
      setAllCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", bundle(true, true));
    }, async () => {
      const result = await smsAdapter.send({
        ...baseInput,
        to: NG_NUMBER,
        countryCode: "US",
      });
      // Sent, not failed — a bad label must never be able to stop delivery.
      assertEquals(result.status, "sent");
      assertEquals(termiiCalls().length, 1);
    });
  } finally {
    console.warn = realWarn;
  }
  assert(
    warnings.some((w) => w.includes("sms_country_assertion_mismatch")),
    `expected a mismatch warning naming both values, got: ${JSON.stringify(warnings)}`,
  );
  assert(
    warnings.some((w) => w.includes("US") && w.includes("NG")),
    "the warning must name BOTH the asserted and the derived country",
  );
});
