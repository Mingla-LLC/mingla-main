// @ts-nocheck — Jest globals follow the app-mobile test convention.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

describe("issue #1919 tester adversarial Consumer contract", () => {
  test("the brand feed sends one distinct paid-brand batch and keeps free rows outside readiness", () => {
    const source = read("src/hooks/useBrandBySlug.ts");
    expect(source.match(/supabase\.rpc\(\s*"pg_brands_can_collect"/g)).toHaveLength(1);
    expect(source).toMatch(/Array\.from\(\s*new Set\(/s);
    expect(source).toContain("if (paidBrandIds.length > 0)");
    expect(source).toContain("paidOnline: canonical.event.tickets.some(");
    expect(source).toMatch(/ticket\.availableAt === "online" \|\| ticket\.availableAt === "both"/);
    expect(source).toContain("!ticket.isFree &&");
    expect(source).toContain("(ticket.priceGbp ?? 0) > 0");
    expect(source).toContain(".filter((item) => item.paidOnline)");
    expect(source).toContain("if (readyError === null)");
    expect(source).toContain("!paidOnline || readyBrandIds.has(row.brand_id)");
    expect(source).not.toMatch(/ticketMap|isPaidOnline|pg_brands_can_charge|pg_brand_can_charge|paystack_subaccount_code|stripe_connect_accounts|charges_enabled/);
  });

  test("paid trip detail fails closed, while free detail performs no readiness RPC", () => {
    const source = read("src/hooks/useConsumerTripDetail.ts");
    const free = source.indexOf("if (!isPaid || brandId === null) return true;");
    const rpc = source.indexOf('supabase.rpc("pg_brand_can_collect"');
    const fail = source.indexOf("if (error !== null) return false;", rpc);
    expect(free).toBeGreaterThan(-1);
    expect(rpc).toBeGreaterThan(free);
    expect(fail).toBeGreaterThan(rpc);
    expect(source).not.toMatch(/pg_brands_can_charge|pg_brand_can_charge/);
  });

  test("Consumer production source has no provider-specific readiness inference", () => {
    const combined = [
      read("src/hooks/useBrandBySlug.ts"),
      read("src/hooks/useConsumerTripDetail.ts"),
    ].join("\n");
    expect(combined).not.toMatch(/paystack_subaccount_code|stripe_connect_accounts|charges_enabled/);
  });
});
