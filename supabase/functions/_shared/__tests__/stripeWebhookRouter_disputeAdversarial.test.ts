// ORCH-0953 §8 — Tester-written adversarial regression test (per ORCH-0840 Step 0.5 gate).
// Attacks different angles than the implementor's happy-path stripeDisputeHandlers.test.ts:
// malformed dispute payloads, missing required fields, replay/idempotency, brand lookup misses.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  handleChargeDispute,
  type StripeDisputeWebhookEvent,
} from "../stripeDisputeHandlers.ts";

type QueryResult = { data?: unknown; error?: { message: string } | null };

class FakeQuery {
  constructor(private table: string, private db: FakeSupabase) {}
  private filters: Record<string, unknown> = {};
  private payload: Record<string, unknown> | null = null;

  select(): FakeQuery {
    return this;
  }
  eq(column: string, value: unknown): FakeQuery {
    this.filters[column] = value;
    return this;
  }
  upsert(payload: Record<string, unknown>): FakeQuery {
    this.payload = payload;
    return this;
  }
  update(payload: Record<string, unknown>): FakeQuery {
    this.payload = payload;
    return this;
  }
  async maybeSingle(): Promise<QueryResult> {
    if (this.table === "stripe_connect_accounts") {
      // Adversarial: simulate brand lookup miss when configured
      return this.db.brandLookupReturnsNull
        ? { data: null, error: null }
        : { data: { brand_id: this.db.brandId }, error: null };
    }
    if (this.table === "orders") {
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
  then(resolve: (value: QueryResult) => void): Promise<void> {
    if (this.table === "stripe_disputes" && this.payload) {
      const id = String(this.payload.stripe_dispute_id);
      // Upsert semantics: same key overwrites — count remains 1
      this.db.disputes.set(id, this.payload);
      this.db.upsertCallCount += 1;
      resolve({ data: this.payload, error: null });
      return Promise.resolve();
    }
    resolve({ data: null, error: null });
    return Promise.resolve();
  }
}

class FakeSupabase {
  brandId = "00000000-0000-4000-8000-000000000001";
  disputes = new Map<string, Record<string, unknown>>();
  upsertCallCount = 0;
  brandLookupReturnsNull = false;
  from(table: string): FakeQuery {
    return new FakeQuery(table, this);
  }
}

function disputeEvent(
  overrides: { dispute?: Record<string, unknown> } = {},
): StripeDisputeWebhookEvent {
  return {
    id: "evt_adv_1",
    type: "charge.dispute.created",
    account: "acct_live_brand_xyz",
    data: {
      object: {
        id: "du_adv_1",
        charge: "ch_adv_1",
        payment_intent: "pi_adv_1",
        amount: 2500,
        currency: "usd",
        status: "needs_response",
        reason: "fraudulent",
        is_charge_refundable: true,
        evidence_details: { due_by: 1900000000 },
        ...(overrides.dispute ?? {}),
      },
    },
  };
}

Deno.test("ORCH-0953 §8 adversarial — duplicate dispute event ID replay produces exactly one row (idempotency)", async () => {
  const db = new FakeSupabase();
  // deno-lint-ignore no-explicit-any
  const supabase = db as any;
  // deno-lint-ignore no-explicit-any
  const noopEffects: any = {
    dispatchNotification: async () => undefined,
    postAppsFlyerS2SEvent: async () => true,
    resolveBrandOwnerUserId: async () => null,
  };

  // Send the same event twice (simulating Stripe webhook retry)
  await handleChargeDispute(supabase, disputeEvent(), noopEffects);
  await handleChargeDispute(supabase, disputeEvent(), noopEffects);

  assertEquals(db.disputes.size, 1, "exactly one dispute row after duplicate delivery");
  assertEquals(db.upsertCallCount, 2, "upsert called twice but rowKey collapses to one");
});

Deno.test("ORCH-0953 §8 adversarial — dispute event with missing charge ID fails loudly (no silent persist with bad data)", async () => {
  const db = new FakeSupabase();
  // deno-lint-ignore no-explicit-any
  const supabase = db as any;
  // deno-lint-ignore no-explicit-any
  const noopEffects: any = {
    dispatchNotification: async () => undefined,
    postAppsFlyerS2SEvent: async () => true,
    resolveBrandOwnerUserId: async () => null,
  };

  const malformed = disputeEvent({
    dispute: { id: "du_no_charge", charge: undefined },
  });

  // The current handler throws on missing required fields (charge is NOT NULL in DB).
  // This adversarial test LOCKS IN that behavior — a future change that silently persists
  // a dispute with null charge would break this test and need explicit re-justification.
  let threw = false;
  try {
    await handleChargeDispute(supabase, malformed, noopEffects);
  } catch (_err) {
    threw = true;
  }
  assert(threw, "handler MUST throw on missing charge ID — silent persist with null FK would corrupt audit trail");
  // And no row should have been written
  assertEquals(db.disputes.size, 0, "no dispute row persisted when payload is malformed");
});

Deno.test("ORCH-0953 §8 adversarial — dispute on unknown connected account (no brand row) does not crash", async () => {
  const db = new FakeSupabase();
  db.brandLookupReturnsNull = true;
  // deno-lint-ignore no-explicit-any
  const supabase = db as any;
  // deno-lint-ignore no-explicit-any
  const noopEffects: any = {
    dispatchNotification: async () => undefined,
    postAppsFlyerS2SEvent: async () => true,
    resolveBrandOwnerUserId: async () => null,
  };

  let threw = false;
  try {
    await handleChargeDispute(supabase, disputeEvent(), noopEffects);
  } catch (_err) {
    threw = true;
  }
  assert(!threw, "handler must not throw when brand lookup misses");
});

Deno.test("ORCH-0953 §8 adversarial — webhook router event-list contract still excludes noisy events", async () => {
  const source = await Deno.readTextFile(
    new URL("../stripeWebhookRouter.ts", import.meta.url),
  );
  // Adversarial check: any future PR that re-adds these to STRIPE_ROUTED_EVENT_TYPES
  // should fail this test (they were explicitly excluded per OQ-5 resolution).
  // We match the ARRAY entries (with quotes + comma) to avoid false positives on the doc comment.
  assertEquals(
    source.includes('"charge.succeeded",'),
    false,
    "charge.succeeded must NOT be in STRIPE_ROUTED_EVENT_TYPES (OQ-5 excluded)",
  );
  assertEquals(
    source.includes('"charge.failed",'),
    false,
    "charge.failed must NOT be in STRIPE_ROUTED_EVENT_TYPES (OQ-5 excluded)",
  );
  assertEquals(
    source.includes('"payment_intent.processing",'),
    false,
    "payment_intent.processing must NOT be in STRIPE_ROUTED_EVENT_TYPES (OQ-5 excluded)",
  );
  // And dispute events MUST be present
  assertStringIncludes(source, '"charge.dispute.created"');
  assertStringIncludes(source, '"charge.dispute.updated"');
  assertStringIncludes(source, '"charge.dispute.closed"');
});
