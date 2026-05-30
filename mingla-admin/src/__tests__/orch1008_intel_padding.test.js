// ORCH-1008 Phase 2 regression test — Place Intelligence Trial page wrapper
// matches peer pages (no max-w / mx-auto / px-* at the root return).
// Fails on revert (verified at commit hash recorded in implementation report).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

const PAGE = path.join(ADMIN_ROOT, "src", "pages", "PlaceIntelligenceTrialPage.jsx");

// The canonical peer-page root wrapper (from SignalLibraryPage convention)
const CANONICAL_ROOT = '<div className="py-6 flex flex-col gap-6">';
const FORBIDDEN_AT_ROOT = [
  "max-w-[var(--content-max-width)]",
  "mx-auto",
  "px-6",
];

describe("ORCH-1008 Phase 2 — Place Intelligence Trial root wrapper parity", () => {
  it("renders the canonical peer-page root wrapper", () => {
    const src = fs.readFileSync(PAGE, "utf8");
    assert.ok(
      src.includes(CANONICAL_ROOT),
      `expected ${PAGE} to contain root wrapper ${CANONICAL_ROOT}`,
    );
  });

  it("does NOT contain max-w / mx-auto / px-6 at the root return statement", () => {
    const src = fs.readFileSync(PAGE, "utf8");
    // Find the `return (` opener then scan forward up to the next `<div ...>`
    // — that div is the page root.
    const returnIdx = src.indexOf("return (");
    assert.notEqual(returnIdx, -1, "expected to find a return ( in the page file");
    const slice = src.slice(returnIdx, returnIdx + 400);
    const rootDivMatch = slice.match(/<div className="([^"]+)"/);
    assert.ok(rootDivMatch, "expected a root <div className=...> after return (");
    const rootClasses = rootDivMatch[1];
    for (const forbidden of FORBIDDEN_AT_ROOT) {
      assert.equal(
        rootClasses.includes(forbidden),
        false,
        `root wrapper must not include '${forbidden}' (AppShell already provides it); saw classes: ${rootClasses}`,
      );
    }
  });
});
