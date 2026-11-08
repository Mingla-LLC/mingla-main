// MINGLA-INVARIANT: I-1023-ONLY-CHOSEN-FONT-DOWNLOADS | issue #1023 | The Google Fonts catalogue is never in the eager web chunk: only the Theme sheet's Font tab loads it, through a dynamic import().
/**
 * issue #1023 wave 2 — P-7. Runs the real strict-grep gate
 * (.github/scripts/strict-grep/i-1047-biz-bundle-budget-deferral.mjs, rule 3)
 * against this checkout, and pins the Font tab's dynamic import directly.
 *
 * Fails on revert: a static `import ... from ".../googleFontsCatalog.json"`
 * anywhere in the app or packages sources, or the Font tab dropping its
 * dynamic import().
 */
import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { promisify } from "util";
import path from "path";
import { describe, expect, test } from "@jest/globals";

const REPO = path.resolve(__dirname, "../../../../..");
const GATE = ".github/scripts/strict-grep/i-1047-biz-bundle-budget-deferral.mjs";

describe("the font catalogue stays lazy", () => {
  test("the bundle-deferral gate passes, including rule 3", async () => {
    const { stdout: out } = await promisify(execFile)(process.execPath, [path.join(REPO, GATE)], {
      cwd: REPO,
      encoding: "utf8",
    });
    expect(out).toContain("the font catalogue loads only by dynamic import");
  });

  test("the Font tab loads the catalogue with import(), and nothing imports it statically", async () => {
    const tab = await readFile(
      path.join(REPO, "mingla-business/src/components/theme/ThemeFontTab.tsx"),
      "utf8",
    );
    expect(tab).toMatch(/await import\(\s*"\.\.\/\.\.\/\.\.\/\.\.\/packages\/offering-rendering\/fonts\/googleFontsCatalog\.json"\s*\)/);
    expect(tab).not.toMatch(/^import[^;]*googleFontsCatalog/m);
    const sheet = await readFile(
      path.join(REPO, "mingla-business/src/components/theme/ThemeSheet.tsx"),
      "utf8",
    );
    expect(sheet).not.toContain("googleFontsCatalog");
  });
});

// issue #1023 merge prep — the motion helpers stay out of the boot chunk: the
// eager web shim, the barrel and the Theme sheet read the dev override and the
// Reduce Motion frame from ./themeMotionDevOverride, never the full
// ./themeMotion (text-safe zones, pause store), which only the lazy players use.
describe("the motion helpers stay lazy", () => {
  test("eager modules import only themeMotionDevOverride (types excepted)", async () => {
    const repo = path.resolve(__dirname, "../../../../..");
    for (const rel of [
      "packages/offering-rendering/ThemeEntranceAnimation.web.tsx",
      "packages/offering-rendering/index.ts",
      "packages/offering-rendering/ParallaxCoverShell.tsx",
      "packages/offering-rendering/PublicEventPage.tsx",
      "mingla-business/src/components/theme/ThemeSheet.tsx",
    ]) {
      const src = await readFile(path.join(repo, rel), "utf8");
      const valueImports = src
        .split("\n")
        .filter((l) => /from "(?:\.\/|.*offering-rendering\/)themeMotion"/.test(l))
        .filter((l) => !/^\s*(?:import|export) type\b|\{\s*type\s[^,}]*\}/.test(l));
      expect({ rel, valueImports }).toEqual({ rel, valueImports: [] });
    }
    const split = await readFile(
      path.join(repo, "packages/offering-rendering/themeMotionDevOverride.ts"),
      "utf8",
    );
    expect(split).toContain("export function setThemeMotionDevOverride(");
    expect(split).toContain("export const REDUCED_MOTION_PROGRESS");
  });
});
