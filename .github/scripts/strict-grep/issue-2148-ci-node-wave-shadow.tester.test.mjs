import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PRE_AMENDMENT_6_TESTER_SHA256 = "d54eb1655eb4bc7ddd157785743954a1cbdbac6f6ae938c07a111f7256ae08a0";
const MARKER = "# #2437 SHADOW-PARITY-TRIGGER — remove before cutover";
const MANIFEST_PATH = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
const BATCH_PATH = path.join(ROOT, ".github/workflows/ci-batch.yml");
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const byteDigest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fileDigest = (relative, root = ROOT) => byteDigest(fs.readFileSync(path.join(root, relative)));
const manifest = () => JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

function locks(source) {
  const rows = source.trim().split("\n").map((line) => line.trim().split(/\s+/));
  assert.ok(rows.every((row) => row.length === 2 && /^[a-f0-9]{64}$/.test(row[1])),
    "canonical lock table must contain exact path/SHA-256 pairs");
  assert.equal(new Set(rows.map(([name]) => name)).size, rows.length,
    "canonical lock table contains a duplicate path");
  return Object.fromEntries(rows);
}

// Tester-owned canonical bytes from the approved Phase 2 base. Keeping the
// authority here makes Class A deterministic in both depth-one CI and offline
// full-history worktrees; mutable manifest claims cannot self-authorize drift.
const WRAPPER_SHA256 = locks(`
issue-1009-campaign-builder-retry-tests.yml fec16e73aadcbbac7a9e77b007066cfee936c12a853a68ce0e3cdb953b5ec057
issue-1322-admin-sentry-tests.yml 25226b13212252c0ecca74e48299197d5267647024d06a628d5f93b072dcd56e
issue-1481-explorer-deck-tests.yml fad75c98e1d3cd9c04e89562cb5c4ad19053751f6729283a26fb7603faf8e92a
issue-1509-boot-budget-tests.yml 04078647e2c880502a2b881c4a0c2960ba88adf50a3d92eef0b636eeba8763a3
issue-1516-coach-mark-tests.yml b643b8ec4b0cd0cfe2f01bc80cd0640d5335f952c4978a0fea632ff24a811619
issue-1576-deck-promoted-card.yml 8162a4ac5d792e7f0d9cee754eab7c5be9a6ff012427d09fd12af9efc19ec57e
issue-1579-deck-tap-expand.yml d8bc6e00e94e7c117ee7be228c066b887bae7315ad524303c597d0d8278ad761
issue-1593-deck-layer-geometry.yml bbe5193ab1271addea5d0d66d8310600794305d0b2762f61b7a27d31762708f2
issue-1605-expanded-card.yml 6a9540d4572ed0d73f572de8e678efeef4f3eb7c7daf82b0f32ee8cf04bbf157
issue-1609-card-identity.yml 624c0082dfa4c8274e1f6f5fa9c8a3cdc57a8731cef10c156c6fdd19957be7ae
issue-1615-public-share-surfaces.yml 9792f6b344ecea4bef41ccd12cbe02545c409ce21661490a358af57aa732abc3
issue-1636-likes-load-tests.yml 6f339a444c780bb228b5f2e078e07a8b3e75165902f4f17dbabe86baf796b2c9
issue-1638-tab-switch-quickwins-tests.yml d871b21d920774ae013ef9ff0cbe26ad35502117c0e22ec4af903ae939f9c2c1
issue-1638-tab-switch-scheduling-tests.yml 1e8885b6802c3cd8fdfb7489592510f537e954331367f58a337043db579e5cd5
issue-1639-profile-cards-tests.yml acae082d8a638aa1ad79a6a16829df47b35ce8b09cc4e8bb5ef42b556a8b2337
issue-1642-been-here-offline-bound.yml 91fa2c046295a48a8bc0e1c75a2895b00a01498effe1505e2f085fe1e4c19dcd
issue-1661-completed-write-unparks-invalidation.yml b308d035b3dc9e1a4064affbebbfe1b76cdae74f15ac4d6a363bbb3203ce48e9
issue-1687-been-here-rating-prompt.yml ba36ead2c5866e2869ff81357ca5eb20bf277b6a694fc2bcfbe16692ba875a2a
issue-1860-rls-coverage-tests.yml baba4c985626037a5f9326b1c025f03686ee244acfb1df6e73baca219fe6d82f
issue-1880-expanded-share-handoff.yml c55d0fe5bc2940df9d19c1c984489a65b19b118661e5f76c07745856f9a50320
issue-1960-share-art-isolation.yml 8669b8a10a82882da34f3468458f48e48912a690a8c7bec47031c4de83f646bf
issue-1962-unlisted-share-previews.yml b89de02eb91c88b22f8d2c448db53af7d1b45ffa3c837bf27226d5eef52419e1
issue-1968-public-web-canonical-sharing.yml cd7003d3e3634481edb23636e7e678715befa408b4a6102a92c819003d1f9aab
issue-2004-share-click-canonical-destination.yml ad0c7527badcf0f6a1efe35512885b9058121237ecd8b5ca4ec72f3c6db1de73
issue-2058-bundle-baseline-handoff-tests.yml 4e78ee4917fd1a1a4f096e793daa45deb5bf7ffca12a6c0022e2e7b222b4719c
issue-2084-credential-output-safety.yml 006ea65057e237707ba579789455891aa41800faa62df6ad371fdeac97deb645
issue-2207-manifest-merge-awareness.yml 3aa4b3d362e195b38f681dabeac6b7ded6a95195779b9be7c6229f61f59fd904
issue-2300-orch-artifact-reap.yml 41132bcd443bee17123fda8134fd0b55d1e7ed852bbd7d7033a91ac7077b9bf8
issue-2393-tester-assertion-credential.yml 108dbe6ef3adcc78aa30d04487caa376a02836d2bec802c7734938fa06585401
issue-994-ota-env-resolution.yml 976c1d47de4c1e712719f0f8b3928484bb75e04df460f5a778d3252ab055e6a1
orch-1386-tester-adversarial.yml f0d49800ed79ccf9a0dd51a0c6fef8cf236ad199da41a90f5721553dfab69f9f
`);

