// #1976 — adversarial tester angle for payout/tax/partner payments tools.
// Distinct from the implementor suite: focuses on PII leaks, rail isolation,
// and confirm-phrase gating rather than happy-path shape.
//
// Run:
//   deno test --allow-read --allow-env supabase/functions/_shared/__tests__/issue_1976_ari_payments_partner.tester_adversarial.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyPartnerDisconnectError,
  DOMAIN_TOOLS,
} from "../agentDomainTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

// deno-lint-ignore no-explicit-any
function clientWith(opts: {
  canCollect?: unknown;
  invoke?: (name: string, body: Record<string, unknown>) => unknown;
  invokeError?: (name: string) => { message: string } | null;
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
      invoke: (name: string, init: any) => {
        const err = opts.invokeError ? opts.invokeError(name) : null;
        if (err) return Promise.resolve({ data: null, error: err });
        return Promise.resolve({
          data: opts.invoke ? opts.invoke(name, init?.body ?? {}) : null,
          error: null,
        });
      },
    },
    rpc: (name: string) => {
      if (name === "pg_brand_can_collect") {
        return Promise.resolve({
          data: opts.canCollect ?? false,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    // deno-lint-ignore no-explicit-any
    from: (table: string): any => {
      if (table === "brands") {
        return chain([{
          id: BRAND,
          name: "Adversarial",
          slug: "adv",
          default_currency: "ngn",
          cover_media_url: null,
        }]);
      }
      if (table === "brand_team_members") return chain([]);
      return chain(null);
    },
  };
}

Deno.test("#1976 tester: payout status never surfaces stripe_account_id or raw requirements", async () => {
  const result = await domainTool("get_payout_status").executor(
    { brand_id: BRAND },
    clientWith({
      canCollect: false,
      invoke: (name) => {
        if (name === "brand-stripe-refresh-status") {
          return {
            status: "restricted",
            charges_enabled: false,
            payouts_enabled: false,
            requirements: {
              disabled_reason: "requirements.past_due",
              currently_due: ["individual.verification.document"],
            },
            stripe_account_id: "acct_LEAK_ME",
            detached_at: null,
          };
        }
        if (name === "brand-paystack-onboard") {
          return {
            connected: false,
            is_verified: false,
            account_number: "0123456789",
            account_number_masked: "••••6789",
            recipient_code: "RCP_LEAK",
          };
        }
        return null;
      },
    }) as never,
    USER,
  );
  assertEquals(result.can_collect, false);
  assertEquals(result.stripe.status, "restricted");
  assertEquals(result.stripe.has_disabled_reason, true);
  assertEquals("requirements" in result.stripe, false);
  assertEquals("stripe_account_id" in result.stripe, false);
  assertEquals(result.paystack.account_number_masked, "••••6789");
  assertEquals("account_number" in result.paystack, false);
  assertEquals("recipient_code" in result.paystack, false);
  const serialized = JSON.stringify(result);
  assert(!serialized.includes("acct_LEAK_ME"));
  assert(!serialized.includes("0123456789"));
  assert(!serialized.includes("RCP_LEAK"));
  assert(String(result.guide).includes("Brand → Payouts"));
});

Deno.test("#1976 tester: a Stripe rail outage does not invent can_collect:false", async () => {
  const result = await domainTool("get_payout_status").executor(
    { brand_id: BRAND },
    clientWith({
      canCollect: true,
      invokeError: (name) =>
        name === "brand-stripe-refresh-status"
          ? { message: "upstream_timeout" }
          : null,
      invoke: (name) => {
        if (name === "brand-paystack-onboard") {
          return { connected: true, is_verified: true };
        }
        return null;
      },
    }) as never,
    USER,
  );
  assertEquals(result.can_collect, true);
  assertEquals(result.stripe.unavailable, true);
  assertEquals(result.paystack.connected, true);
});

Deno.test("#1976 tester: get_tax_status maps hasActiveRegistration and never claims filing", async () => {
  const registered = await domainTool("get_tax_status").executor(
    { brand_id: BRAND },
    clientWith({
      invoke: () => ({ hasActiveRegistration: true }),
    }) as never,
    USER,
  );
  assertEquals(registered.has_active_registration, true);
  assert(!String(registered.guide).toLowerCase().includes("filed tax"));
  assert(String(registered.guide).includes("cannot edit"));

  const missing = await domainTool("get_tax_status").executor(
    { brand_id: BRAND },
    clientWith({
      invoke: () => ({ hasActiveRegistration: false, reason: "not_connected" }),
    }) as never,
    USER,
  );
  assertEquals(missing.has_active_registration, false);
  assert(String(missing.guide).includes("/connect-tax-registrations"));
});

Deno.test("#1976 tester: disconnect_partner rejects missing confirm_phrase", async () => {
  const error = await assertRejects(
    () =>
      domainTool("disconnect_partner").executor(
        { brand_id: BRAND, partner_id: LINK },
        clientWith() as never,
        USER,
      ),
    ToolError,
  );
  assertEquals(error.code, "INVALID_ARGS");
});

Deno.test("#1976 tester: partner disconnect classifier rejects substring laundering", () => {
  assertEquals(
    classifyPartnerDisconnectError({
      code: "P0001",
      message: "link_not_found_v2",
    }).code,
    "RPC_FAILED",
  );
  assertEquals(
    classifyPartnerDisconnectError({
      code: "P0001",
      message: "link_not_found",
    }).code,
    "INVALID_ARGS",
  );
});
