// Issue #4238 W4b §10 — ad credit receipts and statements (no VAT line until
// decided), and the NGN withdrawal settle path with Paystack mocked.
//
// @invariant I-4238-STATEMENT-FROM-LEDGER
//   owner: supabase/functions/_shared/adCreditStatements.ts
//   rule: a statement's closing balance is the ledger's last balance_after
//         (it equals the wallet); receipts show no VAT until VAT_ON_AD_FEE
//         is decided.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAdCreditReceipt,
  buildAdCreditStatement,
  type LedgerRow,
  statementMonthBounds,
  VAT_ON_AD_FEE,
} from "../adCreditStatements.ts";
import { applyAdCreditWithdrawFromPaystackRefund } from "../adCreditWebhook.ts";
import { allocateWithdrawFromLots } from "../adMoney.ts";

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  id: crypto.randomUUID(),
  entry_kind: "top_up",
  amount_cents: 0,
  balance_after_cents: 0,
  currency: "NGN",
  created_at: "2026-11-05T10:00:00.000Z",
  ...over,
});

Deno.test("receipt: you paid, Mingla fee (15%), ad credit, currency; no VAT line", () => {
  const receipt = buildAdCreditReceipt(row({
    amount_cents: 2_125_000,
    fee_cents: 375_000,
    pay_cents: 2_500_000,
    balance_after_cents: 2_125_000,
    external_ref: "PSK_ref_1",
  }));
  assertEquals(receipt.you_paid_cents, 2_500_000);
  assertEquals(receipt.mingla_fee_cents, 375_000);
  assertEquals(receipt.mingla_fee_rate, 0.15);
  assertEquals(receipt.ad_credit_cents, 2_125_000);
  assertEquals(receipt.reference, "PSK_ref_1");
  assertEquals(receipt.vat, "not_shown_pending_decision");
  assertEquals(VAT_ON_AD_FEE, null);
  assert(!("vat_cents" in receipt));
});

Deno.test("statement: opening, top-ups, spend per ad, returns, withdrawals; closing equals the wallet", () => {
  const before = row({
    balance_after_cents: 100_000,
    created_at: "2026-10-30T00:00:00.000Z",
  });
  const rows = [
    row({
      entry_kind: "top_up",
      amount_cents: 2_125_000,
      fee_cents: 375_000,
      pay_cents: 2_500_000,
      balance_after_cents: 2_225_000,
      created_at: "2026-11-01T09:00:00.000Z",
    }),
    row({
      entry_kind: "campaign_spend",
      amount_cents: -1_000_000,
      balance_after_cents: 1_225_000,
      metadata: { plan_id: "plan-a" },
      created_at: "2026-11-02T09:00:00.000Z",
    }),
    row({
      entry_kind: "unspend_return",
      amount_cents: 250_000,
      balance_after_cents: 1_475_000,
      metadata: { plan_id: "plan-a" },
      created_at: "2026-11-20T09:00:00.000Z",
    }),
    row({
      entry_kind: "withdraw",
      amount_cents: -475_000,
      refund_cents: 558_823,
      balance_after_cents: 1_000_000,
      created_at: "2026-11-25T09:00:00.000Z",
    }),
  ];
  const wallet = { balance_cents: 1_000_000 };
  const statement = buildAdCreditStatement({
    month: "2026-11",
    before,
    rows: [...rows].reverse(),
  });
  assertEquals(statement.opening_balance_cents, 100_000);
  assertEquals(statement.top_ups_cents, 2_125_000);
  assertEquals(statement.fees_cents, 375_000);
  assertEquals(statement.spend_by_ad, [{
    ad_key: "plan-a",
    ad_name: null,
    held_cents: 1_000_000,
    returned_cents: 250_000,
    net_cents: 750_000,
  }]);
  assertEquals(statement.returns_cents, 250_000);
  assertEquals(statement.withdrawals_cents, 475_000);
  assertEquals(statement.closing_balance_cents, wallet.balance_cents);
  assertEquals(statement.lines.map((line) => line.kind), [
    "top_up",
    "campaign_spend",
    "unspend_return",
    "withdraw",
  ]);
  // An empty month carries the opening balance.
  assertEquals(
    buildAdCreditStatement({ month: "2026-12", before: rows[3], rows: [] })
      .closing_balance_cents,
    1_000_000,
  );
  assertEquals(statementMonthBounds("2026-11"), [
    "2026-11-01T00:00:00.000Z",
    "2026-12-01T00:00:00.000Z",
  ]);
  assertEquals(statementMonthBounds("2026-13"), null);
});

