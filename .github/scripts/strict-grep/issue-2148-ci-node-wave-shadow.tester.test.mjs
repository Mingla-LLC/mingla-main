import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROVIDERS_ADDED_SINCE_SEAL, SUITES_ADDED_SINCE_SEAL } from "../ci-batch/validate-manifest-v2.mjs";

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

// [TEST-MOD-APPROVED #2589] Two lock VALUES re-banked; the lock itself is
// untouched — same paths, same coupled set, same assertions, same enforcement in
// both the working tree and the depth-one fixture.
//
// Which and why: #2589 amended two coupled suites,
// `curated-composition-terminal-ui.implementor.happy.test.mjs` (C6) and
// `.tester.adversarial.test.mjs` (TA7). Both pinned a boolean failure flag,
// `prepError`, that #2589 replaced with a typed reason so the share sheet could
// tell an unpublished offering from a signed-out session from an outage. Every
// PROPERTY those suites assert still passes untouched; only the names moved. One
// of TA7's assertions would have gone SILENTLY VACUOUS under the rename — the
// token it matched no longer existed — and was restated against the live name so
// it keeps biting.
//
// Both replacement values were derived programmatically from the files on disk,
// never hand-typed, and each old value was verified to occur exactly once in
// this file before being replaced.
// [TEST-MOD-APPROVED #2851] The old d6ea… #2393 lock is re-banked solely for
// its approved top-level concurrency bytes; both full-file lock proofs survive.
const REFERENCE_SHA256 = locks(`
.github/scripts/__tests__/issue-2207-merged-checkout-workflow.tester.test.mjs fc65e60b8636d7dc23190e10e8b0372cf6f033dca4cf060fb3e67d5f0ce21e06
.github/scripts/strict-grep/__tests__/issue-1607-explorer-guard-integrity.adversarial.test.mjs a6dba7a4a109956b82acae0beb2eb6eb28bdc1c1522d5793452cbcc4885d3652
.github/scripts/strict-grep/__tests__/issue-1607-explorer-guard-integrity.regression.test.mjs 034382651f35eb498dabd2a1c5d35df0d1fdb0219cad34f5f5a102cd5f239a87
.github/scripts/strict-grep/issue-1607-explorer-guard-integrity.mjs 02043b12c819cbda96dcdd8bc1d93ab51b3ca7052ab9733e389e36d0a53c275d
.github/scripts/strict-grep/issue-1860-public-tables-rls-enabled.mjs 243225f05fdb969970c2d1bd7de4a52abed8d02162828f6ff21b0f106db7ea6a
.github/scripts/strict-grep/issue-2084-credential-output-safety.mjs 904d78e5e171247af178881a622c97e1485caea2da06969e38be7001f2bcd635
app-mobile/src/components/__tests__/issue-1638-tab-switch-quickwins.test.mjs 852f38916b00c85709eccbfaab634986c8b123a02c27dd40d50ef7324b7b3948
app-mobile/src/components/deckHeroConstants.ts bdb476b046e64fa2601f9081abfc1919a589a079a4b248ca5aeb38324d1e6749
app-mobile/src/components/swipeDeck/__tests__/issue_1481_performance_hotpath.test.mjs 075bc8e558fdca1d993d99f8ba7ada4e4b3fbfc400d6ec72acd922610688c04d
app-mobile/src/components/swipeDeck/__tests__/issue_1481_swipe_lifecycle.test.mjs 6f2cee42857f5f6d6c6f42fc466dbb310272fc3d6b9b129bd12cda583557e565
app-mobile/src/components/swipeDeck/__tests__/issue_1576_promoted_card_opacity.adversarial.test.mjs a7c8e04e6b6d849d37a01a0009cde1b61f6eacf87de8e88c64a73ea093fa2309
app-mobile/src/components/swipeDeck/__tests__/issue_1576_promoted_card_opacity.test.mjs 31becd6159e34347f43ba36911d643e57120af4bdb33947c68b4d9449385da34
app-mobile/src/components/swipeDeck/__tests__/issue_1579_tap_expand_admission.adversarial.test.mjs f0bfc2d3d6117ea926fbc222a245f16dd3b4962eb6cce27c6c93575a2dc88101
app-mobile/src/components/swipeDeck/__tests__/issue_1579_tap_expand_admission.test.mjs e6dab667b68f6683dec748cb1fb4736bcda9f6b40f750d5045028fd0cdca171d
app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.adversarial.test.mjs d8ca0f473606a0b73328a94ce75ddb7fa222c9d228cab1572ba210ee0cd9e0b8
app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.test.mjs 32dbc515c7f62df2ae0d3d6072474fa89d00ac032d16307e6793c8419a43cf93
app-mobile/src/components/swipeDeck/__tests__/issue_1609_direction_c_plate.test.mjs d3793c221ecbe01e7bb2bc0c3e8c70e5f38ee33b973d067e7d8e038adaee4fae
app-mobile/src/components/swipeDeck/__tests__/issue_1609_plate_anchor_wiring.test.mjs f478a1a1a209263d3bd117a15907b5a73bb297f15b6d5ba86f2db42c47693169
app-mobile/src/components/swipeDeck/__tests__/issue_1609_short_plate_keeps_chevron.test.mjs 38517a765c89a0548ca3e330b0c809dcdd87cefb0e73fd1c10c533512eff2f6f
app-mobile/src/components/swipeDeck/__tests__/issue_1609_silhouette_anchor_drift.adversarial.test.mjs d8da901fd243dd1d375712e21db88dd69559c8898354860c006bfa8f2a00acde
app-mobile/src/hooks/__tests__/issue_1642_been_here_offline_write_bound.test.mjs 7de49d59fbeae670bce9f6b94a666c2ce201fc4b4c736fe5d762cee143f0818d
app-mobile/src/hooks/__tests__/issue_1661_completed_write_unparks_invalidation.test.mjs 042ef629b4a03643a6ce34f0c2d7645d610d11926cfa2860ae68c644ddd31c60
app-mobile/src/hooks/__tests__/issue_1661_parked_invalidation_fanout.adversarial.test.mjs 66a87430d62e2e0c110240f2b9c8314e661fbd5c66c437caad520171bd217d4e
mingla-business/scripts/ci/__tests__/issue2058_bundle_baseline_handoff.happy.test.mjs 48a7f8e61f3e7668d233a359bbe4d1540eb8642bd0c1349c85401acd36a73e1f
packages/card-identity/__tests__/card_identity_isolation.test.mjs 7c12a6bb9e90662357992fa8a24142bc0caa8d8b61c9bb5c00d14ea4eaa8640e
packages/card-identity/__tests__/card_identity_single_source.test.mjs 537507cbf17a718d1a75c644850b02e8b6bc0789255906c4ea74550a5f71eec4
scripts/ci/__tests__/issue-2062-expo-config-node20.tester.adversarial.test.mjs a03d9052f03eeaefe686c66a3491f05d79deff1a851c57d21f47fa1afc9133b2
scripts/ci/issue-2062-expo-config-node20.mjs edd8938c93367e76193c850206cae438a3f888a3bb6ffc7d5c6ad143cdb9384b
scripts/issue-1615/curated-composition-terminal-ui.implementor.happy.test.mjs f1f3a94262faab8f998b27bccba420ed90085cfd6f9926334bd22408fce0d1a8
scripts/issue-1615/curated-composition-terminal-ui.tester.adversarial.test.mjs 4d382fefd13bd483b711715005b602e4f4445b324a9804554458ef438bb99a39
scripts/issue-1860/issue-1860-public-tables-rls.tester.adversarial.test.mjs 0cbacffe0dea33f5b69b318ae537422a53d869d039f5cc037d1331c19a1bce63
scripts/issue-1880/expanded-share-handoff.tester.adversarial.test.mjs 707fefb8934df9435b1de1ce1daf8cb0fe8cf8abe8d481ce7ab734ea2e62807e
.github/workflows/issue-2393-valid-marketing-test-fixtures.yml 466ad276405d0719a0d91c7dab4398192085784cc473b791d68895c154eab12e
`);

