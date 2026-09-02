import { corsHeaders } from "../cors.ts";
import { handleBrandSiteControl } from "../../brand-site-control/index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test({
  name:
    "#3016 malformed authenticated requests retain CORS and request identity without bypassing auth",
  // Supabase Auth owns background timers even with session persistence off.
  // The test restores fetch and env state; timer lifetime is library-owned.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = Deno.env.get("SUPABASE_URL");
    const originalAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const originalServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const requestId = "11111111-1111-4111-8111-111111111111";
    let authCalls = 0;

    Deno.env.set("SUPABASE_URL", "https://fixture.supabase.co");
    Deno.env.set("SUPABASE_ANON_KEY", "fixture-anon-key");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
    globalThis.fetch = ((input, init) => {
      const request = input instanceof Request
        ? input
        : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname !== "/auth/v1/user") {
        throw new Error(
          `malformed input reached an unexpected dependency: ${url.pathname}`,
        );
      }
      authCalls += 1;
      assert(
        request.headers.get("authorization") === "Bearer accepted",
        "authorization was not preserved for the auth check",
      );
      return Promise.resolve(Response.json({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        aud: "authenticated",
        role: "authenticated",
        email: "fixture@example.invalid",
      }));
    }) as typeof fetch;

    try {
      const response = await handleBrandSiteControl(
        new Request(
          "https://fixture.supabase.co/functions/v1/brand-site-control",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer accepted",
              "Content-Type": "application/json",
              Origin: "https://host.usemingla.com",
              "X-Request-Id": requestId,
            },
            body: "[]",
          },
        ),
      );

      assert(response.status === 400, `malformed status ${response.status}`);
      assert(authCalls === 1, `expected one auth check, observed ${authCalls}`);
      assert(
        response.headers.get("x-mingla-request-id") === requestId,
        "observer request identity was not preserved",
      );
      for (const [name, value] of Object.entries(corsHeaders)) {
        assert(
          response.headers.get(name) === value,
          `malformed response lost ${name}`,
        );
      }
      assert(
        JSON.stringify(await response.json()) === JSON.stringify({
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Review the highlighted Website fields and try again.",
            retryable: false,
            operation_id: null,
          },
        }),
        "malformed request did not retain the customer-safe failure body",
      );
    } finally {
      globalThis.fetch = originalFetch;
      for (
        const [name, value] of [
          ["SUPABASE_URL", originalUrl],
          ["SUPABASE_ANON_KEY", originalAnonKey],
          ["SUPABASE_SERVICE_ROLE_KEY", originalServiceKey],
        ] as const
      ) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  },
});
