// Issue #4420 — the Stripe webhook answered 200 when processing failed, so
// Stripe never redelivered: a missing QR pepper dropped a paid order's
// finalize for good. These tests drive the REAL processVerifiedStripeEvent
// (the endpoint after signature verification) against an in-memory
// payment_webhook_events table with the production unique stripe_event_id.
//
//   RC-*  classification of the failures the handlers really throw.
//   WH-*  the endpoint's answer: 503 / 500 for transient and config failures
//         with attempts left, 200 for success, replays, permanent failures and
//         exhausted events.
//   ID-*  retry idempotency: a redelivered event after a failure lands the
//         sale exactly once, and a processed event is never routed again.
//
// FAILS-ON-REVERT: restore supabase/functions/stripe-webhook/index.ts and
// supabase/functions/_shared/stripeWebhookRetry.ts from origin/main and the
// WH-1/WH-2/WH-5 statuses go back to 200 (or the export disappears).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  classifyStripeWebhookFailure,
  StripeWebhookRetryableError,
} from "../../_shared/stripeWebhookRetry.ts";

Deno.env.set("DENO_TESTING", "1");
const { processVerifiedStripeEvent } = await import(
  `../index.ts?issue4420=${Date.now()}`
);

interface EventRow {
  id: string;
  stripe_event_id: string;
  processed: boolean;
  retry_count: number;
  retries_exhausted: boolean;
  error: string | null;
  match_status?: string;
  match_reason_code?: string;
}