const REFERENCE_SHA256 = locks(`
.github/scripts/__tests__/issue-2207-merged-checkout-workflow.tester.test.mjs 6ca8ebc37618516184a88936589e60353122e32390422d481d62a4201c0649dc
.github/scripts/strict-grep/__tests__/issue-1607-explorer-guard-integrity.adversarial.test.mjs 2fd30246d92bd384b048c724fba45bf24583ff51522652aa8c3483eb5a66236e
.github/scripts/strict-grep/__tests__/issue-1607-explorer-guard-integrity.regression.test.mjs 2834021c7a1aa757a002c53e4ede86432f62f4306eb065cb7cb2ac24c3952ff0
.github/scripts/strict-grep/issue-1607-explorer-guard-integrity.mjs b5a755cded54723743a35873565a795d7f34636a738f3fe59ac3b9298f885712
.github/scripts/strict-grep/issue-1860-public-tables-rls-enabled.mjs 11a61e71cfa6cd0aaa2da499bde43f409cd53029f10971b03634475aed21849e
.github/scripts/strict-grep/issue-2084-credential-output-safety.mjs a9d6fbb157af9b877b8bfb2c9e3c3a1b3bf40ff9148bca889f882955b738d9b0
app-mobile/src/components/__tests__/issue-1638-tab-switch-quickwins.test.mjs 42d8f4cfff8dcbe32c8b1b24919880b1290c76e28a5479ab52b596f915982ea7
app-mobile/src/components/deckHeroConstants.ts fa82422845d368bdfaa0fadf618b4e4a27c4057f5e2357fe9d003d5f29f12c2f
app-mobile/src/components/swipeDeck/__tests__/issue_1481_performance_hotpath.test.mjs dbc7afb5f7bdd7da2fac72ae69b1ec31e3585d36def43c821e063ea660d5ac4b
app-mobile/src/components/swipeDeck/__tests__/issue_1481_swipe_lifecycle.test.mjs eb7bd2a6226d474fd9cb756bd807e978ca695043a9d6be9bb4b9daabffcf85de
app-mobile/src/components/swipeDeck/__tests__/issue_1576_promoted_card_opacity.adversarial.test.mjs 05d5b634935bab8e7dfa5cc5d74aca475ef1175ac86d56f56fc22f96e00a3020
app-mobile/src/components/swipeDeck/__tests__/issue_1576_promoted_card_opacity.test.mjs 44ae7417629ea71abac88dbd544eab0a74fcab88c9a0f20cc3f8ba0721d4f426
app-mobile/src/components/swipeDeck/__tests__/issue_1579_tap_expand_admission.adversarial.test.mjs 7dc1851a1ce525c49cd020f8ef6fe6fa34bd1c982109558b410da6e7a2e40db4
app-mobile/src/components/swipeDeck/__tests__/issue_1579_tap_expand_admission.test.mjs a5a859183997db241665275a30227a52a9cfa6d64589cd4639a9ade315b01f7c
app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.adversarial.test.mjs e1b1885d687a3d2b0ff98baa6827071112a2873d83bff209b9643d9ca842bb53
app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.test.mjs 79a074262851aa4659009319955d6e38a8c6b4adf7926e610a8f2e54e8b68bec
app-mobile/src/components/swipeDeck/__tests__/issue_1609_direction_c_plate.test.mjs ad31cc628ef6ed79a34a8e8e814b8ae92e08a33ae63df92802708cba4c0f28a8
app-mobile/src/components/swipeDeck/__tests__/issue_1609_plate_anchor_wiring.test.mjs 643a2c287faec0e57932cd6fc8d3c25f0ccb6709ae5cea55424a84b778396bf4
app-mobile/src/components/swipeDeck/__tests__/issue_1609_short_plate_keeps_chevron.test.mjs e946ef4f54726faa5861b0fc46b76ff5640c2fac4e5a3e2144638bbc9cc4336c
app-mobile/src/components/swipeDeck/__tests__/issue_1609_silhouette_anchor_drift.adversarial.test.mjs b28dd521b7ab280d5acd59cc4b5979e352b4b1b9154c9d2fe7e9409b898276e4
app-mobile/src/hooks/__tests__/issue_1642_been_here_offline_write_bound.test.mjs 3d2d95911fc204e9e6141dcb5318afcaccd6a231313ea1b412ba6e38887a1fa1
app-mobile/src/hooks/__tests__/issue_1661_completed_write_unparks_invalidation.test.mjs b841bbe663494fb83f71f58027033ee3397b1b6351bc8a1cb2e369f2aae90e73
app-mobile/src/hooks/__tests__/issue_1661_parked_invalidation_fanout.adversarial.test.mjs a6806fbfda3a381fe6ac8bf58859963dcaba90a437c283fd7f0d214eb9565086
mingla-business/scripts/ci/__tests__/issue2058_bundle_baseline_handoff.happy.test.mjs d7bd899da5603c05aeb5abbad80c9d92c3f123825039acd9fcb39bb13e441229
packages/card-identity/__tests__/card_identity_isolation.test.mjs 9be8ec654539d6110f8b2e78f6c172ae1f4060086562dfca3f724727c6e1e229
packages/card-identity/__tests__/card_identity_single_source.test.mjs 8a9affadc1ab7a2b7b96a5abd95e04f07e10bb3ab5345d1e62433e45a23b9f54
scripts/ci/__tests__/issue-2062-expo-config-node20.tester.adversarial.test.mjs 96d1215b0a4044ed0b28e8d645f458421e9dc505b0e90670f4a4d0c81717d448
scripts/ci/issue-2062-expo-config-node20.mjs c5f20fc75a136a95e2be264f7e285cfc531d3ce13fabab4edce1da596abce614
scripts/issue-1615/curated-composition-terminal-ui.implementor.happy.test.mjs 1bf2fb46a8ffb17e2cebf7b557c84539654af9f3ba67a62ee7ffcf06b4187c9c
scripts/issue-1615/curated-composition-terminal-ui.tester.adversarial.test.mjs 7f68f7e7682a5ed68037a99ee5bd9b46cacf524ff9b096969599ba068261dbb5
scripts/issue-1860/issue-1860-public-tables-rls.tester.adversarial.test.mjs 5d3b6d312baac9feccc1fd35ac5e4140e3a1dfb6f4f71009d494be3a3e04782b
scripts/issue-1880/expanded-share-handoff.tester.adversarial.test.mjs eac1aafe21a441ac1b74988cbb308a615987938f99a047f0ec5f56f0377f9f10
.github/workflows/issue-2393-valid-marketing-test-fixtures.yml d6ea3933b77f620544626715509ca4a812266bfec3296e012ead9d9ca2ca4a61
`);

