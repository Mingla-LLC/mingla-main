// Issue #3645 — automatic Paystack instalment charges (injected Paystack, DB,
// email, push and host notifications). SC-9..SC-14.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { chargePaystackInstallment } from "../chargePaystackInstallment.ts";
import type {
  PaystackChargeAuthorizationParams,
  PaystackChargeAuthorizationResponse,
} from "../../paystack.ts";
import { fakeSupabase, ok, type TableOp } from "./issue_3645_fake_supabase.ts";

const INST = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const REF = `mingla-inst-${INST}-a1`;

function contextRow(over: Record<string, unknown> = {}) {
  return {
    id: INST,
    order_id: ORDER,
    ordinal: 1,
    currency: "NGN",
    buyer_total_cents: 270625,
    amount_cents: 250000,
    planned_application_fee_cents: 11250,
    referral_share_minor: 500,
    orders: {
      id: ORDER,
      event_id: "ev-1",
      buyer_user_id: "user-1",
      buyer_name: "Ada Stone",
      events: {
        id: "ev-1",
        title: "Five Slow Days",
        brand_id: "brand-1",
        brands: {
          id: "brand-1",
          name: "Lagos Trips",
          paystack_subaccount_code: "ACCT_sub",
          payout_hold_cutover_at: null,
        },
      },
    },
    ...over,
  };
}

interface Harness {
  charges: PaystackChargeAuthorizationParams[];
  emails: Array<{ kind: string; payload: Record<string, unknown> }>;
  pushes: Array<Record<string, unknown>>;
  hosts: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
  fake: ReturnType<typeof fakeSupabase>;
  run: (
    opts?: { atRiskOverride?: boolean },
  ) => ReturnType<typeof chargePaystackInstallment>;
}

function harness(opts: {
  begin?: Record<string, unknown>;
  auth?: Record<string, unknown> | null;
  response?: PaystackChargeAuthorizationResponse;
  resolve?: (
    outcome: string,
    args: Record<string, unknown>,
  ) => Record<string, unknown>;
  context?: Record<string, unknown>;
}): Harness {
  const h = {
    charges: [],
    emails: [],
    pushes: [],
    hosts: [],
    refunds: [],
  } as unknown as Harness;
  h.fake = fakeSupabase({
    rpc: (name, args) => {
      switch (name) {
        case "issue_3645_begin_installment_attempt":
          return ok(
            opts.begin ?? {
              ok: true,
              attempt_id: "att-1",
              reference: REF,
              amount_cents: 270625,
              application_fee_cents: Number(args.p_application_fee_cents),
              attempt_no: 1,
            },
          );
        case "issue_3645_installment_authorization_for_charge":
          return ok(
            opts.auth === null ? [] : [
              opts.auth ?? {
                authorization_code: "AUTH_saved",
                authorization_email: "saved@example.test",
              },
            ],
          );
        case "issue_3645_resolve_installment_attempt":
          return ok(
            opts.resolve
              ? opts.resolve(String(args.p_outcome), args)
              : { ok: true, outcome: "collected", remaining: 1 },
          );
        case "issue_3645_issue_pay_link":
          return ok({
            ok: true,
            link_id: "link-1",
            expires_at: "2027-04-01T00:00:00Z",
          });
        default:
          return ok({ ok: true });
      }
    },
    table: (op: TableOp) => {
      if (op.table === "order_installments" && op.kind === "select") {
        if ((op.columns ?? "").includes("planned_application_fee_cents")) {
          return ok(opts.context ?? contextRow());
        }
        return ok({
          id: INST,
          order_id: ORDER,
          ordinal: 1,
          buyer_total_cents: 270625,
          amount_cents: 250000,
          currency: "NGN",
          due_at: "2027-03-01T12:00:00Z",
          orders: {
            id: ORDER,
            buyer_user_id: "user-1",
            event_id: "ev-1",
            events: { brand_id: "brand-1", title: "Five Slow Days" },
          },
        });
      }
      if (op.table === "order_installment_charge_attempts") {
        return ok({
          id: "att-1",
          installment_id: INST,
          method: "auto_card",
          state: "refund_due",
          amount_cents: 270625,
          reference: REF,
          provider_transaction_id: "999",
        });
      }
      if (op.table === "refunds" && op.kind === "insert") {
        return ok({ id: "refund-1" });
      }
      if (op.table === "refunds") return ok(null);
      return ok(null);
    },
  });
  const deps = {
    chargeAuthorization: (p: PaystackChargeAuthorizationParams) => {
      h.charges.push(p);
      return Promise.resolve(
        opts.response ?? {
          kind: "response",
          httpStatus: 200,
          body: {
            status: true,
            data: {
              status: "success",
              id: 777,
              amount: 270625,
              fees: 4060,
              gateway_response: "Approved",
            },
          },
        },
      );
    },
    dispatchBuyerEmail: (kind: string, payload: Record<string, unknown>) => {
      h.emails.push({ kind, payload });
      return Promise.resolve(true);
    },
    sendBuyerPush: (p: Record<string, unknown>) => {
      h.pushes.push(p);
      return Promise.resolve(true);
    },
    notifyHost: (p: Record<string, unknown>) => {
      h.hosts.push(p);
      return Promise.resolve();
    },
    createPaystackRefund: (p: Record<string, unknown>) => {
      h.refunds.push(p);
      return Promise.resolve({
        id: "rf_1",
        amount: 270625,
        status: "pending",
        currency: "NGN",
        integration: null,
        transaction: "999",
        replayed: false,
      });
    },
    alertOps: () => Promise.resolve(),
    randomBytes: (n: number) => new Uint8Array(n).fill(7),
  };
  h.run = (o = {}) =>
    chargePaystackInstallment({
      supabase: h.fake.client as never,
      installmentId: INST,
      atRiskOverride: o.atRiskOverride,
      deps: deps as never,
    });
  return h;
}

