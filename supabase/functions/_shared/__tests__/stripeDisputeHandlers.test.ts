import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handleChargeDispute } from "../stripeDisputeHandlers.ts";

type QueryResult = { data?: unknown; error?: { message: string } | null };

class FakeQuery {
  constructor(
    private table: string,
    private db: FakeSupabase,
  ) {}
  private filters: Record<string, unknown> = {};
  private updatePayload: Record<string, unknown> | null = null;

  select(_columns?: string): FakeQuery {
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
  maybeSingle(): Promise<QueryResult> {
    if (this.table === "stripe_connect_accounts") {
      return Promise.resolve({
        data: { brand_id: this.db.brandId },
        error: null,
      });
    }
    if (this.table === "orders") {
      const byCharge = this.filters.stripe_charge_id === this.db.chargeId;
      const byPi =
        this.filters.stripe_payment_intent_id === this.db.paymentIntentId;
      return Promise.resolve({
        data: byCharge || byPi ? { id: this.db.orderId } : null,
        error: null,
      });
    }
    if (this.table === "brands") {
      return Promise.resolve({
        data: { name: this.db.brandName },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
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
  brandName = "Acme Co";
  orderId = "00000000-0000-4000-8000-000000000002";
  chargeId = "ch_123";
  paymentIntentId = "pi_123";
  disputes = new Map<string, Record<string, unknown>>();

  from(table: string): FakeQuery {
    return new FakeQuery(table, this);
  }
}

const event = (
  type: string,
  status = "needs_response",
  disputeOverrides: Record<string, unknown> = {},
) => ({
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
      livemode: true,
      ...disputeOverrides,
    },
  },
});

Deno.test("ORCH-0956 T-01 — dispute.created upserts one row and sends configured operator email alerts", async () => {
  const prior = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
  Deno.env.set(
    "STRIPE_DISPUTE_ALERT_EMAILS",
    "ops@example.com,ops2@example.com",
  );
  const supabase = new FakeSupabase();
  const alerts: {
    subject: string;
    paragraphs: string[];
    recipients: string[];
    cta?: { label: string; url: string } | null;
  }[] = [];
  const appsFlyerEvents: string[] = [];
  const dueBy = Math.floor(Date.now() / 1000) + 7 * 86_400;
  try {
    await handleChargeDispute(
      supabase as never,
      event("charge.dispute.created", "needs_response", {
        evidence_details: { due_by: dueBy },
      }),
      {
        sendOpsAlertEmail: ((input: {
          subject: string;
          paragraphs: string[];
          recipients: string[];
          cta?: { label: string; url: string } | null;
        }) => {
          alerts.push(input);
          return Promise.resolve({
            attempted: input.recipients.length,
            succeeded: input.recipients.length,
            failed: 0,
          });
        }) as never,
        resolveBrandOwnerUserId: (() => Promise.resolve("owner-user")) as never,
        postAppsFlyerS2SEvent: ((input: { eventName: string }) => {
          appsFlyerEvents.push(input.eventName);
          return Promise.resolve(true);
        }) as never,
      },
    );
    assertEquals(supabase.disputes.size, 1);
    assertEquals(alerts.length, 1);
    assertStringIncludes(
      alerts[0].subject,
      "🚨 [LIVE] Chargeback dispute — USD 50.00 on Acme Co, evidence due in 7 days",
    );
    assertEquals(alerts[0].recipients, ["ops@example.com", "ops2@example.com"]);
    assertStringIncludes(alerts[0].paragraphs.join("\n"), "Amount: USD 50.00");
    assertStringIncludes(alerts[0].paragraphs.join("\n"), "Brand: Acme Co");
    assertStringIncludes(alerts[0].paragraphs.join("\n"), "Reason: fraudulent");
    assertStringIncludes(alerts[0].paragraphs.join("\n"), "Dispute ID: dp_123");
    assertEquals(alerts[0].cta, {
      label: "Open in Stripe Dashboard",
      url: "https://dashboard.stripe.com/disputes/dp_123",
    });
    assertEquals(appsFlyerEvents, ["dispute_created"]);
  } finally {
    if (prior === undefined) Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
    else Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", prior);
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
  const prior = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
  Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
  const supabase = new FakeSupabase();
  const effects = {
    sendOpsAlertEmail: (() =>
      Promise.resolve({
        attempted: 0,
        succeeded: 0,
        failed: 0,
      })) as never,
    resolveBrandOwnerUserId: (() => Promise.resolve(null)) as never,
    postAppsFlyerS2SEvent: (() => Promise.resolve(true)) as never,
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
    if (prior === undefined) Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
    else Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", prior);
  }
});

Deno.test("ORCH-0956 T-02 — closed lost dispute sends email alert and posts dispute_lost AppsFlyer event", async () => {
  const prior = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
  Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", "ops@example.com");
  const supabase = new FakeSupabase();
  const alerts: {
    subject: string;
    paragraphs: string[];
    recipients: string[];
    cta?: { label: string; url: string } | null;
  }[] = [];
  const appsFlyerEvents: string[] = [];
  try {
    await handleChargeDispute(
      supabase as never,
      event("charge.dispute.closed", "lost"),
      {
        sendOpsAlertEmail: ((input: {
          subject: string;
          paragraphs: string[];
          recipients: string[];
          cta?: { label: string; url: string } | null;
        }) => {
          alerts.push(input);
          return Promise.resolve({
            attempted: input.recipients.length,
            succeeded: input.recipients.length,
            failed: 0,
          });
        }) as never,
        resolveBrandOwnerUserId: (() => Promise.resolve("owner-user")) as never,
        postAppsFlyerS2SEvent: ((input: { eventName: string }) => {
          appsFlyerEvents.push(input.eventName);
          return Promise.resolve(true);
        }) as never,
      },
    );
    assertEquals(alerts.length, 1);
    assertEquals(
      alerts[0].subject,
      "❌ [LIVE] Chargeback LOST — USD 50.00 on Acme Co",
    );
    assertEquals(alerts[0].recipients, ["ops@example.com"]);
    assertStringIncludes(
      alerts[0].paragraphs.join("\n"),
      'A Stripe chargeback was closed with status "lost".',
    );
    assertEquals(alerts[0].cta, {
      label: "Open in Stripe Dashboard",
      url: "https://dashboard.stripe.com/disputes/dp_123",
    });
    assertEquals(appsFlyerEvents, ["dispute_lost"]);
  } finally {
    if (prior === undefined) Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
    else Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", prior);
  }
});

Deno.test("ORCH-0956 T-03 — dispute.updated upserts without sending operator email alerts", async () => {
  const prior = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
  Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", "ops@example.com");
  const supabase = new FakeSupabase();
  const alerts: unknown[] = [];
  try {
    await handleChargeDispute(
      supabase as never,
      event("charge.dispute.updated"),
      {
        sendOpsAlertEmail: ((input: unknown) => {
          alerts.push(input);
          return Promise.resolve({ attempted: 1, succeeded: 1, failed: 0 });
        }) as never,
        resolveBrandOwnerUserId: (() => Promise.resolve("owner-user")) as never,
        postAppsFlyerS2SEvent: (() => Promise.resolve(true)) as never,
      },
    );
    assertEquals(supabase.disputes.size, 1);
    assertEquals(alerts.length, 0);
  } finally {
    if (prior === undefined) Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
    else Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", prior);
  }
});

Deno.test("ORCH-0956 T-05 — missing dispute email env does not block upsert or AppsFlyer", async () => {
  const prior = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
  const originalWarn = console.warn;
  const warnings: string[] = [];
  Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
  console.warn = ((message?: unknown) => {
    warnings.push(String(message));
  }) as typeof console.warn;
  const supabase = new FakeSupabase();
  const alerts: unknown[] = [];
  const appsFlyerEvents: string[] = [];
  try {
    await handleChargeDispute(
      supabase as never,
      event("charge.dispute.created"),
      {
        sendOpsAlertEmail: ((input: unknown) => {
          alerts.push(input);
          return Promise.resolve({ attempted: 1, succeeded: 1, failed: 0 });
        }) as never,
        resolveBrandOwnerUserId: (() => Promise.resolve("owner-user")) as never,
        postAppsFlyerS2SEvent: ((input: { eventName: string }) => {
          appsFlyerEvents.push(input.eventName);
          return Promise.resolve(true);
        }) as never,
      },
    );
    assertEquals(supabase.disputes.size, 1);
    assertEquals(alerts.length, 0);
    assertEquals(appsFlyerEvents, ["dispute_created"]);
    assert(
      warnings.some((warning) =>
        warning.includes(
          "STRIPE_DISPUTE_ALERT_EMAILS missing; dispute persisted without operator notification",
        )
      ),
      "missing alert email env warning should be emitted",
    );
  } finally {
    console.warn = originalWarn;
    if (prior === undefined) Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
    else Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", prior);
  }
});

Deno.test("ORCH-0956 T-06 — missing dispute amount degrades without throwing", async () => {
  const prior = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
  Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", "ops@example.com");
  const supabase = new FakeSupabase();
  const alerts: {
    subject: string;
    paragraphs: string[];
    recipients: string[];
  }[] = [];
  try {
    await handleChargeDispute(
      supabase as never,
      event("charge.dispute.created", "needs_response", { amount: undefined }),
      {
        sendOpsAlertEmail: ((input: {
          subject: string;
          paragraphs: string[];
          recipients: string[];
        }) => {
          alerts.push(input);
          return Promise.resolve({
            attempted: input.recipients.length,
            succeeded: input.recipients.length,
            failed: 0,
          });
        }) as never,
        resolveBrandOwnerUserId: (() => Promise.resolve("owner-user")) as never,
        postAppsFlyerS2SEvent: (() => Promise.resolve(true)) as never,
      },
    );
    assertEquals(supabase.disputes.size, 1);
    assertEquals(alerts.length, 1);
    assert(
      alerts[0].subject.includes("USD 0.00") ||
        alerts[0].subject.includes("USD NaN.00"),
      "malformed amount should degrade to an explicit currency amount",
    );
    assert(
      alerts[0].paragraphs.some((paragraph) =>
        paragraph === "Amount: USD 0.00" || paragraph === "Amount: USD NaN.00"
      ),
      "body should include the degraded amount",
    );
  } finally {
    if (prior === undefined) Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
    else Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", prior);
  }
});
