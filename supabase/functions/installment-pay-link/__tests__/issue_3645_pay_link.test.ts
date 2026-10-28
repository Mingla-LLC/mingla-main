import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handleInstallmentPayLink } from "../index.ts";

type RowMap = Record<string, unknown>;

function fakeSupabase(input: {
  links: RowMap[];
  rows?: Record<string, unknown>;
  begin?: RowMap;
}) {
  const calls: Array<{ name: string; args: RowMap }> = [];
  const links = [...input.links];
  class Query {
    constructor(private table: string) {}
    select() {
      return this;
    }
    eq() {
      return this;
    }
    in() {
      return this;
    }
    gt() {
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    maybeSingle() {
      return Promise.resolve({
        data: input.rows?.[this.table] ?? null,
        error: null,
      });
    }
  }
  const client = {
    rpc(name: string, args: RowMap) {
      calls.push({ name, args });
      if (name === "issue_3645_resolve_pay_link") {
        return Promise.resolve({
          data: links.shift() ?? { state: "invalid" },
          error: null,
        });
      }
      if (name === "issue_3645_begin_installment_attempt") {
        return Promise.resolve({
          data: input.begin ?? { ok: false, reason: "attempt_in_flight" },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    from(table: string) {
      return new Query(table);
    },
    schema() {
      return { from: (table: string) => new Query(table) };
    },
  };
  return { client: client as never, calls };
}

function request(token: string, action: string): Request {
  return new Request("https://edge.test/installment-pay-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, action }),
  });
}

Deno.test("#3645 pay-link invalid tokens and unknown tokens have bounded uniform responses", async () => {
  const malformed = fakeSupabase({ links: [] });
  const malformedResponse = await handleInstallmentPayLink(
    request("short", "view"),
    {
      supabase: malformed.client,
    },
  );
  assertEquals(malformedResponse.status, 400);
  assertEquals(await malformedResponse.json(), { error: "invalid_token" });

  const unknown = fakeSupabase({
    links: [{ state: "invalid", internal: "must-not-leak" }],
  });
  const response = await handleInstallmentPayLink(
    request("A".repeat(43), "view"),
    {
      supabase: unknown.client,
    },
  );
  assertEquals(response.status, 404);
  assertEquals(await response.json(), { state: "invalid" });
});

Deno.test("#3645 pay-link view returns only display-safe fields", async () => {
  const fake = fakeSupabase({
    links: [{
      state: "payable",
      installment_id: "secret-installment-id",
      purpose: "pay",
      trip_title: "Lagos Weekend",
      brand_name: "Mingla Trips",
      amount_cents: 125000,
      currency: "NGN",
      due_at: "2027-03-01T12:00:00Z",
      ordinal: 2,
      total_payments: 4,
      authorization_email: "secret@example.test",
      reference: "mingla-inst-secret",
    }],
  });
  const response = await handleInstallmentPayLink(
    request("B".repeat(43), "view"),
    {
      supabase: fake.client,
    },
  );
  const text = await response.text();
  assertEquals(response.status, 200);
  assertStringIncludes(text, '"tripTitle":"Lagos Weekend"');
  for (
    const secret of [
      "secret-installment-id",
      "secret@example.test",
      "mingla-inst-secret",
      "authorization_email",
      "reference",
    ]
  ) {
    if (text.includes(secret)) throw new Error(`response leaked ${secret}`);
  }
});

Deno.test("#3645 approve start reuses a fresh paused provider URL without minting an attempt", async () => {
  const fake = fakeSupabase({
    links: [{ state: "payable", installment_id: "inst-1", purpose: "approve" }],
    rows: {
      order_installment_charge_attempts: {
        approval_url: "https://checkout.paystack.com/fresh",
      },
    },
  });
  const response = await handleInstallmentPayLink(
    request("C".repeat(43), "start"),
    {
      supabase: fake.client,
      now: () => new Date("2027-03-01T12:00:00Z"),
    },
  );
  assertEquals(await response.json(), {
    kind: "redirect",
    url: "https://checkout.paystack.com/fresh",
  });
  assertEquals(
    fake.calls.some((call) =>
      call.name === "issue_3645_begin_installment_attempt"
    ),
    false,
  );
});

Deno.test("#3645 concurrent start maps the one-open-attempt refusal to 409", async () => {
  const fake = fakeSupabase({
    links: [{ state: "payable", installment_id: "inst-2", purpose: "pay" }],
    rows: {
      order_installments: {
        id: "inst-2",
        order_id: "order-2",
        ordinal: 1,
        buyer_total_cents: 100000,
        amount_cents: 90000,
        application_fee_amount_cents: 4500,
        currency: "NGN",
        orders: {
          buyer_email: "buyer@example.test",
          events: { brand_id: "brand-2" },
        },
      },
      brands: {
        paystack_subaccount_code: "ACCT_x",
        payout_hold_cutover_at: null,
      },
    },
  });
  const response = await handleInstallmentPayLink(
    request("D".repeat(43), "start"),
    {
      supabase: fake.client,
    },
  );
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { error: "payment_in_progress" });
});

Deno.test("#3645 status verifies an unresolved attempt and returns fresh paid state", async () => {
  const fake = fakeSupabase({
    links: [
      { state: "payable", installment_id: "inst-3", purpose: "pay" },
      {
        state: "paid",
        installment_id: "inst-3",
        purpose: "pay",
        amount_cents: 100000,
        currency: "NGN",
      },
    ],
    rows: {
      order_installment_charge_attempts: { reference: "mingla-inst-inst-3-l1" },
    },
  });
  let handled = 0;
  const response = await handleInstallmentPayLink(
    request("E".repeat(43), "status"),
    {
      supabase: fake.client,
      verify: async () => ({
        status: "success",
        amount: 100000,
        currency: "NGN",
      }),
      handleCharge: async () => {
        handled += 1;
        return { status: "installment_collected" };
      },
    },
  );
  assertEquals(handled, 1);
  assertEquals((await response.json()).state, "paid");
});
