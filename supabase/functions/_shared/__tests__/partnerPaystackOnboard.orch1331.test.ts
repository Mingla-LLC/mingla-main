// ORCH-1331 [partner Paystack payout rail] — T-1/T-2/T-3 edge-fn suite for
// partner-paystack-onboard (+ the partner-stripe-onboard exclusivity mirror,
// asserted structurally — that fn serves at module load without an exported
// handler, so its runtime leg is the tester's angle).
//
//   T-1 happy — NG onboarding end-to-end (mocked Paystack): resolve →
//     create_recipient → 200, row UPSERTed with last4 only,
//     creator_accounts.partner_country='NG'.
//   T-2 adversarial — PII leak hunt: the FULL NUBAN appears in NO service-
//     client write payload and NO audit `after` payload
//     (I-PROPOSED-1331-NUBAN-NEVER-PERSISTED).
//   T-3 error — exclusivity: an ACTIVE partner Stripe row → 409
//     {error:"conflict", detail:"stripe_already_connected"}; the stripe fn
//     carries the mirrored 409 paystack_already_connected guard (source
//     contract) positioned before account create/reuse.
//   Plus: partner gate (403 not_a_partner), NUBAN validation (400), resolve
//     failure (422, NO recipient created), status shape, disconnect soft-
//     detach idempotency.
//
// NO live Paystack calls — every Paystack surface is injected via
// PartnerPaystackOnboardDeps.
//
// Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   deno test --allow-env --allow-net --allow-read \
//     supabase/functions/_shared/__tests__/partnerPaystackOnboard.orch1331.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  handler,
  type PartnerPaystackOnboardDeps,
} from "../../partner-paystack-onboard/index.ts";

const USER_ID = "12121212-3434-5656-7878-909090909090";
const FULL_NUBAN = "0123456789";

// ---------- fake supabase ----------
interface FakeState {
  creatorAccount?: Record<string, unknown> | null;
  stripeRow?: Record<string, unknown> | null;
  paystackRow?: Record<string, unknown> | null;
}

function fakeSupabase(state: FakeState) {
  const writes: Array<{ table: string; op: string; values: Record<string, unknown> }> = [];

  function rowFor(table: string): Record<string, unknown> | null {
    if (table === "creator_accounts") return state.creatorAccount ?? null;
    if (table === "partner_stripe_connect_accounts") {
      return state.stripeRow ?? null;
    }
    if (table === "partner_paystack_accounts") return state.paystackRow ?? null;
    return null;
  }

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
        return Promise.resolve({ data: rowFor(table), error: null });
      },
      update(values: Record<string, unknown>) {
        writes.push({ table, op: "update", values });
        const chain = {
          eq: () => chain,
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: null, error: null }),
        };
        return chain;
      },
      upsert(values: Record<string, unknown>) {
        writes.push({ table, op: "upsert", values });
        return Promise.resolve({ data: null, error: null });
      },
      insert(values: Record<string, unknown>) {
        writes.push({ table, op: "insert", values });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
  return { sb, writes };
}

interface FakeDepsOpts {
  state?: FakeState;
  resolveFails?: boolean;
  userId?: string | null;
}

function makeDeps(opts: FakeDepsOpts = {}) {
  const state: FakeState = opts.state ?? {
    creatorAccount: { id: USER_ID, partner_enabled: true },
    stripeRow: null,
    paystackRow: null,
  };
  const { sb, writes } = fakeSupabase(state);
  const paystackCalls: Array<{ kind: string; args: unknown }> = [];
  const deps: PartnerPaystackOnboardDeps = {
    serviceClient: () => sb,
    resolveUserId: () => Promise.resolve(opts.userId ?? USER_ID),
    listBanks: (params) => {
      paystackCalls.push({ kind: "listBanks", args: params });
      return Promise.resolve([
        { name: "GTBank", code: "058", currency: "NGN", type: "nuban" },
        { name: "GTBank", code: "058", currency: "NGN", type: "nuban" },
        { name: "Access Bank", code: "044", currency: "NGN", type: "nuban" },
      ]);
    },
    resolveAccount: (params) => {
      paystackCalls.push({ kind: "resolveAccount", args: params });
      if (opts.resolveFails) {
        return Promise.reject(
          new Error("Paystack resolve-account failed (422): unresolved"),
        );
      }
      return Promise.resolve({
        account_number: FULL_NUBAN,
        account_name: "ADAOBI TEST OKAFOR",
      });
    },
    createRecipient: (params) => {
      paystackCalls.push({ kind: "createRecipient", args: params });
      return Promise.resolve({ recipient_code: "RCP_orch1331" });
    },
    deleteRecipient: (code) => {
      paystackCalls.push({ kind: "deleteRecipient", args: code });
      return Promise.resolve();
    },
  };
  return { deps, writes, paystackCalls };
}

