import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleManageBrandCurrency } from "./index.ts";

Deno.test("issue 1384 management endpoint fails closed without a user JWT", async () => {
  const response = await handleManageBrandCurrency(new Request("http://local", {
    method: "POST",
    body: JSON.stringify({
      action: "get_state",
      brandId: "00000000-0000-4000-8000-000000000001",
    }),
  }));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).code, "unauthorized");
});

Deno.test("issue 1384 management endpoint rejects invalid brand identifiers", async () => {
  const response = await handleManageBrandCurrency(new Request("http://local", {
    method: "POST",
    headers: { authorization: "Bearer user-token" },
    body: JSON.stringify({ action: "get_state", brandId: "not-a-uuid" }),
  }));
  assertEquals(response.status, 422);
  assertEquals((await response.json()).code, "invalid_request");
});

const BRAND_ID = "00000000-0000-4000-8000-000000000001";
const VENUE_ID = "00000000-0000-4000-8000-000000000002";
const PLACE_ID = "00000000-0000-4000-8000-000000000003";
const RECONCILIATION_ID = "00000000-0000-4000-8000-000000000004";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000005";

function authenticatedRequest(body: Record<string, unknown>): Request {
  return new Request("http://local", {
    method: "POST",
    headers: {
      authorization: "Bearer user-token",
      "x-request-id": "00000000-0000-4000-8000-000000000099",
    },
    body: JSON.stringify({ brandId: BRAND_ID, ...body }),
  });
}

Deno.test("issue 1384 executes every management action with the binding RPC payload", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-test-key");
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const dependencies = {
    createRpcClient: () => ({
      rpc: (
        name: string,
        params: Record<string, unknown>,
      ): Promise<{ data: unknown; error: null }> => {
        calls.push({ name, params });
        return Promise.resolve({ data: { authority: "provisional" }, error: null });
      },
    }),
  };
  const cases = [
    {
      body: { action: "get_state" },
      name: "issue_1384_brand_currency_state",
      params: { p_brand_id: BRAND_ID },
    },
    {
      body: {
        action: "set_provisional_currency",
        currencyCode: "NGN",
        expectedStateVersion: 7,
      },
      name: "issue_1384_set_provisional_currency",
      params: {
        p_brand_id: BRAND_ID,
        p_currency_code: "NGN",
        p_expected_state_version: 7,
      },
    },
    {
      body: {
        action: "preview_reconciliation",
        reconciliationId: RECONCILIATION_ID,
        decision: "convert",
      },
      name: "issue_1384_preview_reconciliation",
      params: {
        p_brand_id: BRAND_ID,
        p_reconciliation_id: RECONCILIATION_ID,
      },
    },
    {
      body: {
        action: "resolve_reconciliation",
        reconciliationId: RECONCILIATION_ID,
        decision: "convert",
        fxSnapshotId: SNAPSHOT_ID,
        ranges: [{ placePoolId: PLACE_ID, expectedVersion: 3 }],
      },
      name: "issue_1384_resolve_reconciliation",
      params: {
        p_brand_id: BRAND_ID,
        p_reconciliation_id: RECONCILIATION_ID,
        p_decision: "convert",
        p_fx_snapshot_id: SNAPSHOT_ID,
        p_ranges: [{ placePoolId: PLACE_ID, expectedVersion: 3 }],
        p_request_id: "00000000-0000-4000-8000-000000000099",
      },
    },
    {
      body: {
        action: "save_discovery_price_range",
        venueId: VENUE_ID,
        placePoolId: PLACE_ID,
        sourceMinMinor: 20_000,
        sourceMaxMinor: 50_000,
        currencyCode: "NGN",
        expectedVersion: 4,
        reason: "business authored",
      },
      name: "issue_1384_save_discovery_price_range",
      params: {
        p_brand_id: BRAND_ID,
        p_venue_id: VENUE_ID,
        p_place_pool_id: PLACE_ID,
        p_source_min_minor: 20_000,
        p_source_max_minor: 50_000,
        p_source_currency_code: "NGN",
        p_expected_version: 4,
        p_actor_reason: "business authored",
        p_request_id: "00000000-0000-4000-8000-000000000099",
      },
    },
  ] as const;

  for (const testCase of cases) {
    const response = await handleManageBrandCurrency(
      authenticatedRequest(testCase.body),
      dependencies,
    );
    assertEquals(response.status, 200);
    assertEquals((await response.json()).kind, "ok");
    assertEquals(calls.at(-1), {
      name: testCase.name,
      params: testCase.params,
    });
  }
});

Deno.test("issue 1384 management maps role, race, validation, and FX failures without partial retries", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-test-key");
  const cases = [
    ["forbidden", 403],
    ["brand_not_found", 404],
    ["currency_already_set", 409],
    ["range_version_conflict", 409],
    ["range_set_changed", 409],
    ["unsupported_currency", 422],
    ["currency_mismatch", 422],
    ["incomplete_reentry", 422],
    ["fx_snapshot_stale", 422],
    ["fx_unavailable", 503],
  ] as const;

  for (const [code, status] of cases) {
    let rpcCalls = 0;
    const response = await handleManageBrandCurrency(
      authenticatedRequest({
        action: "resolve_reconciliation",
        reconciliationId: RECONCILIATION_ID,
        decision: "reenter",
        ranges: [],
      }),
      {
        createRpcClient: () => ({
          rpc: () => {
            rpcCalls += 1;
            return Promise.resolve({
              data: null,
              error: { message: `rpc failed: ${code}` },
            });
          },
        }),
      },
    );
    assertEquals(response.status, status);
    assertEquals((await response.json()).code, code);
    assertEquals(rpcCalls, 1);
  }
});
