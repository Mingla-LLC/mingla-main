// ===========================================================================
// #2218 T-3 — THE ADAPTER DOES NOT HAND A MESSAGE TO A ROUTE THAT CANNOT CARRY IT.
// ===========================================================================
// The defect in one line: at 06:10 WAT the adapter POSTed a Nigerian ticket
// confirmation to Termii's `generic` channel, Termii accepted it, and the
// network never moved it — Nigerian operators refuse `generic` traffic
// 20:00-08:00 WAT (https://developers.termii.com/campaign). The ledger recorded
// `sent`, provider `termii`, no error.
//
// EVERY CASE HERE PINS ITS OWN INSTANT through `input.now`, so nothing in this
// file depends on the hour CI happens to run — and, deliberately, nothing here
// depends on the module clock either, so a leaked pin from a neighbouring file
// can neither rescue nor break it.
//
// THE ZERO-HTTP ASSERTIONS ARE THE POINT. A deferral that still calls Termii
// would spend money, consume a provider-io claim, and — worst — produce an
// accept-id we would then record. "It returned deferred" is not the invariant;
// "it returned deferred AND the provider was never contacted" is.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { smsAdapter } from "./smsAdapter.ts";

const TERMII_HOST = "termii.test.local";
const TWILIO_HOST = "api.twilio.com";

const NG = "+2348162646567"; // the founder's own handset, per the #2218 report
const US = "+19843822876";

interface Capture {
  url: string;
  body: string;
}

let captures: Capture[] = [];

function envSnapshot(keys: string[]): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of keys) snap[k] = Deno.env.get(k);
  return snap;
}

const ENV_KEYS = [
  "MINGLA_DELIVERY_FLAGS_JSON",
  "SMS_LIVE_ENABLED_NG",
  "SMS_LIVE_ENABLED_US",
  "TERMII_API_KEY",
  "TERMII_BASE_URL",
  "TERMII_SENDER_ID",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
];

async function withHarness(fn: () => Promise<void>): Promise<void> {
  const snap = envSnapshot(ENV_KEYS);
  const realFetch = globalThis.fetch;
  captures = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    captures.push({ url, body: String(init?.body ?? "") });
    if (url.includes(TERMII_HOST)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ code: "ok", message_id: "3017858407816658717238173" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ sid: "SM_test_2218" }), { status: 201 }),
    );
  }) as typeof fetch;
  Deno.env.set(
    "MINGLA_DELIVERY_FLAGS_JSON",
    JSON.stringify({
      schema_version: 1,
      marketing_send_live_enabled: false,
      sms_live_enabled: { ng: true, us: true },
    }),
  );
  Deno.env.set("TERMII_API_KEY", "tk_2218");
  Deno.env.set("TERMII_BASE_URL", `https://${TERMII_HOST}`);
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC_2218");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok_2218");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG_2218");
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

/** WAT hour on 2026-08-18 as a UTC instant (Nigeria is UTC+1, no DST). */
const wat = (hour: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 7, 18, hour - 1, minute, 0));

const termiiCalls = () => captures.filter((c) => c.url.includes(TERMII_HOST));
const twilioCalls = () => captures.filter((c) => c.url.includes(TWILIO_HOST));

Deno.test("#2218 T-3a: the exact production send DEFERS, with ZERO provider HTTP", async () => {
  await withHarness(async () => {
    const result = await smsAdapter.send({
      to: NG,
      brandName: "Mingla",
      message: "Mingla: your 2 tickets are confirmed. Order ABC123.",
      // 2026-08-18 05:10:39Z — 06:10:39 WAT. The instant in the report.
      now: new Date("2026-08-18T05:10:39Z"),
    });
    assertEquals(result.status, "deferred");
    assertEquals(result.ok, false);
    assertEquals(result.error, "ng_operator_embargo");
    assertEquals(
      result.providerMessageId,
      null,
      "a deferral must never carry an accept-id — that id is what made the row read `sent`",
    );
    assertEquals(
      result.provider,
      "termii",
      "the market is still attributable; #1537's skip-attribution rule applies to a hold too",
    );
    assertEquals(
      result.retryAfter,
      "2026-08-18T07:00:00.000Z",
      "held until the next 08:00 WAT, so the buyer's text arrives late rather than never",
    );
    assertEquals(
      captures.length,
      0,
      "ZERO HTTP: no naira spent, no accept-id created, nothing to reconcile",
    );
  });
});

