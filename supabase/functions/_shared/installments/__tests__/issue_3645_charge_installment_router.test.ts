// Issue #3645 — chargeInstallment routes by the instalment's own provider and
// collection method (I-3645-PS-4), never by brands.payment_provider.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { chargeInstallment } from "../chargeInstallment.ts";
import { fakeSupabase, ok, type TableOp } from "./issue_3645_fake_supabase.ts";

const INST = "33333333-3333-4333-8333-333333333333";

function setup(row: Record<string, unknown>, opts: { checkpoint?: Record<string, unknown>; liveLinks?: number } = {}) {
  const calls: string[] = [];
  const emails: string[] = [];
  const fake = fakeSupabase({
    rpc: (name) => {
      if (name === "issue_3645_checkpoint_pay_link_installment") return ok(opts.checkpoint ?? { ok: false, reason: "checkpoint_not_reached" });
      if (name === "issue_3645_issue_pay_link") return ok({ ok: true, link_id: "l1" });
      return ok({ ok: true });
    },
    table: (op: TableOp) => {
      if (op.table === "order_installment_pay_links") return { data: null, error: null, count: opts.liveLinks ?? 0 };
      if (op.table === "order_installments" && (op.columns ?? "").includes("collection_method")) {
        return ok({ id: INST, status: "scheduled", due_at: "2027-03-01T12:00:00Z", next_retry_at: null,
          orders: { event_id: "ev", events: { brand_id: "brand-1" } }, ...row });
      }
      if (op.table === "order_installments") {
        return ok({ id: INST, order_id: "o1", ordinal: 1, buyer_total_cents: 270625, currency: "NGN",
          due_at: "2027-03-01T12:00:00Z", planned_application_fee_cents: 0, referral_share_minor: 0,
          orders: { id: "o1", buyer_user_id: null, event_id: "ev", events: { id: "ev", brand_id: "brand-1", title: "Trip",
            brands: { id: "brand-1", name: "B", paystack_subaccount_code: null, payout_hold_cutover_at: null } } } });
      }
      return ok(null);
    },
  });
  const deps = {
    createInstallmentPI: (input: Record<string, unknown>) => {
      calls.push(`stripe:${input.brandId}`);
      return Promise.resolve({ ok: true, outcome: "collected" as const, chargeId: "pi_1" });
    },
    chargePaystackInstallment: () => {
      calls.push("paystack_auto");
      return Promise.resolve({ outcome: "collected" as const });
    },
    dispatchBuyerEmail: (kind: string) => {
      emails.push(kind);
      return Promise.resolve(true);
    },
    sendBuyerPush: () => Promise.resolve(true),
    notifyHost: () => Promise.resolve(),
    now: () => new Date("2027-03-01T13:00:00Z"),
  };
  const run = (trigger: "cron" | "manual" | "retry" = "cron") =>
    chargeInstallment({ supabase: fake.client as never, installmentId: INST, trigger, deps: deps as never });
  return { fake, calls, emails, run };
}

Deno.test("#3645 router: stripe → createInstallmentPI (only Stripe instalment PI creator)", async () => {
  const t = setup({ provider: "stripe", collection_method: "auto_card" });
  const r = await t.run();
  assertEquals(r.outcome, "collected");
  assertEquals(t.calls, ["stripe:brand-1"]);
});

Deno.test("#3645 router: paystack auto_card → chargePaystackInstallment", async () => {
  const t = setup({ provider: "paystack", collection_method: "auto_card" });
  await t.run();
  assertEquals(t.calls, ["paystack_auto"]);
});

Deno.test("#3645 router: paystack pay_link before its checkpoint sends the link once (the notice)", async () => {
  const t = setup({ provider: "paystack", collection_method: "pay_link" });
  assertEquals((await t.run()).outcome, "pay_link_sent");
  assertEquals(t.emails, ["installment_pay_link"]);
  const live = setup({ provider: "paystack", collection_method: "pay_link" }, { liveLinks: 1 });
  assertEquals((await live.run()).reason, "link_live");
  assertEquals(live.emails, []);
});

Deno.test("#3645 router: paystack pay_link at a checkpoint counts the failure and dunns with a link", async () => {
  const t = setup({ provider: "paystack", collection_method: "pay_link" },
    { checkpoint: { ok: true, outcome: "failed", retry_count: 1, next_retry_at: "2027-03-04T12:00:00Z" } });
  const r = await t.run();
  assertEquals(r.outcome, "pay_link_sent");
  assert(t.emails.includes("installment_dunning"));
  const atRisk = setup({ provider: "paystack", collection_method: "pay_link" },
    { checkpoint: { ok: true, outcome: "at_risk", retry_count: 3, next_retry_at: null } });
  assertEquals((await atRisk.run()).outcome, "at_risk_flagged");
});

Deno.test("#3645 router: in-flight pay link attempt is left alone", async () => {
  const t = setup({ provider: "paystack", collection_method: "pay_link" }, { checkpoint: { ok: false, reason: "attempt_in_flight" } });
  assertEquals(await t.run(), { outcome: "skipped", reason: "attempt_in_flight" });
});

Deno.test("#3645 I-3645-PS-4: routing never reads brands.payment_provider", async () => {
  const t = setup({ provider: "paystack", collection_method: "auto_card" });
  await t.run();
  assert(!t.fake.tableOps.some((op) => op.table === "brands" || (op.columns ?? "").includes("payment_provider")));
  const src = await Deno.readTextFile(new URL("../chargeInstallment.ts", import.meta.url));
  assert(!src.replace(/\/\*[\s\S]*?\*\//g, "").includes("payment_provider"));
});
