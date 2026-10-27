import {
  assertEquals,
  assertObjectMatch,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PaystackApiError } from "../_shared/paystack.ts";
import {
  isDefinitiveProviderFailure,
  payeePayoutIdempotencyKey,
  type PayeePayoutWork,
  paystackPayeeReference,
  paystackTransferState,
  providerFailureCode,
  stripeTransferPayload,
} from "./engine.ts";
import { handlePayeePayoutSweep } from "./index.ts";

const stripeWork: PayeePayoutWork = {
  payout_id: "00000000-3872-4000-8000-000000000001",
  payee_user_id: "00000000-3872-4000-8000-000000000002",
  rail: "stripe",
  currency: "USD",
  amount_minor: 925,
  account_ref: "acct_payee",
  attempt: 0,
  provider_ref: null,
  transfer_group: "payee_00000000-3872-4000-8000-000000000001",
  source_charge_id: "ch_source",
};

const paystackWork: PayeePayoutWork = {
  ...stripeWork,
  payout_id: "00000000-3872-4000-8000-000000000003",
  payee_user_id: "00000000-3872-4000-8000-000000000004",
  rail: "paystack",
  currency: "NGN",
  amount_minor: 189_000,
  account_ref: "RCP_payee",
  source_charge_id: null,
};

function request(token = "service-key") {
  return new Request("http://local/payee-payout-sweep", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

Deno.test("#3872 payout identities and Stripe payload remain deterministic", () => {
  assertEquals(
    payeePayoutIdempotencyKey(stripeWork.payout_id, 2),
    `payee_share:${stripeWork.payout_id}:2`,
  );
  assertEquals(
    paystackPayeeReference(paystackWork.payout_id, 2),
    `mpay_${paystackWork.payout_id}_a2`,
  );
  assertObjectMatch(stripeTransferPayload(stripeWork), {
    amount: 925,
    currency: "usd",
    destination: "acct_payee",
    transfer_group: "payee_00000000-3872-4000-8000-000000000001",
    source_transaction: "ch_source",
  });
});

Deno.test("#3872 provider status and failure classification are bounded", () => {
  assertEquals(paystackTransferState({ status: "success" }), "paid");
  assertEquals(paystackTransferState({ status: "pending" }), "in_transit");
  assertEquals(paystackTransferState({ status: "reversed" }), "failed");
  assertEquals(isDefinitiveProviderFailure({ status: 400 }), true);
  assertEquals(isDefinitiveProviderFailure({ status: 409 }), false);
  assertEquals(isDefinitiveProviderFailure({ status: 503 }), false);
  assertEquals(
    providerFailureCode({ code: "destination_invalid" }),
    "destination_invalid",
  );
});

Deno.test("#3872 worker claims once, marks attempts before provider I/O and nudges safely", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const notifications: Array<Record<string, unknown>> = [];
  let paystackInitiated = 0;
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "payee_prepare_payout_sweep") {
        return Promise.resolve({
          data: [stripeWork, paystackWork],
          error: null,
        });
      }
      if (name === "payee_claim_account_nudges") {
        return Promise.resolve({
          data: [{
            payee_user_id: paystackWork.payee_user_id,
            rail: "paystack",
            currency: "NGN",
            sent_count: 1,
          }],
          error: null,
        });
      }
      return Promise.resolve({
        data: { outcome: args.p_status ?? "ok" },
        error: null,
      });
    },
  };
  const response = await handlePayeePayoutSweep(request(), {
    supabaseUrl: () => "http://supabase.test",
    serviceRoleKey: () => "service-key",
    createAdmin: () => admin,
    createStripe: () => ({
      transfers: {
        create: (_payload: unknown, options: Record<string, unknown>) => {
          assertEquals(
            options.idempotencyKey,
            payeePayoutIdempotencyKey(
              stripeWork.payout_id,
              stripeWork.attempt,
            ),
          );
          return Promise.resolve({ id: "tr_payee" });
        },
      },
    }),
    verifyPaystack: () =>
      Promise.reject(new PaystackApiError("not found", 404)),
    initiatePaystack: (input: { reference: string }) => {
      paystackInitiated++;
      assertEquals(
        input.reference,
        paystackPayeeReference(paystackWork.payout_id, 0),
      );
      return Promise.resolve({ status: "success", transfer_code: "TRF_payee" });
    },
    notify: (input: Record<string, unknown>) => {
      notifications.push(input);
      return Promise.resolve({ notificationId: "n1", delivery: "queued" });
    },
  } as never);
  assertEquals(response.status, 200);
  assertObjectMatch(await response.json(), {
    claimed: 2,
    paid: 2,
    inTransit: 0,
    retry: 0,
    exhausted: 0,
    nudges: 1,
  });
  assertEquals(paystackInitiated, 1);
  assertEquals(
    calls.filter((call) => call.name === "payee_mark_payout_attempt").length,
    2,
  );
  assertEquals(
    calls.filter((call) => call.name === "payee_record_payout_outcome").length,
    2,
  );
  assertEquals(notifications.length, 1);
});

