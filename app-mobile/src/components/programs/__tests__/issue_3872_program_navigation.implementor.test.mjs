import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// #3872 walkthrough: every Creator and Local screen hides the native header, so
// each one must render the shared back header or people are stranded with no
// way back (the edge swipe does nothing when the screen opened from a link).
// Walkthrough build: screens render through ProgramScreen, which owns both the
// hidden native header and ProgramHeader; working screens carry no hero.
const root = path.resolve(import.meta.dirname, "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const SCREENS = [
  "app/creator/index.tsx",
  "app/creator/status.tsx",
  "app/creator/setup/index.tsx",
  "app/creator/setup/profile.tsx",
  "app/creator/setup/socials.tsx",
  "app/creator/setup/rates.tsx",
  "app/creator/setup/showcase.tsx",
  "app/creator/setup/payout.tsx",
  "app/creator/setup/agreement.tsx",
  "app/creator/gig/[gigId].tsx",
  "app/creator/contract/[contractId].tsx",
  "app/local/index.tsx",
  "app/local/review.tsx",
  "app/payout.tsx",
  "src/components/wallet/EarningsWalletScreen.tsx",
];

test("#3872 every program screen renders through ProgramScreen (back header in every return)", () => {
  for (const file of SCREENS) {
    const source = read(file);
    assert.match(source, /<ProgramScreen\b/, `${file} does not use ProgramScreen`);
    assert.doesNotMatch(source, /headerShown:\s*false/, `${file} hides the header itself; use ProgramScreen`);
    assert.doesNotMatch(source, /<SafeAreaView\b/, `${file} renders its own screen shell`);
  }
});

test("#3872 ProgramScreen hides the native header and always renders ProgramHeader", () => {
  const ui = read("src/components/programs/ProgramUi.tsx");
  const screen = ui.slice(ui.indexOf("export function ProgramScreen"), ui.indexOf("// ── Cards"));
  assert.match(screen, /headerShown:\s*false/);
  assert.match(screen, /<ProgramHeader\b/);
});

test("#3872 ProgramHeader falls back when there is no history", () => {
  const ui = read("src/components/programs/ProgramUi.tsx");
  assert.match(ui, /router\.canGoBack\(\)/);
  assert.match(ui, /router\.replace\(/);
  assert.match(ui, /accessibilityLabel="Back"/);
});

test("#3872 ProgramUi is built on the app's own glass components", () => {
  const ui = read("src/components/programs/ProgramUi.tsx");
  for (const piece of ["GlassCard", "GlassIconButton", "Icon", "BaseBottomSheet"]) {
    assert.match(ui, new RegExp(`import \\{[^}]*\\b${piece}\\b`), `ProgramUi no longer uses ${piece}`);
  }
});

test("#3872 working screens carry no marketing hero and no raw values", () => {
  for (const file of SCREENS) {
    const source = read(file);
    assert.doesNotMatch(source, /s\.eyebrow|s\.heading|s\.lede/, `${file} reintroduced the marketing hero`);
    assert.doesNotMatch(source, /replaceAll\('_'/, `${file} prints a raw key with underscores swapped out`);
    assert.doesNotMatch(source, /toUpperCase\(\)\}<\/Text>|budget_band\.toUpperCase/, `${file} shows a raw code`);
    assert.doesNotMatch(source, /minor units|YYYY-MM-DD|Stripe|Paystack|Seth/, `${file} shows raw or internal copy`);
  }
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