Deno.test("ad-credit serves receipts to the people who can fund, before the write actions", async () => {
  const src = await Deno.readTextFile(
    new URL("../../ad-credit/index.ts", import.meta.url),
  );
  const at = src.indexOf(
    'if (action === "get_receipt" || action === "get_statement")',
  );
  assert(at > 0);
  assert(
    src.slice(at, at + 400).includes('"biz_can_manage_payments_for_brand"'),
  );
  assert(
    src.includes('.eq("brand_id", brandId)'),
    "a receipt never reads another brand's ledger",
  );
});

// ── NGN withdrawal (Paystack mocked) ─────────────────────────────────────
function refundsDb(
  rows: {
    id: string;
    provider_refund_id: string | null;
    idempotency_key: string;
  }[],
) {
  const marks: { id: string; status: string }[] = [];
  const db = {
    from: () => {
      const filters: Record<string, unknown> = {};
      let like = "";
      const builder = {
        select: () => builder,
        eq: (col: string, value: unknown) => {
          filters[col] = value;
          return builder;
        },
        like: (_col: string, pattern: string) => {
          like = pattern.replace(/%$/, "");
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => {
          const found = rows.find((r) =>
            (filters.provider_refund_id === undefined ||
              r.provider_refund_id === filters.provider_refund_id) &&
            (!like || r.idempotency_key.startsWith(like))
          );
          return Promise.resolve({
            data: found ? { id: found.id } : null,
            error: null,
          });
        },
      };
      return builder;
    },
    rpc: (_name: string, args: { p_id: string; p_status: string }) => {
      marks.push({ id: args.p_id, status: args.p_status });
      return Promise.resolve({ error: null });
    },
  };
  return { db, marks };
}

Deno.test("Paystack withdraw: processed, pending then settled, failed, replayed", async () => {
  const { db, marks } = refundsDb([{
    id: "r1",
    provider_refund_id: "777",
    idempotency_key: "ad_credit_wd:abc:lot1",
  }]);
  // deno-lint-ignore no-explicit-any
  const client = db as any;
  assertEquals(
    await applyAdCreditWithdrawFromPaystackRefund(client, "refund.pending", {
      id: 777,
      merchant_note: "ad_credit_wd:abc",
    }),
    true,
  );
  assertEquals(
    await applyAdCreditWithdrawFromPaystackRefund(client, "refund.processed", {
      id: 777,
      merchant_note: "ad_credit_wd:abc",
    }),
    true,
  );
  assertEquals(
    await applyAdCreditWithdrawFromPaystackRefund(client, "refund.processed", {
      id: 777,
      merchant_note: "ad_credit_wd:abc",
    }),
    true,
  );
  assertEquals(
    await applyAdCreditWithdrawFromPaystackRefund(client, "refund.failed", {
      id: 777,
      merchant_note: "ad_credit_wd:abc",
    }),
    true,
  );
  assertEquals(marks.map((mark) => mark.status), [
    "pending",
    "succeeded",
    "succeeded",
    "failed",
  ]);
  assert(marks.every((mark) => mark.id === "r1"));
  // A truncated merchant note still finds the row by prefix; no provider id yet.
  assertEquals(
    await applyAdCreditWithdrawFromPaystackRefund(client, "refund.processed", {
      merchant_note: "ad_credit_wd:abc",
    }),
    true,
  );
  // Not an ad-credit refund → ignored; an unknown one → loud.
  assertEquals(
    await applyAdCreditWithdrawFromPaystackRefund(client, "refund.processed", {
      id: 1,
      merchant_note: "ticket:1",
    }),
    false,
  );
  const empty = refundsDb([]);
  // deno-lint-ignore no-explicit-any
  const emptyClient = empty.db as any;
  await assertRejects(
    () =>
      applyAdCreditWithdrawFromPaystackRefund(
        emptyClient,
        "refund.processed",
        { id: 9, merchant_note: "ad_credit_wd:zzz" },
      ),
    Error,
    "ad_credit_wd_paystack_row_missing",
  );
});

Deno.test("partial withdrawal across two lots is FIFO", () => {
  const result = allocateWithdrawFromLots([
    {
      id: "lot1",
      credit_remaining_cents: 2_125_000,
      pay_remaining_cents: 2_500_000,
      fee_remaining_cents: 375_000,
    },
    {
      id: "lot2",
      credit_remaining_cents: 2_125_000,
      pay_remaining_cents: 2_500_000,
      fee_remaining_cents: 375_000,
    },
  ], 3_000_000);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.allocations.map((a) => a.lot_id), ["lot1", "lot2"]);
    assertEquals(result.allocations[0].credit_cents, 2_125_000);
    assertEquals(result.allocations[1].credit_cents, 875_000);
  }
});