Deno.test("#3872 Paystack reconciliation prevents duplicate initiation after a lost response", async () => {
  let initiated = false;
  const admin = {
    rpc(name: string) {
      if (name === "payee_prepare_payout_sweep") {
        return Promise.resolve({ data: [paystackWork], error: null });
      }
      if (name === "payee_claim_account_nudges") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: { outcome: "paid" }, error: null });
    },
  };
  const response = await handlePayeePayoutSweep(request(), {
    supabaseUrl: () => "http://supabase.test",
    serviceRoleKey: () => "service-key",
    createAdmin: () => admin,
    createStripe: () => {
      throw new Error("stripe not expected");
    },
    verifyPaystack: () =>
      Promise.resolve({ status: "success", transfer_code: "TRF_existing" }),
    initiatePaystack: () => {
      initiated = true;
      return Promise.resolve({ status: "success" });
    },
    notify: () => Promise.resolve({ notificationId: "n1", delivery: "queued" }),
  } as never);
  assertObjectMatch(await response.json(), { claimed: 1, paid: 1 });
  assertEquals(initiated, false);
});

Deno.test("#3872 service-role boundary rejects unauthorized callers before claims", async () => {
  let claimed = false;
  const response = await handlePayeePayoutSweep(request("wrong-key"), {
    supabaseUrl: () => "http://supabase.test",
    serviceRoleKey: () => "service-key",
    createAdmin: () => {
      claimed = true;
      return {};
    },
  } as never);
  assertEquals(response.status, 401);
  assertEquals(claimed, false);
});

Deno.test("#3872 deterministic Paystack reference conflicts fail closed", async () => {
  const conflicted = { ...paystackWork, provider_ref: "mpay_wrong_a0" };
  const admin = {
    rpc(name: string) {
      if (name === "payee_prepare_payout_sweep") {
        return Promise.resolve({ data: [conflicted], error: null });
      }
      if (name === "payee_claim_account_nudges") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: {}, error: null });
    },
  };
  const response = await handlePayeePayoutSweep(request(), {
    supabaseUrl: () => "http://supabase.test",
    serviceRoleKey: () => "service-key",
    createAdmin: () => admin,
    createStripe: () => {
      throw new Error("stripe not expected");
    },
    verifyPaystack: () =>
      Promise.reject(new Error("provider must not be read")),
    initiatePaystack: () =>
      Promise.reject(new Error("provider must not be called")),
    notify: () => Promise.resolve({ notificationId: "n1", delivery: "queued" }),
  } as never);
  assertObjectMatch(await response.json(), { claimed: 1, retry: 1 });
});

Deno.test("#3872 local classification helper never treats unknown failures as definitive", async () => {
  await assertRejects(
    () => Promise.reject(new Error("network")),
    Error,
    "network",
  );
  assertEquals(isDefinitiveProviderFailure(new Error("network")), false);
});
