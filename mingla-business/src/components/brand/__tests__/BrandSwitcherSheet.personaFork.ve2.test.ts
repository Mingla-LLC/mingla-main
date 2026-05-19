/**
 * Ve2 (#100) — pool match search on brand sheet persona entry.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const sheetSource = readFileSync(
  join(__dirname, "..", "BrandSwitcherSheet.tsx"),
  "utf-8",
);

describe("BrandSwitcherSheet Ve2 pool match", () => {
  test("persona mode includes debounced pool search UI", () => {
    expect(sheetSource).toContain("usePoolMatchSearch");
    expect(sheetSource).toContain("PoolMatchCard");
    expect(sheetSource).toContain("venue-name-search-input");
  });
});
