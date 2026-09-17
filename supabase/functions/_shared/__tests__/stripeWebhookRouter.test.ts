import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  paymentIntentChargeId,
  routeStripeEvent,
  STRIPE_ROUTED_EVENT_TYPES,
} from "../stripeWebhookRouter.ts";

class FakeBuilder {
  table: string;
  db: FakeDb;
  filters: Record<string, unknown> = {};
  payload: Record<string, unknown> | null = null;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters[key] = value;
    return this;
  }

  is(key: string, value: unknown) {
    this.filters[key] = value;
    return this;
  }

  not() {
    return this;
  }

  in() {
    return this;
  }

  upsert(payload: Record<string, unknown>) {
    this.db.upserts.push({ table: this.table, payload });
    return Promise.resolve({ error: null });
  }

  update(payload: Record<string, unknown>) {
    this.payload = payload;
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.db.inserts.push({ table: this.table, payload });
    return Promise.resolve({ error: null });
  }

  delete() {
    this.db.deletes.push({ table: this.table, filters: this.filters });
    return this;
  }

  maybeSingle() {
    if (this.table === "ticket_checkout_sessions") {
      return Promise.resolve({
        data: {
          id: "session_123",
          brand_id: "brand_123",
          event_id: "event_123",
          order_id: null,
        },
        error: null,
      });
    }
    if (this.table === "stripe_connect_accounts") {
      return Promise.resolve({
        data: {
          brand_id: "brand_123",
          charges_enabled: false,
          payouts_enabled: false,
          requirements: {},
          detached_at: this.db.detachedAt,
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }

  then(resolve: (value: { data: unknown[]; error: null }) => void) {
    if (this.table === "brand_team_members") {
      resolve({
        data: [{ user_id: "user_123", role: "finance_manager" }],
        error: null,
      });
      return;
    }
    resolve({ data: [], error: null });
  }
}

class FakeDb {
  upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  deletes: Array<{ table: string; filters: Record<string, unknown> }> = [];
  rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  detachedAt: string | null = null;

  from(table: string) {
    return new FakeBuilder(this, table);
  }

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcs.push({ fn, args });
    if (fn === "issue_2079_verify_ticket_paid_identity") {
      // Mirrors the live RPC: a Stripe payment with no charge id is never
      // verified — it is held and routed to a reversal instead.
      const charge = typeof args.p_stripe_charge_id === "string"
        ? args.p_stripe_charge_id
        : "";
      return Promise.resolve({
        data: {
          outcome: /^ch_[A-Za-z0-9]+$/.test(charge) ? "verified" : "attention",
        },
        error: null,
      });
    }
    return Promise.resolve({ data: { orderId: "order_123" }, error: null });
  }
}

Deno.test("router exposes 28 subscribed events and excludes fake requirements event", () => {
  // ORCH-0787 added charge.refunded + refund.created + refund.updated (3 events) to the
  // existing 19, bringing total to 22. The legacy charge.refund.updated remains for
  // detached-account audit-only handling per stripeWebhookRouter.ts:28.
  // ORCH-0790 added checkout.session.completed (1 event) for the web Stripe Checkout
  // Sessions flow, bringing total to 23.
  // ORCH-0953 added charge.dispute.created/updated/closed (3 events) for live-mode
  // dispute persistence per SPEC §3.3, bringing total to 26.
  // ORCH-1054 added charge.succeeded (1 event) — it carries the application_fee.id
  // needed to fan-out partner splits via Stripe Transfer — bringing total to 27.
  // ORCH-1221 added application_fee.refund.updated (1 event) so exact fee-leg
  // reconciliation is routed through the typed source-refund handler: total 28.
  // This revises ORCH-0953 §3.4, which had explicitly excluded charge.succeeded.
  assertEquals(STRIPE_ROUTED_EVENT_TYPES.length, 28);
  assertEquals(STRIPE_ROUTED_EVENT_TYPES.includes("account.updated"), true);
  assertEquals(STRIPE_ROUTED_EVENT_TYPES.includes("charge.succeeded"), true);
  assertEquals(
    STRIPE_ROUTED_EVENT_TYPES.includes("application_fee.refunded"),
    true,
  );
  assertEquals(
    STRIPE_ROUTED_EVENT_TYPES.includes("application_fee.refund.updated"),
    true,
  );
  assertEquals(
    STRIPE_ROUTED_EVENT_TYPES.includes("payment_intent.succeeded"),
    true,
  );
  assertEquals(
    STRIPE_ROUTED_EVENT_TYPES.includes("checkout.session.completed"),
    true,
  );
  assertEquals(
    STRIPE_ROUTED_EVENT_TYPES.includes("account.requirements.updated" as never),
    false,
  );
});

Deno.test("payment_intent.succeeded finalizes checkout with bounded QR pepper RPC argument", async () => {
  const priorPepper = Deno.env.get("app.qr_token_pepper");
  const priorSupabaseUrl = Deno.env.get("SUPABASE_URL");
  const priorServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const originalFetch = globalThis.fetch;
  Deno.env.set("app.qr_token_pepper", "12345678901234567890123456789012");
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
  globalThis.fetch =
    (() =>
      Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
  try {
    const db = new FakeDb();
    const result = await routeStripeEvent(db as never, {} as never, {
      id: "evt_pi",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_123",
          charges: { data: [{ id: "ch_123" }] },
          payment_method_types: ["card"],
        },
      },
    });
    assertEquals(result.brandId, "brand_123");
    assertEquals(db.rpcs[0].fn, "issue_2079_verify_ticket_paid_identity");
    const finalizeIndex = db.rpcs.findIndex((call) =>
      call.fn === "biz_ticket_checkout_finalize"
    );
    assertEquals(finalizeIndex > 0, true);
    assertEquals(
      db.rpcs[finalizeIndex].args.p_checkout_session_id,
      "session_123",
    );
    assertEquals(
      db.rpcs[finalizeIndex].args.p_qr_token_pepper,
      "12345678901234567890123456789012",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (priorPepper === undefined) Deno.env.delete("app.qr_token_pepper");
    else Deno.env.set("app.qr_token_pepper", priorPepper);
    if (priorSupabaseUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", priorSupabaseUrl);
    if (priorServiceKey === undefined) {
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    } else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", priorServiceKey);
  }
});

async function withTicketFinalizeEnv(run: () => Promise<void>) {
  const priorPepper = Deno.env.get("app.qr_token_pepper");
  const priorSupabaseUrl = Deno.env.get("SUPABASE_URL");
  const priorServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const originalFetch = globalThis.fetch;
  Deno.env.set("app.qr_token_pepper", "12345678901234567890123456789012");
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
  globalThis.fetch =
    (() =>
      Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (priorPepper === undefined) Deno.env.delete("app.qr_token_pepper");
    else Deno.env.set("app.qr_token_pepper", priorPepper);
    if (priorSupabaseUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", priorSupabaseUrl);
    if (priorServiceKey === undefined) {
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    } else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", priorServiceKey);
  }
}

// A paid ticket must never be refused because the webhook could not see the
// charge. On the pinned Stripe API a PaymentIntent carries `latest_charge`
// and NO `charges` list — the exact live payload shape. REVERT the webhook to
// reading only `charges.data[0]` and this test fails: no finalize, no ticket.
Deno.test("payment_intent.succeeded with only latest_charge (live API shape) verifies and issues the ticket", async () => {
  await withTicketFinalizeEnv(async () => {
    const db = new FakeDb();
    const result = await routeStripeEvent(db as never, {} as never, {
      id: "evt_pi_live_shape",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_3LiveShape",
          latest_charge: "ch_3LiveShape",
          payment_method_types: ["card"],
        },
      },
    });
    assertEquals(result.brandId, "brand_123");
    const verify = db.rpcs.find((call) =>
      call.fn === "issue_2079_verify_ticket_paid_identity"
    );
    assertEquals(verify?.args.p_stripe_charge_id, "ch_3LiveShape");
    const finalize = db.rpcs.find((call) =>
      call.fn === "biz_ticket_checkout_finalize"
    );
    assertEquals(finalize === undefined, false);
    assertEquals(finalize?.args.p_stripe_charge_id, "ch_3LiveShape");
    assertEquals(finalize?.args.p_stripe_payment_intent_id, "pi_3LiveShape");
  });
});

Deno.test("payment_intent.succeeded with an expanded latest_charge object still issues the ticket", async () => {
  await withTicketFinalizeEnv(async () => {
    const db = new FakeDb();
    await routeStripeEvent(db as never, {} as never, {
      id: "evt_pi_expanded",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_3Expanded",
          latest_charge: { id: "ch_3Expanded", object: "charge" },
          payment_method_types: ["card"],
        },
      },
    });
    const finalize = db.rpcs.find((call) =>
      call.fn === "biz_ticket_checkout_finalize"
    );
    assertEquals(finalize?.args.p_stripe_charge_id, "ch_3Expanded");
  });
});

