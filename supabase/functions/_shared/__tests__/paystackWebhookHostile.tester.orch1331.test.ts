// ORCH-1331 [partner Paystack payout rail] — TESTER ADVERSARIAL suite #2:
// WEBHOOK-LEVEL HOSTILE CONDITIONS against the REAL paystack-webhook handler.
//
// Angle (different from the implementor's T-8, which forces the engine's
// FIRST DB read to 500): this suite attacks OTHER stages and OTHER payloads —
//
//   WH-1  the partner-pin RPC (resolve_partner_for_brand_at_time) 500s →
//         the split throws MID-ENGINE (after fee+brand resolved) → the
//         charge.success contract is still byte-stable (200, received:true,
//         finalize + confirmation ran, inbox processed=true, error=null).
//   WH-2  the ledger-record RPC (record_paystack_partner_split_attempt) 500s
//         → same byte-stable contract (throw at the WRITE stage).
//   WH-3  malformed charge.success payloads (data missing / reference missing
//         / reference wrong-typed / amount negative junk) → no crash; the
//         handler answers per its designed taxonomy and NEVER attempts a
//         split (no split-stage fetch is ever issued).
//   WH-4  hostile transfer.success payload (1MB reference, wrong types) via
//         the REAL webhook → 200 received:true, inbox processed=true (the
//         engine no-ops on non-psplit references).
//   WH-5  transfer.failed whose split-row DB read 500s → the DESIGNED retry
//         semantics: ack 500 "processing_failed", inbox processed=false with
//         the error recorded (transfer events are allowed to retry — they
//         have no ticketing consequence; SPEC §4.6.2).
//
// HOW: paystack-webhook serves at module load → std http/server aliased to
// the capture shim via _importmap.test.json (ORCH-1205 pattern). All network
// surfaces stubbed via a mutable fetch dispatcher — NO live Paystack calls
// (LIVE mode, real money). Append-only: NEW file.
//
// Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   deno test --import-map=supabase/functions/_shared/__tests__/_importmap.test.json \
//     --allow-read --allow-env --allow-net --no-check \
//     supabase/functions/_shared/__tests__/paystackWebhookHostile.tester.orch1331.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { getCapturedHandler, resetCapturedHandler } from "./_serveShim.ts";

const SUPA_URL = "https://example-test.supabase.co";
const SECRET = "sk_test_orch1331_hostile_secret";
const ORDER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

