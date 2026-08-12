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
    expect(brandHook).toContain("!isPaidOnline(ticketMap.get(row.id) ?? []) ||");
    expect(brandHook).toContain("readyBrandIds.has(row.brand_id)");
    expect(brandHook).not.toContain('"pg_brands_can_charge"');
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