const rpcNames = (h: Harness) => h.fake.rpcCalls.map((c) => c.name);

Deno.test("#3645 SC-9 success: one charge, stored email, locked amount, deterministic reference, deposit split, fee + referral share", async () => {
  const h = harness({});
  const r = await h.run();
  assertEquals(r.outcome, "collected");
  assertEquals(h.charges.length, 1);
  const c = h.charges[0];
  assertEquals(c.email, "saved@example.test");
  assertEquals(c.authorizationCode, "AUTH_saved");
  assertEquals(c.amountSubunits, 270625);
  assertEquals(c.reference, REF);
  assertEquals(c.subaccount, "ACCT_sub");
  assertEquals(c.transactionChargeSubunits, 11250 + 500);
  const begin = h.fake.rpcCalls.find((x) =>
    x.name === "issue_3645_begin_installment_attempt"
  )!;
  assertEquals(begin.args.p_application_fee_cents, 11750);
  const resolve = h.fake.rpcCalls.find((x) =>
    x.name === "issue_3645_resolve_installment_attempt"
  )!;
  assertEquals(resolve.args.p_outcome, "succeeded");
  assertEquals(resolve.args.p_verified_amount_cents, 270625);
  assertEquals(resolve.args.p_provider_fee_cents, 4060);
  assertEquals(resolve.args.p_provider_transaction_id, "777");
});

Deno.test("#3645 SC-9 email binding: the order's current buyer email is never used for the charge", async () => {
  const h = harness({
    auth: {
      authorization_code: "AUTH_saved",
      authorization_email: "original@example.test",
    },
  });
  await h.run();
  assertEquals(h.charges[0].email, "original@example.test");
  // The module never reads orders.buyer_email.
  assert(
    !h.fake.tableOps.some((op) => (op.columns ?? "").includes("buyer_email")),
  );
});

Deno.test("#3645 cut-over brand: no split fields (100% to Mingla)", async () => {
  const ctx = contextRow();
  (ctx.orders.events.brands as Record<string, unknown>).payout_hold_cutover_at =
    "2026-01-01T00:00:00Z";
  const h = harness({ context: ctx });
  await h.run();
  assertEquals(h.charges[0].subaccount, undefined);
  assertEquals(h.charges[0].transactionChargeSubunits, undefined);
});

Deno.test("#3645 SC-10 begin refused (attempt in flight / at risk / cancelled): no Paystack call", async () => {
  for (
    const reason of [
      "attempt_in_flight",
      "order_at_risk",
      "installment_cancelled",
      "plan_not_bound",
    ]
  ) {
    const h = harness({ begin: { ok: false, reason } });
    const r = await h.run();
    assertEquals(r, { outcome: "skipped", reason });
    assertEquals(h.charges.length, 0);
  }
});

