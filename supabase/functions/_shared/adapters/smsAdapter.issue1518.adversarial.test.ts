// Issue #1518 — TESTER ADVERSARIAL REGRESSION SUITE.
//
// Companion to (NOT a copy of) the implementor's happy-path suite
// `smsAdapter.issue1518.test.ts`. That suite pins the six intended behaviours.
// THIS suite assumes the change is broken and attacks the paths a happy-path
// test cannot reach. Five distinct attack surfaces, none of which the
// implementor's six tests cover:
//
//   A. KILL-SWITCH INTEGRITY THROUGH THE REAL PRODUCTION MECHANISM.
//      `SMS_LIVE_ENABLED_NG` is NOT how production resolves the NG market flag.
//      `envTrue()` calls `resolveDeliveryFlagValue("sms_live_enabled.ng", ...)`,
//      which reads the `MINGLA_DELIVERY_FLAGS_JSON` secret BUNDLE first and only
//      falls back to the legacy env var when the bundle is absent or unparseable
//      (see `_shared/secretBundle.ts`). The implementor's suite drives only the
//      legacy env var, so the bundle path — the one Seth actually flips when
//      `sms_live_enabled.ng` goes true — was untested. Group A drives the bundle
//      and proves NG stays dark with ZERO HTTP, including when a STALE legacy
//      env var disagrees with the bundle. This is the most dangerous regression
//      available on this change: an NG send reaching the network while the
//      market is dark.
//
//   B. COUNTRY-CODE NORMALIZATION / PROVIDER LEAKAGE. Route selection
//      (`cc === "NG"`) and kill-switch selection (`resolveMarketKillSwitch`)
//      are two SEPARATE normalizations of the same input. If they ever diverge,
//      a send could be routed as NG while gated as US (or vice versa) — a
//      split-brain that lights up a dark market. Group B proves both derive the
//      same answer for casing/whitespace/null/ISO-3 variants, and that no
//      non-`NG` value can ever reach Termii (guards against a future
//      `startsWith`/`includes` over-match).
//
//   C. CHANNEL LEAKAGE, ASSERTED ON THE WHOLE SERIALIZED PAYLOAD. The
//      implementor asserts `channel === "generic"` for three `messageType`
//      values. Group C asserts the stronger, construction-agnostic property:
//      the substring `dnd` appears NOWHERE in the JSON body Termii receives,
//      across a hostile `messageType` domain (unknown strings, wrong casing,
//      null, empty, and a caller literally passing `"dnd"` as the messageType).
//      This deliberately catches channel reintroductions that a text gate
//      cannot see — e.g. a backtick template literal, which the strict-grep
//      gate's `/["']dnd["']/` quote class does not match.
//
//   D. FOOTER INDEPENDENCE. The #1518 report states the STOP footer "keys off
//      `messageType`". It does not — `composeSmsBody` keys off
//      `stopFooterOwnLine` ONLY. Group D pins the full 2x3 matrix
//      ({transactional, marketing} x {undefined, false, true}) to prove the
//      footer is independent of BOTH `messageType` and the provider channel,
//      and proves the composed body is byte-identical between the NG/Termii and
//      US/Twilio providers for the same input.
//
//   E. FAIL-CLOSED CONTRACT. Each Termii env var missing INDIVIDUALLY (the
//      implementor tests none of them); HTTP 200 without a usable `message_id`
//      in four shapes; the real 400 "Country Inactive" envelope from #1480; and
//      proof the `blacklisted` provider-error classifier FIRES at runtime (the
//      strict-grep gate's check (c3) only proves the text exists in source).
//
// Provider envelopes used below are the VERBATIM responses recorded in #1480
// (2026-08-03 19:19-19:20 WAT), not invented shapes.
//
// fails-on-revert: restoring the DEC-192 ternary
// (`input.messageType === "marketing" ? "generic" : "dnd"`) at the NG call site
// makes A-2, B-1, B-3, C-1 and C-2 FAIL. Hash recorded in the #1518 QA report.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { smsAdapter } from "./smsAdapter.ts";

const TERMII_BASE = "https://v3.api.termii.com";
const TERMII_HOST = "v3.api.termii.com";
const TWILIO_HOST = "api.twilio.com";
const NG_NUMBER = "+2348012345678";
const US_NUMBER = "+12015550199";

// VERBATIM success envelope from #1480. Note `message_id` is a quoted STRING.
const TERMII_OK_BODY = JSON.stringify({
  code: "ok",
  balance: 18599.65,
  message_id: "3017857812138224517130997",
  message: "Successfully Sent",
  message_id_str: "3017857812138224517130997",
});
// VERBATIM `dnd` rejection envelope from #1480.
const TERMII_COUNTRY_INACTIVE_BODY = JSON.stringify({
  code: 400,
  message: "Country Inactive. Contact Administrator to activate country.",
  status: "error",
  link: "uri=/sms/send",
});