// The guard stays a guard: a payment that truly has no charge is still held.
Deno.test("payment_intent.succeeded with no charge at all is still held, never finalized", async () => {
  await withTicketFinalizeEnv(async () => {
    const db = new FakeDb();
    await routeStripeEvent(db as never, {} as never, {
      id: "evt_pi_no_charge",
      type: "payment_intent.succeeded",
      data: {
        object: { id: "pi_3NoCharge", payment_method_types: ["card"] },
      },
    });
    assertEquals(
      db.rpcs.some((call) =>
        call.fn === "issue_2079_verify_ticket_paid_identity"
      ),
      true,
    );
    assertEquals(
      db.rpcs.some((call) => call.fn === "biz_ticket_checkout_finalize"),
      false,
    );
  });
});

Deno.test("RSVP chip-in payment_intent.succeeded records the live latest_charge id", async () => {
  const db = new FakeDb();
  await routeStripeEvent(db as never, {} as never, {
    id: "evt_rsvp_live_shape",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_3Chipin",
        latest_charge: "ch_3Chipin",
        payment_method_types: ["card"],
        metadata: {
          mingla_purpose: "rsvp_contribution",
          contribution_id: "contribution_123",
        },
      },
    },
  });
  const finalize = db.rpcs.find((call) =>
    call.fn === "issue_1930_finalize_rsvp_contribution"
  );
  assertEquals(finalize?.args.p_charge_id, "ch_3Chipin");
});