Deno.test("#3645 SC-10 two concurrent runs charge once (begin serialises)", async () => {
  let open = false;
  const charges: unknown[] = [];
  const mk = () => harness({});
  const a = mk();
  const b = mk();
  // Shared begin semantics: the second begin sees the first attempt in flight.
  for (const h of [a, b]) {
    const orig = (h.fake.client as {
      rpc: (n: string, x: Record<string, unknown>) => Promise<unknown>;
    }).rpc;
    (h.fake.client as { rpc: unknown }).rpc = (
      n: string,
      x: Record<string, unknown>,
    ) => {
      if (n === "issue_3645_begin_installment_attempt") {
        if (open) {
          return Promise.resolve(
            ok({ ok: false, reason: "attempt_in_flight" }),
          );
        }
        open = true;
      }
      return orig(n, x);
    };
  }
  const [ra, rb] = await Promise.all([a.run(), b.run()]);
  charges.push(...a.charges, ...b.charges);
  assertEquals(charges.length, 1);
  assertEquals([ra.outcome, rb.outcome].sort(), ["collected", "skipped"]);
});

Deno.test("#3645 SC-11 decline: failed, dunning with a pay link, buyer push, host notified; third failure = at risk", async () => {
  const h = harness({
    response: {
      kind: "response",
      httpStatus: 200,
      body: {
        status: true,
        data: { status: "failed", gateway_response: "Declined" },
      },
    },
    resolve: (o) =>
      o === "failed"
        ? {
          ok: true,
          outcome: "failed",
          retry_count: 1,
          next_retry_at: "2027-03-04T12:00:00Z",
        }
        : { ok: true },
  });
  const r = await h.run();
  assertEquals(r.outcome, "failed");
  const dunning = h.emails.find((e) => e.kind === "installment_dunning")!;
  assert(String(dunning.payload.actionUrl).includes("/pay/"));
  assertEquals(h.hosts[0].type, "business.installment_failed");
  assert(h.pushes.some((p) => p.type === "installment_payment_failed"));
  assert(!rpcNames(h).includes("issue_3645_downgrade_to_pay_link"));

  const h3 = harness({
    response: {
      kind: "response",
      httpStatus: 200,
      body: {
        status: true,
        data: { status: "failed", gateway_response: "Declined" },
      },
    },
    resolve: (o) =>
      o === "failed"
        ? { ok: true, outcome: "at_risk", retry_count: 3, next_retry_at: null }
        : { ok: true },
  });
  const r3 = await h3.run();
  assertEquals(r3.outcome, "at_risk_flagged");
  assertEquals(h3.hosts[0].type, "business.installment_at_risk");
  assert(String(h3.hosts[0].body).includes("Ada's booking"));
});

Deno.test("#3645 SC-12 paused: approval required, approve link sent by email and push", async () => {
  const h = harness({
    response: {
      kind: "response",
      httpStatus: 200,
      body: {
        status: true,
        data: {
          paused: true,
          status: "pending",
          authorization_url: "https://checkout.paystack.com/ok",
        },
      },
    },
    resolve: (o) =>
      o === "paused"
        ? { ok: true, outcome: "approval_required", retry_count: 1 }
        : { ok: true },
  });
  const r = await h.run();
  assertEquals(r.outcome, "approval_required");
  const resolve = h.fake.rpcCalls.find((x) =>
    x.name === "issue_3645_resolve_installment_attempt"
  )!;
  assertEquals(resolve.args.p_approval_url, "https://checkout.paystack.com/ok");
  const link = h.fake.rpcCalls.find((x) =>
    x.name === "issue_3645_issue_pay_link"
  )!;
  assertEquals(link.args.p_purpose, "approve");
  assertEquals(
    h.emails.find((e) => e.kind === "installment_pay_link")!.payload.purpose,
    "approve",
  );
  assert(h.pushes.some((p) => p.type === "installment_approval_required"));
});