// ---------------------------------------------------------------------------
// Environment harness. Every key the adapter (and its two resolvers) can read
// is snapshotted and hard-reset before each case, so no ambient CI value can
// silently change a verdict. In particular BOTH secret bundles are DELETED
// unless a test sets them.
// ---------------------------------------------------------------------------
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

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of OWNED_KEYS) snap[k] = Deno.env.get(k);
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
}

function clearOwnedEnv(): void {
  for (const k of OWNED_KEYS) Deno.env.delete(k);
}

/** A VALID `MINGLA_DELIVERY_FLAGS_JSON` bundle — the real production shape. */
function deliveryBundle(ng: boolean, us: boolean): string {
  return JSON.stringify({
    schema_version: 1,
    marketing_send_live_enabled: false,
    sms_live_enabled: { ng, us },
  });
}

/** Termii credentials present and well-formed. Does NOT touch any kill-switch. */
function setTermiiCreds(): void {
  Deno.env.set("TERMII_API_KEY", "tk_adversarial");
  Deno.env.set("TERMII_BASE_URL", TERMII_BASE);
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
}

/** Twilio credentials present and well-formed. */
function setTwilioCreds(): void {
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC_adversarial");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok_adversarial");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG_adversarial");
}

// ---------------------------------------------------------------------------
// fetch harness. Records EVERY outbound call so "ZERO HTTP" is an assertion
// about observed traffic, not an inference.
// ---------------------------------------------------------------------------
interface Capture {
  url: string;
  init: RequestInit;
}

const realFetch = globalThis.fetch;
let captures: Capture[] = [];

type Responder = (url: string, init: RequestInit) => Response;

function installFetch(responder: Responder): void {
  captures = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    captures.push({ url, init: init ?? {} });
    return Promise.resolve(responder(url, init ?? {}));
  }) as unknown as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

/** Default responder: Termii succeeds, Twilio succeeds, anything else 500s. */
const okResponder: Responder = (url) => {
  if (url.includes(TERMII_HOST)) {
    return new Response(TERMII_OK_BODY, { status: 200 });
  }
  if (url.includes(TWILIO_HOST)) {
    return new Response(JSON.stringify({ sid: "SM_adversarial" }), {
      status: 200,
    });
  }
  return new Response("unexpected host", { status: 500 });
};

/** A responder that FAILS the test if it is ever reached. */
const forbiddenResponder: Responder = (url) => {
  throw new Error(`network call escaped the kill-switch: ${url}`);
};

function termiiCalls(): Capture[] {
  return captures.filter((c) => c.url.includes(TERMII_HOST));
}

function twilioCalls(): Capture[] {
  return captures.filter((c) => c.url.includes(TWILIO_HOST));
}

/** Parse the JSON body Termii received. */
function termiiPayload(index = 0): Record<string, unknown> {
  const call = termiiCalls()[index];
  assert(call !== undefined, "expected a Termii call, found none");
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

/** Parse the form body Twilio received. */
function twilioParams(index = 0): URLSearchParams {
  const call = twilioCalls()[index];
  assert(call !== undefined, "expected a Twilio call, found none");
  return new URLSearchParams(String(call.init.body));
}

/** Run `fn` with a clean env + a recording fetch, then restore both. */
async function withHarness(
  responder: Responder,
  setup: () => void,
  fn: () => Promise<void>,
): Promise<void> {
  const snap = snapshotEnv();
  installFetch(responder);
  try {
    clearOwnedEnv();
    setup();
    await fn();
  } finally {
    restoreFetch();
    restoreEnv(snap);
  }
}

const baseInput = {
  to: NG_NUMBER,
  brandName: "Test Brand",
  message: "Your booking at Test Brand is confirmed.",
};

// ===========================================================================
// GROUP A — KILL-SWITCH INTEGRITY VIA THE PRODUCTION SECRET BUNDLE
// ===========================================================================

Deno.test(
  "#1518 ADV A-1: bundle sms_live_enabled.ng=false BEATS a stale SMS_LIVE_ENABLED_NG=true — NG skipped with ZERO HTTP",
  async () => {
    await withHarness(forbiddenResponder, () => {
      setTermiiCreds();
      // The bundle is the production source of truth and says NG is DARK...
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(false, true));
      // ...while a stale legacy override says NG is live. The bundle must win.
      Deno.env.set("SMS_LIVE_ENABLED_NG", "true");
    }, async () => {
      const result = await smsAdapter.send({
        ...baseInput,
        countryCode: "NG",
        messageType: "transactional",
      });
      assertEquals(result.status, "skipped");
      assertEquals(result.ok, false);
      assertEquals(result.error, "provider_kill_switch_off");
      assertEquals(result.providerMessageId, null);
      // The whole point: not one packet left the process.
      assertEquals(captures.length, 0);
    });
  },
);

