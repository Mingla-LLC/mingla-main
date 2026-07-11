// ORCH-1331 [partner Paystack payout rail] — TESTER ADVERSARIAL suite #3:
// RAIL-EXCLUSIVITY RUNTIME (both directions) + ONBOARD HOSTILE INPUTS + PII
// CONSOLE-LEAK HUNT.
//
// Angle (different from the implementor's T-3, which proved the STRIPE
// direction only as a source-contract): this suite runs the REAL
// partner-stripe-onboard handler (serve-shim import map — the implementor's
// own flagged gap, IMPLEMENTATION §10 "SC-4 stripe-direction runtime
// ceiling") and proves at runtime:
//
//   EX-1  active Paystack recipient → partner-stripe-onboard answers
//         409 {error:"conflict", detail:"paystack_already_connected"} and
//         NEVER touches Stripe (zero api.stripe.com calls).
//   EX-2  DETACHED Paystack row → the guard does NOT overfire (the flow
//         proceeds past the exclusivity read; response is anything but the
//         409/paystack detail).
//   EX-3  exclusivity read 500s → fail-CLOSED (500 internal_error, no Stripe
//         account creation attempted).
//
//   HI-1  hostile account_number shapes on partner-paystack-onboard
//         (number-typed, unicode digits, 11 digits, letter-in-digits,
//         whitespace-padded) → 400 account_number_must_be_10_digits; zero
//         Paystack calls, zero writes.
//   HI-2  hostile bank_code shapes (number-typed, empty, missing) → 400
//         bank_code_required.
//
//   PII-1 full onboarding flow (happy + resolve-fail + create-fail +
//         prior-delete-fail) with console captured → the FULL NUBAN never
//         appears in ANY console line (the "log line" clause of
//         I-PROPOSED-1331-NUBAN-NEVER-PERSISTED, which the implementor's T-2
//         covered only for DB writes/audit payloads); last4 capture is
//         asserted present so the check is non-vacuous.
//
// NO live Paystack/Stripe calls — fetch stubbed / deps injected.
// Append-only: NEW file.
//
// Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   BUSINESS_WEB_ORIGIN=https://business.example-test.app \
//   deno test --import-map=supabase/functions/_shared/__tests__/_importmap.test.json \
//     --allow-read --allow-env --allow-net --no-check \
//     supabase/functions/_shared/__tests__/partnerRailExclusivity.tester.orch1331.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { getCapturedHandler, resetCapturedHandler } from "./_serveShim.ts";

const SUPA_URL = "https://example-test.supabase.co";
const USER_ID = "12121212-3434-5656-7878-909090909090";
const FULL_NUBAN = "0123456789";

