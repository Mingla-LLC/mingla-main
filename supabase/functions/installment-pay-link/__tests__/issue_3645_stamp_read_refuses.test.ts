// Issue #3645 — an instalment pay link whose brand payout-hold stamp cannot be
// read refuses with the shared retryable 503 payout_settings_unavailable before
// an attempt is begun or Paystack is initialized. The old code ignored the read error and decided the split
// from whatever came back.
// Fails on revert: without the error check the handler begins an attempt and
// initializes Paystack.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handleInstallmentPayLink } from "../index.ts";

type RowMap = Record<string, unknown>;

function fakeSupabase(brandRead: "error" | "unstamped") {
  const rpcs: string[] = [];
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
    maybeSingle(): Promise<{ data: unknown; error: unknown }> {
      if (this.table === "brands" && brandRead === "error") {
        return Promise.resolve({ data: null, error: { message: "statement timeout" } });
      }
      const rows: RowMap = {
        order_installments: {
          id: "inst-9",
          order_id: "order-9",
          ordinal: 1,
          buyer_total_cents: 100000,
          amount_cents: 90000,
          application_fee_amount_cents: 4500,
          currency: "NGN",
          orders: { buyer_email: "buyer@example.test", events: { brand_id: "brand-9" } },
        },
        brands: { paystack_subaccount_code: "ACCT_x", payout_hold_cutover_at: null },
      };
      return Promise.resolve({ data: rows[this.table] ?? null, error: null });
    }
  }
  const client = {
    rpc(name: string) {
      rpcs.push(name);
      if (name === "issue_3645_resolve_pay_link") {
        return Promise.resolve({
          data: { state: "payable", installment_id: "inst-9", purpose: "pay" },
          error: null,
        });
      }
      if (name === "issue_3645_begin_installment_attempt") {
        return Promise.resolve({
          data: { ok: true, attempt_id: "att-9", amount_cents: 100000, reference: "mingla-inst-9" },
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
  return { client: client as never, rpcs };
}

function startRequest(token: string): Request {
  return new Request("https://edge.test/installment-pay-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, action: "start" }),
  });
}

Deno.test("#3645 pay link: a stamp read error refuses before any attempt or Paystack call", async () => {
  const fake = fakeSupabase("error");
  const initialized: RowMap[] = [];
  const response = await handleInstallmentPayLink(startRequest("S".repeat(43)), {
    supabase: fake.client,
    initialize: (input) => {
      initialized.push(input as unknown as RowMap);
      return Promise.resolve({ authorization_url: "https://checkout.paystack.com/x", reference: "r", access_code: "a" });
    },
  });
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: "payout_settings_unavailable" });
  assertEquals(fake.rpcs.includes("issue_3645_begin_installment_attempt"), false);
  assertEquals(initialized, []);
});

Deno.test("#3645 pay link: a readable unstamped brand still starts with its subaccount split", async () => {
  const fake = fakeSupabase("unstamped");
  const initialized: RowMap[] = [];
  await handleInstallmentPayLink(startRequest("T".repeat(43)), {
    supabase: fake.client,
    initialize: (input) => {
      initialized.push(input as unknown as RowMap);
      return Promise.resolve({ authorization_url: "https://checkout.paystack.com/x", reference: "r", access_code: "a" });
    },
  });
  assertEquals(fake.rpcs.includes("issue_3645_begin_installment_attempt"), true);
  assertEquals(initialized.length, 1);
  assertEquals(initialized[0].subaccount, "ACCT_x");
});