Deno.test(
  "#1518 ADV A-2: bundle sms_live_enabled.ng=true actually enables the NG path — exactly one Termii call on 'generic'",
  async () => {
    await withHarness(okResponder, () => {
      setTermiiCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, false));
    }, async () => {
      const result = await smsAdapter.send({
        ...baseInput,
        countryCode: "NG",
        messageType: "transactional",
      });
      assertEquals(result.status, "sent");
      assertEquals(result.ok, true);
      assertEquals(result.providerMessageId, "3017857812138224517130997");
      assertEquals(termiiCalls().length, 1);
      assertEquals(twilioCalls().length, 0);
      assertEquals(termiiPayload().channel, "generic");
    });
  },
);

Deno.test(
  "#1518 ADV A-3: NG dark + US live must NOT spill an NG send onto the live Twilio route",
  async () => {
    await withHarness(forbiddenResponder, () => {
      setTermiiCreds();
      setTwilioCreds();
      // US is LIVE. NG is DARK. An NG send must be skipped, not re-routed.
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(false, true));
    }, async () => {
      const result = await smsAdapter.send({
        ...baseInput,
        countryCode: "NG",
        messageType: "transactional",
      });
      assertEquals(result.status, "skipped");
      assertEquals(captures.length, 0);
    });
  },
);

Deno.test(
  "#1518 ADV A-4: an unparseable delivery bundle with no legacy override FAILS CLOSED — skipped, ZERO HTTP",
  async () => {
    await withHarness(forbiddenResponder, () => {
      setTermiiCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", "{ this is not json");
      // No SMS_LIVE_ENABLED_NG fallback set — resolution must land on "off".
    }, async () => {
      const result = await smsAdapter.send({
        ...baseInput,
        countryCode: "NG",
        messageType: "transactional",
      });
      assertEquals(result.status, "skipped");
      assertEquals(result.error, "provider_kill_switch_off");
      assertEquals(captures.length, 0);
    });
  },
);

Deno.test(
  "#1518 ADV A-5: no bundle and no legacy flag at all — NG stays dark with ZERO HTTP",
  async () => {
    await withHarness(forbiddenResponder, () => {
      setTermiiCreds();
    }, async () => {
      const result = await smsAdapter.send({
        ...baseInput,
        countryCode: "NG",
        messageType: "transactional",
      });
      assertEquals(result.status, "skipped");
      assertEquals(captures.length, 0);
    });
  },
);

// ===========================================================================
// GROUP B — COUNTRY-CODE NORMALIZATION / PROVIDER LEAKAGE
// ===========================================================================

Deno.test(
  "#1518 ADV B-1: lowercase 'ng' normalizes to the NG route and still rides 'generic'",
  async () => {
    await withHarness(okResponder, () => {
      setTermiiCreds();
      setTwilioCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, true));
    }, async () => {
      for (const cc of ["ng", "Ng", "nG", "NG"]) {
        captures = [];
        const result = await smsAdapter.send({
          ...baseInput,
          countryCode: cc,
          messageType: "transactional",
        });
        assertEquals(result.status, "sent", `countryCode=${cc}`);
        assertEquals(termiiCalls().length, 1, `countryCode=${cc}`);
        assertEquals(twilioCalls().length, 0, `countryCode=${cc}`);
        assertEquals(termiiPayload().channel, "generic", `countryCode=${cc}`);
      }
    });
  },
);

