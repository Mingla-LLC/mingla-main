import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1333 [partner-pages re-skin] — TESTER ADVERSARIAL regression.
 *
 * Different angle from the implementor's happy-path suite
 * (`orch1333PartnerReskin.test.ts`, which checks the 4 NAMED in-scope files for
 * no `icon="x"` / no eyebrow / canvas.discover / Button). This suite:
 *
 *   1. Guards the WHOLE `mingla-business` app (every .tsx under app/ + src/),
 *      not just the 4 named files — asserting the filled-letterform social
 *      glyph `icon="x"` is used by ZERO close/cancel controls anywhere. A
 *      future or overlooked reintroduction in any other file would pass the
 *      implementor's 4-file test but fail this one.
 *   2. Locks the exact testIDs + accessibilityLabels of both partner close
 *      buttons (the re-skin moved them but MUST preserve them verbatim —
 *      downstream QA/e2e selectors depend on them), and asserts the canonical
 *      LEFT-close ChromeRow structure (close precedes the centered title; a
 *      balanced `headerRightSlot` spacer exists) rather than the old
 *      right-close "modal hero" header.
 *
 * fails-on-revert verified at 11a2c446a (revert the 4 files → `icon="x"`
 * reappears app-wide AND `headerRightSlot` disappears → tests 1 + 2 RED).
 */

const businessRoot = path.resolve(__dirname, "../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(businessRoot, rel), "utf8");

// Recursively collect every .tsx under the given roots (no external deps).
function collectTsx(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTsx(full, acc);
    else if (entry.name.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

describe("ORCH-1333 close-glyph — app-wide adversarial guard", () => {
  test('no file in mingla-business (app/ + src/) uses the filled letterform icon="x"', () => {
    const files = [
      ...collectTsx(path.join(businessRoot, "app")),
      ...collectTsx(path.join(businessRoot, "src")),
    ];
    // Sanity: the scan actually walked a real, populated tree.
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((f) =>
      fs.readFileSync(f, "utf8").includes('icon="x"'),
    );
    expect(offenders).toEqual([]);
  });

  test("both partner close buttons preserve exact testID + accessibilityLabel and left-close ChromeRow structure", () => {
    const brands = read("app/partner/brands.tsx");
    const earnings = read("app/partner/earnings.tsx");

    // Selectors QA/e2e depend on — must survive the re-skin verbatim.
    expect(brands).toContain('testID="partner-brands-close-button"');
    expect(brands).toContain('accessibilityLabel="Close partner brands"');
    expect(earnings).toContain('testID="partner-earnings-close-button"');
    expect(earnings).toContain('accessibilityLabel="Close partner earnings"');

    // Canonical left-close ChromeRow: close LEFT → centered title → a balanced
    // right element. #1062 B2 drift-to-truth: ORCH-1384 replaced brands.tsx's
    // empty `headerRightSlot` spacer with a functional add-brand CTA (rendered
    // in ALL list states, cited inline in brands.tsx); earnings.tsx keeps the
    // empty spacer. The balanced ChromeRow structure is preserved on both.
    expect(brands).toContain('testID="partner-brands-add-button"');
    expect(earnings).toContain("headerRightSlot");

    // Close control renders BEFORE the centered title column (left position).
    expect(brands.indexOf('testID="partner-brands-close-button"')).toBeLessThan(
      brands.indexOf("styles.headerMid"),
    );
    expect(
      earnings.indexOf('testID="partner-earnings-close-button"'),
    ).toBeLessThan(earnings.indexOf("styles.headerMid"));
  });
});
