import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createTicketCheckoutCreateHandler, type TicketCheckoutCreateDeps } from "../index.ts";

Deno.test("#1929 tester Edge: invalid request dies before auth/service/provider/network bootstrap", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { calls.push("fetch"); throw new Error("network forbidden"); }) as typeof fetch;
  try {
    const deps: TicketCheckoutCreateDeps = {
      userIdFromAuthHeader: async () => { calls.push("auth"); return null; },
      serviceClient: () => { calls.push("service"); throw new Error("service forbidden"); },
      paystackInitializeTransaction: async () => { calls.push("paystack"); throw new Error("provider forbidden"); },
    };
    const handler = createTicketCheckoutCreateHandler(deps);
    const response = await handler(new Request("http://edge.test", {method:"GET"}));
    assertEquals(response.status, 405);
    assertEquals(calls, []);
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test("#1929 tester Edge: production seam has no #1930/#1931/provider/config widening", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const contract = source.match(/export interface TicketCheckoutCreateDeps \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assertEquals((contract.match(/:/g) ?? []).length, 3);
  for (const forbidden of ["invite_token", "biz_validate_offering_invite_token", "revalidate_inflight", "PAYSTACK_BASE_URL", "ISSUE_1929_TEST", "Deno.env.get(\"ISSUE_1929"]) assert(!source.includes(forbidden), forbidden);
  assertEquals((source.match(/if \(import\.meta\.main\)/g) ?? []).length, 1);
  assertEquals((source.match(/serve\(createTicketCheckoutCreateHandler\(\)\);/g) ?? []).length, 1);
  assertMatch(source, /deps\.serviceClient\(\)[\s\S]*deps\.paystackInitializeTransaction\(\{/);
});
