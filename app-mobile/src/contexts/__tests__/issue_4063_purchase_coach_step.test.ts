import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../..");
const repoRoot = resolve(appRoot, "..");
const steps = readFileSync(resolve(appRoot, "src/constants/coachMarkSteps.ts"), "utf8");
const profile = readFileSync(resolve(appRoot, "src/components/ProfilePage.tsx"), "utf8");
const context = readFileSync(resolve(appRoot, "src/contexts/CoachMarkContext.tsx"), "utf8");
const migration = readFileSync(
  resolve(repoRoot, "supabase/migrations/20271221004063_issue_4063_purchase_coach_step.sql"),
  "utf8",
);

test("Purchases is coach step 8 and every Profile target remains contiguous", () => {
  const arrayBody = steps.slice(steps.indexOf("export const COACH_STEPS"));
  const ids = [...arrayBody.matchAll(/\bid:\s*(\d+)\b/g)].map((match) => Number(match[1]));
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.match(arrayBody, /id:\s*8,[\s\S]*title:\s*'Your tickets are always here'/);
  assert.match(profile, /wireScrollStep\(8, purchasesRef\)/);
  for (const id of [8, 9, 10, 11, 12]) {
    assert.match(profile, new RegExp(`registerTargetScrollOffset\\(${id}\\b`));
  }
  assert.match(context, /SCROLL_STEPS\s*=\s*new Set\(\[8, 9, 10, 11, 12\]\)/);
});

test("saved coach progress is remapped once in data, never guessed at runtime", () => {
  for (const [from, to] of [[8, 9], [9, 10], [10, 11], [11, 12], [12, 13]]) {
    assert.match(migration, new RegExp(`WHEN ${from} THEN ${to}`));
  }
  assert.match(migration, /coach_mark_step BETWEEN 8 AND 12/);
  assert.match(migration, /coach_mark_step < -1 OR coach_mark_step > 12/);
  assert.doesNotMatch(context, /legacy[\s\S]{0,200}setCurrentStep/);
});
