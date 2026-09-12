// #1976 — Ari payments balances + partner links/splits + payout/tax status
// (implementor / fail-on-revert).
//
// [TEST-MOD-APPROVED #1976] Expanded from balances/links/splits-only coverage to
// pin Stripe/Paystack connect-status reads, tax registration probe, confirm
// phrase, and prompt v16 ads — prior assertions retained and extended.
//
// Run:
//   deno test --allow-read --allow-env supabase/functions/_shared/__tests__/issue_1976_ari_payments_partner.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyPartnerDisconnectError,
  DOMAIN_TOOLS,
  DOMAIN_READ_ONLY,
} from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { PROMPT_VERSION, buildSystemPrompt } from "../agentSystemPrompt.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const PARTNER = "33333333-3333-4333-8333-333333333333";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

// deno-lint-ignore no-explicit-any
function brandScopeClient(opts: {
  canCollect?: unknown;
  invoke?: (name: string, body: Record<string, unknown>) => unknown;
  rpcError?: unknown;
} = {}): any {
  // deno-lint-ignore no-explicit-any
  const chain = (result: unknown): any => {
    const self: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "not", "order", "limit"]) {
      self[method] = () => self;
    }
    self.maybeSingle = () => Promise.resolve({ data: result, error: null });
    self.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: result, error: null }).then(resolve, reject);
    return self;
  };
  return {
    functions: {
      // deno-lint-ignore no-explicit-any
      invoke: (name: string, optsInvoke: any) => {
        const data = opts.invoke
          ? opts.invoke(name, optsInvoke?.body ?? {})
          : null;
        return Promise.resolve({ data, error: null });
      },
    },
    rpc: (name: string, _args: Record<string, unknown>) => {
      if (opts.rpcError) {
        return Promise.resolve({ data: null, error: opts.rpcError });
      }
      if (name === "pg_brand_can_collect") {
        return Promise.resolve({
          data: "canCollect" in opts ? opts.canCollect : true,
          error: null,
        });
      }
      if (name === "partner_disconnect_link") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    // deno-lint-ignore no-explicit-any
    from: (table: string): any => {
      if (table === "brands") {
        return chain([{
          id: BRAND,
          name: "B",
          slug: "b",
          default_currency: "usd",
          cover_media_url: null,
        }]);
      }
      if (table === "brand_team_members") return chain([]);
      if (table === "brand_payout_releases") return chain([]);
      if (table === "partner_brand_links") return chain([]);
      if (table === "partner_splits") return chain([]);
      return chain(null);
    },
  };
}

Deno.test("#1976 implementor: three partner/payments tools are registered read-only", () => {
  for (
    const [name, auth] of [
      ["get_brand_balances_reports", {
        requiredRole: "finance_manager",
        resource: "brand",
      }],
      ["list_partner_brand_links", {
        requiredRole: "business_user",
        resource: "none",
      }],
      ["list_partner_splits", {
        requiredRole: "business_user",
        resource: "optional_brand",
      }],
    ] as const
  ) {
    const tool = domainTool(name);
    assertEquals(tool.parameters.additionalProperties, false);
    assert(DOMAIN_READ_ONLY.has(name), `${name} must be read-only`);
    assertEquals(AGENT_TOOL_AUTHORIZATION[name], auth);
  }
});

Deno.test("#1976 implementor: payout + tax tools are finance-gated read-only", () => {
  for (const name of ["get_payout_status", "get_tax_status", "get_partner_status"]) {
    assert(DOMAIN_READ_ONLY.has(name), `${name} must be read-only`);
    assertEquals(AGENT_TOOL_AUTHORIZATION[name], {
      requiredRole: "finance_manager",
      resource: "brand",
    });
  }
  assertEquals(AGENT_TOOL_AUTHORIZATION.disconnect_partner, {
    requiredRole: "finance_manager",
    resource: "brand",
  });
  assert(!DOMAIN_READ_ONLY.has("disconnect_partner"));
});

Deno.test("#1976 implementor: prompt v16 advertises enriched payout/tax copy", () => {
  // [TEST-MOD-APPROVED #1980] prompt version advanced for marketing/growth tools.
  // [TEST-MOD-APPROVED #1981] prompt v17→v18 for refund/cancel discovery (append-only auth).
  assertEquals(PROMPT_VERSION, "v18");
  const prompt = buildSystemPrompt(null, [], { injectStrictReminder: false });
  assert(
    prompt.includes(
      "get_payout_status — read payout readiness plus Stripe/Paystack connect status",
    ),
  );
  assert(
    prompt.includes(
      "get_tax_status — read tax-registration status; open Connect tax screen when unregistered",
    ),
  );
});

Deno.test("#1976 implementor: get_brand_balances_reports invokes brand-stripe-balances", async () => {
  const tool = domainTool("get_brand_balances_reports");
  let invoked: { name?: string; body?: Record<string, unknown> } = {};
  const client = brandScopeClient({
    invoke: (name, body) => {
      invoked = { name, body };
      return {
        currency: "usd",
        available_minor: 100,
        pending_minor: 50,
        retrieved_at: "2026-08-25T00:00:00Z",
      };
    },
  });
  const result = await tool.executor(
    { brand_id: BRAND },
    client as never,
    USER,
  );
  assertEquals(invoked.name, "brand-stripe-balances");
  assertEquals(invoked.body?.brand_id, BRAND);
  assertEquals(result.balances.available_minor, 100);
});

