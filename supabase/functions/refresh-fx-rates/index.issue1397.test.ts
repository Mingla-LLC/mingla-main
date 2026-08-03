import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRefreshFxRates } from "./index.ts";

const SERVICE_URL = "https://example.supabase.co";
const SERVICE_KEY = "issue-1397-service-role";
const CODES = ["USD", "NGN", "EUR"];

function request(): Request {
  return new Request("http://local/refresh-fx-rates", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SERVICE_KEY}`,
      "x-request-id": "13970000-0000-4000-8000-000000000001",
    },
  });
}

function payload(timeEolUnix: number): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    result: "success",
    base_code: "USD",
    time_last_update_unix: nowSeconds - 60,
    time_next_update_unix: nowSeconds + 3_600,
    time_eol_unix: timeEolUnix,
    rates: { USD: 1, NGN: 1534.25, EUR: 0.86 },
  };
}

function dependencies(
  calls: Array<{ name: string; params?: Record<string, unknown> }>,
) {
  return {
    createRpcClient: () => ({
      rpc: (
        name: string,
        params?: Record<string, unknown>,
      ): Promise<{ data: unknown; error: null }> => {
        calls.push({ name, params });
        if (name === "issue_1384_supported_currencies") {
          return Promise.resolve({
            data: CODES.map((code) => ({
              code,
              minor_unit_exponent: 2,
            })),
            error: null,
          });
        }
        return Promise.resolve({
          data: "13970000-0000-4000-8000-000000000002",
          error: null,
        });
      },
    }),
  };
}

async function run(
  providerPayload: Record<string, unknown>,
  calls: Array<{ name: string; params?: Record<string, unknown> }>,
): Promise<Response> {
  Deno.env.set("SUPABASE_URL", SERVICE_URL);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  return await handleRefreshFxRates(
    request(),
    () =>
      Promise.resolve(
        new Response(JSON.stringify(providerPayload), { status: 200 }),
      ),
    dependencies(calls),
  );
}

Deno.test("issue 1397 refresh passes no-EOL sentinel to activation as null", async () => {
  const calls: Array<{ name: string; params?: Record<string, unknown> }> = [];
  const response = await run(payload(0), calls);

  assertEquals(response.status, 200);
  const activation = calls.find((call) =>
    call.name === "issue_1384_activate_fx_snapshot"
  );
  assertEquals(activation?.params?.p_provider_eol_at, null);
  assertEquals(activation?.params?.p_rates, {
    USD: 1,
    NGN: 1534.25,
    EUR: 0.86,
  });
});

Deno.test("issue 1397 refresh preserves positive future EOL", async () => {
  const calls: Array<{ name: string; params?: Record<string, unknown> }> = [];
  const futureEol = Math.floor(Date.now() / 1000) + 86_400;
  const response = await run(payload(futureEol), calls);

  assertEquals(response.status, 200);
  const activation = calls.find((call) =>
    call.name === "issue_1384_activate_fx_snapshot"
  );
  assertEquals(
    activation?.params?.p_provider_eol_at,
    new Date(futureEol * 1000).toISOString(),
  );
});

Deno.test("issue 1397 refresh rejects expired nonzero EOL before activation", async () => {
  const calls: Array<{ name: string; params?: Record<string, unknown> }> = [];
  const response = await run(
    payload(Math.floor(Date.now() / 1000) - 60),
    calls,
  );

  assertEquals(response.status, 503);
  assertEquals((await response.json()).code, "provider_payload_invalid");
  assertEquals(
    calls.some((call) => call.name === "issue_1384_activate_fx_snapshot"),
    false,
  );
});