// ---------------------------------------------------------------------------
// AMENDED BY #1529 [TEST-MOD-APPROVED #1529] — operator decision, Seth
// 2026-08-03: the DESTINATION NUMBER is the routing authority, not the label.
//
// WHAT THIS TEST USED TO SAY: "no non-'NG' country CODE may EVER reach Termii",
// driving a fixed +234 destination and varying only the label. That encoded
// LABEL-PRIMACY AS A PROXY for the real guarantee. The proxy is now provably
// wrong: a missing label on a Nigerian handset is precisely the #1529
// production defect (all 6 outbox rows carried NULL), and under the old proxy
// such a row routed to Twilio under the LIVE US switch — a Nigerian number
// sent as an American one.
//
// WHAT IT SAYS NOW: the same over-match protection, asserted on the axis that
// actually decides routing. Only a genuine +234 DESTINATION may reach Termii;
// neighbouring calling codes that would over-match a sloppy startsWith (+233,
// +27) must not; and no label — however hostile — can move a destination onto
// the wrong provider in either direction.
// ---------------------------------------------------------------------------
Deno.test(
  "#1518 ADV B-2 (amended #1529): no non-NG DESTINATION may EVER reach Termii, and no label can force it",
  async () => {
    await withHarness(okResponder, () => {
      setTermiiCreds();
      setTwilioCreds();
      // Both markets live, so a leak would actually transmit rather than skip.
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, true));
    }, async () => {
      // Destinations that are NOT Nigerian. Chosen to over-match a careless
      // prefix test: +233 and +27 share leading digits with +234.
      const nonNgDestinations = [
        "+14155550123", // US
        "+447700900000", // GB
        "+32460964460", // BE
        "+233201234567", // GH — shares "+23" with Nigeria
        "+27831234567", // ZA — shares "+2" with Nigeria
      ];
      // Hostile labels, including the ones that used to force the route.
      const hostileLabels = [
        "NG",
        "ng",
        "NGA",
        "NGR",
        " NG",
        "NG ",
        "",
        null,
        undefined,
      ];
      for (const to of nonNgDestinations) {
        for (const cc of hostileLabels) {
          captures = [];
          await smsAdapter.send({
            ...baseInput,
            to,
            countryCode: cc as string | null | undefined,
            messageType: "transactional",
          });
          assertEquals(
            termiiCalls().length,
            0,
            `destination ${to} with label ${JSON.stringify(cc)} leaked to Termii`,
          );
        }
      }
      // Positive control — without it every assertion above could pass simply
      // because nothing ever reaches Termii at all.
      captures = [];
      await smsAdapter.send({
        ...baseInput,
        to: NG_NUMBER,
        countryCode: null,
        messageType: "transactional",
      });
      assertEquals(
        termiiCalls().length,
        1,
        "a genuine +234 destination MUST still reach Termii",
      );
    });
  },
);

Deno.test(
  "#1518 ADV B-3: route selection and kill-switch selection share ONE normalization — no split-brain dark-market send",
  async () => {
    // NG live, US DARK. Any variant that routes to Termii must be exactly the
    // set that the NG kill-switch permitted; everything else must be skipped
    // with zero HTTP. A divergence between `cc === "NG"` and
    // resolveMarketKillSwitch would show up here as a Twilio call (gated by a
    // dark US switch) or a skipped NG send.
    await withHarness(okResponder, () => {
      setTermiiCreds();
      setTwilioCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, false));
    }, async () => {
      // Loop 1 is UNCHANGED in intent: a Nigerian destination under a LIVE NG
      // switch must send via Termii. The label variants are retained to prove
      // they are now harmless — the destination decides, so all behave alike.
      const ngVariants = ["NG", "ng", "Ng", "nG"];
      for (const cc of ngVariants) {
        captures = [];
        const result = await smsAdapter.send({
          ...baseInput,
          countryCode: cc,
          messageType: "transactional",
        });
        assertEquals(result.status, "sent", `NG variant ${cc} must send`);
        assertEquals(termiiCalls().length, 1, `NG variant ${cc}`);
      }
      // AMENDED BY #1529 [TEST-MOD-APPROVED #1529]. This loop previously kept
      // the +234 destination FIXED and varied only the LABEL, asserting the
      // non-NG labels were skipped. That is label-primacy as a proxy — the same
      // proxy amended in B-2 above — and it cannot hold once the destination
      // decides the route. Note this loop runs with NG **live** and US dark, so
      // it was never asserting "a dark market is not sent to"; it was asserting
      // "the label picks the provider".
      //
      // THE GUARANTEE THIS TEST EXISTS FOR IS UNCHANGED AND STILL ASSERTED:
      // route selection and kill-switch selection share ONE normalization, so a
      // split-brain cannot send to a dark market. It is now asserted on the
      // destination axis, which is what actually feeds that normalization. With
      // NG live and US DARK, a genuinely non-NG destination must be gated by
      // the dark US switch and skipped with ZERO HTTP — regardless of the
      // label, including a bogus "NG" label that under a split-brain would
      // route to Termii while being gated as US, or vice versa.
      for (const to of ["+14155550123", "+447700900000", "+32460964460"]) {
        for (const cc of ["US", "GB", "NG", "NGA", "", null, undefined]) {
          captures = [];
          const result = await smsAdapter.send({
            ...baseInput,
            to,
            countryCode: cc as string | null | undefined,
            messageType: "transactional",
          });
          assertEquals(
            result.status,
            "skipped",
            `non-NG destination ${to} (label ${JSON.stringify(cc)}) must be gated by the dark US switch`,
          );
          assertEquals(
            captures.length,
            0,
            `non-NG destination ${to} (label ${JSON.stringify(cc)}) made an HTTP call`,
          );
        }
      }
    });
  },
);

