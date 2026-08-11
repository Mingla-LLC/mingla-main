/**
 * #1850 [quarantined-checkout-pins] — TESTER adversarial regression proof.
 *
 * The implementor's happy-path proof (issue-1850-quarantine-invariant-handoff.happy.test.mjs)
 * drives the ledger gate down the path it was designed for: a complete ledger is
 * green, #1850's own ledger removed is red, an emptied block is exit 2, a bare drop
 * is rejected, the keyboard gate reddens on a returning literal 42 and on an
 * un-nested toolbar, and the KNOWN LIMITATION paragraph exists.
 *
 * This file attacks the six places that proof does NOT reach. Each one is a way the
 * mechanism could go quietly green while enforcing less than it claims — which is
 * the exact failure #1850 exists to make impossible, so the gate must not be able
 * to commit it itself.
 *
 *   A-1  NO LIVE HAND-OFF IS VACUOUS. `targets(test) ⊆ …` is trivially true when
 *        the left side is empty. The implementor measured that a literal-only
 *        extractor returned ZERO targets for six of the eleven live pairs and
 *        rewrote it to follow const chains and reader helpers — but nothing pins
 *        the result. `V-TARGETS` is not that pin: it only fires when the test file
 *        literally spells `readFileSync(`, so a future suite that reads through an
 *        imported helper resolves zero targets and passes with no guard at all.
 *        This asserts every live entry resolves at least one target, corpus-wide.
 *
 *   A-2  PROSE IS NOT COVERAGE — ON THE TEST SIDE. The gate's own fixture 10 proves
 *        a path mentioned only in a comment in the GATE does not count as coverage.
 *        The mirror is unproven and is the dangerous direction: a path named only in
 *        the quarantined TEST's docstring must not enter its target set, or the
 *        subset check acquires a phantom obligation and a padded `dropped:` list can
 *        satisfy it. The real corpus carries this case already.
 *
 *   A-3  R2b BITES ON THE REAL CORPUS. R2 (residue) and R3 (drop reasons) are both
 *        pinned by the implementor; R2b — the ledger may not overstate in the other
 *        direction — is not. A `moved:` line naming a file the gate never reads is
 *        the cheapest possible way to fake a reconciled ledger.
 *
 *   A-4  THE EMPTY-SCAN FLOOR IS A BOUNDARY, NOT A POINT, AND IS NOT ABOVE THE
 *        CORPUS. The implementor proved zero entries exits 2. One entry short of
 *        the floor is the case an author actually reaches. And a floor set ABOVE
 *        the live corpus is the opposite vacuity — a gate that can only ever be
 *        red, which gets muted rather than fixed.
 *
 *   A-5  THE FOUR MIGRATED SURFACES MUST USE THE CONSTANT, NOT MERELY IMPORT IT.
 *        Rule (D) of the keyboard gate is satisfied by an import plus the absence
 *        of a literal `42`. Measured on the tree: deleting the Done-bar term from
 *        the Ari lift entirely, while keeping the import, leaves that gate GREEN.
 *        An unused import is not a derivation.
 *
 *   A-6  PLATFORM-SPLIT PARITY. Three of the four migrated surfaces are
 *        platform-agnostic `.tsx`, so Metro hands them `SmartScrollView.tsx` on web
 *        and `SmartScrollView.native.tsx` on device. A name exported by only one
 *        side reads `undefined` on the other and silently budgets NaN. That hazard
 *        was found during implementation and fixed; nothing pins the fix.
 *
 * Append-only: this file is new and edits nothing. The text helpers below are
 * plumbing (comment stripping, import-line filtering) — no rule regex from either
 * gate is restated here; every rule assertion drives the gate's own exported
 * `run`/`extractTargets` or reads the tree directly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SG = path.resolve(HERE, "..");
const REPO = path.resolve(SG, "../../..");
const BIZ = path.join(REPO, "mingla-business");
const ROOTS = { repo: REPO, biz: BIZ };

const LEDGER_GATE = path.join(SG, "issue-1850-quarantine-invariant-handoff-complete.mjs");
const ledger = await import(LEDGER_GATE);

const CONFIG = fs.readFileSync(path.join(BIZ, "jest.config.cjs"), "utf8");
const toPosix = (p) => p.split(path.sep).join("/");

/** Every jest-visible business test file, resolved once. */
const TEST_FILES = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (/(^|\/)__tests__\/.*\.test\.tsx?$/.test(toPosix(path.relative(BIZ, full)))) TEST_FILES.push(full);
  }
})(BIZ);