Deno.env.set("SUPABASE_URL", SUPA_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key-not-real");
Deno.env.set("PAYSTACK_MODE", "test");
Deno.env.set("PAYSTACK_SECRET_KEY_TEST", SECRET);
Deno.env.set(
  "app.qr_token_pepper",
  "orch1331-test-pepper-0123456789abcdef0123456789abcdef",
);

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------- mutable scenario ----------
interface Scenario {
  /** URL substring → forced 500 (the per-test throw injection points). */
  force500: string[];
  /** split-row read (partner_splits by id) result rows; null → force 500. */
  splitRowsById: Array<Record<string, unknown>> | null;
  log: {
    order: string[];
    patches: Array<Record<string, unknown>>;
    finalize: boolean;
    confirmation: boolean;
    splitStageHit: boolean;
  };
}

function freshScenario(): Scenario {
  return {
    force500: [],
    splitRowsById: [],
    log: {
      order: [],
      patches: [],
      finalize: false,
      confirmation: false,
      splitStageHit: false,
    },
  };
}

let scenario: Scenario = freshScenario();

globalThis.fetch = (
  input: Request | URL | string,
  init?: RequestInit,
): Promise<Response> => {
  const url = typeof input === "string"
    ? input
    : (input instanceof URL ? input.href : input.url);
  const method = (init?.method ??
    (input instanceof Request ? input.method : "GET")).toUpperCase();
  scenario.log.order.push(`${method} ${url}`);

  for (const marker of scenario.force500) {
    if (url.includes(marker)) {
      if (
        marker.includes("resolve_partner_for_brand_at_time") ||
        marker.includes("record_paystack_partner_split_attempt")
      ) {
        scenario.log.splitStageHit = true;
      }
      return Promise.resolve(jsonOk({ message: `forced 500 (${marker})` }, 500));
    }
  }

  if (url.startsWith("https://api.paystack.co/transaction/verify/")) {
    return Promise.resolve(jsonOk({
      status: true,
      message: "Verification successful",
      data: {
        status: "success",
        amount: 5000,
        currency: "NGN",
        channel: "card",
        id: 424242,
        paid_at: "2026-07-11T10:00:00.000Z",
      },
    }));
  }

  if (url.startsWith(`${SUPA_URL}/rest/v1/payment_webhook_events`)) {
    if (method === "GET") {
      return Promise.resolve(jsonOk([{
        id: "evtrow-hostile-1",
        processed: false,
        retry_count: 0,
        retries_exhausted: false,
      }]));
    }
    if (method === "PATCH") {
      const bodyText = typeof init?.body === "string" ? init.body : "{}";
      try {
        scenario.log.patches.push(JSON.parse(bodyText));
      } catch {
        scenario.log.patches.push({ unparseable: bodyText });
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }
  }

  if (url.startsWith(`${SUPA_URL}/rest/v1/event_rsvp_contributions`)) {
    return Promise.resolve(jsonOk([]));
  }

  if (url.startsWith(`${SUPA_URL}/rest/v1/ticket_checkout_sessions`)) {
    return Promise.resolve(jsonOk([{
      id: "sess-hostile-1",
      status: "processing_payment",
      order_id: null,
      total_cents: 5000,
      currency: "NGN",
    }]));
  }

  if (url.startsWith(`${SUPA_URL}/rest/v1/rpc/biz_ticket_checkout_finalize`)) {
    scenario.log.finalize = true;
    return Promise.resolve(jsonOk({ orderId: ORDER_ID }));
  }

  if (url.startsWith(`${SUPA_URL}/functions/v1/ticket-confirmation-dispatch`)) {
    scenario.log.confirmation = true;
    return Promise.resolve(jsonOk({ ok: true }));
  }

  if (url.startsWith(`${SUPA_URL}/rest/v1/rpc/resolve_partner_for_brand_at_time`)) {
    scenario.log.splitStageHit = true;
    return Promise.resolve(jsonOk("12121212-3434-5656-7878-909090909090"));
  }

  if (
    url.startsWith(`${SUPA_URL}/rest/v1/rpc/record_paystack_partner_split_attempt`)
  ) {
    scenario.log.splitStageHit = true;
    return Promise.resolve(jsonOk({
      id: "0f0f0f0f-1111-2222-3333-4f4f4f4f4f4f",
      status: "pending",
      stripe_transfer_id: null,
      attempt_count: 0,
      payout_reference: null,
      error_message: null,
    }));
  }

  if (url.startsWith(`${SUPA_URL}/rest/v1/partner_splits`)) {
    // transfer-event split-row lookup (by id).
    if (scenario.splitRowsById === null) {
      return Promise.resolve(jsonOk({ message: "forced split-row 500" }, 500));
    }
    return Promise.resolve(jsonOk(scenario.splitRowsById));
  }

  if (url.startsWith(`${SUPA_URL}/rest/v1/partner_paystack_accounts`)) {
    return Promise.resolve(jsonOk([])); // no recipient → engine blocks, no transfer
  }

  if (url.startsWith(`${SUPA_URL}/rest/v1/orders`)) {
    if (url.includes("stripe_application_fee_amount_cents")) {
      scenario.log.splitStageHit = true;
      return Promise.resolve(jsonOk([{
        id: ORDER_ID,
        currency: "NGN",
        stripe_application_fee_amount_cents: 15000,
      }]));
    }
    if (url.includes("events")) {
      return Promise.resolve(jsonOk([{
        event_id: "eeeeeeee-1111-2222-3333-444444444444",
        events: {
          title: "Hostile Event",
          brand_id: "99999999-8888-7777-6666-555555555555",
        },
      }]));
    }
    return Promise.resolve(jsonOk([{ event_id: null }]));
  }

  // Everything else (audit, api-health, push internals) — inert success.
  return Promise.resolve(jsonOk({}));
};

async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

resetCapturedHandler();
await import("../../paystack-webhook/index.ts");
const handler = getCapturedHandler();

async function post(rawBody: string): Promise<Response> {
  const signature = await hmacSha512Hex(SECRET, rawBody);
  return await handler!(
    new Request("https://edge.test/paystack-webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": signature,
      },
      body: rawBody,
    }),
  );
}

function chargeBody(reference: unknown = "MGL-HOSTILE-1"): string {
  return JSON.stringify({
    event: "charge.success",
    data: {
      reference,
      status: "success",
      amount: 5000,
      currency: "NGN",
      channel: "card",
    },
  });
}

const TEST_OPTS = { sanitizeOps: false, sanitizeResources: false };