const PHASE2_SUITES_SHA256 = "20d161c7c8bafa386347d21eefdeae8ebd0be39c8e2bacec91337992c0fc3786";
const PHASE2_COMMANDS_SHA256 = "92540e31ef9fb7433f6f40a94071b27023786d15c644110e3a43a2929dbe2399";
const PROVIDER_REF_COUNTS_SHA256 = "fe872a916a993f1374c217bbaa31705ab3ba375b194306d93f0e97b921c332a4";

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

const BATCH_RUBY = String.raw`
require "yaml"; require "json"
doc=YAML.safe_load(File.binread(ARGV.fetch(0)),aliases:true)||{}
jobs=doc.fetch("jobs"); out={}
jobs.each do |name,job|
  out[name]={"if"=>job["if"],"timeout"=>job["timeout-minutes"],"strategy"=>job.key?("strategy"),
    "matrix"=>job.dig("strategy","matrix","include"),"steps"=>Array(job["steps"])}
end
STDOUT.write(JSON.generate(out))`;

function inspectOrigins() {
  return JSON.parse(execFileSync("ruby", ["-e", RUBY, ROOT], { input: JSON.stringify(ORIGINS), encoding: "utf8" }));
}

function inspectBatchJobs() {
  return JSON.parse(execFileSync("ruby", ["-e", BATCH_RUBY, BATCH_PATH], { encoding: "utf8" }));
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
    assert.equal(suite.shadowContract.workflowSha256, WRAPPER_SHA256[origin],
      `${suite.id}: mutable workflow digest differs from tester-owned authority`);
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
      assert.equal(byteDigest(withoutMarker), WRAPPER_SHA256[name],
        `${name}: wrapper changed beyond the exact shadow marker`);
      expectedMarked.push(name);
    } else if (record.disposition === "batched-historical") {
      assert.equal(source, null, `${name}: terminal wrapper must be absent`);
    } else {
      assert.fail(`${name}: unsupported wave lifecycle ${record.disposition}`);
    }
  }
  assert.deepEqual([...markedWorkflowNames].sort(), expectedMarked.sort(), "shadow marker exists outside its exact lifecycle set");
}