/** Entries of the live #1047 block, each with its resolved test files and gate. */
function liveEntries(configText = CONFIG) {
  const { entries, error } = ledger.parseLedger(configText);
  assert.equal(error, undefined, `parseLedger failed: ${error}`);
  return entries.map((entry) => {
    const re = new RegExp(entry.pattern);
    const tests = TEST_FILES.filter((f) => re.test(toPosix(path.relative(BIZ, f)))).map((f) => ({
      rel: toPosix(path.relative(BIZ, f)),
      dir: path.dirname(f),
      source: fs.readFileSync(f, "utf8"),
    }));
    const abs = path.join(SG, entry.gateName);
    const onDisk = fs.existsSync(abs);
    return {
      entry,
      tests,
      gate: { onDisk, source: onDisk ? fs.readFileSync(abs, "utf8") : null, dir: SG, enforcement: "batch:A" },
    };
  });
}

/** A model `run()` accepts, built from the live tree. */
function model(configText = CONFIG) {
  const rows = liveEntries(configText);
  const testsFor = new Map();
  const gates = new Map();
  for (const { entry, tests, gate } of rows) {
    testsFor.set(entry.pattern, tests);
    if (!gates.has(entry.gateName)) gates.set(entry.gateName, gate);
  }
  return { configText, roots: ROOTS, testsFor, gates };
}

// ── A-1 ────────────────────────────────────────────────────────────────────
test("A-1 every live hand-off resolves at least one target — no entry is judged vacuously", () => {
  const rows = liveEntries();
  assert.ok(rows.length >= 8, `expected the live block to carry the eleven hand-offs, saw ${rows.length}`);

  const vacuous = [];
  for (const { entry, tests } of rows) {
    assert.ok(tests.length > 0, `${entry.pattern}: matched no test file on disk`);
    const targets = new Set();
    for (const t of tests) for (const x of ledger.extractTargets(t.source, t.dir, ROOTS)) targets.add(x);
    if (targets.size === 0) vacuous.push(`${entry.pattern} (${tests.map((t) => t.rel).join(", ")})`);
  }
  assert.deepEqual(
    vacuous,
    [],
    "these quarantined tests resolve ZERO targets, so `targets(test) ⊆ …` is true for them no matter " +
      "what their gate covers. V-TARGETS does not save this: it only fires when the test spells " +
      `readFileSync(. Teach the extractor the path shape it missed:\n  ${vacuous.join("\n  ")}`,
  );
});

