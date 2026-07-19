/**
 * ORCH-1385 — TESTER adversarial regression suite (CLOSE Step-0.5 leg) for
 * orch-1385-workspace-deps-declared.mjs (I-PROPOSED-1385-WORKSPACE-DEPS-DECLARED).
 *
 * TESTER-AUTHORED, attacking angles the implementor's companion
 * (orch-1385-workspace-deps-declared.test.mjs) did NOT cover. The implementor
 * covered: real-tree happy path, the gate's own self-test matrix, the exact #925 fixture
 * shape (static import undeclared), registry-version half-revert, and
 * subpath/require/dynamic-import attribution. THIS suite attacks:
 *
 *  ANGLE A  — a NEVER-SEEN workspace package (no hardcoded list?)      [T-3]
 *  ANGLE B  — surfaces the gate does not scan: app ENTRY files,
 *             mingla-business/api/, app-mobile/scripts/ (KNOWN-GAP),
 *             bracket-name route dirs (D-IMPL-1384-1 class), and the
 *             app-mobile components/ srcDir that exists only in config  [T-4..T-6]
 *  ANGLE C  — export-star / export-named / type-only / multiline forms [T-7]
 *  ANGLE D  — false-fire on comments + template literals (KNOWN-GAP-FP,
 *             fail-safe direction) and the backtick dynamic-import
 *             EVASION import(`@mingla/x`) (KNOWN-GAP)                  [T-8, T-9]
 *  ANGLE E  — declaration present but pointing at the WRONG package
 *             dir, trailing-slash and protocol-case variants           [T-10]
 *  ANGLE G  — the CI wiring itself: workflow path filters + the gate's
 *             MANIFEST.json registration (a filter-narrowing or
 *             de-registration regression goes red HERE; the pre-batch
 *             per-gate-job assertion was retired by ORCH-1400 after
 *             ORCH-1383 batched the workflow)                          [T-11]
 *  plus     — real-tree artifact binding (tester fails-on-revert case) [T-1, T-2]
 *             and the gate module's import-time side effect            [T-12]
 *
 * PROVENANCE (COMMS-0106 rule 1 — no re-implemented gate logic):
 *  - Unit probes import `referencedMinglaPackages` / `checkApp` from the REAL
 *    gate module — via a CHILD process, because importing the module also
 *    executes its main body (full real-tree scan; process.exit(1) on a broken
 *    tree would kill this runner mid-suite — see T-12). The child receives the
 *    real module path via env and imports it with pathToFileURL, which is the
 *    D-IMPL-1384-1 workaround: this repo's worktree dirnames and route dirs
 *    contain [brackets], which break naive glob/URL tooling.
 *  - E2E fixture legs execute a RUNTIME COPY of the real gate file placed at
 *    fixtureRoot/.github/scripts/strict-grep/, because the gate derives its
 *    repo root from its own file location. The copy is sha256-verified
 *    byte-identical to the real gate ON EVERY RUN — it can never drift.
 *  - Real-tree legs execute the real gate at its real path.
 *
 * KNOWN-GAP markers: where this suite PROVED a guard gap, the assertion
 * encodes the gate's CURRENT behaviour (so main stays green) with a loud
 * KNOWN-GAP comment naming the QA finding. Fixing the gap flips the
 * assertion — the fixer must consciously update it. See
 * Mingla_Artifacts/reports/TEST_ORCH-1385_PHONE_INPUT_DEP.md findings F-1..F-4.
 *
 * Run: node --test .github/scripts/strict-grep/orch-1385-workspace-deps-declared.adversarial.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const GATE = path.join(__dirname, "orch-1385-workspace-deps-declared.mjs");
const WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "strict-grep-mingla-business.yml",
);

const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Execute a node script; never throw on non-zero exit. */
const runNode = (args, opts = {}) => {
  try {
    const stdout = execFileSync(process.execPath, args, {
      encoding: "utf8",
      ...opts,
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 2, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

/**
 * Unit-probe the REAL gate module in a child process (see PROVENANCE above).
 * `expr` is an async JS expression evaluated with `m` = the real module;
 * its JSON-stringified value comes back on stdout between markers.
 */
const probeModule = (expr) => {
  const script =
    'const m = await import(process.env.ORCH1385_GATE_URL);' +
    `const v = await (async () => (${expr}))();` +
    'console.log("__PROBE__" + JSON.stringify(v) + "__END__");';
  const { code, out } = runNode(["--input-type=module", "-e", script], {
    env: { ...process.env, ORCH1385_GATE_URL: pathToFileURL(GATE).href },
  });
  const m = out.match(/__PROBE__(.*)__END__/s);
  return { code, out, value: m ? JSON.parse(m[1]) : undefined };
};

/**
 * Build a throwaway fixture repo root containing BOTH apps (the gate exits 2
 * if either app's package.json is missing or an app has zero sources), the
 * packages/ dirs named, and a sha256-verified runtime copy of the REAL gate.
 */
const makeFixture = ({
  businessPkg = {},
  businessFiles = {},
  mobilePkg = {},
  mobileFiles = {},
  packages = ["phone-input", "offering-rendering"],
} = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orch1385-adv-"));
  const write = (rel, content) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  // Real gate, copied at runtime, provenance-sealed by hash equality.
  const gateCopy = path.join(
    root,
    ".github",
    "scripts",
    "strict-grep",
    "orch-1385-workspace-deps-declared.mjs",
  );
  fs.mkdirSync(path.dirname(gateCopy), { recursive: true });
  fs.copyFileSync(GATE, gateCopy);
  assert.equal(
    sha256(gateCopy),
    sha256(GATE),
    "provenance seal broken: fixture gate copy is not byte-identical to the real gate",
  );
  for (const p of packages) {
    write(path.join("packages", p, "package.json"), `{"name":"@mingla/${p}"}`);
  }
  write(
    "mingla-business/package.json",
    JSON.stringify({ name: "mingla-business", dependencies: businessPkg }),
  );
  write(
    "app-mobile/package.json",
    JSON.stringify({ name: "app-mobile", dependencies: mobilePkg }),
  );
  // Every fixture app needs >= 1 source under a scanned dir (zero-source guard).
  const business = { "mingla-business/src/noop.ts": "export {};", ...businessFiles };
  const mobile = { "app-mobile/src/noop.ts": "export {};", ...mobileFiles };
  for (const [rel, src] of Object.entries({ ...business, ...mobile })) {
    write(rel, src);
  }
  return {
    root,
    gate: gateCopy,
    run: () => runNode([gateCopy]),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

// ---------------------------------------------------------------------------
// T-1 — REAL TREE: the exact #925 artifact chain, bound end-to-end through the
// real extractor + real manifests. TESTER fails-on-revert case: true
// line-deletion of the phone-input declaration from mingla-business/package.json
// reds the declaration assertion below (different angle from the implementor's
// gate-exit-0 test — this pins the CONCRETE artifact, and additionally checks
// target-package NAME integrity, which the gate itself never reads).
// ---------------------------------------------------------------------------
test("T-1 real tree: bracket-path buyer.tsx really imports @mingla/phone-input AND the declaration + target package are intact", () => {
  const buyer = path.join(
    REPO_ROOT,
    "mingla-business",
    "app",
    "checkout-experience",
    "[experienceEventId]",
    "buyer.tsx",
  );
  assert.ok(fs.existsSync(buyer), `missing real file: ${buyer}`);
  // Real extractor over the real bracket-path file (fs read — no glob; the
  // D-IMPL-1384-1 bracket hazard lives in glob/URL layers, not fs.readFileSync).
  const src = JSON.stringify(fs.readFileSync(buyer, "utf8"));
  const probe = probeModule(`[...m.referencedMinglaPackages(${src})]`);
  assert.equal(probe.code, 0, probe.out);
  assert.ok(
    probe.value.includes("@mingla/phone-input"),
    `real buyer.tsx no longer references @mingla/phone-input per the REAL extractor: ${JSON.stringify(probe.value)}`,
  );
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "mingla-business", "package.json"), "utf8"),
  );
  assert.equal(
    pkg.dependencies?.["@mingla/phone-input"],
    "file:../packages/phone-input",
    "ORCH-1385 fix REVERTED: mingla-business no longer declares @mingla/phone-input as file:../packages/phone-input",
  );
  const target = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "packages", "phone-input", "package.json"),
      "utf8",
    ),
  );
  assert.equal(
    target.name,
    "@mingla/phone-input",
    "packages/phone-input/package.json name drifted — declarations would resolve to a mis-named package",
  );
});

