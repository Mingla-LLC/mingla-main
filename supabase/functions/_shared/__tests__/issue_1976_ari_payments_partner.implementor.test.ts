// #1976 — Ari payments balances + partner links/splits (implementor + adversarial).
//
// Run:
//   deno test --allow-read --allow-env supabase/functions/_shared/__tests__/issue_1976_ari_payments_partner.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS, DOMAIN_READ_ONLY } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

Deno.test("#1976 implementor: three partner/payments tools are registered read-only", () => {
  for (
    const [name, auth] of [
      ["get_brand_balances_reports", { requiredRole: "finance_manager", resource: "brand" }],
      ["list_partner_brand_links", { requiredRole: "business_user", resource: "none" }],
      ["list_partner_splits", { requiredRole: "business_user", resource: "optional_brand" }],
    ] as const
  ) {
    const tool = domainTool(name);
    assertEquals(tool.parameters.additionalProperties, false);
    assert(DOMAIN_READ_ONLY.has(name), `${name} must be read-only`);
    assertEquals(AGENT_TOOL_AUTHORIZATION[name], auth);
  }
});

Deno.test("#1976 implementor: get_brand_balances_reports invokes brand-stripe-balances", async () => {
  const tool = domainTool("get_brand_balances_reports");
  const BRAND = "11111111-1111-4111-8111-111111111111";
  const USER = "22222222-2222-4222-8222-222222222222";
  let invoked: { name?: string; body?: Record<string, unknown> } = {};
  // deno-lint-ignore no-explicit-any
  const chain = (result: unknown): any => {
    const self: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "not", "order", "limit"]) {
      self[method] = () => self;
    }
    self.maybeSingle = () => Promise.resolve({ data: result, error: null });
    self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: result, error: null }).then(resolve, reject);
    return self;
  };
  const client = {
    functions: {
      // deno-lint-ignore no-explicit-any
      invoke: (name: string, opts: any) => {
        invoked = { name, body: opts?.body };
        return Promise.resolve({
          data: {
            currency: "usd",
            available_minor: 100,
            pending_minor: 50,
            retrieved_at: "2026-08-25T00:00:00Z",
          },
          error: null,
        });
      },
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
      return chain(null);
    },
  };
  const result = await tool.executor(
    { brand_id: BRAND },
    client as never,
    USER,
  );
  assertEquals(invoked.name, "brand-stripe-balances");
  assertEquals(invoked.body?.brand_id, BRAND);
  assertEquals(result.balances.available_minor, 100);
});

Deno.test("#1976 tester: list_partner_brand_links never selects partner_account_id", async () => {
  const tool = domainTool("list_partner_brand_links");
  let selectClause = "";
  const USER = "22222222-2222-4222-8222-222222222222";
  // deno-lint-ignore no-explicit-any
  const self: any = {};
  for (const method of ["select", "eq", "is", "not", "order", "limit"]) {
    self[method] = (...args: unknown[]) => {
      if (method === "select" && typeof args[0] === "string") selectClause = args[0];
      return self;
    };
  }
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve, reject);
  const client = { from: () => self };
  await tool.executor({}, client as never, USER);
  assert(
    !/partner_account_id/.test(selectClause),
    `partner_account_id leaked into select: ${selectClause}`,
  );
});
