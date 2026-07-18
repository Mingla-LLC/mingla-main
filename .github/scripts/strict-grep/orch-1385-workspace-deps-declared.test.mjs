/**
 * ORCH-1385 — adversarial companion for
 * orch-1385-workspace-deps-declared.mjs (I-PROPOSED-1385-WORKSPACE-DEPS-DECLARED).
 *
 * Proves, via child-process runs of the REAL gate script (not re-implemented
 * logic — provenance-safe per COMMS-0106 rule 1):
 *  1. The gate passes on the real repo tree (happy path: the ORCH-1385 fix
 *     declared every consumed @mingla/* package in both apps).
 *  2. The gate's --self-test passes (its fixture matrix is intact).
 *  3. checkApp (imported from the gate module itself, so a regex/logic edit
 *     in the gate is exercised, not a copy) FAILS a fixture reproducing the
 *     EXACT #925 shape: mingla-business importing @mingla/phone-input in a
 *     buyer.tsx with no declaration.
 *  4. checkApp stays failed if the declaration uses a registry version
 *     instead of file: (the sneaky half-revert).
 *
 * Run: node --test .github/scripts/strict-grep/orch-1385-workspace-deps-declared.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkApp,
  referencedMinglaPackages,
} from "./orch-1385-workspace-deps-declared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(__dirname, "orch-1385-workspace-deps-declared.mjs");

const runGate = (args = []) => {
  try {
    const stdout = execFileSync(process.execPath, [GATE, ...args], {
      encoding: "utf8",
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 2, stdout: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

test("gate passes on the real repo tree (ORCH-1385 fix in place)", () => {
  const { code, stdout } = runGate();
  assert.equal(
    code,
    0,
    `gate must exit 0 on the fixed tree; got ${code}: ${stdout}`,
  );
  assert.match(stdout, /PASS/);
});

test("gate self-test matrix is intact", () => {
  const { code, stdout } = runGate(["--self-test"]);
  assert.equal(code, 0, `self-test must exit 0; got ${code}: ${stdout}`);
  assert.match(stdout, /8\/8/);
});

test("the exact #925 shape fails: buyer.tsx imports @mingla/phone-input undeclared", () => {
  const failures = [];
  checkApp(
    "mingla-business",
    {
      "mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx":
        'import { PhoneInput, type PhoneInputTheme } from "@mingla/phone-input";',
    },
    { dependencies: { expo: "~57.0.6" } }, // no @mingla declaration — the pre-fix state
    failures,
    () => true,
  );
  assert.equal(failures.length, 1, JSON.stringify(failures));
  assert.match(failures[0], /@mingla\/phone-input/);
  assert.match(failures[0], /does not declare/);
});

test("registry-version declaration (non-file:) is still a failure", () => {
  const failures = [];
  checkApp(
    "mingla-business",
    {
      "mingla-business/src/x.tsx": 'import { X } from "@mingla/phone-input";',
    },
    { dependencies: { "@mingla/phone-input": "^0.0.0" } },
    failures,
    () => true,
  );
  assert.equal(failures.length, 1, JSON.stringify(failures));
  assert.match(failures[0], /file:\.\.\/packages\/phone-input/);
});

test("subpath and require/dynamic-import forms attribute to the base package", () => {
  const refs = referencedMinglaPackages(
    'import a from "@mingla/offering-rendering/tokens";\n' +
      'const b = require("@mingla/phone-input");\n' +
      'const c = await import("@mingla/brand-rendering");\n' +
      'import "@mingla/theme-animations";',
  );
  assert.deepEqual(
    [...refs].sort(),
    [
      "@mingla/brand-rendering",
      "@mingla/offering-rendering",
      "@mingla/phone-input",
      "@mingla/theme-animations",
    ],
  );
});