const PHASE2_SUITES_SHA256 = "1c289e7014d7f52808636371c806d9fc05d94e4dfd1644f64840ded1df1f1702";
const PHASE2_COMMANDS_SHA256 = "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f";
const PROVIDER_REF_COUNTS_SHA256 = "394b2a8ad3c984b0c4278f8e4a469f34f25b936fdf1fc346eebb1f4fa8ecd5b6";

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

function inspectOrigins(value = manifest()) {
  const terminal = value.legacyOrigins
    .filter((origin) => ORIGINS.includes(`${origin.stem}.${origin.extension}`))
    .every((origin) => origin.disposition === "batched-historical");
  if (terminal) return null;
  return JSON.parse(execFileSync("ruby", ["-e", RUBY, ROOT], { input: JSON.stringify(ORIGINS), encoding: "utf8" }));
}

function inspectBatchJobs() {
  return JSON.parse(execFileSync("ruby", ["-e", BATCH_RUBY, BATCH_PATH], { encoding: "utf8" }));
}

const EXPECTED_BATCH_EVENTS = ["pull_request", "push", "workflow_dispatch"];
const BATCH_EVENTS_RUBY = String.raw`
require "yaml"; require "json"
doc = YAML.safe_load(STDIN.read, aliases: true) || {}
raw = doc.key?("on") ? doc["on"] : doc[true]
events = case raw
         when Hash then raw.keys.map(&:to_s)
         when Array then raw.map(&:to_s)
         when String then [raw]
         else []
         end
STDOUT.write(JSON.generate(events.sort))`;
const batchEventNames = (source) => JSON.parse(execFileSync("ruby", ["-e", BATCH_EVENTS_RUBY], { input: source, encoding: "utf8" }));
const assertBatchTriggerBoundary = (source) => assert.deepEqual(
  batchEventNames(source), EXPECTED_BATCH_EVENTS, "ci-batch top-level event set must remain pull_request/push/workflow_dispatch",
);
const assertTargetTriggerMutantFails = (source) => {
  const mutant = source.replace(/^  pull_request:\s*$/m, "  pull_request_target:");
  assert.notEqual(mutant, source, "target-trigger mutant must change the parsed event key");
  assert.throws(() => assertBatchTriggerBoundary(mutant), /ci-batch top-level event set/);
};

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
  // [TEST-MOD-APPROVED #2438] Select Phase 3A explicitly after the additive Phase 3B wave.
  const shadow = value.suites.filter((suite) => suite.migrationWave === "phase3a-node-wave");
  // [TEST-MOD-APPROVED #2897] Derived from the validator's declared post-seal set.
  assert.equal(value.legacyOrigins.length, 200 + SUITES_ADDED_SINCE_SEAL.length);
  assert.equal(value.suites.length, 84 + SUITES_ADDED_SINCE_SEAL.length);
  // [TEST-MOD-APPROVED #2591] Literal -> derivation. The provider totals are now
  // `<frozen> + PROVIDERS_ADDED_SINCE_SEAL.length`, read from the one declared set the
  // validator subtracts from the frozen provider seal. Subject and strength unchanged;
  // the number simply stops being typed in a second place where it can disagree.
  assert.equal(value.workflowProviders.length, 91 + PROVIDERS_ADDED_SINCE_SEAL.length);
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
    if (inspections) {
      const reconstructed = assertionRuns(origin, suite.id, inspections);
      assert.deepEqual(suite.steps.map((step) => ({ run: step.invocation.argv[1], cwd: step.cwd })), reconstructed,
        `${suite.id}: assertion payload differs from live wrapper`);
    }
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
  if (inspections) {
    assert.equal(inspections["issue-994-ota-env-resolution.yml"].runs.filter(({ run }) => INSTALLS.has(run.trim())).length, 1);
    assert.equal(ORIGINS.reduce((sum, origin) => sum + inspections[origin].runs.length, 0), 118);
    assert.equal(ORIGINS.reduce((sum, origin) => sum + inspections[origin].runs.filter(({ run }) => INSTALLS.has(run.trim())).length, 0), 16);
  }
  assert.equal(digest(value.commandCapabilities.commands.slice(0, 51)), "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f");
  assert.equal(digest(value.commandCapabilities.commands.slice(51, 158)), "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709");
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
  assert.equal(digest(value.suites.slice(0, 23)), PHASE2_SUITES_SHA256,
    "original Phase 2 suite registry changed");
  assert.equal(digest(value.commandCapabilities.commands.slice(0, 51)), PHASE2_COMMANDS_SHA256,
    "original Phase 2 capability registry changed");
}