// ---------------------------------------------------------------------------
// T-2 — REAL TREE: all six ORCH-1385 declarations present in BOTH apps, each
// pointing at a package dir whose package.json NAME matches (deeper than the
// gate's dir-EXISTS check — a hollowed or renamed package dir reds this).
// ---------------------------------------------------------------------------
test("T-2 real tree: the six @mingla declarations exist in BOTH apps and every declared target's package.json name matches", () => {
  const SIX = [
    "brand-rendering",
    "location-input",
    "offering-rendering",
    "payments-native",
    "phone-input",
    "theme-animations",
  ];
  for (const app of ["mingla-business", "app-mobile"]) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, app, "package.json"), "utf8"),
    );
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const short of SIX) {
      assert.equal(
        deps[`@mingla/${short}`],
        `file:../packages/${short}`,
        `${app} lost the ORCH-1385 declaration for @mingla/${short}`,
      );
    }
    for (const [name, spec] of Object.entries(deps)) {
      if (!name.startsWith("@mingla/")) continue;
      const short = name.split("/")[1];
      const targetPkgJson = path.join(REPO_ROOT, "packages", short, "package.json");
      assert.ok(
        fs.existsSync(targetPkgJson),
        `${app} declares ${name} (${spec}) but ${targetPkgJson} does not exist — the gate only checks the DIR exists, not that it is a real package`,
      );
      assert.equal(
        JSON.parse(fs.readFileSync(targetPkgJson, "utf8")).name,
        name,
        `${app} declares ${name} but packages/${short}/package.json carries a different name`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// T-3 — ANGLE A: a workspace package the gate has NEVER heard of.
// ---------------------------------------------------------------------------
test("T-3 angle A: an undeclared import of a brand-new @mingla package fails the real gate (no hardcoded package list)", () => {
  const fx = makeFixture({
    businessFiles: {
      "mingla-business/src/newthing.tsx":
        'import { N } from "@mingla/never-heard-of-pkg";',
    },
    packages: ["phone-input", "never-heard-of-pkg"],
  });
  try {
    const { code, out } = fx.run();
    assert.equal(code, 1, `gate must fail on the undeclared NEW package; got ${code}: ${out}`);
    assert.match(out, /@mingla\/never-heard-of-pkg/);
    assert.match(out, /does not declare/);
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// T-4 — ANGLE B (KNOWN-GAP, QA finding F-1): the gate scans ONLY
// mingla-business/{app,src} and app-mobile/{app,src,components}. The app
// ENTRY files (index.js / index.ts), mingla-business/api/, and
// app-mobile/scripts/ are bundle- or CI-relevant surfaces the gate cannot
// see — and metro extraNodeModules aliases still resolve @mingla there, so
// the EXACT #925 latent class (alias-only resolution) survives in these
// locations. Current behaviour: exit 0 (blind). If you fix the gate to scan
// them, flip these assertions to code===1.
// ---------------------------------------------------------------------------
test("T-4 angle B KNOWN-GAP: undeclared imports in entry files / api/ / scripts/ are INVISIBLE to the gate (F-1)", () => {
  const cases = [
    ["mingla-business entry file", { businessFiles: { "mingla-business/index.js": 'import "@mingla/ghost-pkg";' } }],
    ["mingla-business/api", { businessFiles: { "mingla-business/api/handler.ts": 'import { g } from "@mingla/ghost-pkg";' } }],
    ["app-mobile entry file", { mobileFiles: { "app-mobile/index.ts": 'import "@mingla/ghost-pkg";' } }],
    ["app-mobile/scripts", { mobileFiles: { "app-mobile/scripts/tool.mjs": 'const g = require("@mingla/ghost-pkg");' } }],
  ];
  for (const [label, spec] of cases) {
    const fx = makeFixture(spec);
    try {
      const { code, out } = fx.run();
      // KNOWN-GAP (F-1): a well-behaved gate would exit 1 here.
      assert.equal(
        code,
        0,
        `gate behaviour changed for unscanned surface "${label}" (was blind/exit 0 — if you widened the scan, flip this assertion to 1 and close F-1): ${out}`,
      );
    } finally {
      fx.cleanup();
    }
  }
});

// ---------------------------------------------------------------------------
// T-5 — ANGLE B: bracket-name route dirs ([id]-style) MUST be scanned. This
// repo's route tree carries them (the #925 break itself was first seen in
// app/checkout-experience/[experienceEventId]/buyer.tsx), and D-IMPL-1384-1
// proved bracket paths break glob-based tooling — this pins the gate's
// readdir-walk so a future glob rewrite cannot silently skip them.
// ---------------------------------------------------------------------------
test("T-5 angle B: an undeclared import inside a [bracket] route dir IS caught, and the failure names the bracket path", () => {
  const fx = makeFixture({
    businessFiles: {
      "mingla-business/app/[eventId]/buyer.tsx":
        'import { PhoneInput } from "@mingla/phone-input";',
    },
  });
  try {
    const { code, out } = fx.run();
    assert.equal(code, 1, `gate must catch the bracket-dir import; got ${code}: ${out}`);
    assert.match(out, /\[eventId\]\/buyer\.tsx/);
    assert.match(out, /@mingla\/phone-input/);
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// T-6 — ANGLE B: app-mobile/components is in the gate's srcDirs but does NOT
// exist in the real repo (silent no-op today). Prove the config entry is live
// future-proofing, not dead config: if the dir appears with an undeclared
// import, the gate fires.
// ---------------------------------------------------------------------------
test("T-6 angle B: app-mobile/components does not exist on the real tree, but IS scanned the moment it appears", () => {
  assert.ok(
    !fs.existsSync(path.join(REPO_ROOT, "app-mobile", "components")),
    "app-mobile/components now exists on the real tree — retire this half of T-6",
  );
  const fx = makeFixture({
    mobileFiles: {
      "app-mobile/components/Widget.tsx":
        'import { W } from "@mingla/offering-rendering";',
    },
  });
  try {
    const { code, out } = fx.run();
    assert.equal(code, 1, `components/ must be scanned when present; got ${code}: ${out}`);
    assert.match(out, /app-mobile/);
    assert.match(out, /@mingla\/offering-rendering/);
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// T-7 — ANGLE C: re-export and type-only forms. `export * from` /
// `export { X } from` / `import type` / multiline imports all need the
// package present — all must attribute (unit, REAL extractor) and
// export-star must fail E2E when undeclared.
// ---------------------------------------------------------------------------
test("T-7 angle C: export-star / export-named / import-type / multiline forms attribute to the base package, and export-star fails E2E when undeclared", () => {
  const probe = probeModule(
    "[" +
      '[...m.referencedMinglaPackages(`export * from "@mingla/phone-input";`)],' +
      '[...m.referencedMinglaPackages(`export { X } from "@mingla/phone-input";`)],' +
      '[...m.referencedMinglaPackages(`import type { T } from "@mingla/phone-input";`)],' +
      "[...m.referencedMinglaPackages('import {\\n  A,\\n  B,\\n} from \"@mingla/phone-input\";')]" +
      "]",
  );
  assert.equal(probe.code, 0, probe.out);
  for (const [i, form] of ["export-star", "export-named", "import-type", "multiline"].entries()) {
    assert.deepEqual(
      probe.value[i],
      ["@mingla/phone-input"],
      `${form} form not attributed by the REAL extractor`,
    );
  }
  const fx = makeFixture({
    businessFiles: {
      "mingla-business/src/reexport.ts": 'export * from "@mingla/offering-rendering";',
    },
  });
  try {
    const { code, out } = fx.run();
    assert.equal(code, 1, `undeclared export-star must fail E2E; got ${code}: ${out}`);
    assert.match(out, /@mingla\/offering-rendering/);
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// T-8 — ANGLE D (KNOWN-GAP-FP, QA finding F-2): the gate FIRES on
// commented-out imports and on import-shaped text inside template literals.
// This is a FALSE-POSITIVE class — fail-safe direction (it wrongly blocks a
// PR rather than wrongly passing one), so it is documented, not dangerous.
// If you make the gate comment-aware, flip these to code===0 and close F-2.
// ---------------------------------------------------------------------------
test("T-8 angle D KNOWN-GAP-FP: comment-only and template-literal-only references false-fire the gate (F-2)", () => {
  const cases = [
    ["line comment", '// import { X } from "@mingla/ghost-pkg";'],
    ["block comment", '/* const y = require("@mingla/ghost-pkg"); */'],
    ["template literal", "const s = `docs: import \"@mingla/ghost-pkg\" like so`;"],
  ];
  for (const [label, src] of cases) {
    const fx = makeFixture({
      businessFiles: { "mingla-business/src/fp.ts": src },
    });
    try {
      const { code, out } = fx.run();
      // KNOWN-GAP-FP (F-2): a comment-aware gate would exit 0 here.
      assert.equal(
        code,
        1,
        `gate behaviour changed for "${label}" (was false-firing/exit 1 — if you made it comment-aware, flip this assertion and close F-2): ${out}`,
      );
      assert.match(out, /@mingla\/ghost-pkg/);
    } finally {
      fx.cleanup();
    }
  }
});

// ---------------------------------------------------------------------------
// T-9 — ANGLE D (KNOWN-GAP, QA finding F-3): backtick dynamic import
// (import(`@mingla/x`)) is valid JS that bundlers resolve statically, but the
// gate's regexes only match ' and " — the reference SLIPS. Current behaviour:
// exit 0 (evasion possible). If you extend the regexes to backticks, flip to
// code===1 and close F-3.
// ---------------------------------------------------------------------------
test("T-9 angle D KNOWN-GAP: backtick dynamic import(`@mingla/...`) evades the gate (F-3)", () => {
  const unit = probeModule(
    "[...m.referencedMinglaPackages('const p = await import(`@mingla/ghost-pkg`);')]",
  );
  assert.equal(unit.code, 0, unit.out);
  assert.deepEqual(
    unit.value,
    [],
    "REAL extractor now sees backtick imports — flip T-9 to expect detection and close F-3",
  );
  const fx = makeFixture({
    businessFiles: {
      "mingla-business/src/evade.ts": "const p = await import(`@mingla/ghost-pkg`);",
    },
  });
  try {
    const { code, out } = fx.run();
    // KNOWN-GAP (F-3): a backtick-aware gate would exit 1 here.
    assert.equal(
      code,
      0,
      `gate behaviour changed for backtick dynamic import (was blind/exit 0 — if extended, flip this assertion and close F-3): ${out}`,
    );
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// T-10 — ANGLE E: declaration EXISTS but is malformed in ways the implementor
// did not fixture: pointing at the WRONG (existing) package dir, trailing
// slash, protocol-case variant. All must fail (exact-spec rule holds).
// ---------------------------------------------------------------------------
test("T-10 angle E: wrong-dir / trailing-slash / case-variant declarations all fail the real gate", () => {
  const specs = [
    ["wrong existing dir", "file:../packages/offering-rendering"],
    ["trailing slash", "file:../packages/phone-input/"],
    ["protocol case variant", "File:../packages/phone-input"],
  ];
  for (const [label, spec] of specs) {
    const fx = makeFixture({
      businessPkg: { "@mingla/phone-input": spec },
      businessFiles: {
        "mingla-business/src/a.tsx": 'import { X } from "@mingla/phone-input";',
      },
    });
    try {
      const { code, out } = fx.run();
      assert.equal(code, 1, `"${label}" (${spec}) must fail; got ${code}: ${out}`);
      assert.match(out, /file:\.\.\/packages\/phone-input/);
    } finally {
      fx.cleanup();
    }
  }
});

// ---------------------------------------------------------------------------
// T-11 — ANGLE G: the CI wiring. The gate only defends main if CI actually
// runs it: assert the REAL workflow's pull_request path filters cover BOTH
// apps + packages/ + the gate scripts dir, and that the gate family is
// registered in MANIFEST.json the way run-batch.mjs executes it. Narrowing
// the filters (e.g. to mingla-business/** only — which would let an
// app-mobile-only undeclared import merge without this gate running) or
// de-registering a row goes RED here.
//
// [TEST-MOD-APPROVED ORCH-1400] — this test used to assert the pre-batch
// per-gate job format ("orch-1385-workspace-deps-declared:" + its three run
// steps). ORCH-1383 legitimately removed that format when it batched 350 jobs
// into run-batch.mjs classes driven by MANIFEST.json; the assertion then
// failed for wiring-format reasons while this suite sat dark (ORCH-1400
// RD-1: dark AND stale). The wiring truth this angle defends now lives in
// MANIFEST.json rows, asserted below; run-batch R4 + parity P5 prove the
// batch actually executes what the rows declare.
// ---------------------------------------------------------------------------
test("T-11 angle G: workflow path filters + ORCH-1385 MANIFEST wiring are intact", () => {
  const yml = fs.readFileSync(WORKFLOW, "utf8");
  const pr = yml.match(/on:\s*\n\s{2}pull_request:[\s\S]*?(?=\n\s{2}push:)/);
  assert.ok(pr, "pull_request trigger block not found in strict-grep-mingla-business.yml");
  for (const p of [
    '"mingla-business/**"',
    '"app-mobile/**"',
    '"packages/**"',
    '".github/scripts/strict-grep/**"',
  ]) {
    assert.ok(
      pr[0].includes(`- ${p}`),
      `pull_request path filter lost ${p} — an undeclared-import PR touching only that path would merge without this gate running`,
    );
  }
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, ".github", "scripts", "strict-grep", "MANIFEST.json"),
      "utf8",
    ),
  );
  const row = (script) => manifest.gates.find((g) => g.script === script);
  const gateRow = row(".github/scripts/strict-grep/orch-1385-workspace-deps-declared.mjs");
  assert.ok(gateRow, "ORCH-1385 gate row missing from MANIFEST.json — the gate is enforced by nothing");
  assert.equal(
    gateRow.enforcement,
    "batch:A",
    "ORCH-1385 gate left batch:A — run-batch.mjs no longer executes it",
  );
  assert.deepEqual(
    [...(gateRow.modes ?? [])].sort(),
    ["plain", "self-test"],
    "ORCH-1385 gate lost a mode — CI no longer runs both its plain scan and its self-test",
  );
  assert.equal(
    gateRow.selfTest,
    "wired",
    "ORCH-1385 gate selfTest demoted from \"wired\" — its self-test no longer counts toward the floor",
  );
  const advRow = row(
    ".github/scripts/strict-grep/orch-1385-workspace-deps-declared.adversarial.test.mjs",
  );
  assert.ok(advRow, "this adversarial suite's own row is missing from MANIFEST.json");
  assert.equal(
    advRow.enforcement,
    "batch:A",
    "this adversarial suite left batch:A — it has gone dark again (the exact RD-1 state ORCH-1400 fixed)",
  );
  assert.equal(advRow.invocation, "node --test", "this adversarial suite's invocation drifted");
  assert.ok(
    (advRow.modes ?? []).includes("plain"),
    "this adversarial suite lost its plain mode — the batch would never run it",
  );
});

// ---------------------------------------------------------------------------
// T-12 — documented structural quirk (QA finding F-4): IMPORTING the gate
// module executes its full real-tree scan (the main body has no
// entry-point guard). On a clean tree that is a harmless PASS banner; on a
// BROKEN tree it process.exit(1)s the importing process — which is why this
// suite unit-probes via a child process, and why the implementor's companion
// dies at import (no per-test output) under a revert. Pin the current
// behaviour so a future entry-point guard is a conscious, visible change.
// ---------------------------------------------------------------------------
test("T-12 quirk: importing the gate module runs the real-tree scan as a side effect (clean tree => PASS banner, exit 0)", () => {
  const probe = probeModule("'imported-ok'");
  assert.equal(probe.code, 0, probe.out);
  assert.equal(probe.value, "imported-ok");
  assert.match(
    probe.out,
    /I-PROPOSED-1385-WORKSPACE-DEPS-DECLARED PASS/,
    "importing the module no longer runs the scan — entry-point guard added? Update T-12 + F-4 and make sure the CI job still executes the gate explicitly",
  );
});