// ===========================================================================
// GROUP B-4 — ADDED BY #1529 [TEST-MOD-APPROVED #1529]
//
// THE EXACT PRODUCTION CASE, WHICH NOTHING PREVIOUSLY COVERED.
//
// Every one of the 6 `notification_outbox` rows in production carries
// `country_code = NULL`, because no producer ever wrote it. A Nigerian
// recipient therefore arrived at this adapter with a NULL (or, via the RSVP
// path's two-country ternary, an outright wrong "US") label on a `+234`
// handset. Under the old label-primacy rule that resolved to the US market and
// was TRANSMITTED over Twilio under the LIVE US switch — a real Nigerian
// number, sent as an American one, bypassing the Nigerian kill switch entirely.
// That is the whole of #1529 in one sentence, and no test in the repo caught it.
//
// This group pins the corrected behaviour and, critically, the SAFETY claim:
// while `sms_live_enabled.ng` is false, such a send reaches the NG route and is
// stopped there with **ZERO HTTP** — asserted on observed traffic via the
// `forbiddenResponder`, which THROWS if any request escapes, plus an explicit
// `captures.length === 0`. Belt and braces, because "no packet left the
// process" is the claim that lets Nigeria stay genuinely dark.
// ===========================================================================

Deno.test(
  "#1529 ADV B-4: a +234 handset with a NULL/absent/'US' label resolves NG, is gated by the NG switch, and is skipped with ZERO HTTP",
  async () => {
    // The production shape: NG DARK, US LIVE. Under the old rule this is the
    // combination that transmitted; under the new rule it must stop dead.
    for (const label of [null, undefined, "US", "us", ""]) {
      await withHarness(forbiddenResponder, () => {
        setTermiiCreds();
        setTwilioCreds();
        Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(false, true));
      }, async () => {
        const result = await smsAdapter.send({
          ...baseInput,
          to: NG_NUMBER,
          countryCode: label as string | null | undefined,
          messageType: "transactional",
        });
        const where = `label=${JSON.stringify(label)}`;
        // Gated by the NG switch — NOT sent, and NOT re-routed to live Twilio.
        assertEquals(result.status, "skipped", where);
        assertEquals(result.ok, false, where);
        assertEquals(result.error, "provider_kill_switch_off", where);
        assertEquals(result.providerMessageId, null, where);
        // THE SAFETY CLAIM: not one packet left the process, to either provider.
        assertEquals(captures.length, 0, `${where}: HTTP escaped the kill switch`);
        assertEquals(termiiCalls().length, 0, where);
        assertEquals(twilioCalls().length, 0, where);
      });
    }
  },
);

Deno.test(
  "#1529 ADV B-4b: the SAME unlabelled +234 handset DOES reach Termii once NG is live — proving the skip was the flag, not a dead route",
  async () => {
    // Without this, B-4 could pass because the NG path is broken rather than
    // because the kill switch held. This is the positive control for the whole
    // group, and it is also the shape SC-11's live-fire will exercise.
    await withHarness(okResponder, () => {
      setTermiiCreds();
      setTwilioCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, true));
    }, async () => {
      const result = await smsAdapter.send({
        ...baseInput,
        to: NG_NUMBER,
        countryCode: null, // the production NULL
        messageType: "transactional",
      });
      assertEquals(result.status, "sent");
      assertEquals(termiiCalls().length, 1);
      assertEquals(twilioCalls().length, 0, "a +234 handset must NEVER reach Twilio");
      // #1518's channel contract is untouched by #1529.
      assertEquals(termiiPayload().channel, "generic");
      assertEquals(termiiPayload().to, NG_NUMBER);
    });
  },
);

Deno.test(
  "#1529 ADV B-4c: an unmapped calling code FAILS CLOSED — zero HTTP to either provider, even with both markets live",
  async () => {
    // A well-formed E.164 whose calling code is not in the derivation table.
    // On a money-adjacent path the honest answer to "we do not know which
    // market governs this handset" is to not send at all.
    await withHarness(forbiddenResponder, () => {
      setTermiiCreds();
      setTwilioCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, true));
    }, async () => {
      const result = await smsAdapter.send({
        ...baseInput,
        to: "+4915112345678", // DE — deliberately unmapped
        countryCode: "US", // a label that would previously have sent it
        messageType: "transactional",
      });
      assertEquals(result.status, "skipped");
      assertEquals(result.error, "country_unresolved");
      assertEquals(result.providerMessageId, null);
      assertEquals(captures.length, 0, "an unresolved market must make no HTTP call");
    });
  },
);

// ===========================================================================
// GROUP C — CHANNEL LEAKAGE ASSERTED ON THE ENTIRE SERIALIZED PAYLOAD
// ===========================================================================

