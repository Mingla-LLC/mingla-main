import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BASE = "5e24d9dfed3559471b701a949cc3e2c76b6f5949";
const PRE_AMENDMENT_6_TESTER_SHA256 = "d54eb1655eb4bc7ddd157785743954a1cbdbac6f6ae938c07a111f7256ae08a0";
const MARKER = "# #2437 SHADOW-PARITY-TRIGGER — remove before cutover";
const MANIFEST_PATH = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
const BATCH_PATH = path.join(ROOT, ".github/workflows/ci-batch.yml");
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fileDigest = (relative) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relative))).digest("hex");
const manifest = () => JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

const VARIANTS = {
  "issue-1009-campaign-builder-retry-tests": ["issue-1009-campaign-builder-retry-tests.yml", "admin-node20-install", 600],
  "issue-1322-admin-sentry-tests": ["issue-1322-admin-sentry-tests.yml", "admin-node20-install", 600],
  "issue-1481-explorer-deck-tests": ["issue-1481-explorer-deck-tests.yml", "node22-noinstall", 300],
  "issue-1509-boot-budget-tests": ["issue-1509-boot-budget-tests.yml", "node20-noinstall", 900],
  "issue-1516-coach-mark-tests": ["issue-1516-coach-mark-tests.yml", "app-node22-install", 900],
  "issue-1576-deck-promoted-card": ["issue-1576-deck-promoted-card.yml", "node22-noinstall", 300],
  "issue-1579-deck-tap-expand": ["issue-1579-deck-tap-expand.yml", "node22-noinstall", 300],
  "issue-1593-deck-layer-geometry": ["issue-1593-deck-layer-geometry.yml", "node22-noinstall", 300],
  "issue-1605-expanded-card": ["issue-1605-expanded-card.yml", "node22-noinstall", 360],
  "issue-1609-card-identity": ["issue-1609-card-identity.yml", "node22-noinstall", 300],
  "issue-1615-public-share-surfaces": ["issue-1615-public-share-surfaces.yml", "cross-root-node22-ignore-scripts", 300],
  "issue-1636-likes-load-tests": ["issue-1636-likes-load-tests.yml", "node22-noinstall", 300],
  "issue-1638-tab-switch-quickwins-tests": ["issue-1638-tab-switch-quickwins-tests.yml", "app-node22-install", 900],
  "issue-1638-tab-switch-scheduling-tests": ["issue-1638-tab-switch-scheduling-tests.yml", "node22-noinstall", 900],
  "issue-1639-profile-cards-tests": ["issue-1639-profile-cards-tests.yml", "app-node22-install", 900],
  "issue-1642-been-here-offline-bound": ["issue-1642-been-here-offline-bound.yml", "app-node22-install", 1500],
  "issue-1661-completed-write-unparks-invalidation": ["issue-1661-completed-write-unparks-invalidation.yml", "app-node22-install", 900],
  "issue-1687-been-here-rating-prompt": ["issue-1687-been-here-rating-prompt.yml", "app-node22-install", 1200],
  "issue-1860-rls-coverage-tests": ["issue-1860-rls-coverage-tests.yml", "node20-noinstall", 600],
  "issue-1880-expanded-share-handoff": ["issue-1880-expanded-share-handoff.yml", "node22-noinstall", 240],
  "issue-1960-share-art-isolation": ["issue-1960-share-art-isolation.yml", "node22-noinstall", 900],
  "issue-1962-unlisted-share-previews": ["issue-1962-unlisted-share-previews.yml", "business-node22-ignore-scripts", 300],
  "issue-1968-public-web-canonical-sharing": ["issue-1968-public-web-canonical-sharing.yml", "business-node22-ignore-scripts", 300],
  "issue-2004-share-click-canonical-destination": ["issue-2004-share-click-canonical-destination.yml", "business-node22-ignore-scripts", 300],
  "issue-2058-bundle-baseline-handoff-tests": ["issue-2058-bundle-baseline-handoff-tests.yml", "node20-noinstall", 900],
  "issue-2084-credential-output-safety": ["issue-2084-credential-output-safety.yml", "node20-noinstall", 900],
  "issue-2207-manifest-merge-awareness": ["issue-2207-manifest-merge-awareness.yml", "root-node20-yaml-no-save", 600],
  "issue-2300-orch-artifact-reap": ["issue-2300-orch-artifact-reap.yml", "node20-19-noinstall", 900],
  "issue-2393-tester-assertion-credential": ["issue-2393-tester-assertion-credential.yml", "node20-noinstall", 300],
  "issue-994-ota-env-resolution-app-mobile": ["issue-994-ota-env-resolution.yml", "ota-app-node20-19-install", 1200],
  "issue-994-ota-env-resolution-mingla-business": ["issue-994-ota-env-resolution.yml", "ota-business-node20-19-install", 1200],
  "orch-1386-tester-adversarial": ["orch-1386-tester-adversarial.yml", "node20-noinstall", 900],
};

