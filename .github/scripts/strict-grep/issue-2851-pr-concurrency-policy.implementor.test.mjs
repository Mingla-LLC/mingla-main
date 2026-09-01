// Issue #2851 implementor regression proof.
//
// This suite protects the real repository, not a retyped policy replica: the
// current workflow inventory must remain correctly partitioned, the production
// scan must pass, and six distinct true policy reversions must turn the semantic
// guard red. It deliberately does not inspect git history: #2871 proved that a
// historical PR diff is not a durable invariant on main or on later branches.

import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  auditWorkflowSources,
  expectedGroup,
  LOAD_GROUP,
  NORMAL_CANCEL,
  readWorkflowSources,
  REPO_ROOT,
} from "./issue-2851-pr-concurrency-policy.mjs";

// Construct live workflow names at runtime. The CI-batch provider scanner reads
// tracked source and must not treat this regression suite as provider evidence.
const liveWorkflow = (...stemParts) => `${stemParts.join("-")}.${["y", "ml"].join("")}`;
const DENIED = [
  liveWorkflow("android", "applinks", "health", "probe"),
  liveWorkflow("bundle", "baseline", "ratchet"),
  liveWorkflow("deploy", "functions"),
  liveWorkflow("onelink", "health", "probe"),
  liveWorkflow("rotate", "apple", "jwt"),
  liveWorkflow("sprint", "rollover"),
  liveWorkflow("stripe", "connect", "smoke"),
];
// [TEST-MOD-APPROVED #2909] Census re-pinned, assertion strength unchanged.
// #2895 added a 131st workflow (sites-backup-restore.yml) that declares
// `pull_request`, making it the 124th PR-family member. These literals are the
// membership tripwire and they are SUPPOSED to move when membership moves --
// that is why they are hand-pinned rather than derived, and it is why this suite
// went red on `main` the moment the workflow landed. Nothing is relaxed: the
// counts stay exact-equal, the digests stay full-byte, and the seven denied
// non-PR workflows and their hashes are untouched. #2909 additionally moves the
// new member onto the canonical policy, so `normalPolicies` moves 122 -> 123 in
// the same commit that moves `prFamily` 123 -> 124.
// Previous values (pre-#2909): count 123,
//   identity a229542a59e0bcb3403a81e6ff938845f0e6a06faa5245a0edb43b9015322912
//   withoutConcurrency 1f9e545979c705a09b13f22ee73d00449aba8fce0b6149fc7e673319173a0b63
const PR_FAMILY_COUNT = 124;
const PR_FAMILY_IDENTITY_SHA256 =
  "9356c4252e3a521e57c039ed765ff1f05f434516010df09c8937cd73bdab3f04";
// [TEST-MOD-APPROVED #2885] Mechanically re-derived from reviewed current main
// after #2885 added a bundle-baseline path exclusion to fourteen existing
// PR-family workflows. Two candidates were REVERTED rather than have their
// assertions weakened, both because they are deliberately always-run and both
// pinned by their own suites: #1614's onConflict arbiter audit, and ci-batch,
// whose header states "NO paths: filter, deliberately" and whose #2148
// runner-v2 tester asserts `doesNotMatch(/^\s*paths(?:-ignore)?:/m)`. This digest covers the `on:` block, which is exactly what
// that change edits, so it MUST move. What must not move, and did not, is the
// membership: PR_FAMILY_COUNT and PR_FAMILY_IDENTITY_SHA256 are untouched
// because no workflow was added, removed, or reclassified — only path filters
// narrowed. Denied-workflow hashes, concurrency policy, test logic and every
// mutation are unchanged.
// Previous value (pre-#2885): a132a0155b04b0dc3bcbdd3edec6d119a7a43dfbe8db02929302c44336b69138
const PR_FAMILY_WITHOUT_CONCURRENCY_SHA256 =
  "757010090a432703e28f14aaebded53351c10614c10b0f7b33f668f5d6243884";