/** payment_webhook_events with the real unique index on stripe_event_id. */
function fakeSupabase(opts: { failSelect?: boolean; failInsert?: boolean } = {}) {
  const rows: EventRow[] = [];
  let nextId = 1;
  const client = {
    rows,
    from(table: string) {
      if (table !== "payment_webhook_events") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select(_cols: string) {
          return {
            eq(_col: string, value: string) {
              return {
                maybeSingle: () =>
                  Promise.resolve(
                    opts.failSelect
                      ? { data: null, error: { message: "connection reset" } }
                      : {
                        data: rows.find((r) => r.stripe_event_id === value) ??
                          null,
                        error: null,
                      },
                  ),
              };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          return {
            select: () => ({
              single: () => {
                if (opts.failInsert) {
                  return Promise.resolve({
                    data: null,
                    error: { message: "duplicate key value" },
                  });
                }
                if (rows.some((r) => r.stripe_event_id === row.stripe_event_id)) {
                  return Promise.resolve({
                    data: null,
                    error: { message: "duplicate key value violates unique constraint" },
                  });
                }
                const inserted: EventRow = {
                  id: `row-${nextId++}`,
                  stripe_event_id: String(row.stripe_event_id),
                  processed: false,
                  retry_count: 0,
                  retries_exhausted: false,
                  error: null,
                };
                rows.push(inserted);
                return Promise.resolve({ data: { id: inserted.id }, error: null });
              },
            }),
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              const row = rows.find((r) => r.id === id);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return client;
}

const event = (id = "evt_4420_pi", type = "payment_intent.succeeded") => ({
  id,
  type,
  data: { object: { id: "pi_4420" } },
});

const META = { secretName: "STRIPE_WEBHOOK_SECRET_TEST", ipAllowed: true };

async function deliver(
  supabase: ReturnType<typeof fakeSupabase>,
  route: (e: unknown) => Promise<unknown>,
  evt = event(),
) {
  const res: Response = await processVerifiedStripeEvent(evt, {
    supabase,
    route,
  }, META);
  return { status: res.status, body: await res.json() };
}

// ---- RC: classification -------------------------------------------------

Deno.test("RC-1 config failures are classified config", () => {
  assertEquals(classifyStripeWebhookFailure(new Error("qr_token_pepper_missing")), "config");
  assertEquals(
    classifyStripeWebhookFailure(
      new Error("ticket checkout finalize failed: qr_token_pepper_missing"),
    ),
    "config",
  );
  assertEquals(
    classifyStripeWebhookFailure(new Error("STRIPE_SECRET_KEY env var is not set")),
    "config",
  );
});

Deno.test("RC-2 transient failures (and anything unrecognised) are classified transient", () => {
  assertEquals(
    classifyStripeWebhookFailure(
      new StripeWebhookRetryableError("partner_attribution_order_pending"),
    ),
    "transient",
  );
  for (
    const message of [
      "order lookup failed: canceling statement due to statement timeout",
      "payout upsert failed: fetch failed",
      "refund webhook commit failed: could not serialize access",
      "refund webhook record lookup failed: refund_record_missing",
      "An error occurred with our connection to Stripe.",
    ]
  ) {
    assertEquals(classifyStripeWebhookFailure(new Error(message)), "transient", message);
  }
});

Deno.test("RC-3 permanently invalid events are classified permanent", () => {
  for (
    const message of [
      "payment_intent.succeeded missing payment_intent.id",
      "payout.paid missing connected account id",
      "account event missing account.id",
      "application_fee.created missing fee id",
      "charge.succeeded missing currency",
      "installment_pi_failed missing mingla_installment_id metadata",
      "source_refund_exact_match_missing",
      "source_refund_provider_evidence_mismatch",
      "source_refund_fee_evidence_mismatch",
      "application_fee_refund_identity_missing",
      "ticket_fee_refund_attempt_identity_conflict",
      "stay_provider_evidence_invalid",
      "partner_attribution_fee_charge_mismatch",
    ]
  ) {
    assertEquals(classifyStripeWebhookFailure(new Error(message)), "permanent", message);
  }
});

// ---- WH: endpoint answers ----------------------------------------------

Deno.test("WH-1 a missing QR pepper answers 500 so Stripe redelivers; the event stays unprocessed", async () => {
  const db = fakeSupabase();
  const out = await deliver(db, () => Promise.reject(new Error("qr_token_pepper_missing")));
  assertEquals(out.status, 500);
  assertEquals(out.body.status, "processing_retry");
  assertEquals(out.body.failure_class, "config");
  assertEquals(db.rows[0].processed, false);
  assertEquals(db.rows[0].error, "qr_token_pepper_missing");
});

Deno.test("WH-2 a transient failure answers 503", async () => {
  const db = fakeSupabase();
  const out = await deliver(db, () => Promise.reject(new Error("order lookup failed: fetch failed")));
  assertEquals(out.status, 503);
  assertEquals(out.body.failure_class, "transient");
});

Deno.test("WH-3 the fee-before-order wait still answers 503", async () => {
  const db = fakeSupabase();
  const out = await deliver(
    db,
    () => Promise.reject(new StripeWebhookRetryableError("partner_attribution_order_pending")),
    event("evt_fee", "application_fee.created"),
  );
  assertEquals(out.status, 503);
});

Deno.test("WH-4 a permanently invalid event answers 200 and keeps its ops flag", async () => {
  const db = fakeSupabase();
  const missing = await deliver(
    db,
    () => Promise.reject(new Error("payment_intent.succeeded missing payment_intent.id")),
  );
  assertEquals(missing.status, 200);
  assertEquals(missing.body.status, "processing_failed");
  const unmatched = await deliver(
    db,
    () => Promise.reject(new Error("source_refund_exact_match_missing")),
    event("evt_refund", "refund.updated"),
  );
  assertEquals(unmatched.status, 200);
  assertEquals(db.rows[1].match_status, "unmatched");
});

Deno.test("WH-5 an event row that cannot be read or written answers 503 and is not routed", async () => {
  let routed = 0;
  const route = () => {
    routed++;
    return Promise.resolve({});
  };
  assertEquals((await deliver(fakeSupabase({ failSelect: true }), route)).status, 503);
  assertEquals((await deliver(fakeSupabase({ failInsert: true }), route)).status, 503);
  assertEquals(routed, 0);
});

Deno.test("WH-6 success answers 200; a replay of a processed event answers 200 without routing", async () => {
  const db = fakeSupabase();
  let routed = 0;
  const route = () => {
    routed++;
    return Promise.resolve({});
  };
  const first = await deliver(db, route);
  assertEquals(first.status, 200);
  assertEquals(first.body.status, "ok");
  const replay = await deliver(db, route);
  assertEquals(replay.status, 200);
  assertEquals(replay.body.status, "replayed_processed");
  assertEquals(routed, 1);
});

Deno.test("WH-7 a failure that never clears stops after the attempt cap with 200", async () => {
  const db = fakeSupabase();
  let routed = 0;
  const route = () => {
    routed++;
    return Promise.reject(new Error("order lookup failed: fetch failed"));
  };
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) statuses.push((await deliver(db, route)).status);
  assertEquals(statuses, [503, 503, 503, 503, 200, 200, 200]);
  assertEquals(routed, 5);
  assertEquals(db.rows[0].retries_exhausted, true);
});

// ---- ID: retry idempotency --------------------------------------------

/**
 * A sale's routing as the real handler does it: finalize is keyed by the
 * checkout session (biz_ticket_checkout_finalize returns `replayed` once the
 * session has an order), ticket emails are rows sent only while `pending`,
 * and the money ledger row is keyed by the order. The first delivery fails
 * AFTER finalize, at the pepper read of a later step, the worst case for a
 * redelivery.
 */
function saleWorld() {
  const orders = new Map<string, string>();
  const ledger = new Set<string>();
  const emailsSent: string[] = [];
  const emailRows = new Map<string, "pending" | "sent">();
  let pepper: string | null = null;
  const route = () => {
    const session = "tcs_4420";
    let orderId = orders.get(session);
    if (!orderId) {
      orderId = `order_${orders.size + 1}`;
      orders.set(session, orderId);
      emailRows.set(orderId, "pending");
    }
    ledger.add(`sale:${orderId}`);
    if (pepper === null) return Promise.reject(new Error("qr_token_pepper_missing"));
    if (emailRows.get(orderId) === "pending") {
      emailsSent.push(orderId);
      emailRows.set(orderId, "sent");
    }
    return Promise.resolve({});
  };
  return {
    orders,
    ledger,
    emailsSent,
    route,
    fixPepper: () => {
      pepper = "configured";
    },
  };
}

Deno.test("ID-1 a redelivery after a config failure lands one order, one ledger row, one email", async () => {
  const db = fakeSupabase();
  const world = saleWorld();
  assertEquals((await deliver(db, world.route)).status, 500);
  assertEquals((await deliver(db, world.route)).status, 500);
  world.fixPepper();
  assertEquals((await deliver(db, world.route)).status, 200);
  // Stripe may still redeliver (or an operator resends) after success.
  const replay = await deliver(db, world.route);
  assertEquals(replay.body.status, "replayed_processed");
  assertEquals(world.orders.size, 1);
  assertEquals(world.ledger.size, 1);
  assertEquals(world.emailsSent, ["order_1"]);
  assertEquals(db.rows.length, 1);
  assert(db.rows[0].processed);
});

Deno.test("ID-2 two distinct events are recorded and routed independently", async () => {
  const db = fakeSupabase();
  let routed = 0;
  const route = () => {
    routed++;
    return Promise.resolve({});
  };
  await deliver(db, route, event("evt_a"));
  await deliver(db, route, event("evt_b"));
  await deliver(db, route, event("evt_a"));
  assertEquals(routed, 2);
  assertEquals(db.rows.length, 2);
});
