/**
 * Issue #1735 rework P1-3 — no source file may contain a raw NUL byte.
 *
 * A single 0x00 in `SiteCheckInstrument.tsx` made git classify the whole
 * 20KB component as BINARY: the PR diff showed "Binary file not shown",
 * grep-class tooling skipped it, and a product file became unreviewable in a
 * public-repo, PR-gated flow. This structural sweep fails on ANY NUL in any
 * `src/**` TypeScript source, with a vacuity floor so an empty walk can never
 * pass.
 */

import fs from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "..");
/** src/ holds ~2000 TS files at authoring time; far fewer = broken walk. */
const MIN_FILES_SWEPT = 500;

const collectSourceFiles = (dir: string, out: string[]): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(abs, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) out.push(abs);
  }
};

describe("issue #1735 rework — src/**/*.ts(x) carries no NUL bytes", () => {
  it("every source file diffs as TEXT (zero 0x00 bytes)", () => {
    const files: string[] = [];
    collectSourceFiles(SRC_ROOT, files);
    // Vacuity floor — a sweep that walked nothing proves nothing.
    expect(files.length).toBeGreaterThanOrEqual(MIN_FILES_SWEPT);
    const offenders: string[] = [];
    for (const file of files) {
      if (fs.readFileSync(file).includes(0)) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
