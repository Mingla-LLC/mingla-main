// #4402 — gig-hire: the server builds the Host return page, a paid hold is
// recorded instead of retried, confirm_reference is host-only, and reconcile
// is machine-only and records stranded payments.
//
// MINGLA-INVARIANT: I-4402-B | issue #4402 | a gig payment return URL is built by the server from the business web origin; client return_url is ignored
// MINGLA-INVARIANT: I-4402-C | issue #4402 | no code path retires a pending gig hold to failed without a provider check proving it unpaid
//
// fails-on-revert: restoring `callbackUrl: body.return_url` sends the
// client's URL to Paystack (the return-URL test fails); deleting the start
// probe lets a retry reach gig_offer_prepare (which retires the paid hold) and
// the already_paid test sees a second Paystack initialize.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createGigHireHandler, type GigHireDeps } from "./handler.ts";
import type { PaystackProbeOutcome } from "../_shared/gigPaymentCapture.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const BRAND = "33333333-3333-4333-8333-333333333333";
const INTEREST = "44444444-4444-4444-8444-444444444444";
const GIG = "55555555-5555-4555-8555-555555555555";
const CREATOR = "66666666-6666-4666-8666-666666666666";
const CONTRACT = "6de5eb40-8f30-444e-83b8-d80fa32b3798";
const REF = "ghold_6de5eb408f30444e83b8d80fa32b3798_v1";

type Row = Record<string, unknown>;

function fakeDb(
  tables: Record<string, Row[]>,
  rpcs: Record<
    string,
    (
      args: Row,
    ) => { data?: unknown; error?: { message: string; code?: string } | null }
  >,
  calls: string[],
) {
  const query = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const rows = () =>
      (tables[table] ?? []).filter((row) =>
        filters.every(([k, v]) => row[k] === v)
      );
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (
        column: string,
        value: unknown,
      ) => (filters.push([column, value]), builder),
      maybeSingle: () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null }),
      insert: (row: Row) => {
        calls.push(`insert:${table}:${String(row.action ?? "")}`);
        return Promise.resolve({ error: null });
      },
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: rows(), error: null }),
    };
    return builder;
  };
  return {
    from: query,
    rpc: (name: string, args: Row) => {
      calls.push(`rpc:${name}`);
      const handler = rpcs[name];
      if (!handler) {
        return Promise.resolve({
          data: null,
          error: { message: `unexpected rpc ${name}` },
        });
      }
      const out = handler(args);
      return Promise.resolve({
        data: out.data ?? null,
        error: out.error ?? null,
      });
    },
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  };
}

interface World {
  user: string;
  tables: Record<string, Row[]>;
  verify: (reference: string) => Promise<PaystackProbeOutcome>;
  calls: string[];
  inits: Row[];
  prepares: number;
}

function world(over: Partial<World> = {}): World {
  return {
    user: HOST,
    tables: {
      gig_interest: [{
        id: INTEREST,
        gig_id: GIG,
        creator_account_id: CREATOR,
      }],
      gig_contracts: [{
        id: CONTRACT,
        brand_id: BRAND,
        gig_id: GIG,
        creator_account_id: CREATOR,
        state: "offered",
        current_terms_version: 1,
      }],
      gig_holds: [{
        contract_id: CONTRACT,
        terms_version: 1,
        rail: "paystack",
        status: "pending",
        provider_ref: null,
        amount_minor: 11500,
        currency: "NGN",
      }],
      gig_hold_adjustments: [],
    },
    verify: () => Promise.resolve({ state: "not_found" }),
    calls: [],
    inits: [],
    prepares: 0,
    ...over,
  };
}

function deps(w: World, cron = false): GigHireDeps {
  const rpcs = {
    issue_3872_gig_host_writer: (args: Row) => ({
      data: args.p_actor === HOST,
    }),
    gig_hold_set_provider_ref: () => ({ data: { ok: true } }),
    gig_hold_mark_captured: () => ({
      data: { replayed: false, late_capture: false },
    }),
    gig_payment_reconcile_candidates: () => ({
      data: {
        candidates: [
          {
            reason: "pending",
            kind: "gig_hold",
            contract_id: CONTRACT,
            terms_version: 1,
            rail: "paystack",
            reference: REF,
          },
        ],
      },
    }),
  };
  const service = fakeDb(w.tables, rpcs, w.calls);
  return {
    webOrigin: "https://host.usemingla.com",
    serviceClient: () => service as never,
    userClient: () => {
      const user = fakeDb(w.tables, {
        gig_offer_prepare: () => {
          w.prepares += 1;
          return {
            data: {
              ok: true,
              contract_id: "77777777-7777-4777-8777-777777777777",
              terms_version: 1,
              rail: "paystack",
              fee_minor: 10000,
              booking_fee_minor: 1500,
              total_minor: 11500,
              currency: "NGN",
              brand_id: BRAND,
            },
          };
        },
      }, w.calls);
      return {
        ...user,
        auth: {
          getUser: () =>
            Promise.resolve({
              data: { user: { id: w.user, email: "host@example.com" } },
            }),
        },
      } as never;
    },
    paystackInitialize: (input) => {
      w.inits.push({ ...input });
      return Promise.resolve({
        authorization_url: "https://checkout.paystack.com/x",
        reference: String(input.reference),
      });
    },
    paystackVerifyOutcome: (reference) => w.verify(reference),
    stripe: () => {
      throw new Error("stripe unused");
    },
    isCronCaller: () => Promise.resolve(cron),
    notifyMismatch: () => Promise.resolve(1),
    requestLateRefund: () => Promise.resolve({ ok: true }),
  };
}