Deno.test("#2218 T-3b: the same call SENDS once the window opens", async () => {
  await withHarness(async () => {
    const result = await smsAdapter.send({
      to: NG,
      brandName: "Mingla",
      message: "Mingla: your 2 tickets are confirmed. Order ABC123.",
      now: wat(9),
    });
    assertEquals(result.status, "sent");
    assertEquals(result.provider, "termii");
    assertEquals(result.providerMessageId, "3017858407816658717238173");
    assertEquals(termiiCalls().length, 1, "in-window, Termii IS contacted");
    assertEquals(twilioCalls().length, 0, "NG never routes to Twilio (#1227)");
    // ORCH-1227 is not weakened by any of this: the route and the channel are
    // exactly what #1518 left behind.
    assert(
      termiiCalls()[0].body.includes('"channel":"generic"'),
      "still `generic`; #2218 changes WHEN we send, never WHERE",
    );
  });
});

Deno.test("#2218 T-3c: both halves of the wrapped window defer, both edges send", async () => {
  await withHarness(async () => {
    // A vacuous `hour >= 20 && hour < 8` passes nothing here; an unwrapped
    // evening-only check passes 21:00 and fails 03:00.
    for (const h of [20, 21, 23, 0, 3, 7]) {
      captures = [];
      const r = await smsAdapter.send({
        to: NG,
        brandName: "Mingla",
        message: "held",
        now: wat(h),
      });
      assertEquals(r.status, "deferred", `${h}:00 WAT must defer`);
      assertEquals(captures.length, 0, `${h}:00 WAT must make no HTTP call`);
    }
    for (const h of [8, 12, 19]) {
      captures = [];
      const r = await smsAdapter.send({
        to: NG,
        brandName: "Mingla",
        message: "carried",
        now: wat(h),
      });
      assertEquals(r.status, "sent", `${h}:00 WAT must send`);
      assertEquals(termiiCalls().length, 1, `${h}:00 WAT must reach Termii`);
    }
  });
});

Deno.test("#2218 T-3d: the embargo is NIGERIAN — a US handset is untouched at 03:00 WAT", async () => {
  await withHarness(async () => {
    const result = await smsAdapter.send({
      to: US,
      brandName: "Mingla",
      message: "US confirmation",
      now: wat(3),
    });
    assertEquals(
      result.status,
      "sent",
      "a window that quietly gated the American rail would be a far bigger outage than the one it fixes",
    );
    assertEquals(result.provider, "twilio");
    assertEquals(twilioCalls().length, 1);
    assertEquals(termiiCalls().length, 0);
  });
});

Deno.test("#2218 T-3e: the kill switch still wins — a dark market reports dark, not held", async () => {
  await withHarness(async () => {
    Deno.env.set(
      "MINGLA_DELIVERY_FLAGS_JSON",
      JSON.stringify({
        schema_version: 1,
        marketing_send_live_enabled: false,
        sms_live_enabled: { ng: false, us: true },
      }),
    );
    const result = await smsAdapter.send({
      to: NG,
      brandName: "Mingla",
      message: "dark",
      now: wat(3), // inside the embargo AND with NG switched off
    });
    assertEquals(
      result.status,
      "skipped",
      "ORDER MATTERS: an operator who switched Nigeria off must see " +
        "`provider_kill_switch_off`, not a hold that implies we will try again",
    );
    assertEquals(result.error, "provider_kill_switch_off");
    assertEquals(result.provider, "termii");
    assertEquals(
      result.retryAfter,
      undefined,
      "a dark market has no scheduled reopening",
    );
    assertEquals(captures.length, 0);
  });
});

Deno.test("#2218 T-3f: an unreconcilable accept-id is announced at the moment it arrives", async () => {
  await withHarness(async () => {
    const realWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      globalThis.fetch = ((input: RequestInfo | URL) => {
        captures.push({ url: String(input), body: "" });
        return Promise.resolve(
          new Response(
            // Verbatim shape of the failing production response.
            JSON.stringify({
              message_id: "sig_7678b296aa6240b4864a6dcb294124b4",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }) as typeof fetch;
      const result = await smsAdapter.send({
        to: NG,
        brandName: "Mingla",
        message: "in window",
        now: wat(12),
      });
      // It IS a send — Termii accepted it, and pretending otherwise would be
      // its own fabrication. What must not happen is that it passes silently.
      assertEquals(result.status, "sent");
      assertEquals(
        result.providerMessageId,
        "sig_7678b296aa6240b4864a6dcb294124b4",
      );
      assert(
        warnings.some((w) => w.includes("termii_accept_id_unreconcilable")),
        "an id no delivery report and no History lookup can ever match must be said out loud",
      );
    } finally {
      console.warn = realWarn;
    }
  });
});

Deno.test("#2218 T-3g: a numeric accept-id raises nothing", async () => {
  await withHarness(async () => {
    const realWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const result = await smsAdapter.send({
        to: NG,
        brandName: "Mingla",
        message: "in window",
        now: wat(12),
      });
      assertEquals(result.status, "sent");
      assertEquals(
        warnings.filter((w) => w.includes("termii_accept_id_unreconcilable"))
          .length,
        0,
        "the alarm must be specific, or it becomes noise and stops being read",
      );
    } finally {
      console.warn = realWarn;
    }
  });
});