Deno.test("#1976 implementor: get_payout_status reads can_collect + Stripe + Paystack", async () => {
  const tool = domainTool("get_payout_status");
  const invoked: Array<{ name: string; body: Record<string, unknown> }> = [];
  const result = await tool.executor(
    { brand_id: BRAND },
    brandScopeClient({
      canCollect: true,
      invoke: (name, body) => {
        invoked.push({ name, body });
        if (name === "brand-stripe-refresh-status") {
          return {
            status: "active",
            charges_enabled: true,
            payouts_enabled: true,
            requirements: {},
            stripe_account_id: "acct_SECRET",
          };
        }
        if (name === "brand-paystack-onboard") {
          return {
            connected: true,
            is_verified: true,
            active: true,
            settlement_bank: "Access Bank",
            account_number_masked: "••••1234",
            recipient_connected: true,
            recipient_code: "RCP_secret",
          };
        }
        return null;
      },
    }) as never,
    USER,
  );
  assertEquals(result.can_collect, true);
  assertEquals(result.stripe.status, "active");
  assertEquals(result.stripe.charges_enabled, true);
  assertEquals(result.paystack.connected, true);
  assertEquals(result.paystack.account_number_masked, "••••1234");
  assertEquals(
    invoked.map((call) => call.name).sort(),
    ["brand-paystack-onboard", "brand-stripe-refresh-status"],
  );
  assertEquals(
    invoked.find((call) => call.name === "brand-paystack-onboard")?.body
      .action,
    "refresh_status",
  );
  // PII minimization: provider account ids never reach the model.
  assertEquals("stripe_account_id" in result.stripe, false);
  assertEquals("recipient_code" in result.paystack, false);
  assert(!JSON.stringify(result).includes("acct_SECRET"));
});

Deno.test("#1976 implementor: get_payout_status refuses non-boolean can_collect", async () => {
  const tool = domainTool("get_payout_status");
  for (const value of [null, { can_collect: true }, "true"]) {
    const error = await assertRejects(
      () =>
        tool.executor(
          { brand_id: BRAND },
          brandScopeClient({ canCollect: value }) as never,
          USER,
        ),
      ToolError,
    );
    assertEquals(error.code, "RPC_FAILED");
  }
});

Deno.test("#1976 implementor: get_tax_status reads brand-tax-registrations-list", async () => {
  const tool = domainTool("get_tax_status");
  let invoked: { name?: string; body?: Record<string, unknown> } = {};
  const result = await tool.executor(
    { brand_id: BRAND },
    brandScopeClient({
      invoke: (name, body) => {
        invoked = { name, body };
        return { hasActiveRegistration: false, reason: "not_connected" };
      },
    }) as never,
    USER,
  );
  assertEquals(invoked.name, "brand-tax-registrations-list");
  assertEquals(invoked.body?.brand_id, BRAND);
  assertEquals(result.has_active_registration, false);
  assertEquals(result.reason, "not_connected");
  assert(String(result.guide).includes("connect-tax-registrations"));
});

Deno.test("#1976 implementor: get_tax_status stays available when the tax edge fails", async () => {
  const tool = domainTool("get_tax_status");
  const result = await tool.executor(
    { brand_id: BRAND },
    brandScopeClient({
      invoke: () => {
        throw new ToolError("EDGE_FAILED", "brand-tax-registrations-list: boom");
      },
    }) as never,
    USER,
  );
  assertEquals(result.has_active_registration, null);
  assertEquals(result.unavailable, true);
  assert(String(result.guide).includes("connect-tax-registrations"));
});

Deno.test("#1976 implementor: missing Stripe/Paystack booleans stay null", async () => {
  const tool = domainTool("get_payout_status");
  const result = await tool.executor(
    { brand_id: BRAND },
    brandScopeClient({
      canCollect: true,
      invoke: (name) => {
        if (name === "brand-stripe-refresh-status") {
          return { status: "onboarding" };
        }
        if (name === "brand-paystack-onboard") {
          return { settlement_bank: "Access Bank" };
        }
        return null;
      },
    }) as never,
    USER,
  );
  assertEquals(result.stripe.charges_enabled, null);
  assertEquals(result.stripe.payouts_enabled, null);
  assertEquals(result.paystack.connected, null);
  assertEquals(result.paystack.is_verified, null);
  assertEquals(result.paystack.recipient_connected, null);
});

Deno.test("#1976 implementor: disconnect_partner requires DISCONNECT confirm phrase", async () => {
  const tool = domainTool("disconnect_partner");
  assertEquals(tool.parameters.properties.confirm_phrase.enum, ["DISCONNECT"]);
  const error = await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND, partner_id: PARTNER, confirm_phrase: "YES" },
        brandScopeClient() as never,
        USER,
      ),
    ToolError,
  );
  assertEquals(error.code, "INVALID_ARGS");
});

Deno.test("#1976 implementor: classifyPartnerDisconnectError stays structured", () => {
  assertEquals(
    classifyPartnerDisconnectError({ code: "P0001", message: "forbidden" })
      .code,
    "BRAND_ACCESS_DENIED",
  );
  assertEquals(
    classifyPartnerDisconnectError({
      code: "42501",
      message: "guest_roster_forbidden",
    }).code,
    "RPC_FAILED",
  );
});

Deno.test("#1976 tester: list_partner_brand_links never selects partner_account_id", async () => {
  const tool = domainTool("list_partner_brand_links");
  let selectClause = "";
  // deno-lint-ignore no-explicit-any
  const self: any = {};
  for (const method of ["select", "eq", "is", "not", "order", "limit"]) {
    self[method] = (...args: unknown[]) => {
      if (method === "select" && typeof args[0] === "string") {
        selectClause = args[0];
      }
      return self;
    };
  }
  self.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
  const client = { from: () => self };
  await tool.executor({}, client as never, USER);
  assert(
    !/partner_account_id/.test(selectClause),
    `partner_account_id leaked into select: ${selectClause}`,
  );
});
// [TEST-MOD-APPROVED #1980] append-only override commit marker
