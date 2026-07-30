import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRefreshFxRates } from "./index.ts";

Deno.test("issue 1384 FX refresh rejects public callers before fetching", async () => {
  let fetchCalled = false;
  const response = await handleRefreshFxRates(
    new Request("http://local", { method: "POST" }),
    (() => {
      fetchCalled = true;
      throw new Error("must not fetch");
    }) as typeof fetch,
  );
  assertEquals(response.status, 401);
  assertEquals(fetchCalled, false);
  assertEquals((await response.json()).code, "unauthorized");
});

const SERVICE_ENV = {
  url: "https://example.supabase.co",
  key: "service-role-test-key",
};
const ACTIVE_CODES = [
  "BGN", "CAD", "CHF", "CZK", "DKK", "EUR", "GBP", "HUF",
  "ISK", "NGN", "NOK", "PLN", "RON", "SEK", "USD",
];

function serviceRequest(): Request {
  return new Request("http://local", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SERVICE_ENV.key}`,
      "x-request-id": "00000000-0000-4000-8000-000000000098",
    },
  });
}

function validProviderPayload(): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    result: "success",
    provider: "https://www.exchangerate-api.com",
    time_last_update_unix: nowSeconds - 60,
    time_next_update_unix: nowSeconds + 3_600,
    time_eol_unix: nowSeconds + 86_400,
    base_code: "USD",
    rates: Object.fromEntries(ACTIVE_CODES.map((code, index) => [
      code,
      code === "USD" ? 1 : index + 2,
    ])),
  };
}

function refreshDependencies(calls: Array<{ name: string; params?: Record<string, unknown> }>) {
  return {
    createRpcClient: () => ({
      rpc: (
        name: string,
        params?: Record<string, unknown>,
      ): Promise<{ data: unknown; error: null }> => {
        calls.push({ name, params });
        if (name === "issue_1384_supported_currencies") {
          return Promise.resolve({
            data: ACTIVE_CODES.map((code) => ({
              code,
              minor_unit_exponent: 2,
            })),
            error: null,
          });
        }
        return Promise.resolve({
          data: "00000000-0000-4000-8000-000000000097",
          error: null,
        });
      },
    }),
  };
}

Deno.test("issue 1384 FX refresh validates then activates one complete snapshot", async () => {
  Deno.env.set("SUPABASE_URL", SERVICE_ENV.url);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ENV.key);
  const calls: Array<{ name: string; params?: Record<string, unknown> }> = [];
  const response = await handleRefreshFxRates(
    serviceRequest(),
    () => Promise.resolve(new Response(
      JSON.stringify(validProviderPayload()),
      { status: 200 },
    )),
    refreshDependencies(calls),
  );
  assertEquals(response.status, 200);
  assertEquals(calls.map((call) => call.name), [
    "issue_1384_supported_currencies",
    "issue_1384_activate_fx_snapshot",
  ]);
  const activation = calls[1].params ?? {};
  assertEquals(
    Object.keys(activation.p_rates as Record<string, number>).sort(),
    [...ACTIVE_CODES].sort(),
  );
  assertEquals((await response.json()).kind, "ok");
});

Deno.test("issue 1384 FX provider failures preserve the old snapshot by never activating", async () => {
  Deno.env.set("SUPABASE_URL", SERVICE_ENV.url);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ENV.key);
  const cases: Array<[string, typeof fetch, string]> = [
    [
      "429",
      () => Promise.resolve(new Response("limited", { status: 429 })),
      "provider_rate_limited",
    ],
    [
      "http",
      () => Promise.resolve(new Response("bad gateway", { status: 502 })),
      "provider_http_error",
    ],
    [
      "malformed",
      () => Promise.resolve(new Response(JSON.stringify({ result: "error" }))),
      "provider_payload_invalid",
    ],
    [
      "missing rate",
      () => {
        const payload = validProviderPayload();
        delete (payload.rates as Record<string, number>).NGN;
        return Promise.resolve(new Response(JSON.stringify(payload)));
      },
      "provider_payload_invalid",
    ],
    [
      "timeout",
      () => Promise.reject(new DOMException("aborted", "AbortError")),
      "provider_timeout",
    ],
  ];
  for (const [label, fetchImpl, expectedCode] of cases) {
    const calls: Array<{ name: string; params?: Record<string, unknown> }> = [];
    const response = await handleRefreshFxRates(
      serviceRequest(),
      fetchImpl,
      refreshDependencies(calls),
    );
    assertEquals(response.status, 503, label);
    assertEquals((await response.json()).code, expectedCode, label);
    assertEquals(
      calls.filter((call) =>
        call.name === "issue_1384_activate_fx_snapshot"
      ).length,
      0,
      label,
    );
  }
});

Deno.test("issue 1384 duplicate payload delegates idempotency to atomic activation", async () => {
  Deno.env.set("SUPABASE_URL", SERVICE_ENV.url);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ENV.key);
  const calls: Array<{ name: string; params?: Record<string, unknown> }> = [];
  const dependencies = refreshDependencies(calls);
  for (let index = 0; index < 2; index += 1) {
    const response = await handleRefreshFxRates(
      serviceRequest(),
      () => Promise.resolve(new Response(JSON.stringify(validProviderPayload()))),
      dependencies,
    );
    assertEquals(response.status, 200);
  }
  const activations = calls.filter((call) =>
    call.name === "issue_1384_activate_fx_snapshot"
  );
  assertEquals(activations.length, 2);
  assertEquals(
    activations[0].params?.p_payload_sha256,
    activations[1].params?.p_payload_sha256,
  );
});