// ── A-2 ────────────────────────────────────────────────────────────────────
test("A-2 a path named only in the quarantined test's PROSE is not a target", () => {
  const rows = liveEntries();
  const rsvp = rows.find((r) => r.entry.pattern.includes("rsvp"));
  assert.ok(rsvp, "the rsvp preview hand-off is no longer in the block — repoint this test");
  const [subject] = rsvp.tests;
  assert.ok(subject, "the rsvp preview pattern matched no file");

  // Its docstring names a second preview route it never reads. Ground the case
  // rather than assuming: the path must be present in the raw source and absent
  // from every line of code that is not a comment.
  const PROSE_ONLY = "app/event/[id]/preview.tsx";
  assert.ok(subject.source.includes(PROSE_ONLY), `${subject.rel} no longer mentions ${PROSE_ONLY} — repoint this test`);
  const codeLines = subject.source
    .split("\n")
    .filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l))
    .join("\n");
  assert.ok(!codeLines.includes(PROSE_ONLY), `${PROSE_ONLY} is now real code in ${subject.rel} — repoint this test`);

  const targets = ledger.extractTargets(subject.source, subject.dir, ROOTS);
  assert.ok(
    !targets.has(PROSE_ONLY),
    `${subject.rel} names ${PROSE_ONLY} only in prose, but the extractor counted it as a target. ` +
      "A file the test never reads becomes an obligation its gate cannot discharge, and a padded " +
      "`dropped:` list is then enough to reconcile the ledger. (#1486: a path in prose is not coverage.)",
  );
  assert.ok(targets.size > 0, `${subject.rel} resolved no targets at all — see A-1`);
});

// ── A-3 ────────────────────────────────────────────────────────────────────
test("A-3 a `moved:` line the named gate does not honour turns the ledger RED (R2b)", () => {
  assert.equal(ledger.run(model()).code, 0, "the tree as committed must be green before this mutation means anything");

  // Claim a file as MOVED that #1850 consciously DROPPED — the gate does not read
  // it, so the claim is false. Keep the drop line too: the entry stays reconciled
  // under R2, and only R2b can see the lie.
  const FALSE_CLAIM = "app/checkout/[eventId]/payment.tsx";
  const lines = CONFIG.split("\n");
  const at = lines.findIndex((l) => l.includes("orch_1165_keyboard_toolbar_mount_coverage") && l.includes("// invariant ->"));
  assert.notEqual(at, -1, "the ORCH-1165 hand-off entry moved — repoint this test");
  const mutated = [...lines.slice(0, at + 1), `    // moved: ${FALSE_CLAIM}`, ...lines.slice(at + 1)].join("\n");

  const r = ledger.run(model(mutated));
  assert.equal(r.code, 1, `a false \`moved:\` claim must be a rule violation, got exit ${r.code}`);
  const text = r.failures.join("\n");
  assert.ok(text.includes(FALSE_CLAIM), `the failure must name the falsely-claimed file — got:\n${text}`);
  assert.match(text, /never reads that file/);
});