Deno.env.set("SUPABASE_URL", SUPA_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key-not-real");
Deno.env.set("BUSINESS_WEB_ORIGIN", "https://business.example-test.app");

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------- mutable fetch scenario (stripe-onboard legs) ----------
interface StripeLegScenario {
  paystackRows: Array<Record<string, unknown>> | "force500";
  stripeScaRows: Array<Record<string, unknown>>;
  log: { urls: string[]; stripeApiHit: boolean };
}

let scenario: StripeLegScenario = {
  paystackRows: [],
  stripeScaRows: [],
  log: { urls: [], stripeApiHit: false },
};

function freshStripeScenario(
  overrides: Partial<StripeLegScenario> = {},
): StripeLegScenario {
  return {
    paystackRows: [],
    stripeScaRows: [],
    log: { urls: [], stripeApiHit: false },
    ...overrides,
  };
}

globalThis.fetch = (
  input: Request | URL | string,
  init?: RequestInit,
): Promise<Response> => {
  const url = typeof input === "string"
    ? input
    : (input instanceof URL ? input.href : input.url);
  const method = (init?.method ??
    (input instanceof Request ? input.method : "GET")).toUpperCase();
  scenario.log.urls.push(`${method} ${url}`);

  if (url.includes("api.stripe.com")) {
    scenario.log.stripeApiHit = true;
    return Promise.resolve(jsonOk({ error: { message: "stub" } }, 500));
  }
  if (url.startsWith(`${SUPA_URL}/auth/v1/user`)) {
    return Promise.resolve(jsonOk({
      id: USER_ID,
      aud: "authenticated",
      email: "partner@example-test.app",
      role: "authenticated",
    }));
  }
  if (url.startsWith(`${SUPA_URL}/rest/v1/creator_accounts`)) {
    return Promise.resolve(jsonOk([{
      id: USER_ID,
      partner_enabled: true,
      partner_country: null,
      display_name: "Test Partner",
    }]));
  }
  if (url.startsWith(`${SUPA_URL}/rest/v1/partner_paystack_accounts`)) {
    if (scenario.paystackRows === "force500") {
      return Promise.resolve(jsonOk({ message: "forced exclusivity 500" }, 500));
    }
    return Promise.resolve(jsonOk(scenario.paystackRows));
  }
  if (url.startsWith(`${SUPA_URL}/rest/v1/partner_stripe_connect_accounts`)) {
    return Promise.resolve(jsonOk(scenario.stripeScaRows));
  }
  return Promise.resolve(jsonOk({}));
};

resetCapturedHandler();
await import("../../partner-stripe-onboard/index.ts");
const stripeOnboardHandler = getCapturedHandler();

function stripePost(): Request {
  return new Request("https://edge.test/partner-stripe-onboard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer test-jwt",
    },
    body: JSON.stringify({
      country: "GB",
      return_url: "mingla-business://partner/earnings",
    }),
  });
}

const TEST_OPTS = { sanitizeOps: false, sanitizeResources: false };

Deno.test({
  name:
    "EX-1 · RUNTIME both-directions gap: active Paystack recipient → partner-stripe-onboard 409 paystack_already_connected; Stripe NEVER touched",
  ...TEST_OPTS,
  fn: async () => {
    assert(stripeOnboardHandler !== null, "partner-stripe-onboard handler captured");
    scenario = freshStripeScenario({
      paystackRows: [{ recipient_code: "RCP_active_1", detached_at: null }],
    });

    const res = await stripeOnboardHandler!(stripePost());
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.error, "conflict");
    assertEquals(body.detail, "paystack_already_connected");
    assertEquals(
      scenario.log.stripeApiHit,
      false,
      "no Stripe account/session call behind the 409",
    );
  },
});

Deno.test({
  name:
    "EX-2 · DETACHED Paystack row does NOT overfire the guard — flow proceeds past exclusivity",
  ...TEST_OPTS,
  fn: async () => {
    scenario = freshStripeScenario({
      paystackRows: [{
        recipient_code: "RCP_detached_1",
        detached_at: "2026-07-01T00:00:00.000Z",
      }],
      // Active existing Stripe row → reuse path (no v2 account create).
      stripeScaRows: [{
        id: "sca-row-1",
        stripe_account_id: "acct_test_1",
        detached_at: null,
      }],
    });

    const res = await stripeOnboardHandler!(stripePost());
    await res.text(); // drain
    assert(res.status !== 409, `guard must not fire on a detached row (got ${res.status})`);
    const sawScaRead = scenario.log.urls.some((u) =>
      u.includes("partner_stripe_connect_accounts")
    );
    assert(sawScaRead, "flow proceeded past the exclusivity read to the SCA read");
  },
});

