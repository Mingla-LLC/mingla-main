import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const ORIGINAL_CONFIG = 'project_id = "fixture"\n\n[functions.probe]\nverify_jwt = true\n';

function waitForFile(file, timeoutMs = 2_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (existsSync(file)) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error(`timed out waiting for ${file}`));
      setTimeout(poll, 10);
    };
    poll();
  });
}

function runDeploy(root, bin, materializedMarker, supabaseMarker) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [
      path.join(root, "scripts/deploy-supabase-functions.sh"),
      "--project-ref",
      "unrelatedprojectref",
      "--merged-commit",
      "0123456789abcdef0123456789abcdef01234567",
      "--function",
      "probe",
    ], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        MATERIALIZED_MARKER: materializedMarker,
        SUPABASE_MARKER: supabaseMarker,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

test("parallel deploy wrappers serialize effective config materialization and restore the tracked file", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "mingla-3643-config-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const config = path.join(root, "supabase/config.toml");
  const materializedMarker = path.join(root, "materialized");
  const supabaseMarker = path.join(root, "supabase-called");
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(root, "scripts/ops"), { recursive: true });
  mkdirSync(path.join(root, ".github/scripts/ci-discovery"), { recursive: true });
  mkdirSync(path.join(root, "supabase/functions/probe"), { recursive: true });
  mkdirSync(path.join(root, "supabase/functions/_shared"), { recursive: true });
  copyFileSync(
    path.join(ROOT, "scripts/deploy-supabase-functions.sh"),
    path.join(root, "scripts/deploy-supabase-functions.sh"),
  );
  writeFileSync(config, ORIGINAL_CONFIG);
  writeFileSync(path.join(root, "supabase/functions/probe/index.ts"), "export {};\n");
  writeFileSync(
    path.join(root, "supabase/functions/_shared/releaseAttestationBake.ts"),
    'export const BAKED_RELEASE_SHA = "0000000000000000000000000000000000000000";\n',
  );

  const nodeStub = path.join(bin, "node");
  writeFileSync(nodeStub, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == *function-policy.mjs ]]; then
  target="\${@: -1}"
  if ! grep -q 'project_id = "fixture"' "$target"; then
    echo 'config:bootstrap_seal_mismatch:concurrent-write' >&2
    exit 77
  fi
  printf '%s\n' 'project_id = "fixture"' '' '[functions.probe]' 'verify_jwt = false' > "$target"
  printf 'materialized\n' >> "$MATERIALIZED_MARKER"
  sleep 0.3
  exit 0
fi
if [[ "$1" == *verify-production-supabase-authority.mjs ]]; then exit 0; fi
if [[ "$1" == *preflight-function-secret-readiness.mjs ]]; then exit 0; fi
if [[ "$1" == *postdeploy-governed-fallback-watch.mjs ]]; then exit 0; fi
exit 99
`);
  chmodSync(nodeStub, 0o755);
  const supabaseStub = path.join(bin, "supabase");
  writeFileSync(supabaseStub, `#!/usr/bin/env bash
printf 'called\n' >> "$SUPABASE_MARKER"
exit 0
`);
  chmodSync(supabaseStub, 0o755);

  const first = runDeploy(root, bin, materializedMarker, supabaseMarker);
  await waitForFile(materializedMarker);
  const second = runDeploy(root, bin, materializedMarker, supabaseMarker);
  const results = await Promise.all([first, second]);

  // [TEST-MOD-APPROVED #3720] The old fixture intentionally failed authority
  // after config generation, pinning mutation before validation. Both complete
  // deploy fixtures now reach the materialization window, where the same lock
  // and restoration invariant is exercised without blessing that unsafe order.
  assert.deepEqual(results.map(({ status }) => status), [0, 0]);
  for (const result of results) {
    assert.doesNotMatch(result.stderr, /bootstrap_seal_mismatch/);
  }
  assert.equal(readFileSync(config, "utf8"), ORIGINAL_CONFIG);
  assert.equal(existsSync(`${config}.materialization.lock`), false);
  assert.equal(readFileSync(supabaseMarker, "utf8"), "called\ncalled\n");
});
