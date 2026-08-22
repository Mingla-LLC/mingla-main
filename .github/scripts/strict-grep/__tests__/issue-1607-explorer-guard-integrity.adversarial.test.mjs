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
const DECK_DIR = "app-mobile/src/components/swipeDeck/__tests__";
const VICTIM = `${DECK_DIR}/issue_1701_dark_card_edges.test.mjs`;
const workflows = Object.fromEntries(fs.readdirSync(path.join(ROOT, ".github/workflows"))
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => [name, fs.readFileSync(path.join(ROOT, ".github/workflows", name), "utf8")]));
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, ".github/ci-batch/MANIFEST.json"), "utf8"));
for (const suite of registry.suites.filter((item) => item.lifecycle === "batched-historical")) {
  workflows[`ci-batch:${suite.id}`] = suite.steps.map((step) => `run: |\n  ${step.run.replaceAll("\n", "\n  ")}`).join("\n");
}
const baseline = {
  diskFiles: fs.readdirSync(path.join(ROOT, DECK_DIR))
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => `${DECK_DIR}/${name}`),
  workflows,
  releaseHotpathSource: fs.readFileSync(path.join(ROOT, DECK_DIR, "issue_1481_release_hotpath.test.mjs"), "utf8"),
};

function withoutVictimReferences(source) {
  return source.replaceAll(VICTIM, `${DECK_DIR}/unrelated.test.mjs`);
}

test("#1607 YAML prose cannot impersonate executable wiring, including quoted-hash shell text", () => {
  const deceptiveWorkflow = `${withoutVictimReferences(workflows["ci-batch:issue-1609-card-identity"])}
      - name: prose is not protection
        run: |
          echo "# ${VICTIM} is discussed here" # a quoted hash is shell data
          # test -f ${VICTIM}
          # node --test ${VICTIM}
`;
  const failures = checkExplorerGuardIntegrity({
    ...baseline,
    workflows: { ...workflows, "ci-batch:issue-1609-card-identity": deceptiveWorkflow },
  });
  assert.ok(failures.includes(`wiring: ${VICTIM} lacks executable test -f`));
  assert.ok(failures.includes(`wiring: ${VICTIM} is not passed to node --test`));
});

test("#1607 a quoted hash does not hide later real shell commands in the same run block", () => {
  const executableWorkflow = `${withoutVictimReferences(workflows["ci-batch:issue-1609-card-identity"])}
      - name: real commands survive quoted hash text
        run: |
          echo "# this hash is quoted data" # this suffix is a shell comment
          test -f ${VICTIM}
          node --test ${VICTIM}
`;
  assert.deepEqual(checkExplorerGuardIntegrity({
    ...baseline,
    workflows: { ...workflows, "ci-batch:issue-1609-card-identity": executableWorkflow },
  }), []);
});

test("#1607 existence-only wiring remains red until the guard reaches node --test", () => {
  const existenceOnly = workflows["ci-batch:issue-1609-card-identity"]
    .split("\n")
    .map((line) => line.includes("node --test") ? line.replaceAll(VICTIM, `${DECK_DIR}/unrelated.test.mjs`) : line)
    .join("\n");
  const failures = checkExplorerGuardIntegrity({
    ...baseline,
    workflows: { ...workflows, "ci-batch:issue-1609-card-identity": existenceOnly },
  });
  assert.ok(!failures.some((failure) => failure === `wiring: ${VICTIM} lacks executable test -f`));
  assert.ok(failures.includes(`wiring: ${VICTIM} is not passed to node --test`));
});

test("#1607 duplicate catalog rows cannot masquerade as a complete disk inventory", () => {
  const duplicateCatalog = [...DECK_GUARD_CATALOG, { ...DECK_GUARD_CATALOG[0] }];
  const failures = checkExplorerGuardIntegrity({ ...baseline, catalog: duplicateCatalog });
  assert.ok(failures.includes("catalog: duplicate file entry"));
  assert.ok(failures.includes("inventory: disk/catalog mismatch"));
});

test("#1607 #1481 require/run parity rejects one-sided ninth-guard drift", () => {
  const ninth = `${DECK_DIR}/issue_1481_ninth.test.mjs`;
  const requireOnlyDrift = `${workflows["ci-batch:issue-1481-explorer-deck-tests"]}
run: |
  test -f ${ninth}
`;
  const failures = checkExplorerGuardIntegrity({
    ...baseline,
    workflows: { ...workflows, "ci-batch:issue-1481-explorer-deck-tests": requireOnlyDrift },
  });
  assert.ok(failures.includes("#1481 exact-eight require set drifted"));
  assert.ok(!failures.includes("#1481 exact-eight run set drifted"));
});
