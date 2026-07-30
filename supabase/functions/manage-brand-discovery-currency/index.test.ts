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