Deno.test("paymentIntentChargeId reads latest_charge first, then the legacy charges list", () => {
  assertEquals(paymentIntentChargeId({ latest_charge: "ch_a" }), "ch_a");
  assertEquals(
    paymentIntentChargeId({ latest_charge: { id: "ch_b" } }),
    "ch_b",
  );
  assertEquals(
    paymentIntentChargeId({ charges: { data: [{ id: "ch_c" }] } }),
    "ch_c",
  );
  assertEquals(
    paymentIntentChargeId({
      latest_charge: "ch_new",
      charges: { data: [{ id: "ch_old" }] },
    }),
    "ch_new",
  );
  assertEquals(paymentIntentChargeId({ latest_charge: null }), null);
  assertEquals(paymentIntentChargeId({ latest_charge: "" }), null);
  assertEquals(paymentIntentChargeId({}), null);
});

Deno.test("account.updated updates connect row and clears KYC stall marker when enabled", async () => {
  const db = new FakeDb();
  const result = await routeStripeEvent(db as never, {} as never, {
    id: "evt_account",
    type: "account.updated",
    data: {
      object: {
        id: "acct_123",
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [] },
        metadata: { mingla_brand_id: "brand_123" },
      },
    },
  });
  assertEquals(result.brandId, "brand_123");
  assertEquals(db.upserts[0].payload.kyc_stall_reminder_sent_at, null);
});

Deno.test("payout.failed upserts payout and dispatches remediation notification", async () => {
  const calls: unknown[] = [];
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = Deno.env.get("SUPABASE_URL");
  const originalServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
  globalThis.fetch = ((_, init) => {
    const requestInit = init as { body?: unknown };
    calls.push(JSON.parse(String(requestInit?.body)));
    return Promise.resolve(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
  }) as typeof fetch;
  try {
    const db = new FakeDb();
    await routeStripeEvent(db as never, {} as never, {
      id: "evt_payout",
      type: "payout.failed",
      account: "acct_123",
      data: {
        object: {
          id: "po_123",
          amount: 1200,
          currency: "gbp",
          status: "failed",
          failure_code: "invalid_account_number",
        },
      },
    });
    assertEquals(db.upserts.some((row) => row.table === "payouts"), true);
    assertEquals((calls[0] as { type: string }).type, "stripe.payout_failed");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl === undefined) {
      Deno.env.delete("SUPABASE_URL");
    } else {
      Deno.env.set("SUPABASE_URL", originalSupabaseUrl);
    }
    if (originalServiceKey === undefined) {
      Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    } else {
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalServiceKey);
    }
  }
});