const DENIED_FULL_SHA256 = [
  "9ca2a41b615930e24419623c052caf0b81c3be272e06a66f0db8762405ac713b",
  "50e7093bc2f3b46037a885b7c295faad747c2eaa377760e2ea1ad151545c88eb",
  "7fe5131de1ff59b0b247b9c718ca01bbcfcb637ff115e1e5751e052c05bdb72a",
  "0ca059b1118b93b455ee539ff31c28b2fe6ad53c61c5f61faee5c5eccb9cb7f5",
  "ae053d47c1cea32c1889cc00eba1ed11b5bbec30dd726c3d078af92f3dfdf76a",
  "c6056ea23b01ad1e38e2cfe94891872dbed9dba94c9d7e5464c354f1563fc132",
  "9c1acd54bfa35a2eb6f67aea9c7c097ea1bcfe80a67865a1b2b8f62f8ef462b5",
];

const RUBY_CANONICAL = String.raw`
require "yaml"
require "json"
payload = JSON.parse(STDIN.read)
result = {}
payload.each do |file, source|
  document = YAML.safe_load(source, aliases: true) || {}
  on_value = document.key?("on") ? document["on"] : document[true]
  events = case on_value
           when Hash then on_value.keys.map(&:to_s)
           when Array then on_value.map(&:to_s)
           when String then [on_value]
           else []
           end
  document.delete("concurrency")
  result[file] = {"events" => events.sort, "withoutConcurrency" => document}
end
STDOUT.write(JSON.generate(result))
`;

