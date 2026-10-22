import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createDiscountUpsertHandler } from "../index.ts";

Deno.test(
  "D9 forwards every Host choice to the rank-gated SQL writer",
  async () => {
    let args: Record<string, unknown> | null = null;
    const handler = createDiscountUpsertHandler({
      actorId: async () => "actor-1",
      rpc: async (_name, input) => {
        args = input;
        return { data: { id: "discount-1" }, error: null };
      },
    });
    const payload = {
      brandId: "brand-1",
      kind: "code",
      code: "WELCOME",
      combinesWith: "any",
      scopeKind: "listing_kinds",
      targets: [{ targetKind: "listing_kind", listingKind: "event" }],
    };
    const response = await handler(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", payload }),
      }),
    );
    assertEquals(response.status, 200);
    assertEquals(args, {
      p_actor: "actor-1",
      p_action: "create",
      p_payload: payload,
    });
  },
);

Deno.test("D9 preserves permission and conflict details", async () => {
  const invoke = async (message: string) => {
    const handler = createDiscountUpsertHandler({
      actorId: async () => "actor-1",
      rpc: async () => ({ data: null, error: { message } }),
    });
    return await handler(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          payload: { kind: "automatic" },
        }),
      }),
    );
  };
  const forbidden = await invoke("insufficient_permission");
  assertEquals(forbidden.status, 403);
  assertEquals(await forbidden.json(), {
    error: "forbidden",
    detail: "insufficient_permission",
  });
  const conflict = await invoke("version_conflict");
  assertEquals(conflict.status, 409);
  assertEquals(await conflict.json(), {
    error: "discount_write_failed",
    detail: "version_conflict",
  });
});
