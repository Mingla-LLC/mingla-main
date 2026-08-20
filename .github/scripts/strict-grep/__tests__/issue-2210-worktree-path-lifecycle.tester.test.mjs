// ISSUE-2210 — independent tester adversarial guard.
//
// Unlike the implementor's source/fake-HOME checks, this suite drives the real
// spawn and reap scripts against an isolated Git repository. It proves that:
//   * hostile bytes in either identifier — or in a parent directory — are
//     refused before even one Git command can reach the anchor;
//   * a legitimate label creates a real worktree whose leaf equals its branch;
//   * reap still removes a real legacy bracketed worktree safely; and
//   * the durable docs and COMMS correction describe the same contract.
// Every path and repository created here lives under one mkdtemp-owned root and
// is removed by this process only. The operator's anchor/worktrees are never
// passed to spawn.sh, reap.sh, or git.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");
const SPAWN = path.join(ROOT, "scripts", "orch-worktree", "spawn.sh");
const REAP = path.join(ROOT, "scripts", "orch-worktree", "reap.sh");
const GUARD = path.join(ROOT, "scripts", "orch-worktree", "assert-safe-worktree-path.sh");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function git(args, cwd) {
  const result = run("git", args, { cwd });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.output}`);
  return result.output.trim();
}

function makeRepoFixture() {
  const ownedRoot = mkdtempSync(path.join(os.tmpdir(), "issue-2210-tester-"));
  const home = path.join(ownedRoot, "home");
  const desktop = path.join(home, "Desktop");
  const anchor = path.join(desktop, "mingla-main");
  const remote = path.join(ownedRoot, "remote.git");
  mkdirSync(desktop, { recursive: true });
  git(["init", "--bare", remote], ownedRoot);
  git(["init", "-b", "main", anchor], ownedRoot);
  git(["config", "user.name", "Issue 2210 Tester"], anchor);
  git(["config", "user.email", "issue-2210-tester@example.invalid"], anchor);
  writeFileSync(path.join(anchor, "README.txt"), "isolated fixture\n");
  git(["add", "README.txt"], anchor);
  git(["commit", "-m", "fixture"], anchor);
  git(["remote", "add", "origin", remote], anchor);
  git(["push", "-u", "origin", "main"], anchor);
  return { ownedRoot, home, anchor };
}

function withFixture(body) {
  const fixture = makeRepoFixture();
  try {
    body(fixture);
  } finally {
    // This root was allocated by this test and contains no external path.
    rmSync(fixture.ownedRoot, { recursive: true, force: true });
  }
}

test("#2210 tester: hostile full paths and identifiers cannot reach the anchor", () => {
  withFixture(({ ownedRoot, home, anchor }) => {
    const bin = path.join(ownedRoot, "bin");
    const gitLog = path.join(ownedRoot, "git-calls.log");
    mkdirSync(bin);
    writeFileSync(
      path.join(bin, "git"),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$ISSUE2210_GIT_LOG"\nexit 97\n',
    );
    chmodSync(path.join(bin, "git"), 0o755);
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      ISSUE2210_GIT_LOG: gitLog,
    };
    const beforeHead = git(["rev-parse", "HEAD"], anchor);
    const beforeStatus = git(["status", "--porcelain"], anchor);

    for (const [orchId, label] of [
      ["2210", "label with space"],
      ["2210#bad", "clean-label"],
      ["2210", "clean?label"],
      ["2210", "clean\nlabel"],
    ]) {
      const result = run("bash", [SPAWN, orchId, label], { env });
      assert.equal(
        result.status,
        2,
        `hostile input ${JSON.stringify([orchId, label])} was not refused:\n${result.output}`,
      );
      assert.match(result.output, /REFUSING TO SPAWN/);
      assert.doesNotMatch(result.output, /Syncing anchor|anchor checkout not found/);
    }

    const hostileHome = path.join(ownedRoot, "parent [hostile]", "home");
    mkdirSync(path.join(hostileHome, "Desktop", "mingla-main", ".git"), { recursive: true });
    const parentResult = run("bash", [SPAWN, "2210", "clean-label"], {
      env: { ...env, HOME: hostileHome },
    });
    assert.equal(parentResult.status, 2, parentResult.output);
    assert.match(parentResult.output, /REFUSING TO SPAWN/);

    assert.equal(existsSync(gitLog), false, "a refused spawn invoked git against its anchor");
    assert.equal(git(["rev-parse", "HEAD"], anchor), beforeHead, "anchor HEAD changed on refusal");
    assert.equal(git(["status", "--porcelain"], anchor), beforeStatus, "anchor tree changed on refusal");
  });
});

test("#2210 tester: a legitimate label creates a real branch-identical worktree", () => {
  withFixture(({ home, anchor }) => {
    const result = run("bash", [SPAWN, "qa", "legitimate-path"], {
      env: { ...process.env, HOME: home },
    });
    const worktree = path.join(home, "Desktop", "mingla-orchs", "qa-legitimate-path");
    try {
      assert.equal(result.status, 0, result.output);
      assert.equal(existsSync(worktree), true, `spawn did not create ${worktree}`);
      assert.equal(git(["branch", "--show-current"], worktree), "qa-legitimate-path");
      assert.equal(path.basename(worktree), "qa-legitimate-path");
      assert.doesNotMatch(worktree, /[\[\]]/);
    } finally {
      if (existsSync(worktree)) {
        git(["worktree", "remove", "--force", worktree], anchor);
      }
      run("git", ["branch", "-D", "qa-legitimate-path"], { cwd: anchor });
    }
  });
});

test("#2210 tester: reap accepts and removes a real legacy bracketed worktree", () => {
  withFixture(({ ownedRoot, home, anchor }) => {
    const legacy = path.join(ownedRoot, "legacy-[bracketed]-worktree");
    git(["worktree", "add", "-b", "9999-tester-legacy", legacy, "main"], anchor);
    assert.equal(existsSync(legacy), true);

    const fakeGh = path.join(ownedRoot, "gh-no-pr");
    writeFileSync(fakeGh, "#!/usr/bin/env bash\nprintf '[]\\n'\n");
    chmodSync(fakeGh, 0o755);
    const bin = path.join(ownedRoot, "reap-bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "xcrun"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(path.join(bin, "xcrun"), 0o755);
    const result = run("bash", [REAP, legacy], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        ORCH_ANCHOR: anchor,
        ORCH_GH: fakeGh,
      },
    });
    assert.equal(result.status, 0, result.output);
    assert.equal(existsSync(legacy), false, "reap left the legacy worktree on disk");
    assert.equal(
      run("git", ["show-ref", "--verify", "--quiet", "refs/heads/9999-tester-legacy"], { cwd: anchor }).status,
      1,
      "reap left the legacy branch behind",
    );
  });
});

test("#2210 tester: guard, docs, reap guidance, and COMMS carry one contract", () => {
  for (const hostile of [
    "/tmp/full/path/[bad]/clean-leaf",
    "/tmp/full/path/clean leaf",
    "/tmp/full/path/clean#leaf",
    "/tmp/full/path/clean|leaf",
    "/tmp/full/path/clean\rleaf",
    "/tmp/full/path/clean\x7fleaf",
    "/tmp/full/path/caf\u00e9",
  ]) {
    const result = run("bash", [GUARD, hostile]);
    assert.equal(result.status, 2, `guard accepted ${JSON.stringify(hostile)}:\n${result.output}`);
  }

  const docs = readFileSync(path.join(ROOT, "docs", "WORKTREE_STRATEGY.md"), "utf8");
  const reap = readFileSync(REAP, "utf8");
  const comms = readFileSync(path.join(ROOT, "COMMS.md"), "utf8");
  assert.match(docs, /directory name and the branch name are identical/);
  assert.match(docs, /Path characters — hard rule \(#2210\)/);
  assert.doesNotMatch(docs, /mingla-orchs\/<ORCH_ID>-\[<short-kebab-label>\]/);
  assert.match(reap, /reaps the LEGACY bracketed/);
  assert.match(comms, /CORRECTION 2026-08-18 \(#2210\).*NARROWED to the #1544 Metro-symlink symptom/);
  assert.match(comms, /Brackets ARE the proven cause of a separate defect/);
  assert.match(comms, /existing bracketed worktrees are still NOT migrated/);
});