function post(body: Record<string, unknown>, token = "test-jwt"): Request {
  return new Request("https://edge.test/partner-paystack-onboard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────── T-1 · happy ───────────────────────────────

Deno.test("T-1 · resolve_account returns the verified holder name", async () => {
  const { deps } = makeDeps();
  const res = await handler(
    post({
      action: "resolve_account",
      account_number: FULL_NUBAN,
      bank_code: "058",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.account_name, "ADAOBI TEST OKAFOR");
});

Deno.test("T-1 · create_recipient — 200, UPSERT with last4 only, partner_country=NG, audit written", async () => {
  const { deps, writes, paystackCalls } = makeDeps();
  const res = await handler(
    post({
      action: "create_recipient",
      account_number: FULL_NUBAN,
      bank_code: "058",
      bank_name: "GTBank",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.recipient_code, "RCP_orch1331");
  assertEquals(body.account_name, "ADAOBI TEST OKAFOR");
  assertEquals(body.account_number_masked, "••••6789");
  assertEquals(body.currency, "NGN");

  // recipient created with the RESOLVED name.
  const create = paystackCalls.find((c) => c.kind === "createRecipient");
  assertEquals(
    (create!.args as { name: string }).name,
    "ADAOBI TEST OKAFOR",
  );

  const upsert = writes.find((w) =>
    w.table === "partner_paystack_accounts" && w.op === "upsert"
  );
  assert(upsert, "partner_paystack_accounts upserted");
  assertEquals(upsert!.values.recipient_code, "RCP_orch1331");
  assertEquals(upsert!.values.account_number_last4, "6789");
  assertEquals(upsert!.values.detached_at, null);

  const caUpdate = writes.find((w) =>
    w.table === "creator_accounts" && w.op === "update"
  );
  assert(caUpdate, "creator_accounts updated");
  assertEquals(caUpdate!.values.partner_country, "NG");

  const audit = writes.find((w) =>
    w.table === "audit_log" &&
    (w.values.action === "partner_paystack.recipient_created")
  );
  assert(audit, "audit row written");
});

Deno.test("T-1 · list_banks slims to {name, code}", async () => {
  const { deps } = makeDeps();
  const res = await handler(post({ action: "list_banks" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(Array.isArray(body.banks));
  assertEquals(Object.keys(body.banks[0]).sort(), ["code", "name"]);
});

Deno.test("T-1 · status — connected shape after onboarding", async () => {
  const { deps } = makeDeps({
    state: {
      creatorAccount: { id: USER_ID, partner_enabled: true },
      paystackRow: {
        id: "row-1",
        recipient_code: "RCP_orch1331",
        bank_code: "058",
        bank_name: "GTBank",
        account_number_last4: "6789",
        account_name: "ADAOBI TEST OKAFOR",
        detached_at: null,
      },
    },
  });
  const res = await handler(post({ action: "status" }), deps);
  const body = await res.json();
  assertEquals(body.connected, true);
  assertEquals(body.account_number_masked, "••••6789");
  assertEquals(body.bank_name, "GTBank");
});

Deno.test("T-1 · status — detached row reads connected:false", async () => {
  const { deps } = makeDeps({
    state: {
      creatorAccount: { id: USER_ID, partner_enabled: true },
      paystackRow: {
        id: "row-1",
        recipient_code: "RCP_orch1331",
        bank_code: "058",
        bank_name: "GTBank",
        account_number_last4: "6789",
        account_name: "ADAOBI TEST OKAFOR",
        detached_at: "2026-07-01T00:00:00Z",
      },
    },
  });
  const res = await handler(post({ action: "status" }), deps);
  const body = await res.json();
  assertEquals(body.connected, false);
});

Deno.test("T-1 · disconnect — soft-detach + best-effort recipient delete + audit; absent row is a no-op success", async () => {
  const { deps, writes, paystackCalls } = makeDeps({
    state: {
      creatorAccount: { id: USER_ID, partner_enabled: true },
      paystackRow: {
        id: "row-1",
        recipient_code: "RCP_orch1331",
        detached_at: null,
      },
    },
  });
  const res = await handler(post({ action: "disconnect" }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).disconnected, true);
  const detach = writes.find((w) =>
    w.table === "partner_paystack_accounts" && w.op === "update" &&
    typeof w.values.detached_at === "string"
  );
  assert(detach, "detached_at stamped");
  assert(
    paystackCalls.some((c) => c.kind === "deleteRecipient"),
    "recipient delete attempted",
  );

  // Absent row → idempotent success.
  const { deps: deps2 } = makeDeps({
    state: {
      creatorAccount: { id: USER_ID, partner_enabled: true },
      paystackRow: null,
    },
  });
  const res2 = await handler(post({ action: "disconnect" }), deps2);
  assertEquals(res2.status, 200);
  assertEquals((await res2.json()).disconnected, true);
});

// ─────────────────────────── T-2 · PII leak hunt ───────────────────────────

Deno.test("T-2 · the FULL NUBAN never lands in any service-client write or audit payload", async () => {
  const { deps, writes } = makeDeps();
  await handler(
    post({
      action: "create_recipient",
      account_number: FULL_NUBAN,
      bank_code: "058",
      bank_name: "GTBank",
    }),
    deps,
  );
  assert(writes.length > 0, "writes captured");
  for (const w of writes) {
    const serialized = JSON.stringify(w.values);
    assert(
      !serialized.includes(FULL_NUBAN),
      `full NUBAN leaked into ${w.op} on ${w.table}: ${serialized}`,
    );
  }
});

Deno.test("T-2 · error responses never echo the full NUBAN", async () => {
  const { deps } = makeDeps({ resolveFails: true });
  const res = await handler(
    post({
      action: "create_recipient",
      account_number: FULL_NUBAN,
      bank_code: "058",
    }),
    deps,
  );
  assertEquals(res.status, 422);
  const text = await res.text();
  assert(!text.includes(FULL_NUBAN), "422 body must not echo the NUBAN");
});

// ─────────────────────────── T-3 · exclusivity ─────────────────────────────

Deno.test("T-3 · ACTIVE Stripe row → 409 stripe_already_connected; NO recipient created", async () => {
  const { deps, paystackCalls } = makeDeps({
    state: {
      creatorAccount: { id: USER_ID, partner_enabled: true },
      stripeRow: { stripe_account_id: "acct_123", detached_at: null },
      paystackRow: null,
    },
  });
  const res = await handler(
    post({
      action: "create_recipient",
      account_number: FULL_NUBAN,
      bank_code: "058",
    }),
    deps,
  );
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, "conflict");
  assertEquals(body.detail, "stripe_already_connected");
  assertEquals(
    paystackCalls.filter((c) => c.kind === "createRecipient").length,
    0,
  );
});

Deno.test("T-3 · DETACHED Stripe row does NOT block the Paystack rail", async () => {
  const { deps } = makeDeps({
    state: {
      creatorAccount: { id: USER_ID, partner_enabled: true },
      stripeRow: {
        stripe_account_id: "acct_123",
        detached_at: "2026-07-01T00:00:00Z",
      },
      paystackRow: null,
    },
  });
  const res = await handler(
    post({
      action: "create_recipient",
      account_number: FULL_NUBAN,
      bank_code: "058",
    }),
    deps,
  );
  assertEquals(res.status, 200);
});

Deno.test("T-3 · mirror guard — partner-stripe-onboard 409s on an active Paystack row (source contract)", async () => {
  const src = await Deno.readTextFile(
    new URL("../../partner-stripe-onboard/index.ts", import.meta.url),
  );
  assert(
    src.includes(`"partner_paystack_accounts"`),
    "stripe onboard reads partner_paystack_accounts",
  );
  assert(
    src.includes(`detail: "paystack_already_connected"`),
    "409 detail string bound",
  );
  // Guard is positioned AFTER the partner gate and BEFORE account create/reuse.
  const gateIdx = src.indexOf(`detail: "not_a_partner"`);
  const guardIdx = src.indexOf(`detail: "paystack_already_connected"`);
  const reuseIdx = src.indexOf("Existing partner row? If active, reuse");
  assert(gateIdx >= 0 && guardIdx >= 0 && reuseIdx >= 0, "landmarks present");
  assert(
    gateIdx < guardIdx && guardIdx < reuseIdx,
    "exclusivity guard sits between the partner gate and account reuse",
  );
});

// ───────────────────────── gates + validation ──────────────────────────────

Deno.test("gate · partner_enabled=false → 403 not_a_partner (Stripe-fn parity)", async () => {
  const { deps } = makeDeps({
    state: {
      creatorAccount: { id: USER_ID, partner_enabled: false },
    },
  });
  const res = await handler(post({ action: "list_banks" }), deps);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).detail, "not_a_partner");
});

Deno.test("gate · missing bearer → 401; unknown action → 400", async () => {
  const { deps } = makeDeps();
  const noAuth = new Request("https://edge.test/partner-paystack-onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status" }),
  });
  assertEquals((await handler(noAuth, deps)).status, 401);
  const bad = await handler(post({ action: "explode" }), deps);
  assertEquals(bad.status, 400);
  assertEquals((await bad.json()).detail, "unknown_action");
});

Deno.test("validation · 9-digit account number → 400 account_number_must_be_10_digits", async () => {
  const { deps } = makeDeps();
  const res = await handler(
    post({
      action: "resolve_account",
      account_number: "012345678",
      bank_code: "058",
    }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).detail, "account_number_must_be_10_digits");
});

Deno.test("validation · unresolvable account → 422 account_unresolved, NO recipient", async () => {
  const { deps, paystackCalls } = makeDeps({ resolveFails: true });
  const res = await handler(
    post({
      action: "resolve_account",
      account_number: FULL_NUBAN,
      bank_code: "058",
    }),
    deps,
  );
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error, "account_unresolved");
  assertEquals(
    paystackCalls.filter((c) => c.kind === "createRecipient").length,
    0,
  );
});

Deno.test("CORS · OPTIONS preflight carries x-client-info in the allow-list", async () => {
  const { deps } = makeDeps();
  const res = await handler(
    new Request("https://edge.test/partner-paystack-onboard", {
      method: "OPTIONS",
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const allow = res.headers.get("Access-Control-Allow-Headers") ?? "";
  assert(allow.includes("x-client-info"), "x-client-info allowed (ORCH-1205)");
});
