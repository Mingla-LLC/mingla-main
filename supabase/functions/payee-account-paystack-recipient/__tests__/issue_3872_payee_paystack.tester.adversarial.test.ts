import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler, type PayeePaystackDeps } from "../index.ts";

const USER_ID = "38720000-0000-4000-9900-000000000002";

function request(body: Record<string, unknown>): Request {
  return new Request("https://edge.test/payee-account-paystack-recipient", {
    method: "POST",
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function deps(overrides: Partial<PayeePaystackDeps> = {}): PayeePaystackDeps {
  return {
    resolveUserId: async () => USER_ID,
    loadAccount: async () => ({ data: null, error: null }),
    upsertAccount: async () => ({ error: null }),
    listBanks: async () => [],
    resolveAccount: async ({ accountNumber }) => ({
      account_name: "R2 Payee",
      account_number: accountNumber,
    }),
    createRecipient: async () => ({ recipient_code: "RCP_payee_r2" }),
    deleteRecipient: async () => {},
    isShared: async () => false,
    audit: async () => {},
    ...overrides,
  };
}

Deno.test("#3872 Paystack payee rejects non-NUBAN input before provider calls", async () => {
  let providerCalls = 0;
  const response = await handler(
    request({
      action: "create_recipient",
      account_number: "1234 567890",
      bank_code: "057",
    }),
    deps({
      resolveAccount: async () => {
        providerCalls++;
        throw new Error("must not run");
      },
      createRecipient: async () => {
        providerCalls++;
        return { recipient_code: "never" };
      },
    }),
  );
  assertEquals(response.status, 400);
  assertEquals(providerCalls, 0);
});

Deno.test("#3872 Paystack payee persists last4 only and leaves Stripe columns untouched", async () => {
  const mirroredRows: Array<Record<string, unknown>> = [];
  const providerInputs: Array<Record<string, unknown>> = [];
  const response = await handler(
    request({
      action: "create_recipient",
      account_number: "0123456789",
      bank_code: "057",
      bank_name: "Zenith Bank",
    }),
    deps({
      createRecipient: async (input) => {
        providerInputs.push(input as unknown as Record<string, unknown>);
        return { recipient_code: "RCP_payee_r2" };
      },
      upsertAccount: async (row) => {
        mirroredRows.push(row);
        return { error: null };
      },
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(providerInputs[0]?.accountNumber, "0123456789");
  assertEquals(mirroredRows[0]?.bank_account_last4, "6789");
  assertEquals(mirroredRows[0]?.paystack_status, "verified");
  assertEquals(mirroredRows[0]?.paystack_country, "NG");
  assertEquals(mirroredRows[0]?.paystack_currency, "NGN");
  assert(!Object.hasOwn(mirroredRows[0] ?? {}, "account_number"));
  assert(!Object.hasOwn(mirroredRows[0] ?? {}, "stripe_account_id"));
  assert(!Object.hasOwn(mirroredRows[0] ?? {}, "stripe_country"));
  assertEquals(await response.json(), {
    recipient_code: "RCP_payee_r2",
    account_name: "R2 Payee",
    account_number_masked: "••••6789",
    currency: "NGN",
  });
});

Deno.test("#3872 Paystack account resolution never returns the full NUBAN", async () => {
  const response = await handler(
    request({
      action: "resolve_account",
      account_number: "0123456789",
      bank_code: "057",
    }),
    deps(),
  );
  assertEquals(response.status, 200);
  const raw = await response.text();
  assert(!raw.includes("0123456789"));
  assertEquals(JSON.parse(raw), {
    account_name: "R2 Payee",
    account_number_masked: "••••6789",
  });
});

Deno.test("#3872 Paystack payee disconnect never deletes a shared recipient", async () => {
  let deleted = 0;
  const mirroredRows: Array<Record<string, unknown>> = [];
  const response = await handler(
    request({ action: "disconnect" }),
    deps({
      loadAccount: async () => ({
        data: {
          user_id: USER_ID,
          paystack_recipient_code: "RCP_shared",
          paystack_status: "verified",
          bank_name: "Bank",
          bank_account_last4: "6789",
          paystack_country: "NG",
          paystack_currency: "NGN",
        },
        error: null,
      }),
      isShared: async () => true,
      upsertAccount: async (row) => {
        mirroredRows.push(row);
        return { error: null };
      },
      deleteRecipient: async () => {
        deleted++;
      },
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(deleted, 0);
  assertEquals(mirroredRows[0]?.paystack_status, "none");
  assertEquals(mirroredRows[0]?.paystack_country, null);
  assert(!Object.hasOwn(mirroredRows[0] ?? {}, "stripe_account_id"));
});

Deno.test("#3872 Paystack payee disconnect fails closed when sharing is unknown", async () => {
  let deleted = 0;
  const response = await handler(
    request({ action: "disconnect" }),
    deps({
      loadAccount: async () => ({
        data: {
          user_id: USER_ID,
          paystack_recipient_code: "RCP_unknown",
          paystack_status: "verified",
          bank_name: "Bank",
          bank_account_last4: "6789",
          paystack_country: "NG",
          paystack_currency: "NGN",
        },
        error: null,
      }),
      isShared: async () => {
        throw new Error("database unavailable");
      },
      deleteRecipient: async () => {
        deleted++;
      },
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(deleted, 0);
});
