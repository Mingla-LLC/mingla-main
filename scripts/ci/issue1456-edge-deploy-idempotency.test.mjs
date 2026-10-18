import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chmod, copyFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CONTRACT_PATH,
  CONTRACT_SHA256,
} from "../../.github/scripts/ci-discovery/function-policy.mjs";

// MINGLA-INVARIANT: I-3645-EDGE-LANE-BOOTSTRAP-SEAL | issue #3645 | The edge idempotency lane proves the checked-in function contract matches the bootstrap seal before deployment behavior is trusted.
const repoRoot = resolve(import.meta.dirname, "../..");
const deploySource = join(repoRoot, "scripts/deploy-supabase-functions.sh");
const serveSource = join(repoRoot, "scripts/serve-supabase-functions.sh");
const originalConfig = "project_id = \"fixture\"\n\n[functions.legacy]\nverify_jwt = true\n";
const originalBake = 'export const BAKED_RELEASE_SHA = "0000000000000000000000000000000000000000";\n';

// I-3645-EDGE-LANE-BOOTSTRAP-SEAL: this test is in the lane's frozen PR/main
// path scope, so a recovery cannot report green while its real contract seal
// remains stale. Keep the bytes raw: function-policy.mjs seals the file bytes.
const contractBytes = await readFile(CONTRACT_PATH);
assert.equal(crypto.createHash("sha256").update(contractBytes).digest("hex"), CONTRACT_SHA256);

// [TEST-MOD-APPROVED #3643] The fixture now runs copied wrappers in a temporary
// repository so effective-config materialization and restoration are observable
// without ever mutating the tracked checkout.
async function fixture(mode) {
  const root = await mkdtemp(join(tmpdir(), `mingla-1456-${mode}-`));
  const scriptsRoot = join(root, "scripts");
  const binRoot = join(root, "bin");
  const callsPath = join(root, "calls.txt");
  const nodeCallsPath = join(root, "node-calls.txt");
  const configPath = join(root, "supabase/config.toml");
  const bakePath = join(root, "supabase/functions/_shared/releaseAttestationBake.ts");
  const deployScript = join(scriptsRoot, "deploy-supabase-functions.sh");
  const serveScript = join(scriptsRoot, "serve-supabase-functions.sh");
  await mkdir(join(root, ".github/scripts/ci-discovery"), { recursive: true });
  await mkdir(join(root, "supabase/functions/_shared"), { recursive: true });
  await mkdir(binRoot, { recursive: true });
  await mkdir(scriptsRoot, { recursive: true });
  await writeFile(configPath, originalConfig);
  await writeFile(bakePath, originalBake);
  await copyFile(deploySource, deployScript);
  await copyFile(serveSource, serveScript);
  await chmod(deployScript, 0o755);
  await chmod(serveScript, 0o755);

  const supabaseMock = `#!/usr/bin/env bash
set -u
false_count=$(grep -c '^verify_jwt = false$' "$ISSUE1456_CONFIG" || true)
printf '%s|jwt_false=%s\n' "$*" "$false_count" >> "$ISSUE1456_CALLS"
action="$2"
name="$3"
if [[ "$ISSUE1456_MODE" == serve-interrupt && "$action" == serve ]]; then exit 130; fi
if [[ "$action" == deploy && "$name" == beta ]]; then
  if [[ "$ISSUE1456_MODE" == duplicate ]]; then
    printf '%s\n' 'unexpected deploy status 409: {"message":"deployment already exists"}' >&2
  else
    printf '%s\n' 'unexpected deploy status 409: {"message":"different conflict"}' >&2
  fi
  exit 1
fi
printf 'completed %s %s\n' "$action" "$name"
`;
  const mockPath = join(binRoot, "supabase");
  await writeFile(mockPath, supabaseMock);
  await chmod(mockPath, 0o755);

  // [TEST-MOD-APPROVED #3643] The copied wrapper fixture now records the
  // remediation coordinator separately from Supabase CLI calls so cleanup and
  // exact child-status propagation are observable without weakening any
  // existing normal-deploy, serve, interruption, or materialization proof.
  const nodeStub = join(binRoot, "node");
  await writeFile(nodeStub, `#!/usr/bin/env bash
set -u
if [[ "$*" == *function-policy.mjs* ]]; then
  if [[ "$ISSUE1456_MODE" == materialize-fail ]]; then exit 73; fi
  target="\${@: -1}"
  printf '%s\n' 'project_id = "fixture"' '' '[functions.legacy]' 'verify_jwt = true' '' '# synthetic future policy' '[functions.future-local]' 'verify_jwt = false' > "$target"
fi
if [[ "$1" == */reconcile-governed-secrets.mjs ]]; then
  false_count=$(grep -c '^verify_jwt = false$' "$ISSUE1456_CONFIG" || true)
  printf 'coordinator|mode=remediation|args=%s|jwt_false=%s\n' "\${*:2}" "$false_count" >> "$ISSUE1456_NODE_CALLS"
  if [[ "$ISSUE1456_MODE" == remediation-fail ]]; then exit 71; fi
  if [[ "$ISSUE1456_MODE" == remediation-signal ]]; then exit 130; fi
fi
if [[ "$1" == */postdeploy-governed-fallback-watch.mjs ]]; then
  printf 'fallback-watch|args=%s\n' "\${*:2}" >> "$ISSUE1456_NODE_CALLS"
fi
exit 0
`);
  await chmod(nodeStub, 0o755);
  return { root, binRoot, callsPath, nodeCallsPath, configPath, bakePath, deployScript, serveScript };
}