Deno.test(
  "#1518 ADV C-1: across a HOSTILE messageType domain, the Termii payload is 'generic' and contains no 'dnd' anywhere",
  async () => {
    await withHarness(okResponder, () => {
      setTermiiCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, false));
    }, async () => {
      const hostileMessageTypes = [
        "transactional",
        "marketing",
        undefined,
        null,
        "",
        "MARKETING", // wrong casing
        "Transactional",
        "promotional", // unknown class
        "dnd", // a caller trying to select the channel through messageType
        0,
        false,
      ];
      for (const mt of hostileMessageTypes) {
        captures = [];
        const result = await smsAdapter.send({
          ...baseInput,
          countryCode: "NG",
          messageType: mt as "transactional" | "marketing" | undefined,
        });
        const label = `messageType=${JSON.stringify(mt)}`;
        assertEquals(result.status, "sent", label);
        assertEquals(termiiCalls().length, 1, label);
        const payload = termiiPayload();
        assertEquals(payload.channel, "generic", label);
        // Construction-agnostic: whatever produced the channel, the retired
        // value must not appear ANYWHERE in what the provider receives. This
        // catches reintroductions a source-text gate cannot see (e.g. a
        // backtick template literal, which the strict-grep gate's `["']dnd["']`
        // quote class does not match).
        const raw = String(termiiCalls()[0].init.body).toLowerCase();
        assertEquals(
          raw.includes("dnd"),
          false,
          `${label}: 'dnd' leaked into the Termii request body`,
        );
      }
    });
  },
);

Deno.test(
  "#1518 ADV C-2: the NG payload shape is exactly the #1480-proven contract, and media is DROPPED (ORCH-1282)",
  async () => {
    await withHarness(okResponder, () => {
      setTermiiCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, false));
    }, async () => {
      await smsAdapter.send({
        ...baseInput,
        countryCode: "NG",
        messageType: "transactional",
        // Media must be ignored on the NG path — Termii /api/sms/send type
        // "plain" carries no media param.
        mediaUrls: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
        messagingServiceSid: "MG_should_be_ignored_on_ng",
      });
      const payload = termiiPayload();
      assertEquals(payload.channel, "generic");
      assertEquals(payload.type, "plain");
      assertEquals(payload.to, NG_NUMBER);
      assertEquals(payload.from, "Mingla");
      assertEquals(payload.api_key, "tk_adversarial");
      // No media key of any spelling reached the provider.
      const keys = Object.keys(payload).map((k) => k.toLowerCase());
      assertEquals(keys.includes("media"), false);
      assertEquals(keys.includes("mediaurl"), false);
      assertEquals(keys.includes("media_url"), false);
      assertEquals(keys.includes("mediaurls"), false);
      const raw = String(termiiCalls()[0].init.body);
      assertEquals(raw.includes("example.com"), false);
      // The Twilio-only override never appears on the Termii payload either.
      assertEquals(raw.includes("MG_should_be_ignored_on_ng"), false);
      assertEquals(termiiCalls()[0].url, `${TERMII_BASE}/api/sms/send`);
    });
  },
);

Deno.test(
  "#1518 ADV C-3: the US/Twilio request carries MessagingServiceSid, no raw From, and no Termii channel param",
  async () => {
    await withHarness(okResponder, () => {
      setTwilioCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(false, true));
    }, async () => {
      await smsAdapter.send({
        ...baseInput,
        to: US_NUMBER,
        countryCode: "US",
        messageType: "transactional",
      });
      assertEquals(twilioCalls().length, 1);
      assertEquals(termiiCalls().length, 0);
      const params = twilioParams();
      assertEquals(params.get("MessagingServiceSid"), "MG_adversarial");
      assertEquals(params.get("To"), US_NUMBER);
      // I-PROPOSED-1161: never a raw From number.
      assertEquals(params.get("From"), null);
      // The Termii-only channel concept must not bleed onto the Twilio path.
      assertEquals(params.get("channel"), null);
      assertEquals(params.get("Channel"), null);
    });
  },
);

// ===========================================================================
// GROUP D — STOP-FOOTER INDEPENDENCE FROM messageType AND FROM THE CHANNEL
// ===========================================================================

Deno.test(
  "#1518 ADV D-1: the STOP footer keys ONLY off stopFooterOwnLine — messageType does not move it",
  async () => {
    await withHarness(okResponder, () => {
      setTermiiCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, false));
    }, async () => {
      const message = "Your booking at Test Brand is confirmed.";
      const singleSpace = `${message} Reply STOP to opt out.`;
      const ownLine = `${message}\n\nReply STOP to opt out.`;
      const matrix: Array<
        [
          "transactional" | "marketing",
          boolean | undefined,
          string,
        ]
      > = [
        // messageType varies, footer form does NOT follow it.
        ["transactional", undefined, singleSpace],
        ["marketing", undefined, singleSpace],
        ["transactional", false, singleSpace],
        ["marketing", false, singleSpace],
        ["transactional", true, ownLine],
        ["marketing", true, ownLine],
      ];
      for (const [messageType, ownLineFlag, expected] of matrix) {
        captures = [];
        await smsAdapter.send({
          ...baseInput,
          message,
          countryCode: "NG",
          messageType,
          stopFooterOwnLine: ownLineFlag,
        });
        const label = `${messageType}/stopFooterOwnLine=${ownLineFlag}`;
        assertEquals(termiiPayload().sms, expected, label);
      }
    });
  },
);

