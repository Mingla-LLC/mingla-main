/**
 * MINGLA-INVARIANT: I-1023-ONLY-CHOSEN-FONT-DOWNLOADS | issue #1023 | The Google Fonts catalogue is never in the eager web chunk: only the Theme sheet's Font tab loads it, through a dynamic import().
 *
 * issue #1023 wave 2 — P-7. Runs the real strict-grep gate
 * (.github/scripts/strict-grep/i-1047-biz-bundle-budget-deferral.mjs, rule 3)
 * against this checkout, and pins the Font tab's dynamic import directly.
 *
 * Fails on revert: a static `import ... from ".../googleFontsCatalog.json"`
 * anywhere in the app or packages sources, or the Font tab dropping its
 * dynamic import().
 */
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

const REPO = path.resolve(__dirname, "../../../../..");
const GATE = ".github/scripts/strict-grep/i-1047-biz-bundle-budget-deferral.mjs";

describe("the font catalogue stays lazy", () => {
  test("the bundle-deferral gate passes, including rule 3", () => {
    const out = execFileSync(process.execPath, [path.join(REPO, GATE)], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(out).toContain("the font catalogue loads only by dynamic import");
  });

  test("the Font tab loads the catalogue with import(), and nothing imports it statically", () => {
    const tab = readFileSync(
      path.join(REPO, "mingla-business/src/components/theme/ThemeFontTab.tsx"),
      "utf8",
    );
    expect(tab).toMatch(/await import\(\s*"\.\.\/\.\.\/\.\.\/\.\.\/packages\/offering-rendering\/fonts\/googleFontsCatalog\.json"\s*\)/);
    expect(tab).not.toMatch(/^import[^;]*googleFontsCatalog/m);
    const sheet = readFileSync(
      path.join(REPO, "mingla-business/src/components/theme/ThemeSheet.tsx"),
      "utf8",
    );
    expect(sheet).not.toContain("googleFontsCatalog");
  });
});
