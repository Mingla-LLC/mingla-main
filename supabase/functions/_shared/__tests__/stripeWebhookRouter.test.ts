import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
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
    return Promise.resolve({ data: { orderId: "order_123" }, error: null });
  }
}

Deno.test("router exposes 26 subscribed events and excludes fake requirements event", () => {
  // ORCH-0787 added charge.refunded + refund.created + refund.updated (3 events) to the
  // existing 19, bringing total to 22. The legacy charge.refund.updated remains for
  // detached-account audit-only handling per stripeWebhookRouter.ts:28.
  // ORCH-0790 added checkout.session.completed (1 event) for the web Stripe Checkout
  // Sessions flow, bringing total to 23.
  // ORCH-0953 added charge.dispute.created/updated/closed (3 events) for live-mode
  // dispute persistence per SPEC §3.3, bringing total to 26.
  assertEquals(STRIPE_ROUTED_EVENT_TYPES.length, 26);
  assertEquals(STRIPE_ROUTED_EVENT_TYPES.includes("account.updated"), true);
  assertEquals(
    STRIPE_ROUTED_EVENT_TYPES.includes("application_fee.refunded"),
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
  globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
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
    assertEquals(db.rpcs[0].fn, "biz_ticket_checkout_finalize");
    assertEquals(db.rpcs[0].args.p_checkout_session_id, "session_123");
    assertEquals(db.rpcs[0].args.p_qr_token_pepper, "12345678901234567890123456789012");
  } finally {
    globalThis.fetch = originalFetch;
    if (priorPepper === undefined) Deno.env.delete("app.qr_token_pepper");
    else Deno.env.set("app.qr_token_pepper", priorPepper);
    if (priorSupabaseUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", priorSupabaseUrl);
    if (priorServiceKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", priorServiceKey);
  }
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