const post = (body: Row) =>
  new Request("https://example.test/functions/v1/gig-hire", {
    method: "POST",
    headers: {
      authorization: "Bearer user-jwt",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
const paidTxn = {
  status: "success",
  amount: 11500,
  currency: "NGN",
  metadata: {
    mingla_kind: "gig_hold",
    contract_id: CONTRACT,
    terms_version: 1,
  },
};

Deno.test("#4402 the Paystack return URL is built by the server; client return_url is ignored", async () => {
  const w = world();
  const response = await createGigHireHandler(deps(w))(post({
    action: "start",
    interest_id: INTEREST,
    fee_minor: 10000,
    idempotency_key: "key-12345678",
    return_url: "https://evil.example/steal",
  }));
  assertEquals(response.status, 200);
  assertEquals(w.inits.length, 1);
  assertEquals(
    w.inits[0].callbackUrl,
    `https://host.usemingla.com/brand/${BRAND}/creators/contract/77777777-7777-4777-8777-777777777777?gig_pay=hold`,
  );
  // The reference is persisted before the provider call.
  const store = w.calls.indexOf("rpc:gig_hold_set_provider_ref");
  assertEquals(store >= 0, true);
});

Deno.test("#4402 a retry on a paid hold records it and never charges again", async () => {
  const w = world({
    verify: () => Promise.resolve({ state: "success", txn: paidTxn }),
  });
  const response = await createGigHireHandler(deps(w))(post({
    action: "start",
    interest_id: INTEREST,
    fee_minor: 10000,
    idempotency_key: "key-retry-0001",
  }));
  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    ok: false,
    error: "already_paid",
    contract_id: CONTRACT,
  });
  assertEquals(
    w.prepares,
    0,
    "gig_offer_prepare (which retires the hold) must not run",
  );
  assertEquals(w.inits.length, 0);
  assertEquals(w.calls.includes("rpc:gig_hold_mark_captured"), true);
});

Deno.test("#4402 a retry while the provider is unsure never retires the hold", async () => {
  const pending = world({
    verify: () =>
      Promise.resolve({ state: "pending", txn: { status: "ongoing" } }),
  });
  const response = await createGigHireHandler(deps(pending))(post({
    action: "start",
    interest_id: INTEREST,
    fee_minor: 10000,
    idempotency_key: "key-retry-0002",
  }));
  assertEquals((await response.json()).error, "payment_pending");
  assertEquals(pending.prepares, 0);
  const down = world({
    verify: () => Promise.reject(new Error("paystack down")),
  });
  const failed = await createGigHireHandler(deps(down))(post({
    action: "start",
    interest_id: INTEREST,
    fee_minor: 10000,
    idempotency_key: "key-retry-0003",
  }));
  assertEquals(failed.status, 503);
  assertEquals(down.prepares, 0);
});

Deno.test("#4402 a retry on a proven-unpaid hold goes ahead", async () => {
  const w = world({ verify: () => Promise.resolve({ state: "not_found" }) });
  const response = await createGigHireHandler(deps(w))(post({
    action: "start",
    interest_id: INTEREST,
    fee_minor: 10000,
    idempotency_key: "key-retry-0004",
  }));
  assertEquals(response.status, 200);
  assertEquals(w.prepares, 1);
});

Deno.test("#4402 confirm_reference records the payment for the host only", async () => {
  const w = world({
    verify: () => Promise.resolve({ state: "success", txn: paidTxn }),
  });
  const ok = await createGigHireHandler(deps(w))(
    post({ action: "confirm_reference", reference: REF }),
  );
  assertEquals(await ok.json(), {
    ok: true,
    status: "captured",
    payment_check: "paid",
    contract_id: CONTRACT,
    brand_id: BRAND,
  });
  const stranger = world({
    user: STRANGER,
    verify: () => Promise.resolve({ state: "success", txn: paidTxn }),
  });
  const denied = await createGigHireHandler(deps(stranger))(
    post({ action: "confirm_reference", reference: REF }),
  );
  assertEquals(denied.status, 403);
  assertEquals(stranger.calls.includes("rpc:gig_hold_mark_captured"), false);
});

Deno.test("#4402 confirm_reference answers pending and not-paid without recording", async () => {
  const pending = world({
    verify: () =>
      Promise.resolve({ state: "pending", txn: { status: "ongoing" } }),
  });
  const a = await createGigHireHandler(deps(pending))(
    post({ action: "confirm_reference", contract_id: CONTRACT }),
  );
  assertEquals((await a.json()).payment_check, "pending");
  const unpaid = world({
    verify: () =>
      Promise.resolve({ state: "failed", txn: { status: "abandoned" } }),
  });
  const b = await createGigHireHandler(deps(unpaid))(
    post({ action: "confirm_reference", contract_id: CONTRACT }),
  );
  assertEquals(await b.json(), {
    ok: false,
    error: "payment_failed",
    payment_check: "not_paid",
    contract_id: CONTRACT,
    brand_id: BRAND,
  });
  assertEquals(unpaid.calls.includes("rpc:gig_hold_mark_captured"), false);
});

Deno.test("#4402 reconcile needs the machine credential and records stranded payments", async () => {
  const w = world({
    verify: () => Promise.resolve({ state: "success", txn: paidTxn }),
  });
  const refused = await createGigHireHandler(deps(w, false))(
    post({ action: "reconcile" }),
  );
  assertEquals(refused.status, 401);
  assertEquals(w.calls.includes("rpc:gig_payment_reconcile_candidates"), false);
  const answer = await createGigHireHandler(deps(w, true))(
    post({ action: "reconcile" }),
  );
  const summary = await answer.json();
  assertEquals(summary.checked, 1);
  assertEquals(summary.captured, 1);
  assertEquals(w.calls.includes("insert:audit_log:gig.payment_captured"), true);
});