const ORIGINS = [...new Set(Object.values(VARIANTS).map(([name]) => name))].sort();
const UNBOUNDED = [
  "issue-1509-boot-budget-tests.yml", "issue-1960-share-art-isolation.yml",
  "issue-2058-bundle-baseline-handoff-tests.yml", "issue-2084-credential-output-safety.yml",
  "issue-2300-orch-artifact-reap.yml", "orch-1386-tester-adversarial.yml",
].sort();
const REFERENCES = [
  ".github/scripts/__tests__/issue-2207-merged-checkout-workflow.tester.test.mjs",
  ".github/scripts/strict-grep/MANIFEST.json",
  ".github/scripts/strict-grep/__tests__/issue-1607-explorer-guard-integrity.adversarial.test.mjs",
  ".github/scripts/strict-grep/__tests__/issue-1607-explorer-guard-integrity.regression.test.mjs",
  ".github/scripts/strict-grep/issue-1607-explorer-guard-integrity.mjs",
  ".github/scripts/strict-grep/issue-1860-public-tables-rls-enabled.mjs",
  ".github/scripts/strict-grep/issue-2084-credential-output-safety.mjs",
  "app-mobile/src/components/__tests__/issue-1638-tab-switch-quickwins.test.mjs",
  "app-mobile/src/components/deckHeroConstants.ts",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1481_performance_hotpath.test.mjs",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1481_swipe_lifecycle.test.mjs",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1576_promoted_card_opacity.adversarial.test.mjs",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1576_promoted_card_opacity.test.mjs",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1579_tap_expand_admission.adversarial.test.mjs",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1579_tap_expand_admission.test.mjs",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.adversarial.test.mjs",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.test.mjs",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1609_direction_c_plate.test.mjs",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1609_plate_anchor_wiring.test.mjs",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1609_short_plate_keeps_chevron.test.mjs",
  "app-mobile/src/components/swipeDeck/__tests__/issue_1609_silhouette_anchor_drift.adversarial.test.mjs",
  "app-mobile/src/hooks/__tests__/issue_1642_been_here_offline_write_bound.test.mjs",
  "app-mobile/src/hooks/__tests__/issue_1661_completed_write_unparks_invalidation.test.mjs",
  "app-mobile/src/hooks/__tests__/issue_1661_parked_invalidation_fanout.adversarial.test.mjs",
  "mingla-business/scripts/ci/__tests__/issue2058_bundle_baseline_handoff.happy.test.mjs",
  "packages/card-identity/__tests__/card_identity_isolation.test.mjs",
  "packages/card-identity/__tests__/card_identity_single_source.test.mjs",
  "scripts/ci/__tests__/issue-2062-expo-config-node20.tester.adversarial.test.mjs",
  "scripts/ci/issue-2062-expo-config-node20.mjs",
  "scripts/issue-1615/curated-composition-terminal-ui.implementor.happy.test.mjs",
  "scripts/issue-1615/curated-composition-terminal-ui.tester.adversarial.test.mjs",
  "scripts/issue-1860/issue-1860-public-tables-rls.tester.adversarial.test.mjs",
  "scripts/issue-1880/expanded-share-handoff.tester.adversarial.test.mjs",
];

const RUBY = String.raw`
require "yaml"; require "json"
root=ARGV.fetch(0); names=JSON.parse(STDIN.read); out={}
names.each do |name|
  doc=YAML.safe_load(File.binread(File.join(root,".github/workflows",name)),aliases:true)||{}
  jobs=doc["jobs"]||{}; raise "#{name}: expected one job" unless jobs.length==1
  job=jobs.values.first; defaults=job.dig("defaults","run","working-directory")||"."
  runs=Array(job["steps"]).each_with_object([]) do |step, rows|
    next unless step.is_a?(Hash) && step["run"].is_a?(String)
    rows << {"run"=>step["run"],"cwd"=>step["working-directory"]||defaults}
  end
  setup=Array(job["steps"]).each_with_object([]) do |step, rows|
    next unless step.is_a?(Hash) && step["uses"].to_s.start_with?("actions/setup-node@")
    rows << step.dig("with","node-version").to_s
  end
  out[name]={"runs"=>runs,"timeoutMinutes"=>job["timeout-minutes"],"nodeVersions"=>setup}
end
STDOUT.write(JSON.generate(out))`;