// ── A-4 ────────────────────────────────────────────────────────────────────
test("A-4 the empty-scan floor is a boundary, and it sits at or below the live corpus", () => {
  const live = ledger.parseLedger(CONFIG).entries.length;

  // Rebuild the block with exactly n annotated entries, n = 0 … live.
  const rebuild = (n) => {
    const rows = [];
    for (let i = 0; i < n; i += 1) rows.push(`    "floor${i}\\\\.test\\\\.ts$", // invariant -> floor.mjs`);
    return CONFIG.replace(
      /(#1047 \[business-jest-suite-audit\] — Part 1 quarantine)[\s\S]*?(\n\s*\],)/,
      `$1\n${rows.join("\n")}$2`,
    );
  };
  const modelFor = (n) => {
    const m = model(rebuild(n));
    for (let i = 0; i < n; i += 1) {
      m.testsFor.set(`floor${i}\\.test\\.ts$`, [
        { rel: `floor${i}.test.ts`, dir: path.join(BIZ, "src"), source: 'read("src/floor.ts");' },
      ]);
    }
    m.gates.set("floor.mjs", { onDisk: true, source: 'read("src/floor.ts");', dir: SG, enforcement: "batch:A" });
    return m;
  };

  // Find the floor empirically rather than restating the constant.
  let floor = null;
  for (let n = 0; n <= live; n += 1) {
    const r = ledger.run(modelFor(n));
    const vacuous = r.code === 2 && r.failures.join("\n").includes("V-ENTRIES");
    if (!vacuous && floor === null) floor = n;
    if (floor === null) {
      assert.equal(r.code, 2, `a scan of ${n} entries is below the floor and must exit 2, got ${r.code}`);
    }
  }
  assert.notEqual(floor, null, "no entry count cleared V-ENTRIES — the floor is above the live corpus");
  assert.ok(floor >= 1, "a scan of ZERO entries must never be green");
  assert.ok(
    floor <= live,
    `the V-ENTRIES floor (${floor}) is above the live corpus (${live}). A gate that can only ever be ` +
      "red gets muted, not fixed — lower the floor in the same PR that shrinks the block.",
  );
});

// ── A-5 ────────────────────────────────────────────────────────────────────
test("A-5 the four migrated surfaces USE the derived constant, not merely import it", () => {
  const SURFACES = [
    "src/components/groupChat/GroupChatPanel.tsx",
    "src/components/support/SupportThread.native.tsx",
    "src/components/brand/BrandPaystackOnboardView.tsx",
    "src/screens/ari/AriChatScreen.tsx",
  ];
  const NAME = "DONE_BAR_OCCUPIED";
  const unused = [];
  for (const rel of SURFACES) {
    const raw = fs.readFileSync(path.join(BIZ, rel), "utf8");
    const code = raw
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
      .split("\n")
      .filter((l) => !/^\s*import\b/.test(l) && !/^\s*\}\s*from\s*["']/.test(l))
      .join("\n");
    if (!code.includes(NAME)) unused.push(rel);
  }
  assert.deepEqual(
    unused,
    [],
    `${NAME} is imported but never used in these files. The keyboard gate's rule (D) is satisfied by ` +
      "the import plus the absence of a literal 42, so deleting the clearance term while keeping the " +
      "import leaves it GREEN (measured on this tree). An unused import is not a derivation:\n  " +
      unused.join("\n  "),
  );
});

// ── A-6 ────────────────────────────────────────────────────────────────────
test("A-6 every name the migrated surfaces import from the wrapper exists on BOTH sides of the platform split", () => {
  const WEB = path.join(BIZ, "src/wrappers/SmartScrollView.tsx");
  const NATIVE = path.join(BIZ, "src/wrappers/SmartScrollView.native.tsx");
  for (const p of [WEB, NATIVE]) assert.ok(fs.existsSync(p), `${p} is missing — the platform split is broken`);

  const exportsOf = (p) => {
    const src = fs.readFileSync(p, "utf8");
    const names = new Set();
    for (const m of src.matchAll(/^export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    for (const m of src.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) names.add(name.replace(/^type\s+/, ""));
      }
    }
    for (const m of src.matchAll(/^export\s+type\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    return names;
  };
  const web = exportsOf(WEB);
  const native = exportsOf(NATIVE);

  const CONSUMERS = [
    "src/components/groupChat/GroupChatPanel.tsx",
    "src/components/support/SupportThread.native.tsx",
    "src/components/brand/BrandPaystackOnboardView.tsx",
    "src/screens/ari/AriChatScreen.tsx",
  ];
  const wanted = new Set();
  for (const rel of CONSUMERS) {
    const src = fs.readFileSync(path.join(BIZ, rel), "utf8");
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*wrappers\/SmartScrollView["']/g)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (name) wanted.add(name);
      }
    }
  }
  assert.ok(wanted.size > 0, "no consumer imports anything from wrappers/SmartScrollView — repoint this test");

  const missing = [];
  for (const name of wanted) {
    if (!web.has(name)) missing.push(`${name} — absent from the WEB variant (reads undefined on web)`);
    if (!native.has(name)) missing.push(`${name} — absent from the NATIVE variant (reads undefined on device)`);
  }
  assert.deepEqual(
    missing,
    [],
    "a platform-agnostic screen imports a name that only one side of the split exports. Metro resolves " +
      "the other variant on that platform and the import silently evaluates to `undefined`, which turns " +
      "any budget built from it into NaN with no error anywhere:\n  " + missing.join("\n  "),
  );
});
