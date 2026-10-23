import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createDiscountMaintenanceHandler } from "../index.ts";
import type { DiscountNotice } from "../../_shared/discountNotify.ts";

Deno.test(
  "D10 sends each notice then marks it, and a quiet replay sends nothing",
  async () => {
    const notice: DiscountNotice = {
      discountId: "discount-1",
      brandId: "brand-1",
      type: "business.discount_limit_80",
      name: "Welcome",
      left: 2,
    };
    let sweepCount = 0;
    const calls: string[] = [];
    const handler = createDiscountMaintenanceHandler({
      authorize: () => true,
      rpc: async (name) => {
        calls.push(name);
        if (name === "issue_3872_discount_maintenance") {
          sweepCount += 1;
          return {
            data: { notify: sweepCount === 1 ? [notice] : [] },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      send: async (item) => {
        calls.push(`send:${item.type}`);
      },
    });
    const request = () =>
      new Request("https://example.test", { method: "POST" });
    assertEquals((await handler(request())).status, 200);
    assertEquals((await handler(request())).status, 200);
    assertEquals(calls, [
      "issue_3872_discount_maintenance",
      "send:business.discount_limit_80",
      "issue_3872_mark_discount_notified",
      "issue_3872_discount_maintenance",
    ]);
  },
);

Deno.test("D10 refuses a non-service caller before SQL", async () => {
  let touched = false;
  const handler = createDiscountMaintenanceHandler({
    authorize: () => false,
    rpc: async () => {
      touched = true;
      return { data: null, error: null };
    },
    send: async () => {},
  });
  const response = await handler(
    new Request("https://example.test", { method: "POST" }),
  );
  assertEquals(response.status, 403);
  assertEquals(touched, false);
});