function inspectOrigins() {
  return JSON.parse(execFileSync("ruby", ["-e", RUBY, ROOT], { input: JSON.stringify(ORIGINS), encoding: "utf8" }));
}

const INSTALLS = new Set(["npm ci", "npm ci --ignore-scripts", "npm install --no-save yaml"]);
function assertionRuns(origin, variantId, inspections) {
  const matrixApp = variantId.endsWith("-app-mobile") ? "app-mobile"
    : variantId.endsWith("-mingla-business") ? "mingla-business" : null;
  return inspections[origin].runs.filter(({ run }) => !INSTALLS.has(run.trim())).map(({ run, cwd }) => ({
    run: matrixApp ? run.replaceAll("${{ matrix.app }}", matrixApp) : run,
    cwd: matrixApp ? cwd.replaceAll("${{ matrix.app }}", matrixApp) : cwd,
  }));
}

function assertReconstructed(value, inspections) {
  const shadow = value.suites.filter((suite) => suite.lifecycle === "shadow-active");
  assert.equal(value.legacyOrigins.length, 198);
  assert.equal(value.suites.length, 54);
  assert.equal(value.workflowProviders.length, 89);
  assert.equal(shadow.length, 32);
  assert.deepEqual(shadow.map((suite) => suite.id), Object.keys(VARIANTS));
  assert.deepEqual([...new Set(shadow.map((suite) => path.basename(suite.origin)))].sort(), ORIGINS);
  assert.equal(shadow.filter((suite) => path.basename(suite.origin) === "issue-994-ota-env-resolution.yml").length, 2);
  assert.equal(shadow.flatMap((suite) => suite.steps).length, 107);

  for (const suite of shadow) {
    const [origin, profile, timeout] = VARIANTS[suite.id];
    assert.equal(path.basename(suite.origin), origin, `${suite.id}: wrong origin`);
    assert.equal(suite.setupProfile, profile, `${suite.id}: wrong profile`);
    assert.equal(suite.class, profile, `${suite.id}: wrong matrix class`);
    assert.equal(suite.timeoutSeconds, timeout, `${suite.id}: wrong timeout`);
    assert.equal(suite.isolation, "clean-worktree");
    const reconstructed = assertionRuns(origin, suite.id, inspections);
    assert.deepEqual(suite.steps.map((step) => ({ run: step.invocation.argv[1], cwd: step.cwd })), reconstructed,
      `${suite.id}: assertion payload differs from live wrapper`);
    suite.steps.forEach((step, index) => {
      assert.deepEqual(step.invocation, { kind: "raw-shell", command: "bash", argv: ["-c", step.run] });
      const capability = value.commandCapabilities.commands.filter((item) => item.id === step.commandId);
      assert.equal(capability.length, 1, `${suite.id}:${index}: capability claim count`);
      assert.equal(capability[0].suiteId, suite.id);
      assert.equal(capability[0].stepIndex, index);
      assert.equal(capability[0].cwd, step.cwd);
      assert.equal(capability[0].executable, "bash");
      assert.deepEqual(capability[0].argv, ["-c", step.run]);
      assert.equal(capability[0].payloadSha256,
        digest({ cwd: step.cwd, executable: "bash", argv: ["-c", step.run] }));
    });
  }
  assert.equal(inspections["issue-994-ota-env-resolution.yml"].runs.filter(({ run }) => INSTALLS.has(run.trim())).length, 1);
  assert.equal(ORIGINS.reduce((sum, origin) => sum + inspections[origin].runs.length, 0), 118);
  assert.equal(ORIGINS.reduce((sum, origin) => sum + inspections[origin].runs.filter(({ run }) => INSTALLS.has(run.trim())).length, 0), 16);
  assert.equal(digest(value.commandCapabilities.commands.slice(0, 46)), "92540e31ef9fb7433f6f40a94071b27023786d15c644110e3a43a2929dbe2399");
  assert.equal(digest(value.commandCapabilities.commands.slice(46)), "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709");
}

