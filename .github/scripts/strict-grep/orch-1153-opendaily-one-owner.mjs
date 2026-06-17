#!/usr/bin/env node
/**
 * ORCH-1153 WS2 — open-daily detection has ONE canonical (rule-based) owner
 * (I-PROPOSED-1153-OPENDAILY-ONE-OWNER).
 *
 * The buyer-web /exp/ page and the app-mobile consumer detail screen must BOTH
 * use the shared rule-based predicate isOpenDailyExperience
 * (@mingla/event-rendering). The consumer's prior occurrence-density heuristic
 * (utils/experienceOpenDaily isOpenDailyModel) classified the SAME experience
 * differently than the web page (F-5) and is no longer the detector.
 *
 * Fails if:
 *   (a) the consumer detail screen still CALLS isOpenDailyModel( (the heuristic),
 *   (b) the consumer detail screen does not import/use isOpenDailyExperience,
 *   (c) the /exp/ page does not use isOpenDailyExperience,
 *   (d) the shared export is missing from packages/event-rendering.
 *
 * Self-test (`--self-test`): FAILS on the reverted consumer (heuristic call),
 * PASSES on the fixed consumer (shared predicate).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const CONSUMER =
  "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx";
const EXP_PAGE = "mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx";
const SHARED = "packages/event-rendering/experienceOpenDaily.ts";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function checkConsumer(src, label) {
  const failures = [];
  const code = stripComments(src);
  if (/\bisOpenDailyModel\s*\(/.test(code)) {
    failures.push(
      `${label}: still CALLS isOpenDailyModel( — the retired density heuristic. ` +
        "Use the shared rule-based isOpenDailyExperience.",
    );
  }
  if (!/\bisOpenDailyExperience\s*\(/.test(code)) {
    failures.push(
      `${label}: does not call the shared isOpenDailyExperience — the canonical ` +
        "rule-based open-daily owner.",
    );
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const reverted = `const openDaily = useMemo(() => isOpenDailyModel(bookableOccurrences), [bookableOccurrences]);`;
  const fixed = `const openDaily = useMemo(() => isOpenDailyExperience({ isRecurring: seed?.isRecurring === true, recurrenceRule: seed?.recurrenceRule ?? null }), [seed]);`;
  if (checkConsumer(reverted, "rev").length === 0) {
    console.error("SELF-TEST FAIL: gate did not catch the heuristic call.");
    process.exit(1);
  }
  if (checkConsumer(fixed, "fix").length !== 0) {
    console.error("SELF-TEST FAIL: gate wrongly flagged the fixed consumer.");
    process.exit(1);
  }
  console.log("ORCH-1153 opendaily-one-owner gate self-test passed.");
  process.exit(0);
}

const failures = [];
for (const [rel, fn] of [[CONSUMER, checkConsumer]]) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    failures.push(`${rel}: missing.`);
    continue;
  }
  failures.push(...fn(readFileSync(path, "utf8"), rel));
}
// (c) the /exp/ page must use the shared predicate too.
const expPath = join(root, EXP_PAGE);
if (!existsSync(expPath)) {
  failures.push(`${EXP_PAGE}: missing.`);
} else if (!/\bisOpenDailyExperience\b/.test(stripComments(readFileSync(expPath, "utf8")))) {
  failures.push(`${EXP_PAGE}: does not use the shared isOpenDailyExperience.`);
}
// (d) the shared export must exist.
const sharedPath = join(root, SHARED);
if (!existsSync(sharedPath)) {
  failures.push(`${SHARED}: the shared rule-based detector is missing.`);
} else if (!/export const isOpenDailyExperience/.test(readFileSync(sharedPath, "utf8"))) {
  failures.push(`${SHARED}: does not export isOpenDailyExperience.`);
}

if (failures.length > 0) {
  console.error("ORCH-1153 opendaily-one-owner gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("ORCH-1153 opendaily-one-owner gate passed.");