// ── Installment PaymentIntents record the real charge ────────────────────────
// A collected installment keeps the charge id so it can be refunded and
// reconciled later. The pinned Stripe API sends `latest_charge` and NO
// `charges` list; the installment handler used to read only
// `charges.data[0]` and saved a null charge id on every collection. REVERT
// installmentWebhookHandlers.ts to that read and the live-shape tests fail.
class InstallmentFakeBuilder {
  table: string;
  db: InstallmentFakeDb;
  pendingUpdate: Record<string, unknown> | null = null;

  constructor(db: InstallmentFakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select() {
    return this;
  }

  eq() {
    return this;
  }

  in() {
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.pendingUpdate = payload;
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.db.inserts.push({ table: this.table, payload });
    return Promise.resolve({ error: null });
  }

  maybeSingle() {
    if (this.table === "order_installments" && this.pendingUpdate) {
      this.db.installmentUpdates.push(this.pendingUpdate);
      return Promise.resolve({
        data: {
          id: "installment_123",
          order_id: "order_123",
          ordinal: 2,
          amount_cents: 2500,
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }

  // The "remaining installments" count. One still scheduled, so the
  // paid-in-full dispatch (a network call) is never reached.
  then(resolve: (value: { count: number; error: null }) => void) {
    resolve({ count: 1, error: null });
  }
}

class InstallmentFakeDb {
  inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  installmentUpdates: Array<Record<string, unknown>> = [];

  from(table: string) {
    return new InstallmentFakeBuilder(this, table);
  }

  rpc() {
    throw new Error("installment collection must not call an RPC");
  }
}

function installmentSucceededEvent(object: Record<string, unknown>) {
  return {
    id: "evt_installment",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_3Installment",
        payment_method_types: ["card"],
        metadata: {
          mingla_installment_id: "installment_123",
          mingla_brand_id: "brand_123",
        },
        ...object,
      },
    },
  };
}

Deno.test("installment payment_intent.succeeded with only latest_charge (live API shape) saves the charge id", async () => {
  const db = new InstallmentFakeDb();
  const result = await routeStripeEvent(
    db as never,
    {} as never,
    installmentSucceededEvent({ latest_charge: "ch_3InstallmentLive" }),
  );
  assertEquals(result.brandId, "brand_123");
  assertEquals(db.installmentUpdates.length, 1);
  assertEquals(db.installmentUpdates[0].status, "collected");
  assertEquals(
    db.installmentUpdates[0].stripe_payment_intent_id,
    "pi_3Installment",
  );
  assertEquals(
    db.installmentUpdates[0].stripe_charge_id,
    "ch_3InstallmentLive",
  );
  const audit = db.inserts.find((row) => row.table === "audit_log");
  assertEquals(
    (audit?.payload.after as Record<string, unknown>).stripe_charge_id,
    "ch_3InstallmentLive",
  );
});

Deno.test("installment payment_intent.succeeded with an expanded latest_charge object saves the charge id", async () => {
  const db = new InstallmentFakeDb();
  await routeStripeEvent(
    db as never,
    {} as never,
    installmentSucceededEvent({
      latest_charge: { id: "ch_3InstallmentExpanded", object: "charge" },
    }),
  );
  assertEquals(
    db.installmentUpdates[0]?.stripe_charge_id,
    "ch_3InstallmentExpanded",
  );
});

Deno.test("installment payment_intent.succeeded with no charge still collects, with no invented charge id", async () => {
  const db = new InstallmentFakeDb();
  await routeStripeEvent(
    db as never,
    {} as never,
    installmentSucceededEvent({}),
  );
  assertEquals(db.installmentUpdates[0]?.status, "collected");
  assertEquals(db.installmentUpdates[0]?.stripe_charge_id, null);
});
