import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

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
  maybeSingle(): Promise<QueryResult> {
    if (this.table === "stripe_connect_accounts") {
      return Promise.resolve({
        data: { brand_id: this.db.brandId },
        error: null,
      });
    }
    if (this.table === "brands") {
      return Promise.resolve({ data: { name: "Acme Co" }, error: null });
    }
    if (this.table === "orders") {
      const byCharge = this.filters.stripe_charge_id === "ch_123";
      return Promise.resolve({
        data: byCharge ? { id: this.db.orderId } : null,
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }
  then(resolve: (value: QueryResult) => void): Promise<void> {
    if (this.table === "stripe_disputes" && this.payload) {
      this.db.disputes.set(
        String(this.payload.stripe_dispute_id),
        this.payload,
      );
      resolve({ data: this.payload, error: null });
      return Promise.resolve();
    }
    resolve({ data: null, error: null });
    return Promise.resolve();
  }
}

class FakeSupabase {
  brandId = "00000000-0000-4000-8000-000000000001";
  orderId = "00000000-0000-4000-8000-000000000002";
  disputes = new Map<string, Record<string, unknown>>();
  from(table: string): FakeQuery {
    return new FakeQuery(table, this);
  }
}

Deno.test("ORCH-0956 T-08 — sandbox sender rejection is caught by dispute alert envelope", async () => {
  const priorTesting = Deno.env.get("DENO_TESTING");
  const priorApiKey = Deno.env.get("RESEND_API_KEY");
  const priorEmails = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
  const priorSystemFrom = Deno.env.get("RESEND_SYSTEM_FROM");
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const errors: string[] = [];
  let fetchCalls = 0;
  Deno.env.set("DENO_TESTING", "1");
  Deno.env.set("RESEND_API_KEY", "re_test_key");
  Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", "ops@example.com");
  Deno.env.set("RESEND_SYSTEM_FROM", "Test <noreply@resend.dev>");
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response("{}", { status: 202 }));
  }) as typeof fetch;
  console.error = ((...args: unknown[]) => {
    errors.push(args.map((arg) => JSON.stringify(arg)).join(" "));
  }) as typeof console.error;
  try {
    const [{ sendOpsAlertEmail }, { handleChargeDispute }] = await Promise.all([
      import(`../stripeOpsAlertEmail.ts?t08=${Date.now()}`),
      import(`../stripeDisputeHandlers.ts?t08=${Date.now()}`),
    ]);
    await assertRejects(
      () =>
        sendOpsAlertEmail({
          subject: "Sandbox sender test",
          paragraphs: ["This should never send."],
          recipients: ["ops@example.com"],
          cta: null,
        }),
      Error,
      "email_sender_resend_sandbox_forbidden",
    );
    const supabase = new FakeSupabase();
    await handleChargeDispute(
      supabase as never,
      {
        id: "evt_t08",
        type: "charge.dispute.created",
        account: "acct_connected",
        data: {
          object: {
            id: "dp_t08",
            charge: "ch_123",
            payment_intent: "pi_123",
            amount: 5000,
            currency: "usd",
            status: "needs_response",
            reason: "fraudulent",
            evidence_details: { due_by: 1_800_000_000 },
            is_charge_refundable: false,
            livemode: true,
          },
        },
      },
      {
        sendOpsAlertEmail,
        resolveBrandOwnerUserId: (() => Promise.resolve("owner-user")) as never,
        postAppsFlyerS2SEvent: (() => Promise.resolve(true)) as never,
      },
    );
    assertEquals(supabase.disputes.size, 1);
    assertEquals(fetchCalls, 0);
    assertStringIncludes(
      errors.join("\n"),
      "email_sender_resend_sandbox_forbidden",
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    if (priorTesting === undefined) Deno.env.delete("DENO_TESTING");
    else Deno.env.set("DENO_TESTING", priorTesting);
    if (priorApiKey === undefined) Deno.env.delete("RESEND_API_KEY");
    else Deno.env.set("RESEND_API_KEY", priorApiKey);
    if (priorEmails === undefined) {
      Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
    } else Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", priorEmails);
    if (priorSystemFrom === undefined) Deno.env.delete("RESEND_SYSTEM_FROM");
    else Deno.env.set("RESEND_SYSTEM_FROM", priorSystemFrom);
  }
});
