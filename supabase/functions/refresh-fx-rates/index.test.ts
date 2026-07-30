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