Deno.test({
  name:
    "EX-3 · exclusivity read 500s → fail-CLOSED (500 internal_error), Stripe never touched",
  ...TEST_OPTS,
  fn: async () => {
    scenario = freshStripeScenario({ paystackRows: "force500" });

    const res = await stripeOnboardHandler!(stripePost());
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body.error, "internal_error");
    assertEquals(
      scenario.log.stripeApiHit,
      false,
      "a broken exclusivity read must never fall open into account creation",
    );
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Paystack-onboard hostile inputs + PII console hunt (exported handler + DI).
// ─────────────────────────────────────────────────────────────────────────────

import {
  handler as paystackOnboardHandler,
  type PartnerPaystackOnboardDeps,
} from "../../partner-paystack-onboard/index.ts";

interface OnboardWorld {
  writes: Array<{ table: string; op: string; values: Record<string, unknown> }>;
  paystackCalls: Array<{ kind: string; args: unknown }>;
  resolveThrows?: Error;
  createThrows?: Error;
  deleteThrows?: Error;
  priorPaystackRow?: Record<string, unknown> | null;
}

function onboardDeps(world: OnboardWorld): PartnerPaystackOnboardDeps {
  // deno-lint-ignore no-explicit-any
  const sb: any = {
    from: (table: string) => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle() {
        if (table === "creator_accounts") {
          return Promise.resolve({
            data: { id: USER_ID, partner_enabled: true },
            error: null,
          });
        }
        if (table === "partner_paystack_accounts") {
          return Promise.resolve({
            data: world.priorPaystackRow ?? null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update(values: Record<string, unknown>) {
        world.writes.push({ table, op: "update", values });
        const chain = {
          eq: () => chain,
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: null, error: null }),
        };
        return chain;
      },
      upsert(values: Record<string, unknown>) {
        world.writes.push({ table, op: "upsert", values });
        return Promise.resolve({ data: null, error: null });
      },
      insert(values: Record<string, unknown>) {
        world.writes.push({ table, op: "insert", values });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
  return {
    serviceClient: () => sb,
    resolveUserId: () => Promise.resolve(USER_ID),
    listBanks: () =>
      Promise.resolve([
        { name: "GTBank", code: "058", currency: "NGN", type: "nuban" },
      ]),
    resolveAccount: (params) => {
      world.paystackCalls.push({ kind: "resolveAccount", args: params });
      if (world.resolveThrows) return Promise.reject(world.resolveThrows);
      return Promise.resolve({
        account_number: FULL_NUBAN,
        account_name: "ADAOBI TEST OKAFOR",
      });
    },
    createRecipient: (params) => {
      world.paystackCalls.push({ kind: "createRecipient", args: params });
      if (world.createThrows) return Promise.reject(world.createThrows);
      return Promise.resolve({ recipient_code: "RCP_tester_1" });
    },
    deleteRecipient: (code) => {
      world.paystackCalls.push({ kind: "deleteRecipient", args: code });
      if (world.deleteThrows) return Promise.reject(world.deleteThrows);
      return Promise.resolve();
    },
  };
}

function onboardPost(body: Record<string, unknown>): Request {
  return new Request("https://edge.test/partner-paystack-onboard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer test-jwt",
    },
    body: JSON.stringify(body),
  });
}

Deno.test({
  name:
    "HI-1 · hostile account_number shapes → 400 must_be_10_digits; ZERO Paystack calls, ZERO writes",
  ...TEST_OPTS,
  fn: async () => {
  const hostile: unknown[] = [
    1234567890, // number-typed
    "١٢٣٤٥٦٧٨٩٠", // unicode-digit spoof
    "12345678901", // 11 digits
    "123456789O", // letter O
    " 0123456789", // whitespace-padded
    "01234-6789",
    "",
    null,
  ];
  for (const accountNumber of hostile) {
    for (const action of ["resolve_account", "create_recipient"]) {
      const world: OnboardWorld = { writes: [], paystackCalls: [] };
      const res = await paystackOnboardHandler(
        onboardPost({
          action,
          account_number: accountNumber,
          bank_code: "058",
        }),
        onboardDeps(world),
      );
      assertEquals(
        res.status,
        400,
        `${action} account_number=${JSON.stringify(accountNumber)}`,
      );
      const body = await res.json();
      assertEquals(body.detail, "account_number_must_be_10_digits");
      assertEquals(world.paystackCalls.length, 0, "no Paystack call on invalid input");
      assertEquals(world.writes.length, 0, "no write on invalid input");
    }
  }
  },
});

Deno.test({
  name:
    "HI-2 · hostile bank_code shapes → 400 bank_code_required; ZERO Paystack calls",
  ...TEST_OPTS,
  fn: async () => {
  const hostile: unknown[] = [58, "", null, undefined, { code: "058" }];
  for (const bankCode of hostile) {
    const world: OnboardWorld = { writes: [], paystackCalls: [] };
    const res = await paystackOnboardHandler(
      onboardPost({
        action: "create_recipient",
        account_number: FULL_NUBAN,
        bank_code: bankCode,
      }),
      onboardDeps(world),
    );
    assertEquals(res.status, 400, `bank_code=${JSON.stringify(bankCode)}`);
    assertEquals((await res.json()).detail, "bank_code_required");
    assertEquals(world.paystackCalls.length, 0);
    assertEquals(world.writes.length, 0);
  }
  },
});

Deno.test({
  name:
    "PII-1 · console-leak hunt: the FULL NUBAN never appears in any console line across happy + failure flows (last4 presence proves the capture)",
  ...TEST_OPTS,
  fn: async () => {
  const lines: string[] = [];
  const orig = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };
  const capture = (...args: unknown[]) => {
    lines.push(
      args.map((a) => {
        try {
          return typeof a === "string" ? a : JSON.stringify(a);
        } catch {
          return String(a);
        }
      }).join(" "),
    );
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  console.info = capture;

  try {
    // Happy create.
    {
      const world: OnboardWorld = { writes: [], paystackCalls: [] };
      const res = await paystackOnboardHandler(
        onboardPost({
          action: "create_recipient",
          account_number: FULL_NUBAN,
          bank_code: "058",
          bank_name: "GTBank",
        }),
        onboardDeps(world),
      );
      assertEquals(res.status, 200);
      await res.text();
      // Non-vacuous: last4 DID flow through the system.
      const upsert = world.writes.find((w) =>
        w.table === "partner_paystack_accounts" && w.op === "upsert"
      );
      assert(upsert !== undefined);
      assertEquals(upsert!.values.account_number_last4, "6789");
    }
    // Resolve failure (realistic Paystack message — no echo).
    {
      const world: OnboardWorld = {
        writes: [],
        paystackCalls: [],
        resolveThrows: new Error(
          "Paystack resolve-account failed (422): Could not resolve account name. Check parameters or try again.",
        ),
      };
      const res = await paystackOnboardHandler(
        onboardPost({
          action: "create_recipient",
          account_number: FULL_NUBAN,
          bank_code: "058",
        }),
        onboardDeps(world),
      );
      assertEquals(res.status, 422);
      await res.text();
    }
    // Recipient-create failure + prior-recipient delete failure (both logged
    // paths run).
    {
      const world: OnboardWorld = {
        writes: [],
        paystackCalls: [],
        priorPaystackRow: { recipient_code: "RCP_old_1", detached_at: null },
        deleteThrows: new Error(
          "Paystack delete-transfer-recipient failed (404): Recipient not found",
        ),
        createThrows: new Error(
          "Paystack create-transfer-recipient failed (503): server error",
        ),
      };
      // NOTE: prior stripeRow is null in onboardDeps, so no 409 here.
      const res = await paystackOnboardHandler(
        onboardPost({
          action: "create_recipient",
          account_number: FULL_NUBAN,
          bank_code: "058",
        }),
        onboardDeps(world),
      );
      assertEquals(res.status, 502);
      await res.text();
    }

    const leak = lines.find((l) => l.includes(FULL_NUBAN));
    assertEquals(
      leak,
      undefined,
      `I-PROPOSED-1331-NUBAN-NEVER-PERSISTED (log-line clause) violated: ${leak}`,
    );
    assert(lines.length > 0, "console capture saw at least one line (delete-failure log)");
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
    console.info = orig.info;
  }
  },
});
