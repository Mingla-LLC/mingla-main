import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPayoutRecipientAccountBody,
  buildPayoutRecipientAccountLinkBody,
} from "../../_shared/stripeBlueprintClient.ts";
import {
  handler,
  PAYEE_NATIVE_RETURN_URL,
  type PayeeStripeDeps,
} from "../index.ts";

const USER_ID = "38720000-0000-4000-9900-000000000001";

function request(body: Record<string, unknown>): Request {
  return new Request("https://edge.test/payee-account-stripe-link", {
    method: "POST",
    headers: {
      authorization: "Bearer valid",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function deps(overrides: Partial<PayeeStripeDeps> = {}): PayeeStripeDeps {
  return {
    businessOrigin: "https://host.usemingla.com",
    resolveUser: async () => ({
      id: USER_ID,
      email: "payee@example.test",
      emailVerified: true,
    }),
    loadProfile: async () => ({
      data: { display_name: "R2 Payee" },
      error: null,
    }),
    loadAccount: async () => ({ data: null, error: null }),
    upsertAccount: async () => ({ error: null }),
    createAccount: async () => ({ id: "acct_payee_r2" }),
    createLink: async () => ({ url: "https://connect.stripe.test/r2" }),
    idempotencyKey: (_user, operation) => `idem:${operation}`,
    audit: async () => {},
    ...overrides,
  };
}

Deno.test("#3872 payout account is recipient-only Accounts v2", () => {
  assertEquals(PAYEE_NATIVE_RETURN_URL, "mingla://payout-account/return");
  const body = buildPayoutRecipientAccountBody({
    displayName: "R2 Payee",
    contactEmail: "payee@example.test",
    country: "US",
  });
  assertEquals(body.configuration, {
    recipient: {
      capabilities: {
        stripe_balance: { stripe_transfers: { requested: true } },
      },
    },
  });
  assert(!JSON.stringify(body).includes("card_payments"));
  assert(!JSON.stringify(body).includes('"merchant"'));
  assertEquals(body.defaults, {
    responsibilities: {
      losses_collector: "stripe",
      fees_collector: "application",
    },
  });

  const link = buildPayoutRecipientAccountLinkBody({
    accountId: "acct_payee_r2",
    refreshUrl: PAYEE_NATIVE_RETURN_URL,
    returnUrl: PAYEE_NATIVE_RETURN_URL,
  });
  assertEquals(
    (link.use_case as Record<string, unknown>).account_onboarding,
    {
      configurations: ["recipient"],
      refresh_url: PAYEE_NATIVE_RETURN_URL,
      return_url: PAYEE_NATIVE_RETURN_URL,
    },
  );
});

Deno.test("#3872 Stripe payee link rejects open redirects before provider calls", async () => {
  let providerCalls = 0;
  const response = await handler(
    request({
      country: "US",
      return_url: "https://attacker.example/collect",
    }),
    deps({
      createAccount: async () => {
        providerCalls++;
        return { id: "never" };
      },
      createLink: async () => {
        providerCalls++;
        return { url: "never" };
      },
    }),
  );
  assertEquals(response.status, 400);
  assertEquals((await response.json()).detail, "return_url_not_allowed");
  assertEquals(providerCalls, 0);
});

Deno.test("#3872 Stripe payee link requires a verified email", async () => {
  let providerCalls = 0;
  const response = await handler(
    request({ country: "US", return_url: PAYEE_NATIVE_RETURN_URL }),
    deps({
      resolveUser: async () => ({
        id: USER_ID,
        email: "payee@example.test",
        emailVerified: false,
      }),
      createAccount: async () => {
        providerCalls++;
        return { id: "never" };
      },
    }),
  );
  assertEquals(response.status, 422);
  assertEquals((await response.json()).error, "verified_email_required");
  assertEquals(providerCalls, 0);
});

Deno.test("#3872 Stripe payee link creates, mirrors and returns recipient onboarding", async () => {
  const createInputs: Array<Record<string, unknown>> = [];
  const linkInputs: Array<Record<string, unknown>> = [];
  const mirroredRows: Array<Record<string, unknown>> = [];
  const response = await handler(
    request({
      country: "us",
      return_url: PAYEE_NATIVE_RETURN_URL,
    }),
    deps({
      createAccount: async (input) => {
        createInputs.push(input as unknown as Record<string, unknown>);
        return { id: "acct_payee_r2" };
      },
      createLink: async (input) => {
        linkInputs.push(input as unknown as Record<string, unknown>);
        return { url: "https://connect.stripe.test/r2" };
      },
      upsertAccount: async (row) => {
        mirroredRows.push(row);
        return { error: null };
      },
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    account_id: "acct_payee_r2",
    onboarding_url: "https://connect.stripe.test/r2",
  });
  assertEquals(createInputs[0]?.country, "US");
  assertEquals(createInputs[0]?.contactEmail, "payee@example.test");
  assertEquals(linkInputs[0]?.accountId, "acct_payee_r2");
  assertEquals(linkInputs[0]?.returnUrl, PAYEE_NATIVE_RETURN_URL);
  assertEquals(mirroredRows[0]?.stripe_status, "onboarding");
  assertEquals(mirroredRows[0]?.stripe_country, "US");
  assert(!Object.hasOwn(mirroredRows[0] ?? {}, "paystack_country"));
});

Deno.test("#3872 Stripe payee link reuses an existing account", async () => {
  let creates = 0;
  const response = await handler(
    request({
      country: "US",
      return_url: "https://host.usemingla.com/connect-payee-onboarding",
    }),
    deps({
      loadAccount: async () => ({
        data: {
          user_id: USER_ID,
          stripe_account_id: "acct_existing",
          stripe_status: "pending",
          stripe_country: "US",
        },
        error: null,
      }),
      createAccount: async () => {
        creates++;
        return { id: "never" };
      },
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(creates, 0);
  assertEquals((await response.json()).account_id, "acct_existing");
});

Deno.test("#3872 Stripe payee link cannot relabel an existing account country", async () => {
  let providerCalls = 0;
  const response = await handler(
    request({ country: "GB", return_url: PAYEE_NATIVE_RETURN_URL }),
    deps({
      loadAccount: async () => ({
        data: {
          user_id: USER_ID,
          stripe_account_id: "acct_us",
          stripe_status: "active",
          stripe_country: "US",
        },
        error: null,
      }),
      createLink: async () => {
        providerCalls++;
        return { url: "never" };
      },
    }),
  );
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "payout_country_mismatch");
  assertEquals(providerCalls, 0);
});