async function calls(path) {
  try {
    const source = await readFile(path, "utf8");
    return source.trim() ? source.trim().split("\n") : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function runDeploy(mode) {
  const current = await fixture(mode);
  const result = spawnSync("bash", [
    current.deployScript,
    "--project-ref", "gqnoajqerqhnvulmnyvv",
    "--merged-commit", "0123456789abcdef0123456789abcdef01234567",
    "--function", "alpha", "--function", "beta", "--function", "gamma",
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${current.binRoot}:${process.env.PATH}`,
      SUPABASE_PROJECT_ID: "gqnoajqerqhnvulmnyvv",
      ISSUE1456_CALLS: current.callsPath,
      ISSUE1456_NODE_CALLS: current.nodeCallsPath,
      ISSUE1456_CONFIG: current.configPath,
      ISSUE1456_MODE: mode,
    },
  });
  return {
    ...current,
    result,
    calls: await calls(current.callsPath),
    nodeCalls: await calls(current.nodeCallsPath),
    restoredConfig: await readFile(current.configPath, "utf8"),
    restoredBake: await readFile(current.bakePath, "utf8"),
  };
}

async function runRemediation(mode) {
  const current = await fixture(mode);
  const result = spawnSync("bash", [
    current.deployScript,
    "--issue-2241-remediation",
    "--project-ref", "gqnoajqerqhnvulmnyvv",
    "--merged-commit", "0123456789abcdef0123456789abcdef01234567",
    "--function", "alpha",
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${current.binRoot}:${process.env.PATH}`,
      SUPABASE_PROJECT_ID: "gqnoajqerqhnvulmnyvv",
      ISSUE1456_CALLS: current.callsPath,
      ISSUE1456_NODE_CALLS: current.nodeCallsPath,
      ISSUE1456_CONFIG: current.configPath,
      ISSUE1456_MODE: mode,
    },
  });
  return {
    ...current,
    result,
    calls: await calls(current.callsPath),
    nodeCalls: await calls(current.nodeCallsPath),
    restoredConfig: await readFile(current.configPath, "utf8"),
    restoredBake: await readFile(current.bakePath, "utf8"),
  };
}

async function runServe(mode) {
  const current = await fixture(mode);
  const result = spawnSync("bash", [current.serveScript, "--function", "future-local"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${current.binRoot}:${process.env.PATH}`,
      ISSUE1456_CALLS: current.callsPath,
      ISSUE1456_NODE_CALLS: current.nodeCallsPath,
      ISSUE1456_CONFIG: current.configPath,
      ISSUE1456_MODE: mode,
    },
  });
  return {
    ...current,
    result,
    calls: await calls(current.callsPath),
    restoredConfig: await readFile(current.configPath, "utf8"),
  };
}

const duplicate = await runDeploy("duplicate");
assert.equal(duplicate.result.status, 0, duplicate.result.stderr);
assert.equal(duplicate.calls.length, 3, "the exact duplicate response must not starve later functions");
assert.match(duplicate.calls[2], /gamma/);
assert.ok(duplicate.calls.every((call) => !call.includes("--no-verify-jwt")));
assert.ok(duplicate.calls.every((call) => call.includes("--use-api")));
// [TEST-MOD-APPROVED #3643] The prior project-ref-only assertion now also
// proves wrapper-owned effective config and cleanup without weakening identity.
assert.ok(duplicate.calls.every((call) => call.endsWith("jwt_false=1")), "deploy must observe effective JWT-false config");
assert.ok(duplicate.calls.every((call) => call.includes("--project-ref gqnoajqerqhnvulmnyvv")));
assert.equal(duplicate.restoredConfig, originalConfig);
assert.equal(duplicate.restoredBake, originalBake);

const conflict = await runDeploy("other-conflict");
assert.notEqual(conflict.result.status, 0, "any different deployment failure must stay fatal");
assert.equal(conflict.calls.length, 2, "a real failure must stop before the next function");
assert.doesNotMatch(conflict.calls.join("\n"), /gamma/);
assert.equal(conflict.restoredConfig, originalConfig);
assert.equal(conflict.restoredBake, originalBake);

const materializeFailure = await runDeploy("materialize-fail");
assert.equal(materializeFailure.result.status, 73);
assert.deepEqual(materializeFailure.calls, [], "materialization failure must invoke no Supabase command");
assert.deepEqual(materializeFailure.nodeCalls, [], "materialization failure must invoke no coordinator");
assert.equal(materializeFailure.restoredConfig, originalConfig);

// [TEST-MOD-APPROVED #3643] These append-only runtime cases prove the terminal
// remediation child returns through the wrapper's EXIT cleanup trap on success,
// an ordinary nonzero verdict, and signal-shaped status 130.
const remediationSuccess = await runRemediation("remediation-success");
assert.equal(remediationSuccess.result.status, 0, remediationSuccess.result.stderr);
assert.deepEqual(remediationSuccess.calls, [], "remediation must not invoke the Supabase CLI");
assert.equal(remediationSuccess.nodeCalls.length, 1, "remediation coordinator cardinality");
assert.match(remediationSuccess.nodeCalls[0], /^coordinator\|mode=remediation\|/);
assert.match(remediationSuccess.nodeCalls[0], /--project-ref gqnoajqerqhnvulmnyvv/);
assert.match(remediationSuccess.nodeCalls[0], /--function alpha/);
assert.match(remediationSuccess.nodeCalls[0], /--merged-commit 0123456789abcdef0123456789abcdef01234567/);
// [TEST-MOD-APPROVED #3720] The old assertion required the wrapper to replace
// the sealed config before starting the coordinator. That generated file then
// failed the coordinator's own bootstrap-seal verification. The coordinator
// now reads the sealed config and materializes its effective policy internally.
assert.match(remediationSuccess.nodeCalls[0], /jwt_false=0$/);
assert.doesNotMatch(remediationSuccess.nodeCalls[0], /--normal-governed-deploy|fallback-watch/);
assert.equal(remediationSuccess.restoredConfig, originalConfig);
assert.equal(remediationSuccess.restoredBake, originalBake);

const remediationFailure = await runRemediation("remediation-fail");
assert.equal(remediationFailure.result.status, 71, "coordinator status 71 must propagate exactly");
assert.deepEqual(remediationFailure.calls, [], "failed remediation must run no later Supabase command");
assert.equal(remediationFailure.nodeCalls.length, 1, "failed remediation must stop after its coordinator");
assert.match(remediationFailure.nodeCalls[0], /^coordinator\|mode=remediation\|/);
assert.doesNotMatch(remediationFailure.nodeCalls[0], /--normal-governed-deploy|fallback-watch/);
assert.equal(remediationFailure.restoredConfig, originalConfig);
assert.equal(remediationFailure.restoredBake, originalBake);

const remediationSignal = await runRemediation("remediation-signal");
assert.equal(remediationSignal.result.status, 130, "signal-shaped coordinator status must propagate exactly");
assert.deepEqual(remediationSignal.calls, [], "status 130 must run no later Supabase command");
assert.equal(remediationSignal.nodeCalls.length, 1, "status 130 must stop after its coordinator");
assert.match(remediationSignal.nodeCalls[0], /^coordinator\|mode=remediation\|/);
assert.doesNotMatch(remediationSignal.nodeCalls[0], /--normal-governed-deploy|fallback-watch/);
assert.equal(remediationSignal.restoredConfig, originalConfig);
assert.equal(remediationSignal.restoredBake, originalBake);

const served = await runServe("serve-success");
assert.equal(served.result.status, 0, served.result.stderr);
assert.deepEqual(served.calls, ["functions serve future-local|jwt_false=1"]);
assert.equal(served.restoredConfig, originalConfig);

const interrupted = await runServe("serve-interrupt");
assert.equal(interrupted.result.status, 130);
assert.deepEqual(interrupted.calls, ["functions serve future-local|jwt_false=1"]);
assert.equal(interrupted.restoredConfig, originalConfig);

const serveMaterializeFailure = await runServe("materialize-fail");
assert.equal(serveMaterializeFailure.result.status, 73);
assert.deepEqual(serveMaterializeFailure.calls, []);
assert.equal(serveMaterializeFailure.restoredConfig, originalConfig);

console.log("issue #1456 deployment idempotency and effective-policy wrappers: PASS");
