import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handleChargeDispute } from "../stripeDisputeHandlers.ts";

type QueryResult = { data?: unknown; error?: { message: string } | null };

class FakeQuery {
  constructor(
    private table: string,
    private db: FakeSupabase,
  ) {}
  private filters: Record<string, unknown> = {};
  private updatePayload: Record<string, unknown> | null = null;

  select(): FakeQuery {
    return this;
  }
  eq(column: string, value: unknown): FakeQuery {
    this.filters[column] = value;
    return this;
  }
  update(payload: Record<string, unknown>): FakeQuery {
    this.updatePayload = payload;
    return this;
  }
  upsert(payload: Record<string, unknown>): FakeQuery {
    this.updatePayload = payload;
    return this;
  }
  async maybeSingle(): Promise<QueryResult> {
    if (this.table === "stripe_connect_accounts") {
      return { data: { brand_id: this.db.brandId }, error: null };
    }
    if (this.table === "orders") {
      const byCharge = this.filters.stripe_charge_id === this.db.chargeId;
      const byPi =
        this.filters.stripe_payment_intent_id === this.db.paymentIntentId;
      return {
        data: byCharge || byPi ? { id: this.db.orderId } : null,
        error: null,
      };
    }
    return { data: null, error: null };
  }
  then(resolve: (value: QueryResult) => void): Promise<void> {
    if (this.table === "stripe_disputes" && this.updatePayload) {
      const id = String(this.updatePayload.stripe_dispute_id);
      this.db.disputes.set(id, this.updatePayload);
      resolve({ data: this.updatePayload, error: null });
      return Promise.resolve();
    }
    resolve({ data: null, error: null });
    return Promise.resolve();
  }
}

class FakeSupabase {
  brandId = "00000000-0000-4000-8000-000000000001";
  orderId = "00000000-0000-4000-8000-000000000002";
  chargeId = "ch_123";
  paymentIntentId = "pi_123";
  disputes = new Map<string, Record<string, unknown>>();

  from(table: string): FakeQuery {
    return new FakeQuery(table, this);
  }
}

const event = (type: string, status = "needs_response") => ({
  id: `evt_${type}`,
  type,
  account: "acct_connected",
  data: {
    object: {
      id: "dp_123",
      charge: "ch_123",
      payment_intent: "pi_123",
      amount: 5000,
      currency: "usd",
      status,
      reason: "fraudulent",
      evidence_details: { due_by: 1_800_000_000 },
      is_charge_refundable: false,
    },
  },
});

Deno.test("ORCH-0953 §3.3 — dispute.created upserts one row and dispatches configured operator alerts", async () => {
  const prior = Deno.env.get("STRIPE_DISPUTE_ALERT_USERS");
  Deno.env.set("STRIPE_DISPUTE_ALERT_USERS", "user-a,user-b");
  const supabase = new FakeSupabase();
  const notifications: unknown[] = [];
  const appsFlyerEvents: string[] = [];
  try {
    await handleChargeDispute(
      supabase as never,
      event("charge.dispute.created"),
      {
        dispatchNotification: (async (input: unknown) => {
          notifications.push(input);
        }) as never,
        resolveBrandOwnerUserId: (async () => "owner-user") as never,
        postAppsFlyerS2SEvent: (async (input: { eventName: string }) => {
          appsFlyerEvents.push(input.eventName);
          return true;
        }) as never,
      },
    );
    assertEquals(supabase.disputes.size, 1);
    assertEquals(notifications.length, 2);
    assertEquals(appsFlyerEvents, ["dispute_created"]);
  } finally {
    if (prior === undefined) Deno.env.delete("STRIPE_DISPUTE_ALERT_USERS");
    else Deno.env.set("STRIPE_DISPUTE_ALERT_USERS", prior);
  }
});

Deno.test("ORCH-0953 §3.3 — stripe_disputes migration declares schema, RLS, and policies", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20260726000000_orch_0953_create_stripe_disputes.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(sql, "CREATE TABLE public.stripe_disputes");
  assertStringIncludes(sql, "stripe_dispute_id text NOT NULL UNIQUE");
  assertStringIncludes(
    sql,
    "ALTER TABLE public.stripe_disputes ENABLE ROW LEVEL SECURITY",
  );
  assertStringIncludes(sql, 'CREATE POLICY "service_role_all_stripe_disputes"');
  assertStringIncludes(
    sql,
    'CREATE POLICY "brand_payment_managers_select_stripe_disputes"',
  );
});

Deno.test("ORCH-0953 §3.3 — replaying the same dispute is idempotent", async () => {
  const prior = Deno.env.get("STRIPE_DISPUTE_ALERT_USERS");
  Deno.env.delete("STRIPE_DISPUTE_ALERT_USERS");
  const supabase = new FakeSupabase();
  const effects = {
    dispatchNotification: (async () => {}) as never,
    resolveBrandOwnerUserId: (async () => null) as never,
    postAppsFlyerS2SEvent: (async () => true) as never,
  };
  try {
    await handleChargeDispute(
      supabase as never,
      event("charge.dispute.created"),
      effects,
    );
    await handleChargeDispute(
      supabase as never,
      event("charge.dispute.created"),
      effects,
    );
    assertEquals(supabase.disputes.size, 1);
  } finally {
    if (prior === undefined) Deno.env.delete("STRIPE_DISPUTE_ALERT_USERS");
    else Deno.env.set("STRIPE_DISPUTE_ALERT_USERS", prior);
  }
});

Deno.test("ORCH-0953 §3.3 — closed lost dispute posts dispute_lost AppsFlyer event", async () => {
  const supabase = new FakeSupabase();
  const appsFlyerEvents: string[] = [];
  await handleChargeDispute(
    supabase as never,
    event("charge.dispute.closed", "lost"),
    {
      dispatchNotification: (async () => {}) as never,
      resolveBrandOwnerUserId: (async () => "owner-user") as never,
      postAppsFlyerS2SEvent: (async (input: { eventName: string }) => {
        appsFlyerEvents.push(input.eventName);
        return true;
      }) as never,
    },
  );
  assertEquals(appsFlyerEvents, ["dispute_lost"]);
});