test("typed authority reconstructs exactly 32 variants and 107 reviewed assertion capabilities", () => {
  assert.deepEqual(Object.keys(WRAPPER_SHA256).sort(), ORIGINS);
  assertReconstructed(manifest(), inspectOrigins());
});

test("typed setup, runtime, timeout, dispatch, and trust boundaries are exact", () => {
  const value = manifest();
  const inspected = inspectOrigins(value);
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
  if (inspected) assert.deepEqual(ORIGINS.filter((origin) => inspected[origin].timeoutMinutes === null).sort(), UNBOUNDED);
  const source = fs.readFileSync(BATCH_PATH, "utf8");
  const jobs = inspectBatchJobs();
  assert.deepEqual(Object.keys(jobs).sort(), ["batch", "dispatch"]);
  assert.equal(jobs.batch.if, "github.event_name != 'workflow_dispatch'");
  assert.equal(jobs.batch.strategy, true);
  assert.equal(jobs.batch.matrix.length, 14);
  assert.equal(jobs.dispatch.if, "github.event_name == 'workflow_dispatch' && inputs.suite == 'issue-2300-orch-artifact-reap'");
  assert.equal(jobs.dispatch.strategy, false);
  assert.equal(jobs.dispatch.timeout, 25);
  assert.deepEqual(value.suites.filter((suite) => suite.class === "node20-19-noinstall" && suite.migrationWave !== "phase3b-postgres-wave").map((suite) => suite.id),
    ["issue-2300-orch-artifact-reap"]);
  for (const name of ["batch", "dispatch"]) {
    const checkout = jobs[name].steps.filter((step) => step.uses === "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683");
    const setup = jobs[name].steps.filter((step) => step.uses === "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
    assert.equal(checkout.length, 1, `${name}: checkout pin cardinality`);
    assert.deepEqual(checkout[0].with, { "fetch-depth": 0, "persist-credentials": false });
    assert.equal(setup.length, name === "batch" ? 4 : 1, `${name}: setup-node pin cardinality`);
  }
  assert.deepEqual(jobs.batch.steps.find((step) => !step.name && step.uses?.startsWith("actions/setup-node@")).with,
    { "node-version": "${{ matrix.node }}", cache: "${{ matrix.cache }}", "cache-dependency-path": "${{ matrix.cache-lock }}" });
  assert.deepEqual(jobs.dispatch.steps.find((step) => step.uses?.startsWith("actions/setup-node@")).with,
    { "node-version": "20.19.4" });
  assert.equal(jobs.dispatch.steps.filter((step) => step.run === 'node .github/scripts/ci-batch/run-suite-batch.mjs --setup "node20-19-noinstall"').length, 1);
  assert.equal(jobs.dispatch.steps.filter((step) => step.run === 'node .github/scripts/ci-batch/run-suite-batch.mjs --run "node20-19-noinstall"').length, 1);
  assert.equal((source.match(/actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/g) || []).length, 2);
  assert.equal((source.match(/actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/g) || []).length, 5);
  assert.match(source, /permissions:\n  contents: read/);
  // [TEST-MOD-APPROVED #2851] Replace the old whole-source target-token ban
  // with semantic trigger truth: the canonical concurrency operand is safe,
  // while an actual pull_request_target trigger mutant remains red.
  assert.doesNotMatch(source, /secrets\.|id-token:\s*write|environment:/);
  assertBatchTriggerBoundary(source);
  assertTargetTriggerMutantFails(source);
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
  assert.equal(fileDigest(".github/scripts/ci-batch/process-supervisor.py"), "1c890b876833df9e6f9c8cf2b0dc8cec4ba1364b7b5519e68b0245b5077dfb20");
  assert.equal(fileDigest(".github/scripts/strict-grep/issue-2148-ci-runner-v2.implementor.test.mjs"), "83d249fcfa0cdffe1501f542bdfc7ae8ae375b3496a11e9e0ee6237220e40b71");
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
  [swapped.suites[23].origin, swapped.suites[24].origin] = [swapped.suites[24].origin, swapped.suites[23].origin];
  assert.throws(() => assertReconstructed(swapped, inspected));
  const payload = structuredClone(manifest());
  payload.suites[23].steps[0].run += " "; payload.suites[23].steps[0].invocation.argv[1] += " ";
  assert.throws(() => assertReconstructed(payload, inspected));
  const timeout = structuredClone(manifest()); timeout.suites[23].timeoutSeconds += 1;
  assert.throws(() => assertReconstructed(timeout, inspected));
  if (inspected) {
    const wrapper = structuredClone(inspected);
    wrapper["issue-1009-campaign-builder-retry-tests.yml"].runs.at(-1).run += " ";
    assert.throws(() => assertReconstructed(manifest(), wrapper));
  } else {
    const restored = ORIGINS[0];
    assert.throws(() => assertWrapperLifecycle(manifest(), (name) => name === restored ? "restored wrapper" : null, []));
  }
});

test("canonical locks remain enforceable in a depth-one checkout with no historical base object", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2437-shallow-"));
  const seed = path.join(temporary, "seed");
  const shallow = path.join(temporary, "shallow");
  const required = [
    ".github/ci-batch/MANIFEST.json",
    ".github/scripts/strict-grep/MANIFEST.json",
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
    assertWrapperLifecycle(value, (name) => {
      const absolute = path.join(workflowDirectory, name);
      return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
    }, markedWorkflowNames);
    assertCanonicalReferenceLocks(shallow);
    assertPhase2Locks(value);

    const wrapperPath = path.join(workflowDirectory, ORIGINS[0]);
    fs.writeFileSync(wrapperPath, "restored terminal wrapper\n");
    assert.throws(() => assertWrapperLifecycle(value,
      (name) => {
        const absolute = path.join(workflowDirectory, name);
        return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
      }, markedWorkflowNames));
    fs.unlinkSync(wrapperPath);

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