Deno.test({
  name:
    "WH-1 · partner-pin RPC 500s mid-engine → charge.success contract byte-stable (200, finalize, confirmation, processed=true, error=null)",
  ...TEST_OPTS,
  fn: async () => {
    assert(handler !== null, "handler captured");
    scenario = freshScenario();
    scenario.force500 = ["resolve_partner_for_brand_at_time"];

    const res = await post(chargeBody());
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.received, true);
    assert(scenario.log.finalize, "finalize ran");
    assert(scenario.log.confirmation, "confirmation dispatched");
    assert(scenario.log.splitStageHit, "the split path genuinely reached the forced-500 stage");
    const processed = scenario.log.patches.find((p) => p.processed === true);
    assert(processed !== undefined, "inbox processed=true");
    assertEquals(processed!.error ?? null, null, "no processingError from the split throw");
  },
});

Deno.test({
  name:
    "WH-2 · ledger-record RPC 500s (write stage) → charge.success contract byte-stable",
  ...TEST_OPTS,
  fn: async () => {
    scenario = freshScenario();
    scenario.force500 = ["record_paystack_partner_split_attempt"];

    const res = await post(chargeBody("MGL-HOSTILE-2"));
    assertEquals(res.status, 200);
    assertEquals((await res.json()).received, true);
    assert(scenario.log.finalize, "finalize ran");
    assert(scenario.log.confirmation, "confirmation dispatched");
    assert(scenario.log.splitStageHit, "split path reached the record stage");
    const processed = scenario.log.patches.find((p) => p.processed === true);
    assert(processed !== undefined, "inbox processed=true");
    assertEquals(processed!.error ?? null, null);
  },
});

Deno.test({
  name:
    "WH-3 · malformed charge.success payloads (no data / no reference / wrong types / negative junk) → no crash, no split attempt",
  ...TEST_OPTS,
  fn: async () => {
    const hostileBodies = [
      JSON.stringify({ event: "charge.success" }), // no data at all
      JSON.stringify({ event: "charge.success", data: {} }), // no reference
      JSON.stringify({ event: "charge.success", data: "not-an-object" }),
      JSON.stringify({
        event: "charge.success",
        data: { reference: 42, amount: -999999, currency: 7 },
      }),
      JSON.stringify({
        event: "charge.success",
        data: { reference: null, amount: "NaN" },
      }),
    ];
    for (const raw of hostileBodies) {
      scenario = freshScenario();
      const res = await post(raw);
      // Contract: the handler must ANSWER (2xx or the designed 5xx retry) —
      // never throw/hang — and must never reach the split stage on a charge
      // that could not finalize into an order.
      assert(
        res.status === 200 || res.status === 500,
        `hostile body answered ${res.status} (no crash)`,
      );
      await res.text(); // drain
      assertEquals(
        scenario.log.splitStageHit,
        false,
        `no split attempt for hostile body ${raw.slice(0, 60)}`,
      );
    }
  },
});

Deno.test({
  name:
    "WH-4 · hostile transfer.success (1MB reference, wrong-typed fields) → 200 received:true, processed=true, engine no-ops",
  ...TEST_OPTS,
  fn: async () => {
    scenario = freshScenario();
    const raw = JSON.stringify({
      event: "transfer.success",
      data: {
        reference: `psplit_${"x".repeat(1_000_000)}_a0`,
        transfer_code: 42,
        amount: "junk",
      },
    });
    const res = await post(raw);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).received, true);
    const processed = scenario.log.patches.find((p) => p.processed === true);
    assert(processed !== undefined, "inbox processed=true (no-op route)");
    assertEquals(processed!.error ?? null, null);
  },
});

Deno.test({
  name:
    "WH-5 · transfer.failed whose split-row read 500s → DESIGNED retry semantics: 500 processing_failed, processed=false, error recorded",
  ...TEST_OPTS,
  fn: async () => {
    scenario = freshScenario();
    scenario.splitRowsById = null; // force the partner_splits read to 500
    const raw = JSON.stringify({
      event: "transfer.failed",
      data: {
        reference: "psplit_0f0f0f0f-1111-2222-3333-4f4f4f4f4f4f_a0",
        transfer_code: "TRF_hostile_1",
        reason: "bank says no",
      },
    });
    const res = await post(raw);
    assertEquals(
      res.status,
      500,
      "transfer events ride the inbox retry semantics (SPEC §4.6.2 — no ticketing consequence)",
    );
    const body = await res.json();
    assertEquals(body.status, "processing_failed");
    const failedPatch = scenario.log.patches.find((p) => p.processed === false);
    assert(failedPatch !== undefined, "inbox processed=false (will retry)");
    assert(
      typeof failedPatch!.error === "string" &&
        (failedPatch!.error as string).length > 0,
      "processingError recorded for the retry",
    );
  },
});
