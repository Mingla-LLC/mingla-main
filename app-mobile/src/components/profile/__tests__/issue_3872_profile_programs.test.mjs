import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// #3872 walkthrough W1 — Profile › Creator programs opens with the creator's
// status and how hosts see them; non-creators get the Earn with Mingla sheet.
// Fails before the build: the section said "New creator" and offered two plain
// rows with no status and no explanation.
const root = path.resolve(import.meta.dirname, "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("#3872 W1.1 creators see their status line and how hosts see them", () => {
  const section = read("src/components/profile/CreatorProgramsSection.tsx");
  assert.match(section, /You’re a Mingla Creator/);
  assert.match(section, /Hosts see you as \$\{seenAs\}/);
  assert.match(section, /localRowCopy\(local\)/);
  assert.doesNotMatch(section, /New creator/);
  assert.doesNotMatch(section, /monthly_usd_minor \/ 100/);
});

test("#3872 W1 non-creators get one Earn with Mingla sheet with the three ways to earn", () => {
  const section = read("src/components/profile/CreatorProgramsSection.tsx");
  const sheet = read("src/components/profile/EarnWithMinglaSheet.tsx");
  assert.match(section, /label="Earn with Mingla"/);
  assert.match(section, /<EarnWithMinglaSheet/);
  assert.match(sheet, /Make videos for hosts/);
  assert.match(sheet, /Become a Mingla Local/);
  assert.match(sheet, /Bring friends/);
});

test("#3872 the public Creator card shows no New creator text and hides until verified", () => {
  const card = read("src/components/profile/PublicCreatorSection.tsx");
  assert.doesNotMatch(card, /New creator/);
  assert.match(card, /if \(!creator \|\| !creator\.id\) return null/);
  assert.match(card, /showcase\.slice\(0, 2\)/);
  assert.match(card, /Promoting now/);
});