function assertCanonicalReferenceLocks(root = ROOT) {
  for (const [relative, expected] of Object.entries(REFERENCE_SHA256)) {
    assert.equal(fs.existsSync(path.join(root, relative)), true, relative);
    assert.equal(fileDigest(relative, root), expected, `${relative}: coupled reference bytes changed`);
  }
  const strictManifest = fs.readFileSync(path.join(root, ".github/scripts/strict-grep/MANIFEST.json"), "utf8");
  assert.equal(digest(ORIGINS.map((origin) => [origin, strictManifest.split(origin).length])),
    PROVIDER_REF_COUNTS_SHA256, "strict-manifest provider references changed during shadow");
}

function assertPhase2Locks(value) {
  assert.equal(digest(value.suites.slice(0, 22)), PHASE2_SUITES_SHA256,
    "original Phase 2 suite registry changed");
  assert.equal(digest(value.commandCapabilities.commands.slice(0, 46)), PHASE2_COMMANDS_SHA256,
    "original Phase 2 capability registry changed");
}

test("31 live wrappers reconstruct exactly 32 variants and 107 reviewed assertion capabilities", () => {
  assert.deepEqual(Object.keys(WRAPPER_SHA256).sort(), ORIGINS);
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
  const jobs = inspectBatchJobs();
  assert.deepEqual(Object.keys(jobs).sort(), ["batch", "dispatch"]);
  assert.equal(jobs.batch.if, "github.event_name != 'workflow_dispatch'");
  assert.equal(jobs.batch.strategy, true);
  assert.equal(jobs.batch.matrix.length, 14);
  assert.equal(jobs.dispatch.if, "github.event_name == 'workflow_dispatch' && inputs.suite == 'issue-2300-orch-artifact-reap'");
  assert.equal(jobs.dispatch.strategy, false);
  assert.equal(jobs.dispatch.timeout, 25);
  assert.deepEqual(value.suites.filter((suite) => suite.class === "node20-19-noinstall").map((suite) => suite.id),
    ["issue-2300-orch-artifact-reap"]);
  for (const name of ["batch", "dispatch"]) {
    const checkout = jobs[name].steps.filter((step) => step.uses === "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683");
    const setup = jobs[name].steps.filter((step) => step.uses === "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
    assert.equal(checkout.length, 1, `${name}: checkout pin cardinality`);
    assert.deepEqual(checkout[0].with, { "fetch-depth": 0, "persist-credentials": false });
    assert.equal(setup.length, 1, `${name}: setup-node pin cardinality`);
  }
  assert.deepEqual(jobs.batch.steps.find((step) => step.uses?.startsWith("actions/setup-node@")).with,
    { "node-version": "${{ matrix.node }}", cache: "${{ matrix.cache }}", "cache-dependency-path": "${{ matrix.cache-lock }}" });
  assert.deepEqual(jobs.dispatch.steps.find((step) => step.uses?.startsWith("actions/setup-node@")).with,
    { "node-version": "20.19.4" });
  assert.equal(jobs.dispatch.steps.filter((step) => step.run === 'node .github/scripts/ci-batch/run-suite-batch.mjs --setup "node20-19-noinstall"').length, 1);
  assert.equal(jobs.dispatch.steps.filter((step) => step.run === 'node .github/scripts/ci-batch/run-suite-batch.mjs --run "node20-19-noinstall"').length, 1);
  assert.equal((source.match(/actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/g) || []).length, 2);
  assert.equal((source.match(/actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/g) || []).length, 2);
  assert.match(source, /permissions:\n  contents: read/);
  assert.doesNotMatch(source, /secrets\.|id-token:\s*write|pull_request_target|environment:/);
  assert.match(source, /workflow_dispatch:[\s\S]*type: choice[\s\S]*- issue-2300-orch-artifact-reap/);
  assert.doesNotMatch(jobs.batch.if, /matrix|strategy|steps|runner|job/);
  assert.doesNotMatch(jobs.dispatch.if, /matrix|strategy|steps|runner|job/);
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

  assert.deepEqual(byteLockedReferences.sort(), Object.keys(REFERENCE_SHA256)
    .filter((relative) => relative !== ".github/workflows/issue-2393-valid-marketing-test-fixtures.yml").sort());
  assertCanonicalReferenceLocks();
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
  assertPhase2Locks(value);
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

test("canonical locks remain enforceable in a depth-one checkout with no historical base object", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2437-shallow-"));
  const seed = path.join(temporary, "seed");
  const shallow = path.join(temporary, "shallow");
  const required = [
    ".github/ci-batch/MANIFEST.json",
    ".github/scripts/strict-grep/MANIFEST.json",
    ...ORIGINS.map((name) => `.github/workflows/${name}`),
    ...Object.keys(REFERENCE_SHA256),
  ];
  try {
    for (const relative of new Set(required)) {
      const target = path.join(seed, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(ROOT, relative), target);
    }
    execFileSync("git", ["init", "--quiet"], { cwd: seed });
    execFileSync("git", ["add", "."], { cwd: seed });
    execFileSync("git", ["-c", "user.name=Mingla Tester", "-c", "user.email=tester@invalid", "commit", "--quiet", "-m", "shallow fixture"], { cwd: seed });
    execFileSync("git", ["clone", "--quiet", "--depth=1", `file://${seed}`, shallow]);
    assert.notEqual(spawnSync("git", ["cat-file", "-e", "5e24d9dfed3559471b701a949cc3e2c76b6f5949^{commit}"], { cwd: shallow }).status, 0,
      "fixture unexpectedly contains the historical base object");

    const value = JSON.parse(fs.readFileSync(path.join(shallow, ".github/ci-batch/MANIFEST.json"), "utf8"));
    const workflowDirectory = path.join(shallow, ".github/workflows");
    const markedWorkflowNames = fs.readdirSync(workflowDirectory).filter((name) =>
      fs.readFileSync(path.join(workflowDirectory, name), "utf8").split("\n").includes(MARKER));
    assertWrapperLifecycle(value, (name) => fs.readFileSync(path.join(workflowDirectory, name), "utf8"), markedWorkflowNames);
    assertCanonicalReferenceLocks(shallow);
    assertPhase2Locks(value);

    const wrapperPath = path.join(workflowDirectory, ORIGINS[0]);
    const wrapperBytes = fs.readFileSync(wrapperPath, "utf8");
    fs.writeFileSync(wrapperPath, `${wrapperBytes}# unreviewed drift\n`);
    assert.throws(() => assertWrapperLifecycle(value,
      (name) => fs.readFileSync(path.join(workflowDirectory, name), "utf8"), markedWorkflowNames));
    fs.writeFileSync(wrapperPath, wrapperBytes);

    const reference = Object.keys(REFERENCE_SHA256)[0];
    fs.appendFileSync(path.join(shallow, reference), "\n");
    assert.throws(() => assertCanonicalReferenceLocks(shallow));

    const forgedPhase2 = structuredClone(value);
    forgedPhase2.suites[0].timeoutSeconds += 1;
    assert.throws(() => assertPhase2Locks(forgedPhase2));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
