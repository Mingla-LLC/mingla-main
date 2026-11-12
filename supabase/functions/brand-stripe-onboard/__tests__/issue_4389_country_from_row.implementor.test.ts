/**
 * #4389 — the Stripe account country comes from `brands.payout_country`,
 * the payments-setup window is stamped before any Stripe call, the account
 * create key is the same for two requests (two devices), and
 * `refresh_status` reads the account live for F4.
 *
 * MINGLA-INVARIANT: I-4389-COUNTRY-ONE-TRUTH | issue #4389 | brand-stripe-onboard opens the account in brands.payout_country; a different body country is a 409 country_mismatch with no Stripe call.
 *
 * Drives the REAL exported handler over a stubbed fetch (PostgREST, GoTrue
 * and api.stripe.com), like the #3258 suite.
 *
 * FAILS-ON-REVERT: reading `body.country` again (dropping
 * resolveOnboardCountry) fails test 1 (a GB account is created); restoring
 * `generateIdempotencyKey` for the create fails test 3 (keys differ).
 *
 * Run: deno test -A supabase/functions/brand-stripe-onboard/__tests__/issue_4389_country_from_row.implementor.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../../_shared/businessWebOrigin.ts";

const SUPABASE_URL = "https://proj-issue4389.supabase.co";
const BRAND_ID = "43890000-2222-4333-8444-555555555555";
const USER_ID = "43890000-8888-4777-8666-555555555555";

Deno.env.set("SUPABASE_URL", SUPABASE_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-issue4389");
Deno.env.set("BUSINESS_WEB_ORIGIN", PRODUCTION_BUSINESS_WEB_ORIGIN);
Deno.env.set("MINGLA_STRIPE_MODE", "test");
Deno.env.set("STRIPE_RAK_ONBOARD_TEST", "rk_test_issue4389");
Deno.env.set("STRIPE_RAK_REFRESH_STATUS_TEST", "rk_test_issue4389_refresh");

const { handler } = await import("../index.ts");

interface Call {
  url: string;
  method: string;
  body: string;
  idempotencyKey: string | null;
}

interface StubState {
  payoutCountry: string | null;
  sca: Record<string, unknown> | null;
  account: Record<string, unknown>;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function withStub(
  state: StubState,
  fn: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body, idempotencyKey: headers.get("Idempotency-Key") });

    if (url.startsWith("https://api.stripe.com/")) {
      if (url.endsWith("/v2/core/accounts")) return json({ id: "acct_issue4389" });
      if (url.endsWith("/v1/account_sessions")) return json({ client_secret: "acs_issue4389" });
      if (url.includes("/v1/accounts/acct_issue4389")) return json({ id: "acct_issue4389", ...state.account });
      return json({});
    }
    if (url.includes("/auth/v1/user")) {
      return json({ id: USER_ID, aud: "authenticated", email: "host@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00.000Z" });
    }
    if (url.includes("/rest/v1/rpc/biz_can_mutate_payouts_for_brand")) return json(true);
    if (url.includes("/rest/v1/rpc/issue_4389_begin_payments_setup_internal")) {
      return json({ payout_country: state.payoutCountry, provider: "stripe" });
    }
    if (url.includes("/rest/v1/brand_team_members")) {
      return json([{ mingla_tos_accepted_at: "2026-01-02T00:00:00.000Z", mingla_tos_version_accepted: "1.0" }]);
    }
    if (url.includes("/rest/v1/stripe_connect_accounts")) {
      if (method === "POST") return json({ id: "sca_issue4389", stripe_account_id: "acct_issue4389" });
      if (method === "PATCH") return json([], 200);
      return json(state.sca ? [state.sca] : []);
    }
    if (url.includes("/rest/v1/brands")) {
      if (method === "PATCH") return json([], 200);
      return json([{ name: "Night Owl", contact_email: "host@example.com", default_currency: "USD", slug: "night-owl", payout_country: state.payoutCountry }]);
    }
    return json([], 201);
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function request(body: Record<string, unknown>): Request {
  return new Request(`${SUPABASE_URL}/functions/v1/brand-stripe-onboard`, {
    method: "POST",
    headers: {
      Origin: PRODUCTION_BUSINESS_WEB_ORIGIN,
      Authorization: "Bearer issue4389-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ brand_id: BRAND_ID, return_url: "mingla-business://brand/x/setup", ...body }),
  });
}

function edgeTest(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });
}

edgeTest("#4389 1 — a body country that differs from payout_country is a 409 and nothing reaches Stripe", async () => {
  await withStub({ payoutCountry: "US", sca: null, account: {} }, async (calls) => {
    const res = await handler(request({ country: "GB" }));
    assertEquals(res.status, 409);
    const payload = await res.json();
    assertEquals(payload.error, "country_mismatch");
    assertEquals(payload.expected, "US");
    assert(!calls.some((c) => c.url.startsWith("https://api.stripe.com/")), "a Stripe call was made");
  });
});

edgeTest("#4389 2 — no body country: the stored country opens the account, after the setup window is stamped", async () => {
  await withStub({ payoutCountry: "US", sca: null, account: {} }, async (calls) => {
    const res = await handler(request({}));
    assertEquals(res.status, 200);
    const create = calls.find((c) => c.url.endsWith("/v2/core/accounts"));
    assert(create, "no account create");
    const body = JSON.parse(create.body) as { identity?: { country?: string } };
    assertEquals(body.identity?.country?.toUpperCase(), "US");
    const beginAt = calls.findIndex((c) => c.url.includes("issue_4389_begin_payments_setup_internal"));
    const stripeAt = calls.findIndex((c) => c.url.startsWith("https://api.stripe.com/"));
    assert(beginAt >= 0 && beginAt < stripeAt, "begin setup must run before any Stripe call");
  });
});

edgeTest("#4389 3 — two requests (two devices) send the SAME account-create idempotency key", async () => {
  const keys: string[] = [];
  for (let i = 0; i < 2; i++) {
    await withStub({ payoutCountry: "GB", sca: null, account: {} }, async (calls) => {
      const res = await handler(request({ country: "GB" }));
      assertEquals(res.status, 200);
      const create = calls.find((c) => c.url.endsWith("/v2/core/accounts"));
      keys.push(String(create?.idempotencyKey));
    });
  }
  assertEquals(keys[0], keys[1]);
  assert(keys[0].startsWith(BRAND_ID) && keys[0].includes(":GB:"), keys[0]);
});

edgeTest("#4389 4 — Nigeria (Paystack) never opens a Stripe account", async () => {
  await withStub({ payoutCountry: "NG", sca: null, account: {} }, async (calls) => {
    const res = await handler(request({}));
    assertEquals(res.status, 409);
    assert(!calls.some((c) => c.url.startsWith("https://api.stripe.com/")));
  });
});

edgeTest("#4389 5 — refresh_status reads live and maps due codes to host words", async () => {
  await withStub({
    payoutCountry: "US",
    sca: { id: "sca_issue4389", stripe_account_id: "acct_issue4389" },
    account: {
      details_submitted: true,
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { currently_due: ["individual.verification.document", "individual.dob.day"], past_due: [] },
    },
  }, async (calls) => {
    const res = await handler(request({ action: "refresh_status" }));
    assertEquals(res.status, 200);
    const payload = await res.json();
    assertEquals(payload.state, "action_needed");
    assertEquals(payload.due, ["A photo of your ID", "Your date of birth"]);
    assert(JSON.stringify(payload).toLowerCase().indexOf("stripe") === -1, "host copy names the partner");
    assert(calls.some((c) => c.method === "PATCH" && c.url.includes("stripe_connect_accounts")), "requirements not written back");
  });
  await withStub({ payoutCountry: "US", sca: null, account: {} }, async () => {
    const res = await handler(request({ action: "refresh_status" }));
    assertEquals((await res.json()).state, "not_started");
  });
});
