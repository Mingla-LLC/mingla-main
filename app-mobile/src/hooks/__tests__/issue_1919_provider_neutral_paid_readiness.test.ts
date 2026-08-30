// @ts-nocheck — Jest globals follow the app-mobile test convention.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP_ROOT = join(__dirname, "..", "..", "..");
const appFile = (relativePath: string): string =>
  readFileSync(join(APP_ROOT, relativePath), "utf8");

describe("issue #1919 provider-neutral Consumer readiness", () => {
  test("brand feed batches distinct paid IDs, preserves free rows, and fails closed", () => {
    const brandHook = appFile("src/hooks/useBrandBySlug.ts");
    expect(brandHook).toContain("const paidBrandIds = Array.from(");
    expect(brandHook).toContain("new Set(");
    expect(brandHook).toContain('"pg_brands_can_collect"');
    expect(brandHook).toContain("if (readyError === null)");
    expect(brandHook).toContain("paidOnline: canonical.event.tickets.some(");
    expect(brandHook).toContain('ticket.availableAt === "online" || ticket.availableAt === "both"');
    expect(brandHook).toContain("!ticket.isFree &&");
    expect(brandHook).toContain("(ticket.priceGbp ?? 0) > 0");
    expect(brandHook).toContain(".filter((item) => item.paidOnline)");
    expect(brandHook).toContain("if (paidBrandIds.length > 0)");
    expect(brandHook).toContain("!paidOnline || readyBrandIds.has(row.brand_id)");
    expect(brandHook.match(/"pg_brands_can_collect"/g)).toHaveLength(1);
    expect(brandHook).not.toMatch(/ticketMap|isPaidOnline|pg_brands_can_charge|pg_brand_can_charge|paystack_subaccount_code|stripe_connect_accounts|charges_enabled/);
  });

  test("trip detail bypasses readiness for free and fails closed for paid RPC errors", () => {
    const tripHook = appFile("src/hooks/useConsumerTripDetail.ts");
    expect(tripHook).toContain("if (!isPaid || brandId === null) return true;");
    expect(tripHook).toContain('supabase.rpc("pg_brand_can_collect"');
    expect(tripHook).toContain("if (error !== null) return false;");
    expect(tripHook).toContain("return data === true;");
    expect(tripHook).not.toContain('supabase.rpc("pg_brand_can_charge"');
  });
});
