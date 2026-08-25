// #1976 — Ari balances/reports + partner links/splits (implementor happy path).
//
// Fails on revert of:
//   - get_brand_balances_reports / list_partner_brand_links / list_partner_splits
//   - finance role on balances; business_user on partner self-reads
//   - partner_account_id never returned from link/split tools
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1976_ari_payments_partner.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS, DOMAIN_READ_ONLY } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { TENANT_SCOPED_READ_TOOL_NAMES } from "../agentTenantScope.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered in DOMAIN_TOOLS`);
  return tool;
}

/** Thenable PostgREST-style chain. */
// deno-lint-ignore no-explicit-any
function chain(data: unknown, onSelect?: (clause: string) => void): any {
  const result = Promise.resolve({ data, error: null });
  // deno-lint-ignore no-explicit-any
  const query: any = {
    select: (clause: string) => {
      onSelect?.(clause);
      return query;
    },
    eq: () => query,
    is: () => query,
    not: () => query,
    order: () => query,
    limit: () => result,
    gte: () => query,
    lte: () => query,
    maybeSingle: () =>
      Promise.resolve({
        data: Array.isArray(data) ? (data[0] ?? null) : data,
        error: null,
      }),
    then: result.then.bind(result),
    catch: result.catch.bind(result),
  };
  return query;
}

Deno.test("#1976 implementor: three tools registered read-only with auth + tenant pins", () => {
  for (const name of [
    "get_brand_balances_reports",
    "list_partner_brand_links",
    "list_partner_splits",
  ]) {
    assert(DOMAIN_READ_ONLY.has(name), `${name} must be read-only`);
    assert(
      TENANT_SCOPED_READ_TOOL_NAMES.has(name),
      `${name} must be tenant-scoped`,
    );
  }
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_brand_balances_reports, {
    requiredRole: "finance_manager",
    resource: "brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.list_partner_brand_links, {
    requiredRole: "business_user",
    resource: "none",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.list_partner_splits, {
    requiredRole: "business_user",
    resource: "optional_brand",
  });
});

Deno.test("#1976 implementor: get_brand_balances_reports invokes balances edge + ledger select", async () => {
  const tool = domainTool("get_brand_balances_reports");
  assertEquals(tool.parameters.required, ["brand_id"]);
  const invoked: { name: string; body: Record<string, unknown> } = {
    name: "",
    body: {},
  };
  let releaseSelect = "";
  const brandRow = {
    id: BRAND,
    name: "Test",
    slug: "test",
    default_currency: "usd",
    cover_media_url: null,
  };
  const client = {
    functions: {
      invoke: (name: string, opts: { body: Record<string, unknown> }) => {
        invoked.name = name;
        invoked.body = opts.body;
        return Promise.resolve({
          data: {
            currency: "usd",
            available_minor: 1200,
            pending_minor: 300,
            retrieved_at: "2026-08-25T00:00:00Z",
          },
          error: null,
        });
      },
    },
    from(table: string) {
      if (table === "brands") return chain([brandRow]);
      if (table === "brand_team_members") return chain([]);
      if (table === "brand_payout_releases") {
        return chain(
          [{
            id: "rel-1",
            currency: "usd",
            status: "released",
            net_release_cents: 1000,
          }],
          (clause) => {
            releaseSelect = clause;
          },
        );
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const result = await tool.executor(
    { brand_id: BRAND },
    client as never,
    USER,
  );
  assertEquals(invoked.name, "brand-stripe-balances");
  assertEquals(invoked.body, { brand_id: BRAND });
  assert(/net_release_cents/.test(releaseSelect));
  assertEquals(result.balances.available_minor, 1200);
  assertEquals(result.payout_releases.length, 1);
});

Deno.test("#1976 implementor: list_partner_brand_links binds caller and omits partner_account_id", async () => {
  const tool = domainTool("list_partner_brand_links");
  let eqPartner: string | null = null;
  let selectClause = "";
  const client = {
    from: (_table: string) => ({
      select: (clause: string) => {
        selectClause = clause;
        const afterSelect = {
          eq: (_col: string, value: string) => {
            eqPartner = value;
            const afterEq = {
              order: () => {
                const afterOrder = {
                  is: () =>
                    Promise.resolve({
                      data: [{
                        id: "link-1",
                        brand_id: BRAND,
                        invited_owner_email: "owner@example.com",
                        invited_at: "2026-08-01T00:00:00Z",
                        accepted_at: "2026-08-02T00:00:00Z",
                        owner_stripe_connected_at: "2026-08-03T00:00:00Z",
                        first_split_at: null,
                        cancelled_at: null,
                        cancelled_reason: null,
                        brand: {
                          id: BRAND,
                          name: "Acme",
                          slug: "acme",
                          default_currency: "usd",
                        },
                      }],
                      error: null,
                    }),
                };
                return afterOrder;
              },
            };
            return afterEq;
          },
        };
        return afterSelect;
      },
    }),
  };
  const result = await tool.executor({}, client as never, USER);
  assertEquals(eqPartner, USER);
  assert(!/partner_account_id/.test(selectClause));
  assertEquals(result[0].status, "active");
  assertEquals(result[0].partner_account_id, undefined);
});

Deno.test("#1976 implementor: list_partner_splits never selects partner_account_id", async () => {
  const tool = domainTool("list_partner_splits");
  let selectClause = "";
  const client = {
    from: (_table: string) =>
      chain(
        [{
          id: "split-1",
          brand_id: BRAND,
          partner_share_cents: 500,
          transfer_currency: "usd",
          status: "transferred",
        }],
        (clause) => {
          selectClause = clause;
        },
      ),
  };
  const result = await tool.executor({}, client as never, USER);
  assert(!/partner_account_id/.test(selectClause));
  assertEquals(result.length, 1);
  assertEquals(result[0].partner_share_cents, 500);
});
