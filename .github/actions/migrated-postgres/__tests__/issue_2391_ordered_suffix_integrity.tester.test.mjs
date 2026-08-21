import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const action = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
const prefixVerifier = new URL("../verify-applied-prefix.sh", import.meta.url);

function verifyPrefix(dir, applied) {
  const appliedPath = join(dir, "applied.txt");
  const repoPath = join(dir, "repo.txt");
  writeFileSync(appliedPath, `${applied.join("\n")}\n`);
  writeFileSync(repoPath, "001.sql\n002.sql\n003.sql\n004.sql\n");
  return spawnSync("bash", [prefixVerifier.pathname, appliedPath, repoPath], {
    encoding: "utf8",
  });
}

test("#2391 tester: only an exact ordered prefix may receive an incremental suffix", () => {
  const dir = mkdtempSync(join(tmpdir(), "issue-2391-ordered-suffix-"));
  try {
    assert.equal(
      verifyPrefix(dir, ["001.sql", "002.sql", "003.sql"]).status,
      0,
      "a valid ordered prefix lost the cache top-up path",
    );
    assert.equal(
      verifyPrefix(dir, ["001.sql", "003.sql"]).status,
      1,
      "a missing middle migration was applied out of repository order",
    );
    assert.equal(
      verifyPrefix(dir, ["001.sql", "002.sql", "002.sql", "003.sql"]).status,
      1,
      "a duplicate applied-migration row was trusted",
    );
    assert.equal(
      verifyPrefix(dir, ["001.sql", "003.sql", "002.sql"]).status,
      1,
      "an unsorted applied-migration manifest was trusted",
    );
    assert.equal(
      verifyPrefix(dir, ["001.sql", "002.sql", "999.sql"]).status,
      1,
      "a snapshot containing a migration absent from the repository was trusted",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#2391 tester: ordered-prefix rejection executes before snapshot restore", () => {
  const unknownCheck = action.indexOf(
    'if comm -23 "$APPLIED" /tmp/repo-migrations.txt | grep -q .; then',
  );
  const deltaDerivation = action.indexOf(
    'comm -13 "$APPLIED" /tmp/repo-migrations.txt > /tmp/delta.txt',
  );
  const newestBinding = action.indexOf('NEWEST_IN_SNAP=$(tail -n1 "$APPLIED")');
  const orderCheck = action.indexOf(
    '"$(sort /tmp/delta.txt | head -n1)" \\< "$NEWEST_IN_SNAP"',
  );
  const incrementalMode = action.indexOf("MODE=incremental", orderCheck);
  const restore = action.indexOf('if [ "$MODE" = incremental ]; then');

  for (const [label, index] of [
    ["unknown-migration rejection", unknownCheck],
    ["suffix derivation", deltaDerivation],
    ["snapshot newest binding", newestBinding],
    ["out-of-order suffix rejection", orderCheck],
    ["incremental-mode assignment", incrementalMode],
    ["physical restore", restore],
  ]) {
    assert.ok(index >= 0, `action lost ${label}`);
  }
  assert.ok(unknownCheck < deltaDerivation, "unknown migrations are checked after suffix derivation");
  assert.ok(deltaDerivation < newestBinding, "snapshot boundary is bound before deriving the suffix");
  assert.ok(newestBinding < orderCheck, "suffix ordering is checked before binding the snapshot boundary");
  assert.ok(orderCheck < incrementalMode, "incremental mode is selected before the order guard");
  assert.ok(incrementalMode < restore, "physical restore can begin before prefix integrity passes");
});
