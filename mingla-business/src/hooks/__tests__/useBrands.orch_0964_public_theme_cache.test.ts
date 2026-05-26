import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const source = readFileSync(join(__dirname, "..", "useBrands.ts"), "utf8");

describe("ORCH-0964 smoke follow-up — brand theme save refreshes public page cache", () => {
  test("useUpdateBrand imports the public brand query key factory", () => {
    expect(source).toContain('import { publicEventKeys } from "./usePublicEvents";');
  });

  test("brand update success invalidates /b/{slug} public brand cache", () => {
    const match = source.match(
      /onSuccess:\s*\(serverBrand,\s*\{\s*brandId,\s*accountId\s*\}\)\s*=>\s*\{[\s\S]*?\n\s*\},\n\s*\}\);/,
    );
    expect(match).not.toBeNull();
    const body = match![0];
    expect(body).toContain("publicEventKeys.brandBySlug(serverBrand.slug)");
    expect(body).toContain("queryClient.invalidateQueries");
  });
});
