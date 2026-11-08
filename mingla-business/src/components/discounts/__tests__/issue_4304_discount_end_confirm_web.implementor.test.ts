// #4304 — the Host web "End" discount button did nothing.
//
// Live on host.usemingla.com (2026-11-08): DiscountListView confirmed End with
// Alert.alert(title, message, buttons). react-native-web's Alert.alert is a
// no-op, so no dialog showed and the discount never ended. End now opens the
// web-capable ConfirmDialog, lazy-loaded so it stays off the boot bundle.
//
// fails-on-revert: restore the Alert.alert confirm (or a static ConfirmDialog
// import, or drop the mutate on confirm) and a test below goes red.
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const SOURCE = readFileSync(join(__dirname, "..", "DiscountListView.tsx"), "utf8");
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("#4304 End discount confirms on web", () => {
  test("never confirms with Alert.alert, which is a no-op on web", () => {
    expect(code).not.toMatch(/\bAlert\.alert\s*\(/);
    expect(code).not.toMatch(/import\s*\{[^}]*\bAlert\b[^}]*\}\s*from\s*"react-native"/);
  });

  test("End opens a lazy ConfirmDialog with the same words", () => {
    expect(code).toMatch(
      /React\.lazy\(\(\)\s*=>\s*import\("\.\.\/ui\/ConfirmDialog"\)/,
    );
    expect(code).not.toMatch(/import\s*\{[^}]*ConfirmDialog[^}]*\}\s*from\s*"\.\.\/ui\/ConfirmDialog"/);
    expect(code).toMatch(/if \(op === "end"\) setEndTarget\(row\);/);
    for (const words of [
      'title="End this discount?"',
      'description="Buyers will stop receiving it. Existing orders keep their discount."',
      'cancelLabel="Keep live"',
      'confirmLabel="End discount"',
    ]) {
      expect(code).toContain(words);
    }
  });

  test("confirming ends that discount; cancelling closes without a write", () => {
    expect(code).toMatch(/onConfirm=\{confirmEnd\}/);
    expect(code).toMatch(
      /const confirmEnd = \(\): void => \{\s*const row = endTarget;\s*setEndTarget\(null\);\s*if \(row\) action\.mutate\(\{ row, op: "end" \}\);/,
    );
    expect(code).toMatch(/onClose=\{\(\) => setEndTarget\(null\)\}/);
  });

  test("pause, resume and delete_draft still write straight away", () => {
    expect(code).toMatch(/else action\.mutate\(\{ row, op \}\);/);
  });

  test("the edit sheet's Discard changes confirm also works on web", () => {
    const sheet = readFileSync(join(__dirname, "..", "DiscountEditSheet.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(sheet).not.toMatch(/\bAlert\.alert\s*\(/);
    expect(sheet).toMatch(/React\.lazy\(\(\)\s*=>\s*import\("\.\.\/ui\/ConfirmDialog"\)/);
    expect(sheet).toContain('title="Discard changes?"');
    expect(sheet).toContain('cancelLabel="Keep editing"');
    expect(sheet).toMatch(/setConfirmDiscard\(false\);\s*onClose\(\);/);
  });
});
