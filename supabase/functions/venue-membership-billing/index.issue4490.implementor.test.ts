// #4490 P6 — venue-membership-billing: only the platform scheduler (the exact
// service bearer) runs the membership clock.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createVenueMembershipBillingHandler } from "./index.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:57521",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-for-tests",
};

function req(auth: string | null): Request {
  return new Request("http://local/venue-membership-billing", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
    body: "{}",
  });
}

Deno.test("anyone but the scheduler is refused; nothing runs", async () => {
  const calls: string[] = [];
  const handle = createVenueMembershipBillingHandler({
    env: (n) => ENV[n],
    client: () => ({
      rpc: (name: string) => {
        calls.push(name);
        return Promise.resolve({ data: {}, error: null });
      },
    }),
  });
  assertEquals((await handle(req(null))).status, 401);
  assertEquals((await handle(req("Bearer anon-key"))).status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("the scheduler runs the clock once per call", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const handle = createVenueMembershipBillingHandler({
    env: (n) => ENV[n],
    client: () => ({
      rpc: (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        return Promise.resolve({ data: { renewalsSent: 2 }, error: null });
      },
    }),
  });
  const res = await handle(req("Bearer service-key-for-tests"));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).result.renewalsSent, 2);
  assertEquals(calls, [{
    name: "issue_4490_membership_billing_run",
    params: { p_now: null, p_limit: 500 },
  }]);
});

Deno.test("a failed run answers 500 with no detail", async () => {
  const res = await createVenueMembershipBillingHandler({
    env: (n) => ENV[n],
    client: () => ({
      rpc: () => Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } }),
    }),
  })(req("Bearer service-key-for-tests"));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "billing_failed" });
});