function assertWrapperLifecycle(value, readSource, markedWorkflowNames) {
  const originsByName = new Map(value.legacyOrigins.map((origin) => [`${origin.stem}.${origin.extension}`, origin]));
  const expectedMarked = [];
  for (const name of ORIGINS) {
    const record = originsByName.get(name);
    assert.ok(record, `${name}: missing historical origin record`);
    const source = readSource(name);
    if (record.disposition === "shadow-active") {
      assert.equal(typeof source, "string", `${name}: shadow wrapper missing`);
      const exactMarkers = source.split("\n").filter((line) => line === MARKER);
      assert.equal(exactMarkers.length, 1, `${name}: shadow marker cardinality`);
      assert.equal(source.startsWith(`${MARKER}\n`), true, `${name}: marker is not the exact top-level line`);
      const withoutMarker = source.replace(`${MARKER}\n`, "");
      const base = execFileSync("git", ["show", `${BASE}:.github/workflows/${name}`], { cwd: ROOT, encoding: "utf8" });
      assert.equal(withoutMarker, base, `${name}: wrapper changed beyond the exact shadow marker`);
      expectedMarked.push(name);
    } else if (record.disposition === "batched-historical") {
      assert.equal(source, null, `${name}: terminal wrapper must be absent`);
    } else {
      assert.fail(`${name}: unsupported wave lifecycle ${record.disposition}`);
    }
  }
  assert.deepEqual([...markedWorkflowNames].sort(), expectedMarked.sort(), "shadow marker exists outside its exact lifecycle set");
}

test("31 live wrappers reconstruct exactly 32 variants and 107 reviewed assertion capabilities", () => {
  assertReconstructed(manifest(), inspectOrigins());
});

test("typed setup, runtime, timeout, dispatch, and trust boundaries are exact", () => {
  const value = manifest();
  const inspected = inspectOrigins();
  const expectedProfiles = {
    "admin-node20-install": ["20", [["mingla-admin", ["ci"]]]],
    "node22-noinstall": ["22", []],
    "app-node22-install": ["22", [["app-mobile", ["ci"]]]],
    "business-node22-ignore-scripts": ["22", [["mingla-business", ["ci", "--ignore-scripts"]]]],
    "cross-root-node22-ignore-scripts": ["22", [["mingla-business", ["ci", "--ignore-scripts"]], ["mingla-marketing", ["ci", "--ignore-scripts"]], ["app-mobile", ["ci", "--ignore-scripts"]]]],
    "root-node20-yaml-no-save": ["20", [[".", ["install", "--no-save", "yaml"]]]],
    "node20-19-noinstall": ["20.19.4", []],
    "ota-app-node20-19-install": ["20.19.4", [["app-mobile", ["ci"]]]],
    "ota-business-node20-19-install": ["20.19.4", [["mingla-business", ["ci"]]]],
  };
  for (const [name, [runtime, installs]] of Object.entries(expectedProfiles)) {
    const profile = value.setupProfiles[name];
    assert.deepEqual(profile.runtime, { name: "node", version: runtime });
    assert.deepEqual((profile.installs || []).map((item) => [item.cwd, item.invocation.argv]), installs);
    assert.ok((profile.installs || []).every((item) => item.invocation.kind === "argv" && item.invocation.command === "npm"));
  }
  assert.deepEqual(ORIGINS.filter((origin) => inspected[origin].timeoutMinutes === null).sort(), UNBOUNDED);
  const source = fs.readFileSync(BATCH_PATH, "utf8");
  assert.equal((source.match(/actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/g) || []).length, 1);
  assert.equal((source.match(/actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/g) || []).length, 1);
  assert.match(source, /fetch-depth: 0/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /permissions:\n  contents: read/);
  assert.doesNotMatch(source, /secrets\.|id-token:\s*write|pull_request_target|environment:/);
  assert.match(source, /workflow_dispatch:[\s\S]*type: choice[\s\S]*- issue-2300-orch-artifact-reap/);
  assert.match(source, /if: github\.event_name != 'workflow_dispatch' \|\| matrix\.class == 'node20-19-noinstall'/);
});

