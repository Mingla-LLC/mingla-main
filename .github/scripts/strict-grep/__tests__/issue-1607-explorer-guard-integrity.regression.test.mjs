import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkExplorerGuardIntegrity,
  DECK_GUARD_CATALOG,
} from "../issue-1607-explorer-guard-integrity.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const workflows = Object.fromEntries(fs.readdirSync(path.join(ROOT, ".github/workflows"))
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => [name, fs.readFileSync(path.join(ROOT, ".github/workflows", name), "utf8")]));
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, ".github/ci-batch/MANIFEST.json"), "utf8"));
for (const suite of registry.suites.filter((item) => item.lifecycle === "batched-historical")) {
  workflows[`ci-batch:${suite.id}`] = suite.steps.map((step) => `run: |\n  ${step.run.replaceAll("\n", "\n  ")}`).join("\n");
}
const diskFiles = fs.readdirSync(path.join(ROOT, "app-mobile/src/components/swipeDeck/__tests__"))
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => `app-mobile/src/components/swipeDeck/__tests__/${name}`);
const releaseHotpathSource = fs.readFileSync(path.join(ROOT, "app-mobile/src/components/swipeDeck/__tests__/issue_1481_release_hotpath.test.mjs"), "utf8");
const baseline = { diskFiles, workflows, releaseHotpathSource };

test("#1607 real deck inventory and executable workflow wiring are complete", () => {
  assert.equal(DECK_GUARD_CATALOG.length, 26);
  assert.deepEqual(checkExplorerGuardIntegrity(baseline), []);
});

test("#1607 true wiring revert orphans a real guard and turns the checker red", () => {
  const victim = "app-mobile/src/components/swipeDeck/__tests__/issue_1701_dark_card_edges.test.mjs";
  const reverted = {
    ...baseline,
    workflows: {
      ...workflows,
      "ci-batch:issue-1609-card-identity": workflows["ci-batch:issue-1609-card-identity"].split(victim).join(""),
    },
  };
  assert.ok(checkExplorerGuardIntegrity(reverted).some((failure) => failure.includes(victim)));
});

test("#1607 true structural-anchor revert turns the checker red", () => {
  const reverted = {
    ...baseline,
    releaseHotpathSource: releaseHotpathSource.replace(
      "const currentStartToken = '<GestureDetector key={currentRec.id} gesture={deckSwipe.gesture}>';",
      "const currentStartToken = '{/* Current Card */}';",
    ),
  };
  assert.ok(checkExplorerGuardIntegrity(reverted).some((failure) => failure.includes("structural current-card")));
});
