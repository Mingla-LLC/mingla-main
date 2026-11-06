// Issue #4275 P1-2 — the repo's full file listing passed Node's 1 MiB default buffer.
//
// Past it, execFileSync throws ENOBUFS, and the validator reported that as "requires
// a git worktree". Every caller that lists the whole repo must set maxBuffer.
//
// FAILS-ON-REVERT: drop maxBuffer from any listed caller and this fails. The real
// proof is the registry validator on the merged tree, recorded on #4275.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../../../../", import.meta.url);
const CALLERS = [
  ".github/scripts/ci-batch/validate-manifest-v2.mjs",
  ".github/scripts/ci-batch/author-postgres-wave.mjs",
  ".github/scripts/ci-batch/__tests__/issue-2438-postgres-wave-shadow-parity.implementor.test.mjs",
  ".github/scripts/ci-batch/__tests__/issue-2882-origin-paths-routing.implementor.test.mjs",
  ".github/scripts/ci-batch/__tests__/issue-2882-routing-cannot-select-silently.tester.test.mjs",
  ".github/scripts/ci-batch/__tests__/issue-3072-live-provider-routing.implementor.test.mjs",
  ".github/scripts/strict-grep/issue-1001-dead-logo-urls.mjs",
  ".github/scripts/strict-grep/issue-1203-secret-capacity.mjs",
  ".github/scripts/strict-grep/issue-1221-source-refund-control-plane.mjs",
  ".github/scripts/strict-grep/issue-2113-empty-window-negative-assertion.mjs",
];

Deno.test("every caller that lists the repo sets maxBuffer", () => {
  for (const path of CALLERS) {
    const source = Deno.readTextFileSync(new URL(path, root));
    const calls = [...source.matchAll(/(?:execFileSync|spawnSync)\(\s*"git",\s*\["ls-files"[^)]*\)/g)];
    assert(calls.length > 0, `${path} no longer lists files here; update this test`);
    for (const call of calls) {
      if (/--error-unmatch/.test(call[0])) continue;
      assert(/maxBuffer/.test(call[0]), `${path}: ${call[0].slice(0, 80)}`);
    }
  }
});

Deno.test("a buffer failure says what it is", () => {
  const source = Deno.readTextFileSync(new URL(".github/scripts/ci-batch/validate-manifest-v2.mjs", root));
  assert(/error\?\.code === "ENOBUFS"/.test(source), "not reported as a missing worktree");
});