test("shadow markers are exact and inert while terminal wrappers must be absent", () => {
  assert.equal(ORIGINS.length, 31);
  assert.equal(REFERENCES.length, 33);
  const byteLockedReferences = REFERENCES.filter((relative) => relative !== ".github/scripts/strict-grep/MANIFEST.json");
  const workflowDirectory = path.join(ROOT, ".github/workflows");
  const markedWorkflowNames = fs.readdirSync(workflowDirectory).filter((name) => {
    const absolute = path.join(workflowDirectory, name);
    return fs.statSync(absolute).isFile() && fs.readFileSync(absolute, "utf8").split("\n").includes(MARKER);
  });
  assertWrapperLifecycle(manifest(), (name) => {
    const absolute = path.join(workflowDirectory, name);
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
  }, markedWorkflowNames);

  const protectedPaths = [...byteLockedReferences, ".github/workflows/issue-2393-valid-marketing-test-fixtures.yml"];
  protectedPaths.forEach((relative) => assert.equal(fs.existsSync(path.join(ROOT, relative)), true, relative));
  const diff = spawnSync("git", ["diff", "--quiet", BASE, "--", ...protectedPaths], { cwd: ROOT });
  assert.equal(diff.status, 0, "shadow changed a coupled reference or excluded DB sibling");
  const strictManifest = fs.readFileSync(path.join(ROOT, ".github/scripts/strict-grep/MANIFEST.json"), "utf8");
  const baseStrictManifest = execFileSync("git", ["show", `${BASE}:.github/scripts/strict-grep/MANIFEST.json`], { cwd: ROOT, encoding: "utf8" });
  for (const origin of ORIGINS) {
    assert.equal(strictManifest.split(origin).length, baseStrictManifest.split(origin).length,
      `${origin}: strict-manifest provider reference changed during shadow`);
  }
  const shadowOrigins = new Set(manifest().suites.filter((suite) => suite.lifecycle === "shadow-active").map((suite) => path.basename(suite.origin)));
  assert.equal(shadowOrigins.has("issue-2393-valid-marketing-test-fixtures.yml"), false);

  const terminal = structuredClone(manifest());
  for (const origin of terminal.legacyOrigins) {
    if (ORIGINS.includes(`${origin.stem}.${origin.extension}`)) origin.disposition = "batched-historical";
  }
  assert.doesNotThrow(() => assertWrapperLifecycle(terminal, () => null, []));
  assert.equal(PRE_AMENDMENT_6_TESTER_SHA256, "d54eb1655eb4bc7ddd157785743954a1cbdbac6f6ae938c07a111f7256ae08a0");
});

test("original Phase 2 execution and containment stay byte-for-byte protected", () => {
  const value = manifest();
  const base = JSON.parse(execFileSync("git", ["show", `${BASE}:.github/ci-batch/MANIFEST.json`], { cwd: ROOT, encoding: "utf8" }));
  assert.deepEqual(value.suites.slice(0, 22), base.suites);
  assert.deepEqual(value.commandCapabilities.commands.slice(0, 46), base.commandCapabilities.commands);
  assert.equal(fileDigest(".github/scripts/ci-batch/process-supervisor.py"), "710c70df84e0d3c4773c75f18979dfffeb2aaa397d69356bb4beabd5340f39e8");
  assert.equal(fileDigest(".github/scripts/strict-grep/issue-2148-ci-runner-v2.implementor.test.mjs"), "e9e8059d7127ab0a33e9f3057c488d896d4d10f828fa11b39c198892633dbf95");
  assert.deepEqual(value.runnerContract, {
    workspaceIsolation: "detached-git-worktree", processGroup: "detached", timeoutGraceSeconds: 2,
    resultsFile: "suite-results.json", setupEvidencePrefix: "ci-batch-setup-",
    processOwnership: "linux-subreaper-before-fork",
    dependencyIsolation: "independent-tree-no-escaping-links-with-shard-snapshot",
    childEnvironment: "minimal-allowlist-no-job-secrets",
  });
});

test("reconstruction rejects count-preserving attribution, payload, timeout, and wrapper substitutions", () => {
  const inspected = inspectOrigins();
  const swapped = structuredClone(manifest());
  [swapped.suites[22].origin, swapped.suites[23].origin] = [swapped.suites[23].origin, swapped.suites[22].origin];
  assert.throws(() => assertReconstructed(swapped, inspected));
  const payload = structuredClone(manifest());
  payload.suites[22].steps[0].run += " "; payload.suites[22].steps[0].invocation.argv[1] += " ";
  assert.throws(() => assertReconstructed(payload, inspected));
  const timeout = structuredClone(manifest()); timeout.suites[22].timeoutSeconds += 1;
  assert.throws(() => assertReconstructed(timeout, inspected));
  const wrapper = structuredClone(inspected);
  wrapper["issue-1009-campaign-builder-retry-tests.yml"].runs.at(-1).run += " ";
  assert.throws(() => assertReconstructed(manifest(), wrapper));
});
