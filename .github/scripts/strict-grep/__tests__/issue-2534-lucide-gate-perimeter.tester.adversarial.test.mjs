/**
 * Issue #2534 — TESTER ADVERSARIAL SUITE.
 *
 * Angle: the implementor's suite
 * (`mingla-business/src/shims/__tests__/issue_2534_public_brand_page_icons.test.ts`)
 * attacks the SHIM — it requires the web stub and asserts that nine icon names
 * resolve to real, mutually distinct lucide components rather than the
 * HelpCircle placeholder. That is the right test for half the fix. This suite
 * attacks the OTHER half, and the half that actually let the bug ship: the
 * PERIMETER of the drift gate `i-proposed-1137-biz-web-lucide-real.mjs`.
 *
 * WHY THE PERIMETER IS THE REAL TARGET. INV-4 exists precisely to fail CI when a
 * `lucide-react-native` import names an icon missing from the shim's USED_ICONS
 * map. Throughout the entire life of this bug it reported
 * `PASS · violations=0` — because its scan roots were
 * `mingla-business/{src,app}` only, and the broken file
 * (`packages/brand-rendering/PublicBrandPage.tsx`) lives under neither. The gate
 * was never wrong about what it checked; it checked the wrong perimeter. A
 * suite that only proves the nine icons are mapped today would leave that
 * failure mode completely unguarded: map the nine, and the TENTH one still
 * ships a silent question mark.
 *
 * So every assertion here is about REACH, not about icons:
 *
 *   T-0  VACUITY GUARD — the real repo tree and a pristine fixture both pass.
 *        Without this, every "gate goes red" assertion below could be red for
 *        the wrong reason (a broken fixture, a missing shim) and prove nothing.
 *   T-1  THE LOAD-BEARING ONE — a brand-new, never-before-seen unmapped icon
 *        introduced by a brand-new directory under `packages/` FAILS the gate,
 *        with a matched negative control (map it, and the same tree passes).
 *        This is the assertion that goes red if `packages/` is ever removed
 *        from the scan roots.
 *   T-2  The perimeter is load-bearing, demonstrated rather than argued: the
 *        SAME fixture that T-1 turns red goes GREEN under a gate whose
 *        `packages` scan root has been deleted. That green is the exact state
 *        `main` was in while production drew question marks.
 *   T-3  STRUCTURAL PIN — the shipped gate source still lists a `packages` scan
 *        root, so a silent narrowing is a diff that fails CI on its own.
 *   T-4  NO FALSE POSITIVE — `node_modules` nested under `packages/` is skipped
 *        (a gate that walked it would red every PR on a workspace install),
 *        with a matched positive control proving the walker really does reach
 *        that depth when the directory is NOT named node_modules.
 *   T-5  EVASION BOUNDARY — the import forms most likely to reintroduce the
 *        blind spot are still caught inside the widened perimeter: multi-line
 *        imports, `Icon as Alias` (which must report the SOURCE name, since
 *        that is the name USED_ICONS is keyed on), a package that is not
 *        `brand-rendering`, and a deeply nested new directory.
 *   T-6  END-TO-END ON THE REAL TREE — the ten icons
 *        `packages/brand-rendering/PublicBrandPage.tsx` actually imports are all
 *        present in the shipped shim map, asserted through the GATE's own
 *        verdict on the real repository rather than through `require()`
 *        identity. This is the shim half of the fix, verified from the other
 *        side of the fence.
 *
 * FIXTURE DESIGN. The gate derives REPO_ROOT from its own `__dirname` via
 * `../../..`, so a fixture is a throwaway directory that reproduces exactly that
 * shape: `<root>/.github/scripts/strict-grep/<gate>.mjs` plus the two files the
 * gate reads (the shim and metro.config.js) plus whatever source roots the case
 * needs. The shim and metro config are COPIED FROM THE REAL REPO, never
 * synthesised — a hand-written stand-in would drift from production and could
 * keep this suite green against a shim shape that no longer exists.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const GATE_NAME = "i-proposed-1137-biz-web-lucide-real.mjs";
const GATE = path.join(REPO_ROOT, ".github/scripts/strict-grep", GATE_NAME);
const SHIM_REL = "mingla-business/src/shims/lucideReactNativeWebStub.js";
const METRO_REL = "mingla-business/metro.config.js";
const BRAND_PAGE_REL = "packages/brand-rendering/PublicBrandPage.tsx";

/** An icon name that is deliberately absent from the shim map — the "new icon a
 *  future PR adds" that INV-4 exists to catch. Asserted absent in T-0 so this
 *  suite cannot quietly rot into a no-op if someone ever maps it. */
