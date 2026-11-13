// #4402 OQ-5 / E21: after a Paystack payout account connects, the server
// checks the bank's account name against the creator's profile names and
// flags a mismatch for Admin review. The check never blocks the connect.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler, type PayeePaystackDeps } from "../index.ts";

const USER_ID = "44020500-0000-4000-9900-000000000002";

function request(): Request {
  return new Request("https://edge.test/payee-account-paystack-recipient", {
    method: "POST",
    headers: { authorization: "Bearer valid", "content-type": "application/json" },
    body: JSON.stringify({ action: "create_recipient", account_number: "0123456789", bank_code: "057", bank_name: "Zenith Bank" }),
  });
}

function deps(overrides: Partial<PayeePaystackDeps> = {}): PayeePaystackDeps {
  return {
    resolveUserId: async () => USER_ID,
    loadAccount: async () => ({ data: null, error: null }),
    upsertAccount: async () => ({ error: null }),
    listBanks: async () => [],
    resolveAccount: async ({ accountNumber }) => ({ account_name: "ADA OBI FILMS", account_number: accountNumber }),
    createRecipient: async () => ({ recipient_code: "RCP_i4402" }),
    deleteRecipient: async () => {},
    isShared: async () => false,
    audit: async () => {},
    ...overrides,
  };
}

Deno.test("#4402 E21 the resolved account name goes to the server name check", async () => {
  const calls: Array<[string, string]> = [];
  const response = await handler(request(), deps({
    flagNameReview: async (userId, name) => { calls.push([userId, name]); },
  }));
  assertEquals(response.status, 200);
  assertEquals(calls, [[USER_ID, "ADA OBI FILMS"]]);
});

Deno.test("#4402 E21 a failed name check never blocks connecting the account", async () => {
  const response = await handler(request(), deps({
    flagNameReview: async () => { throw new Error("rpc down"); },
  }));
  assertEquals(response.status, 200);
  assertEquals((await response.json()).recipient_code, "RCP_i4402");
});