function canonicalize(sources) {
  return JSON.parse(execFileSync("ruby", ["-e", RUBY_CANONICAL], {
    input: JSON.stringify(sources),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function currentTreeAuthority(sources) {
  const canonical = canonicalize(sources);
  const names = Object.keys(canonical).filter((name) => {
    const events = canonical[name].events;
    return events.includes("pull_request") || events.includes("pull_request_target");
  }).sort();
  const withoutConcurrency = Object.fromEntries(
    names.map((name) => [name, canonical[name]]),
  );
  return {
    names,
    identitySha256: sha256(JSON.stringify(names)),
    withoutConcurrencySha256: sha256(JSON.stringify(withoutConcurrency)),
  };
}

function assertCurrentTreeAuthority(sources) {
  const authority = currentTreeAuthority(sources);
  assert.equal(authority.names.length, PR_FAMILY_COUNT, "PR-family identity count drifted");
  assert.equal(authority.identitySha256, PR_FAMILY_IDENTITY_SHA256, "PR-family identity digest drifted");
  assert.equal(
    authority.withoutConcurrencySha256,
    PR_FAMILY_WITHOUT_CONCURRENCY_SHA256,
    "PR-family non-concurrency semantic digest drifted",
  );
  return authority;
}

function assertDeniedAuthorities(sources, identities = DENIED, hashes = DENIED_FULL_SHA256) {
  assert.deepEqual(identities, DENIED, "denied workflow identity ordering/correspondence drifted");
  assert.equal(identities.length, 7, "denied workflow identity count drifted");
  assert.equal(new Set(identities).size, 7, "denied workflow identities must be unique");
  assert.equal(hashes.length, 7, "denied workflow authority count drifted");
  assert.equal(new Set(hashes).size, 7, "denied workflow authorities must be unique");
  for (const [index, name] of identities.entries()) {
    assert.equal(typeof sources[name], "string", `${name}: denied workflow is missing or renamed`);
    assert.equal(sha256(sources[name]), hashes[index], `${name}: denied workflow bytes changed`);
  }
}
function replacePolicy(source, group, cancel) {
  const replacement = `concurrency:\n  group: ${group}\n  cancel-in-progress: ${cancel}\n`;
  const updated = source.replace(/^concurrency:\n(?: {2}[^\n]*\n){2}/m, replacement);
  assert.notEqual(updated, source, "fixture mutation must replace a real top-level policy");
  return updated;
}

function removePolicy(source) {
  const updated = source.replace(/^concurrency:\n(?: {2}[^\n]*\n){2}\n?/m, "");
  assert.notEqual(updated, source, "fixture mutation must delete a real top-level policy");
  return updated;
}

function expectMutationFailure(name, mutate, diagnostic) {
  const sources = readWorkflowSources();
  mutate(sources);
  const result = auditWorkflowSources(sources);
  assert.ok(
    result.errors.some((error) => error.includes(diagnostic)),
    `${name}: expected diagnostic ${diagnostic}; got ${result.errors.join(" | ")}`,
  );
}

test("the real tree has 124 canonical PR-family policies and the sole load exception", () => {
  const result = auditWorkflowSources(readWorkflowSources());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.counts, {
    totalWorkflows: 131,
    prFamily: 124,
    standardPullRequest: 123,
    pullRequestTarget: 1,
    normalPolicies: 123,
    exceptions: 1,
  });
});

// [TEST-MOD-APPROVED #2582] The origin/main diff was valid before #2851
// merged, then became an empty moving-base comparison downstream. Preserve the
// same exact 123 identities and non-concurrency semantics with current-tree
// digests, and preserve the seven exclusions with durable full-byte hashes.
test("the real tree independently classifies 124 PR-family and seven non-PR workflows", () => {
  const sources = readWorkflowSources();
  const authority = assertCurrentTreeAuthority(sources);
  const audit = auditWorkflowSources(sources);
  assert.deepEqual(audit.errors, []);
  assert.deepEqual(audit.counts, {
    totalWorkflows: 131,
    prFamily: 124,
    standardPullRequest: 123,
    pullRequestTarget: 1,
    normalPolicies: 123,
    exceptions: 1,
  });

  const noHistoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mingla-2851-no-git-"));
  try {
    const noHistoryWorkflows = path.join(noHistoryRoot, ".github/workflows");
    fs.mkdirSync(noHistoryWorkflows, { recursive: true });
    for (const [name, source] of Object.entries(sources)) {
      fs.writeFileSync(path.join(noHistoryWorkflows, name), source);
    }
    assert.deepEqual(
      assertCurrentTreeAuthority(readWorkflowSources(noHistoryRoot)),
      authority,
      "current-tree authority must not require Git metadata or history",
    );
  } finally {
    fs.rmSync(noHistoryRoot, { recursive: true, force: true });
  }

  const removed = { ...sources };
  delete removed[authority.names[0]];
  assert.throws(() => assertCurrentTreeAuthority(removed), /identity count drifted/);

  const renamed = { ...sources };
  const renamedFrom = authority.names[0];
  renamed[liveWorkflow("renamed", "pr", "family", "fixture")] = renamed[renamedFrom];
  delete renamed[renamedFrom];
  assert.throws(() => assertCurrentTreeAuthority(renamed), /identity digest drifted/);

  const added = { ...sources };
  added[liveWorkflow("added", "pr", "family", "fixture")] = sources[authority.names[0]];
  assert.throws(() => assertCurrentTreeAuthority(added), /identity count drifted/);

  const semanticDrift = { ...sources };
  const semanticName = authority.names[0];
  semanticDrift[semanticName] = `${semanticDrift[semanticName]}\nx-amendment-13-probe: true\n`;
  const semanticAuthority = currentTreeAuthority(semanticDrift);
  assert.equal(semanticAuthority.identitySha256, authority.identitySha256);
  assert.notEqual(semanticAuthority.withoutConcurrencySha256, authority.withoutConcurrencySha256);
  assert.throws(() => assertCurrentTreeAuthority(semanticDrift), /non-concurrency semantic digest drifted/);

  const concurrencyDrift = { ...sources };
  const concurrencyName = liveWorkflow("framework", "major", "guard");
  concurrencyDrift[concurrencyName] = removePolicy(concurrencyDrift[concurrencyName]);
  const concurrencyAuthority = assertCurrentTreeAuthority(concurrencyDrift);
  assert.deepEqual(concurrencyAuthority, authority);
  assert.ok(
    auditWorkflowSources(concurrencyDrift).errors.some((error) =>
      error.includes(`${concurrencyName}: missing or non-object top-level concurrency policy`)),
  );

  assert.throws(() => assertCurrentTreeAuthority({}), /identity count drifted/);
  assert.throws(
    () => assertCurrentTreeAuthority({ [liveWorkflow("malformed", "fixture")]: "on: [pull_request\n" }),
    /Command failed/,
  );
});

test("the seven non-PR workflows remain outside the PR cancellation mandate", () => {
  const sources = readWorkflowSources();
  assertDeniedAuthorities(sources);

  const missing = { ...sources };
  delete missing[DENIED[0]];
  assert.throws(() => assertDeniedAuthorities(missing), /missing or renamed/);

  const renamed = { ...sources };
  renamed[liveWorkflow("renamed", "denied", "fixture")] = renamed[DENIED[0]];
  delete renamed[DENIED[0]];
  assert.throws(() => assertDeniedAuthorities(renamed), /missing or renamed/);

  const duplicated = [...DENIED];
  duplicated[1] = duplicated[0];
  assert.throws(() => assertDeniedAuthorities(sources, duplicated), /ordering\/correspondence drifted/);

  assert.throws(
    () => assertDeniedAuthorities(sources, [...DENIED].reverse()),
    /ordering\/correspondence drifted/,
  );

  const byteDrift = { ...sources };
  byteDrift[DENIED[0]] = `${byteDrift[DENIED[0]]}\n`;
  assert.throws(() => assertDeniedAuthorities(byteDrift), /denied workflow bytes changed/);
});

test("missing concurrency reversion turns the real repository scan red", () => {
  expectMutationFailure("missing", (sources) => {
    const name = liveWorkflow("framework", "major", "guard");
    sources[name] = removePolicy(sources[name]);
  }, "missing or non-object top-level concurrency policy");
});

test("github.workflow identity reversion turns the real repository scan red", () => {
  expectMutationFailure("workflow-name", (sources) => {
    const name = liveWorkflow("issue", "1423", "stay", "discovery", "tests");
    sources[name] = replacePolicy(sources[name], "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}", NORMAL_CANCEL);
  }, "github.workflow is collision-prone");
});

test("github.ref non-PR fallback reversion turns the real repository scan red", () => {
  expectMutationFailure("ref-fallback", (sources) => {
    const name = liveWorkflow("ci", "batch");
    sources[name] = replacePolicy(sources[name], "ci-ci-batch-${{ github.event.pull_request.number || github.ref }}", NORMAL_CANCEL);
  }, "github.ref/head_ref can pending-displace non-PR runs");
});

test("unconditional cancellation reversion turns the real repository scan red", () => {
  expectMutationFailure("unconditional", (sources) => {
    const name = liveWorkflow("mingla", "business", "jest", "suite");
    sources[name] = replacePolicy(sources[name], expectedGroup(name), true);
  }, "unconditional cancellation reaches non-PR events");
});

test("pull_request_target mis-scope reversion turns the real repository scan red", () => {
  expectMutationFailure("target", (sources) => {
    const name = liveWorkflow("bundle", "baseline", "provenance", "guard");
    sources[name] = replacePolicy(sources[name], expectedGroup(name), "${{ github.event_name == 'pull_request' }}");
  }, "wrong pull_request_target cancellation scope");
});

test("load-smoke cancellation reversion turns the real repository scan red", () => {
  expectMutationFailure("load", (sources) => {
    const name = liveWorkflow("load", "smoke");
    sources[name] = replacePolicy(sources[name], LOAD_GROUP, true);
  }, "external-POST exception must be run-unique and non-cancellable");
});

test("strict-grep manifest wires the guard in both modes and this suite in class A", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".github/scripts/strict-grep/MANIFEST.json"), "utf8"));
  const byScript = new Map(manifest.gates.map((entry) => [entry.script, entry]));
  assert.deepEqual(byScript.get(".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.mjs"), {
    script: ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.mjs",
    kind: "file",
    enforcement: "batch:A",
    invocation: "node",
    modes: ["plain", "self-test"],
    selfTest: "wired",
    jobKeys: ["issue-2851-pr-concurrency-policy"],
  });
  assert.deepEqual(byScript.get(".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.implementor.test.mjs"), {
    script: ".github/scripts/strict-grep/issue-2851-pr-concurrency-policy.implementor.test.mjs",
    kind: "file",
    enforcement: "batch:A",
    invocation: "node --test",
    modes: ["plain"],
    selfTest: "none",
    jobKeys: ["issue-2851-pr-concurrency-policy-implementor"],
  });
});