Deno.test(
  "#1518 ADV D-2: the composed body is BYTE-IDENTICAL across the NG/Termii and US/Twilio providers",
  async () => {
    await withHarness(okResponder, () => {
      setTermiiCreds();
      setTwilioCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, true));
    }, async () => {
      const message = "Your booking at Test Brand is confirmed.";
      captures = [];
      await smsAdapter.send({
        ...baseInput,
        message,
        countryCode: "NG",
        messageType: "transactional",
      });
      const ngBody = termiiPayload().sms;
      captures = [];
      await smsAdapter.send({
        ...baseInput,
        message,
        to: US_NUMBER,
        countryCode: "US",
        messageType: "transactional",
      });
      const usBody = twilioParams().get("Body");
      // Provider/channel selection must have ZERO influence on body bytes.
      assertEquals(ngBody, usBody);
      assertEquals(ngBody, `${message} Reply STOP to opt out.`);
    });
  },
);

Deno.test(
  "#1518 ADV D-3: an existing STOP footer is never doubled, on either provider",
  async () => {
    await withHarness(okResponder, () => {
      setTermiiCreds();
      setTwilioCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, true));
    }, async () => {
      const alreadyFootered = "Test Brand: see you tonight. Reply STOP to opt out.";
      captures = [];
      await smsAdapter.send({
        ...baseInput,
        message: alreadyFootered,
        countryCode: "NG",
        messageType: "transactional",
      });
      const ngBody = String(termiiPayload().sms);
      assertEquals(ngBody, alreadyFootered);
      assertEquals(ngBody.split("Reply STOP to opt out.").length - 1, 1);

      captures = [];
      await smsAdapter.send({
        ...baseInput,
        message: alreadyFootered,
        to: US_NUMBER,
        countryCode: "US",
        messageType: "marketing",
        stopFooterOwnLine: true,
      });
      const usBody = String(twilioParams().get("Body"));
      assertEquals(usBody, alreadyFootered);
      assertEquals(usBody.split("Reply STOP to opt out.").length - 1, 1);
    });
  },
);

Deno.test(
  "#1518 ADV D-4: GSM-7 sanitization still runs on the NG body after the channel move",
  async () => {
    await withHarness(okResponder, () => {
      setTermiiCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, false));
    }, async () => {
      await smsAdapter.send({
        ...baseInput,
        message: "Test’s “night” — doors 8…9pm",
        countryCode: "NG",
        messageType: "transactional",
      });
      const sms = String(termiiPayload().sms);
      assertStringIncludes(sms, "Test's \"night\" - doors 8...9pm");
      // None of the UCS-2-forcing originals survived.
      for (const ch of ["’", "“", "”", "—", "…"]) {
        assertEquals(sms.includes(ch), false, `unsanitized ${escape(ch)}`);
      }
    });
  },
);

// ===========================================================================
// GROUP E — FAIL-CLOSED CONTRACT
// ===========================================================================

Deno.test(
  "#1518 ADV E-1: each Termii env var missing INDIVIDUALLY fails closed with ZERO HTTP",
  async () => {
    const required = ["TERMII_API_KEY", "TERMII_BASE_URL", "TERMII_SENDER_ID"];
    for (const missing of required) {
      await withHarness(forbiddenResponder, () => {
        setTermiiCreds();
        Deno.env.delete(missing);
        Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, false));
      }, async () => {
        const result = await smsAdapter.send({
          ...baseInput,
          countryCode: "NG",
          messageType: "transactional",
        });
        assertEquals(result.status, "failed", `missing ${missing}`);
        assertEquals(result.ok, false, `missing ${missing}`);
        assertEquals(result.providerMessageId, null, `missing ${missing}`);
        // The adapter genericises termiiSend's `termii_env_missing`.
        assertEquals(
          result.error,
          "provider_config_missing",
          `missing ${missing}`,
        );
        assertEquals(captures.length, 0, `missing ${missing} made an HTTP call`);
      });
    }
  },
);

