import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const actionPath = new URL("../action.yml", import.meta.url);
const verifierPath = new URL("../verify-restored-snapshot.sh", import.meta.url);
const action = readFileSync(actionPath, "utf8");

function runVerifier(manifest, counts) {
  return spawnSync("bash", [verifierPath.pathname, manifest, ...counts.map(String)], {
    encoding: "utf8",
  });
}

test("#2391 verifies the physical restore before a policy-removing suffix", () => {
  const dir = mkdtempSync(join(tmpdir(), "issue-2391-"));
  const manifest = join(dir, "counts.txt");
  try {
    writeFileSync(manifest, "654 345 1475 415 446\n");

    const exactRestore = runVerifier(manifest, [654, 345, 1475, 415, 446]);
    assert.equal(exactRestore.status, 0, exactRestore.stderr);
    assert.match(exactRestore.stdout, /verified physical restore/);

    // #1985 legitimately removes two broad policies after the restore. The old
    // post-delta comparison rejects 652 < 654; the fixed action invokes the
    // verifier once, before the ON_ERROR_STOP delta loop, so that valid suffix
    // is allowed to define the new catalog.
    const postDeltaWouldDiffer = runVerifier(manifest, [652, 345, 1475, 415, 446]);
    assert.notEqual(postDeltaWouldDiffer.status, 0);

    const verifyCall = action.indexOf('bash "$VERIFY_RESTORED_SNAPSHOT" "$COUNTS"');
    const deltaLoop = action.indexOf(
      'while IFS= read -r m; do [ -n "$m" ] && { echo "  + $m"; apply "supabase/migrations/$m"; }; done < /tmp/delta.txt',
    );
    assert.ok(verifyCall >= 0, "action must execute the snapshot verifier");
    assert.ok(deltaLoop > verifyCall, "snapshot verification must precede every delta migration");
    assert.equal(
      action.indexOf('bash "$VERIFY_RESTORED_SNAPSHOT"', verifyCall + 1),
      -1,
      "snapshot counts must not be compared again after the reviewed suffix",
    );
    assert.doesNotMatch(action, /Restored database has fewer objects than the snapshot/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#2391 fails closed on corrupt or untrusted restore manifests", () => {
  const dir = mkdtempSync(join(tmpdir(), "issue-2391-corrupt-"));
  const manifest = join(dir, "counts.txt");
  try {
    writeFileSync(manifest, "654 345 1475 415 446\n");
    for (const counts of [
      [653, 345, 1475, 415, 446],
      [654, 344, 1475, 415, 446],
      [654, 345, 1474, 415, 446],
      [654, 345, 1475, 414, 446],
      [654, 345, 1475, 415, 445],
    ]) {
      const result = runVerifier(manifest, counts);
      assert.notEqual(result.status, 0, `corrupt restore unexpectedly passed: ${counts}`);
      assert.match(result.stderr, /physical database restore does not match/);
    }

    writeFileSync(manifest, "654 bad 1475 415 446\n");
    assert.notEqual(runVerifier(manifest, [654, 345, 1475, 415, 446]).status, 0);
    rmSync(manifest);
    assert.notEqual(runVerifier(manifest, [654, 345, 1475, 415, 446]).status, 0);

    assert.match(action, /\[ -f "\$COUNTS" \]/);
    assert.match(action, /comm -23 "\$APPLIED" \/tmp\/repo-migrations\.txt/);
    assert.match(action, /ON_ERROR_STOP=1/);
    assert.match(action, /order cannot be preserved, falling back to a full replay/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#2391 verifier is valid strict Bash", () => {
  execFileSync("bash", ["-n", verifierPath.pathname], { stdio: "pipe" });
});
