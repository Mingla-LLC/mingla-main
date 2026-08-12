import { handler } from "./index.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test({
  name:
    "#1858 validates and forwards explicit brand targets without changing roster",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    Deno.env.set("SUPABASE_URL", "https://issue-1858.supabase.test");
    Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const originalFetch = globalThis.fetch;
    const rpcBodies: Record<string, unknown>[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({
            id: "18580000-0000-4000-8000-000000000001",
            aud: "authenticated",
            role: "authenticated",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/rest/v1/rpc/biz_export_brand_people")) {
        const requestInit = init as { body?: BodyInit | null } | undefined;
        rpcBodies.push(JSON.parse(String(requestInit?.body)));
        return new Response(
          JSON.stringify({
            jobId: "18580000-0000-4000-8000-000000000099",
            status: "queued",
            result: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const post = (body: unknown) =>
      handler(
        new Request("https://edge.test/brand-people-export", {
          method: "POST",
          headers: {
            authorization: "Bearer test",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    try {
      let response = await post({
        scope: "brand_book",
        clientRequestId: crypto.randomUUID(),
      });
      assert(
        response.status === 400 &&
          (await response.json()).error === "brand_id_required",
        "missing brand response drifted",
      );
      response = await post({
        scope: "brand_book",
        brandId: "not-a-uuid",
        clientRequestId: crypto.randomUUID(),
      });
      assert(
        response.status === 400 &&
          (await response.json()).error === "brand_id_invalid",
        "invalid brand response drifted",
      );
      response = await post({
        scope: "offering_guest_roster",
        eventId: crypto.randomUUID(),
        brandId: crypto.randomUUID(),
      });
      assert(
        response.status === 400 &&
          (await response.json()).error === "export_request_invalid",
        "roster brand response drifted",
      );
      response = await post({
        scope: "brand_book",
        brandId: crypto.randomUUID(),
        eventId: crypto.randomUUID(),
      });
      assert(
        response.status === 400 &&
          (await response.json()).error === "export_request_invalid",
        "brand-book event response drifted",
      );
      response = await post({ scope: "offering_guest_roster" });
      assert(
        response.status === 400 &&
          (await response.json()).error === "export_request_invalid",
        "missing roster event response drifted",
      );
      assert(rpcBodies.length === 0, "invalid requests reached RPC");

      const brandId = "18580000-0000-4000-8000-000000000011";
      response = await post({
        scope: "brand_book",
        brandId,
        clientRequestId: crypto.randomUUID(),
      });
      assert(
        response.status === 202 && rpcBodies[0]?.p_brand_id === brandId,
        "brand target was not forwarded",
      );
      response = await post({
        scope: "offering_guest_roster",
        eventId: crypto.randomUUID(),
        clientRequestId: crypto.randomUUID(),
      });
      assert(
        response.status === 202 && rpcBodies[1]?.p_brand_id === null,
        "roster did not forward null brand",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});
