import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// #3872 walkthrough: every Creator and Local screen hides the native header, so
// each one must render the shared ProgramHeader or people are stranded with no
// way back (the edge swipe does nothing when the screen opened from a link).
const root = path.resolve(import.meta.dirname, "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const SCREENS = [
  "app/creator/index.tsx",
  "app/creator/setup.tsx",
  "app/creator/showcase.tsx",
  "app/creator/gig/[gigId].tsx",
  "app/creator/contract/[contractId].tsx",
  "app/local/index.tsx",
];

test("#3872 every hidden-header program screen renders a back header in each return", () => {
  for (const file of SCREENS) {
    const source = read(file);
    const hidden = (source.match(/headerShown:\s*false/g) ?? []).length;
    const headers = (source.match(/<ProgramHeader\b/g) ?? []).length;
    assert.ok(hidden > 0, `${file} no longer hides the native header; update this test`);
    assert.equal(headers, hidden, `${file}: ${hidden} hidden headers but ${headers} ProgramHeader`);
  }
});

test("#3872 ProgramHeader falls back when there is no history", () => {
  const ui = read("src/components/programs/ProgramUi.tsx");
  assert.match(ui, /router\.canGoBack\(\)/);
  assert.match(ui, /router\.replace\(/);
  assert.match(ui, /accessibilityLabel="Back"/);
});

test("#3872 public Creator and Local cards use the Mingla dark palette", () => {
  for (const file of [
    "src/components/profile/PublicCreatorSection.tsx",
    "src/components/profile/PublicLocalSection.tsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /#faf7ff|#7c3aed|#6d28d9|#5b21b6|#fffaf5|#c2410c/i, `${file} reintroduced the off-brand light palette`);
    assert.match(source, /#eb7825/i);
  }
});
