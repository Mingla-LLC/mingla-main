/**
 * TESTER-AUTHORED adversarial companion for issue #967 (D-8): app-mobile/scripts/ci
 * dark-gate triage — the P11 external-totality enforcement (the change's CENTERPIECE).
 *
 * ANGLE — a DIFFERENT axis than the implementor's happy-path (which proves the 43
 * newly-wired/converted gates RUN GREEN). This test attacks the *enforcement machinery*
 * #967 installs: adding "app-mobile/scripts/ci" to MANIFEST.externalGateDirs makes
 * meta-1383's P11 sweep that dir for TOTALITY — every on-disk .mjs must appear in
 * gates[] exactly once. Two silent-drift modes must now be caught forever:
 *   (a) unregistered-ADD  — a NEW .mjs dropped into the dir but never registered → P11
 *   (b) registered-DELETE — a registered gate whose file vanishes from disk       → P2
 * Both are proven NON-VACUOUSLY: inject → meta-1383 goes RED naming the exact violation;
 * restore → meta-1383 goes GREEN again. Before #967 externalGateDirs was [] and NEITHER
 * (a) nor (b) under app-mobile/scripts/ci would trip anything — so this file is a live
 * regression guard on the centerpiece itself, not on the gates' own logic.
 *
 * MECHANISM — invokes the REAL shipped meta-1383 CLI via child_process against the REAL
 * working tree (not synthetic runChecks() inputs), so the assertion is on the gate's
 * true end-to-end behavior. #958 masking note: the child is a plain `node <script>`
 * (NOT a nested `node --test`), and NODE_TEST_CONTEXT is stripped from the child env, so
 * no child failure can be silently masked — every violation surfaces via the child exit
 * code and combined output this test asserts on.
 *
 * HOME — registered batch:B (NOT batch:A) on purpose: meta-1383 imports `yaml`, which CI
 * installs ONLY in the class-B job (strict-grep-mingla-business.yml). meta-1383 itself is
 * batch:B for the same reason. Running this in class A (no yaml) would make the child
 * crash on `import('yaml')` and produce a false red.
 *
 * Run: `node --test orch-967-p11-external-totality.tester.test.mjs`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, renameSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __tests__ → strict-grep → scripts → .github → repo root (cwd-independent).
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const META = join(__dirname, "..", "meta-1383-manifest-parity.mjs");
const MANIFEST = join(__dirname, "..", "MANIFEST.json");
const EXT_DIR_REL = "app-mobile/scripts/ci";
const EXT_DIR_ABS = join(REPO_ROOT, EXT_DIR_REL);

// Invoke the SHIPPED meta-1383 CLI against the real disk. NODE_TEST_CONTEXT stripped
// (#958) so nothing about the parent test runner leaks into / masks the child.
function runMeta() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const p = spawnSync(process.execPath, [META], { cwd: REPO_ROOT, encoding: "utf8", env });
  if (p.error) throw p.error; // spawn failure is a hard error, never a silent pass
  return { code: p.status, out: `${p.stdout || ""}${p.stderr || ""}` };
}

test("ORCH-967 P11 external-totality — unregistered-add (P11) + registered-delete (P2), non-vacuous", async (t) => {
  // Precondition: externalGateDirs actually lists the dir — else the whole enforcement is off
  // and this test would be vacuously satisfied. Assert the centerpiece is present.
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  assert.ok(
    Array.isArray(manifest.externalGateDirs) && manifest.externalGateDirs.includes(EXT_DIR_REL),
    `precondition: MANIFEST.externalGateDirs must include "${EXT_DIR_REL}" (the #967 centerpiece), ` +
      `got ${JSON.stringify(manifest.externalGateDirs)}`
  );

  // Baseline: the shipped tree must be GREEN before we perturb anything.
  const base = runMeta();
  assert.equal(base.code, 0, `baseline meta-1383 must PASS before injection, got exit ${base.code}:\n${base.out}`);

  // ── (a) unregistered-ADD → P11 totality catch ─────────────────────────────────────
  await t.test("an UNREGISTERED new .mjs in app-mobile/scripts/ci makes meta-1383 FAIL (P11)", () => {
    const probe = join(EXT_DIR_ABS, `__orch967_p11_probe_${process.pid}_${Date.now()}.mjs`);
    try {
      writeFileSync(probe, "// ORCH-967 tester transient P11 probe — not a real gate\nprocess.exit(0);\n");
      const red = runMeta();
      assert.notEqual(red.code, 0, `meta-1383 must FAIL with an unregistered .mjs on disk, but it exited 0:\n${red.out}`);
      assert.match(red.out, /P11:/, `expected a P11 totality violation, got:\n${red.out}`);
      assert.ok(
        red.out.includes(basename(probe)) && /ABSENT from/.test(red.out),
        `P11 must name the unregistered file "${basename(probe)}" as ABSENT from MANIFEST, got:\n${red.out}`
      );
    } finally {
      if (existsSync(probe)) rmSync(probe); // guaranteed restore even on assertion throw
    }
    // Non-vacuous: with the probe gone, meta-1383 is GREEN again.
    const restored = runMeta();
    assert.equal(restored.code, 0, `meta-1383 must PASS again after removing the probe, got exit ${restored.code}:\n${restored.out}`);
  });

  // ── (b) registered-DELETE → P2 dangling-registration catch ────────────────────────
  await t.test("DELETING a registered app-mobile/scripts/ci gate file makes meta-1383 FAIL (P2)", () => {
    const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
    const victim = m.gates
      .map((g) => g.script)
      .filter(
        (s) =>
          typeof s === "string" &&
          s.startsWith(`${EXT_DIR_REL}/`) &&
          s.endsWith(".mjs") &&
          existsSync(join(REPO_ROOT, s))
      )
      .sort()[0]; // deterministic pick — not brittle to any one filename
    assert.ok(victim, `precondition: expected at least one registered .mjs gate under ${EXT_DIR_REL}`);
    const abs = join(REPO_ROOT, victim);
    // Stash with a NON-.mjs suffix so P11's `.mjs` walk ignores it — isolates the P2 catch
    // (registered row with no on-disk file) instead of also tripping P11 on a renamed .mjs.
    const stash = `${abs}.orch967bak`;
    try {
      renameSync(abs, stash);
      const red = runMeta();
      assert.notEqual(red.code, 0, `meta-1383 must FAIL when registered gate "${victim}" is missing from disk, but it exited 0:\n${red.out}`);
      assert.match(red.out, /P2:/, `expected a P2 stale-manifest-row violation, got:\n${red.out}`);
      assert.ok(
        red.out.includes(victim) && /no such file exists/.test(red.out),
        `P2 must name the deleted gate "${victim}" as having no file on disk, got:\n${red.out}`
      );
    } finally {
      if (existsSync(stash)) renameSync(stash, abs); // guaranteed restore even on assertion throw
    }
    // Non-vacuous: with the file restored, meta-1383 is GREEN again.
    const restored = runMeta();
    assert.equal(restored.code, 0, `meta-1383 must PASS again after restoring "${victim}", got exit ${restored.code}:\n${restored.out}`);
  });
});