Deno.test("#3645 adversarial: third paused charge notifies the host that the booking is at risk", async () => {
  const h = harness({
    response: {
      kind: "response",
      httpStatus: 200,
      body: {
        status: true,
        data: {
          paused: true,
          status: "pending",
          authorization_url: "https://checkout.paystack.com/third",
        },
      },
    },
    resolve: (o) =>
      o === "paused"
        ? { ok: true, outcome: "at_risk", retry_count: 3, next_retry_at: null }
        : { ok: true },
  });
  const result = await h.run();
  assertEquals(result.outcome, "at_risk_flagged");
  assertEquals(h.hosts.length, 1);
  assertEquals(h.hosts[0].type, "business.installment_at_risk");
  assert(String(h.hosts[0].body).includes("Ada's booking for Five Slow Days"));
  assert(String(h.hosts[0].body).includes("after 3 missed payments"));
  assert(h.pushes.some((p) => p.type === "installment_approval_required"));
});

Deno.test("#3645 SC-13 timeout: attempt left unknown, nothing counted, no notifications", async () => {
  const h = harness({
    response: { kind: "network_error", message: "timeout" },
    resolve: () => ({ ok: true, outcome: "unknown" }),
  });
  const r = await h.run();
  assertEquals(r.outcome, "unknown");
  const resolve = h.fake.rpcCalls.find((x) =>
    x.name === "issue_3645_resolve_installment_attempt"
  )!;
  assertEquals(resolve.args.p_outcome, "unknown");
  assertEquals(h.emails.length + h.hosts.length + h.pushes.length, 0);
});

Deno.test("#3645 SC-14 unusable authorization: downgrade to pay links", async () => {
  const h = harness({
    response: {
      kind: "response",
      httpStatus: 400,
      body: { status: false, message: "Invalid authorization code" },
    },
    resolve: (o) =>
      o === "failed"
        ? {
          ok: true,
          outcome: "failed",
          retry_count: 1,
          next_retry_at: "2027-03-04T12:00:00Z",
        }
        : { ok: true },
  });
  await h.run();
  const down = h.fake.rpcCalls.find((x) =>
    x.name === "issue_3645_downgrade_to_pay_link"
  )!;
  assertEquals(down.args.p_reason, "authorization_unusable");
});

Deno.test("#3645 missing saved card: uncounted failure, downgrade, pay link sent, no charge", async () => {
  const h = harness({ auth: null });
  const r = await h.run();
  assertEquals(r.outcome, "pay_link_sent");
  assertEquals(h.charges.length, 0);
  const resolve = h.fake.rpcCalls.find((x) =>
    x.name === "issue_3645_resolve_installment_attempt"
  )!;
  assertEquals(resolve.args.p_count_failure, false);
  assert(rpcNames(h).includes("issue_3645_downgrade_to_pay_link"));
  assert(h.emails.some((e) => e.kind === "installment_pay_link"));
});

Deno.test("#3645 cancel won the race after a successful charge: refunded automatically", async () => {
  const h = harness({
    resolve: (o) =>
      o === "succeeded"
        ? { ok: true, outcome: "refund_due", reason: "event_cancelled" }
        : { ok: true },
  });
  const r = await h.run();
  assertEquals(r.outcome, "skipped");
  assertEquals(h.refunds.length, 1);
  assertEquals(h.refunds[0].merchantNote, "mingla_inst_dup:att-1");
  assert(rpcNames(h).includes("record_paystack_refund_outcome"));
});

Deno.test("#3645 I-3645-PS-2: saved card values never reach a log, an audit or a notification", async () => {
  const logs: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a: unknown[]) =>
    logs.push(JSON.stringify(a));
  try {
    const h = harness({
      response: {
        kind: "response",
        httpStatus: 200,
        body: {
          status: true,
          data: { status: "failed", gateway_response: "Declined" },
        },
      },
      resolve: () => ({
        ok: true,
        outcome: "failed",
        retry_count: 1,
        next_retry_at: null,
      }),
    });
    await h.run();
    const visible = JSON.stringify([
      logs,
      h.emails,
      h.hosts,
      h.pushes,
      h.fake.rpcCalls.filter((c) =>
        c.name !== "issue_3645_installment_authorization_for_charge"
      ),
    ]);
    assert(!visible.includes("AUTH_saved"));
    assert(!visible.includes("saved@example.test"));
  } finally {
    Object.assign(console, orig);
  }
});