const UNMAPPED = "Fingerprint";
const UNMAPPED_2 = "Rocket";

function readRepo(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/** Run a gate .mjs and return its exit code plus combined output. */
function runGate(gatePath) {
  const r = spawnSync(process.execPath, [gatePath], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * Build a throwaway repo whose shape satisfies the gate's REPO_ROOT arithmetic.
 *
 * @param {object} opts
 * @param {Record<string,string>} [opts.files]  repo-relative path -> contents
 * @param {string[]} [opts.extraShimIcons]      icon names to append to USED_ICONS
 * @param {boolean} [opts.narrowPerimeter]      delete the `packages` scan root,
 *                                              reproducing the pre-#2534 gate
 * @returns {{ root: string, gate: string, cleanup: () => void }}
 */
function makeFixture({ files = {}, extraShimIcons = [], narrowPerimeter = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2534-perimeter-"));
  const write = (rel, body) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };

  // The two files the gate READS, copied from the real repo so INV-1/2/3 stay
  // green for the same reasons they are green in production and every failure
  // this suite observes is unambiguously INV-4.
  let shim = readRepo(SHIM_REL);
  if (extraShimIcons.length > 0) {
    const anchor = "const USED_ICONS = {";
    assert.ok(
      shim.includes(anchor),
      `fixture cannot inject icons: the shim no longer declares \`${anchor}\`. ` +
        "The shim's map shape changed — update this suite rather than deleting it.",
    );
    const injected = extraShimIcons
      .map(
        (n) =>
          `  ${n}: iconOf(require("lucide-react/dist/esm/icons/${n.replace(
            /([a-z0-9])([A-Z])/g,
            "$1-$2",
          ).toLowerCase()}.js")),`,
      )
      .join("\n");
    shim = shim.replace(anchor, `${anchor}\n${injected}`);
  }
  write(SHIM_REL, shim);
  write(METRO_REL, readRepo(METRO_REL));

  // The scan roots must EXIST or `walk()` returns early and a "gate stayed
  // green" assertion would be green because it scanned nothing.
  fs.mkdirSync(path.join(root, "mingla-business/src"), { recursive: true });
  fs.mkdirSync(path.join(root, "mingla-business/app"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages"), { recursive: true });

  let gateSrc = readRepo(path.join(".github/scripts/strict-grep", GATE_NAME));
  if (narrowPerimeter) {
    const before = gateSrc;
    gateSrc = gateSrc.replace(/^\s*path\.join\(REPO_ROOT, "packages"\),\n/m, "");
    assert.notEqual(
      gateSrc,
      before,
      "T-2 could not narrow the perimeter: the gate no longer contains a " +
        '`path.join(REPO_ROOT, "packages"),` scan-root line. Either the fix was ' +
        "reverted (T-1 and T-3 will say so) or the roots were refactored.",
    );
  }
  write(path.join(".github/scripts/strict-grep", GATE_NAME), gateSrc);

  for (const [rel, body] of Object.entries(files)) write(rel, body);

  return {
    root,
    gate: path.join(root, ".github/scripts/strict-grep", GATE_NAME),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Convenience: build, run, tear down. */
function gateVerdict(opts) {
  const fx = makeFixture(opts);
  try {
    return runGate(fx.gate);
  } finally {
    fx.cleanup();
  }
}

// ── T-0 — VACUITY GUARD ─────────────────────────────────────────────────────
// Everything below reads a gate exit code. If the gate could not run, or the
// baseline were already red, or the "unmapped" icon were secretly mapped, the
// red/green assertions would carry no information at all.

test("T-0 VACUITY GUARD: the real repo passes, a pristine fixture passes, and the probe icons really are unmapped", () => {
  const real = runGate(GATE);
  assert.equal(
    real.code,
    0,
    `the shipped gate must pass on the real repository before any fixture verdict means anything.\n${real.out}`,
  );
  assert.match(real.out, /OK\s+\[INV-4: used-set-drift-guard\]/);

  const pristine = gateVerdict();
  assert.equal(
    pristine.code,
    0,
    `a fixture with no icon drift must pass — otherwise every "goes red" assertion below is red for the wrong reason.\n${pristine.out}`,
  );

  const shim = readRepo(SHIM_REL);
  for (const name of [UNMAPPED, UNMAPPED_2]) {
    assert.ok(
      !new RegExp(`\\b${name}\\s*:`).test(shim),
      `this suite uses "${name}" as its never-mapped probe icon, but the shim now maps it. ` +
        "Pick a different probe rather than weakening these assertions.",
    );
  }
});

// ── T-1 — THE LOAD-BEARING ASSERTION ────────────────────────────────────────
// This is the fails-on-revert lever. Remove `packages/` from the gate's scan
// roots and this test goes red, because the drift becomes invisible again.

test("T-1 a brand-new unmapped icon introduced by a NEW directory under packages/ FAILS the gate", () => {
  const files = {
    "packages/z-2534-probe-pkg/src/Probe.tsx":
      `import { ${UNMAPPED} } from "lucide-react-native";\n` +
      `export const Probe = () => <${UNMAPPED} />;\n`,
  };

  const drifted = gateVerdict({ files });
  assert.equal(
    drifted.code,
    1,
    "INV-4 must FAIL when a file under packages/ imports an icon missing from the shim map. " +
      "It passing is the exact state that shipped circled question marks to " +
      "host.usemingla.com/b/{brandSlug} — check whether the `packages` scan root " +
      `was removed from ${GATE_NAME}.\n${drifted.out}`,
  );
  assert.match(drifted.out, /FAIL \[INV-4: used-set-drift-guard\]/);
  assert.match(drifted.out, new RegExp(`\\b${UNMAPPED}\\b`));

  // NEGATIVE CONTROL — the identical tree with the icon MAPPED must pass. This
  // is what proves the red above is caused by the drift and not by the fixture
  // merely existing.
  const mapped = gateVerdict({ files, extraShimIcons: [UNMAPPED] });
  assert.equal(
    mapped.code,
    0,
    `mapping the icon must clear the violation; if it does not, T-1's red proves nothing.\n${mapped.out}`,
  );
});

// ── T-2 — THE PERIMETER IS THE BUG, DEMONSTRATED ────────────────────────────

test("T-2 the SAME drifted tree goes GREEN under a gate whose packages/ scan root is deleted", () => {
  const files = {
    "packages/z-2534-probe-pkg/src/Probe.tsx":
      `import { ${UNMAPPED} } from "lucide-react-native";\n`,
  };

  const narrowed = gateVerdict({ files, narrowPerimeter: true });
  assert.equal(
    narrowed.code,
    0,
    `the pre-#2534 perimeter is expected to MISS packages/ drift — that green is the bug being reproduced.\n${narrowed.out}`,
  );
  assert.match(narrowed.out, /I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL: PASS/);

  // Same tree, shipped perimeter: red. The two verdicts differ ONLY by the one
  // scan-root line, which is the whole claim of the #2534 gate change.
  const shipped = gateVerdict({ files });
  assert.equal(shipped.code, 1, shipped.out);
});

// ── T-3 — STRUCTURAL PIN ────────────────────────────────────────────────────

test("T-3 the shipped gate still declares a packages/ scan root (a silent narrowing fails here)", () => {
  const src = readRepo(path.join(".github/scripts/strict-grep", GATE_NAME));
  const roots = src.match(/const\s+SCAN_ROOTS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(
    roots,
    "the gate no longer declares a `SCAN_ROOTS` array. INV-4's perimeter is the " +
      "root cause of issue #2534 — if the roots were renamed or restructured, " +
      "re-pin them here deliberately rather than dropping this assertion.",
  );
  const body = roots[1];
  assert.match(body, /path\.join\(REPO_ROOT,\s*"packages"\)/);
  assert.match(body, /path\.join\(REPO_ROOT,\s*"mingla-business",\s*"src"\)/);
  assert.match(body, /path\.join\(REPO_ROOT,\s*"mingla-business",\s*"app"\)/);
});

// ── T-4 — NO FALSE POSITIVE FROM node_modules UNDER packages/ ───────────────
// Walking a new root is only safe if the walker still skips dependency trees.
// A workspace install puts node_modules under packages/*, and a gate that
// scanned it would demand USED_ICONS entries for icons no Mingla file imports —
// reddening every PR. The positive control is what makes this falsifiable: it
// proves the walker genuinely reaches that depth.

test("T-4 node_modules nested under packages/ is skipped, and the walker really does reach that depth otherwise", () => {
  const IMPORT = `import { ${UNMAPPED} } from "lucide-react-native";\n`;

  const skipped = gateVerdict({
    files: {
      "packages/z-2534-probe-pkg/node_modules/some-dep/dist/Icon.tsx": IMPORT,
      "packages/z-2534-probe-pkg/node_modules/@scope/dep/src/Deep.tsx": IMPORT,
    },
  });
  assert.equal(
    skipped.code,
    0,
    "the gate must NOT read node_modules under packages/. Scanning a dependency " +
      "tree would fail CI on icons no Mingla source imports, on every PR.\n" +
      skipped.out,
  );

  // POSITIVE CONTROL — identical depth and identical content, one directory
  // renamed. Red here proves the pass above is a deliberate skip and not the
  // walker simply never getting there.
  const reached = gateVerdict({
    files: {
      "packages/z-2534-probe-pkg/vendored_modules/some-dep/dist/Icon.tsx": IMPORT,
    },
  });
  assert.equal(
    reached.code,
    1,
    `the walker must reach that depth when the directory is not node_modules, or T-4's green is vacuous.\n${reached.out}`,
  );
});

// ── T-5 — EVASION BOUNDARY INSIDE THE WIDENED PERIMETER ─────────────────────

test("T-5 multi-line, aliased, non-brand-rendering and deeply nested imports are all caught", () => {
  const drifted = gateVerdict({
    files: {
      // Multi-line + aliased, in a package that is NOT brand-rendering, several
      // directories deep, alongside a type-only import that must be ignored.
      "packages/z-2534-other-pkg/src/a/b/c/d/Deep.tsx":
        'import type { LucideIcon } from "lucide-react-native";\n' +
        "import {\n" +
        `  ${UNMAPPED},\n` +
        `  ${UNMAPPED_2} as ShortAlias,\n` +
        '} from "lucide-react-native";\n' +
        `export const D = (p: { i: LucideIcon }) => <${UNMAPPED} />;\n`,
    },
  });

  assert.equal(drifted.code, 1, drifted.out);
  // The ALIAS must be reported by its SOURCE name: USED_ICONS is keyed on the
  // exported lucide name, so demanding the local alias would send the next dev
  // to add an entry that fixes nothing.
  assert.match(drifted.out, new RegExp(`\\b${UNMAPPED_2}\\b`));
  assert.ok(
    !/ShortAlias/.test(drifted.out),
    `the gate named the local alias instead of the source name:\n${drifted.out}`,
  );
  assert.match(drifted.out, new RegExp(`\\b${UNMAPPED}\\b`));
  // `import type { ... }` is not an icon and must never be demanded.
  assert.ok(
    !/LucideIcon/.test(drifted.out),
    `a type-only import was demanded as an icon:\n${drifted.out}`,
  );
});

// ── T-6 — THE SHIM HALF, VERIFIED FROM THE GATE'S SIDE ──────────────────────

test("T-6 every icon PublicBrandPage.tsx actually imports is covered by the shipped shim, per the gate itself", () => {
  const page = readRepo(BRAND_PAGE_REL);
  const named = [
    ...page.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react-native["']/g),
  ]
    .flatMap((m) => m[1].split(","))
    .map((raw) => raw.trim().split(/\s+as\s+/)[0].trim())
    .filter(Boolean);

  // Vacuity guard: this test is worthless if the page stopped importing icons.
  assert.ok(
    named.length >= 10,
    `expected PublicBrandPage.tsx to import at least ten lucide icons, found ${named.length}: ${named.join(", ")}. ` +
      "If the page genuinely dropped icons, re-baseline this count deliberately.",
  );

  const shim = readRepo(SHIM_REL);
  const mapped = new Set(
    [
      ...shim.matchAll(
        /([A-Za-z_$][\w$]*)\s*:\s*[^,:{}]*require\(\s*["']lucide-react\/[^"']*["']\s*\)/g,
      ),
    ].map((m) => m[1]),
  );

  const missing = named.filter((n) => !mapped.has(n)).sort();
  assert.deepEqual(
    missing,
    [],
    `these icons are imported by ${BRAND_PAGE_REL} but absent from the web shim's ` +
      "USED_ICONS map, so business web renders a HelpCircle placeholder for each " +
      "of them on the public brand page: " +
      missing.join(", "),
  );
});