Deno.test(
  "#1518 ADV E-2: HTTP 200 without a usable message_id is a FAILURE in every shape",
  async () => {
    const shapes: Array<[string, string]> = [
      ["code ok, no message_id", JSON.stringify({ code: "ok", balance: 1 })],
      ["empty-string message_id", JSON.stringify({ code: "ok", message_id: "" })],
      [
        "numeric message_id (not a string)",
        '{"code":"ok","message_id":3017857812138224517130997}',
      ],
      ["null message_id", JSON.stringify({ code: "ok", message_id: null })],
      ["non-JSON body", "Successfully Sent"],
      ["empty body", ""],
    ];
    for (const [label, body] of shapes) {
      await withHarness(
        () => new Response(body, { status: 200 }),
        () => {
          setTermiiCreds();
          Deno.env.set(
            "MINGLA_DELIVERY_FLAGS_JSON",
            deliveryBundle(true, false),
          );
        },
        async () => {
          const result = await smsAdapter.send({
            ...baseInput,
            countryCode: "NG",
            messageType: "transactional",
          });
          assertEquals(result.ok, false, label);
          assertEquals(result.status, "failed", label);
          assertEquals(result.providerMessageId, null, label);
          // It DID reach the provider — this is a response-parsing contract,
          // not a pre-flight guard.
          assertEquals(termiiCalls().length, 1, label);
        },
      );
    }
  },
);

Deno.test(
  "#1518 ADV E-3: the real #1480 400 'Country Inactive' envelope is a plain failure, NOT an opt-out",
  async () => {
    await withHarness(
      () => new Response(TERMII_COUNTRY_INACTIVE_BODY, { status: 400 }),
      () => {
        setTermiiCreds();
        Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, false));
      },
      async () => {
        const result = await smsAdapter.send({
          ...baseInput,
          countryCode: "NG",
          messageType: "transactional",
        });
        assertEquals(result.status, "failed");
        assertEquals(result.blacklisted, false);
        // Misclassifying this as an opt-out would suppress the recipient
        // forever over a provider-side configuration error.
        assertEquals(result.error, "provider_unavailable");
      },
    );
  },
);

Deno.test(
  "#1518 ADV E-4: the provider-error 'dnd' classifier FIRES at runtime (gate check (c3) only proves it exists in source)",
  async () => {
    // Only the FOUR tokens the classifier actually recognises are asserted
    // here ("dnd", "blacklist", "opt out", "opt-out"). Termii publishes no
    // canonical opt-out error string, so asserting any other phrasing would be
    // inventing a provider contract rather than testing one. NOTE the adjacent
    // gap recorded in the #1518 QA report: the natural phrasing "opted out"
    // does NOT contain the substring "opt out" and is therefore classified as
    // a retryable failure instead of a suppression.
    const dndRejections = [
      JSON.stringify({ code: 400, message: "Number is on DND, cannot deliver" }),
      JSON.stringify({ code: 400, message: "recipient blacklisted" }),
      JSON.stringify({ code: 400, message: "recipient chose to opt out" }),
      JSON.stringify({ code: 400, message: "opt-out recipient" }),
    ];
    for (const body of dndRejections) {
      await withHarness(
        () => new Response(body, { status: 400 }),
        () => {
          setTermiiCreds();
          Deno.env.set(
            "MINGLA_DELIVERY_FLAGS_JSON",
            deliveryBundle(true, false),
          );
        },
        async () => {
          const result = await smsAdapter.send({
            ...baseInput,
            countryCode: "NG",
            messageType: "transactional",
          });
          assertEquals(result.status, "failed", body);
          assertEquals(result.blacklisted, true, body);
          assertEquals(result.error, "recipient_opted_out", body);
        },
      );
    }
  },
);

Deno.test(
  "#1518 ADV E-5: a thrown network error is caught and reported, never propagated",
  async () => {
    await withHarness(
      () => {
        throw new TypeError("connection reset");
      },
      () => {
        setTermiiCreds();
        Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, false));
      },
      async () => {
        const result = await smsAdapter.send({
          ...baseInput,
          countryCode: "NG",
          messageType: "transactional",
        });
        assertEquals(result.status, "failed");
        assertEquals(result.ok, false);
        assertEquals(result.providerMessageId, null);
        assertEquals(result.error, "provider_unavailable");
      },
    );
  },
);

Deno.test(
  "#1518 ADV E-6: an invalid recipient is rejected before the kill-switch and before any HTTP",
  async () => {
    await withHarness(forbiddenResponder, () => {
      setTermiiCreds();
      Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(true, false));
    }, async () => {
      for (const to of ["", "2348012345678", "+0348012345678", "not a number"]) {
        captures = [];
        const result = await smsAdapter.send({
          ...baseInput,
          to,
          countryCode: "NG",
          messageType: "transactional",
        });
        assertEquals(result.status, "failed", `to=${to}`);
        assertEquals(result.error, "invalid_recipient", `to=${to}`);
        assertEquals(captures.length, 0, `to=${to}`);
      }
    });
  },
);
