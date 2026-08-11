/**
 * #1850 [quarantined-checkout-pins] — implementor happy-path regression proof.
 *
 * This EXECUTES both gates rather than restating their rules. A test that
 * re-implements a gate's regexes can drift from it and still look green — the
 * exact failure #1841 found in the previous keyboard adversarial test, and a
 * cousin of the failure #1850 is about. So every assertion below either spawns
 * the gate as CI spawns it, or imports its `run` and drives it with a mutated
 * input, and reads the real exit code.
 *
 * What it pins:
 *   T-1  the ledger gate is GREEN on the tree, and the eleven hand-offs reconcile.
 *   T-2  removing #1850's own ledger turns it RED and names every dark file —
 *        i.e. the gate really decides `17 ⊄ 6`, it does not merely run.
 *   T-3  an EMPTY scan exits 2. A gate that finds nothing must never be green.
 *   T-4  a drop with no successor is rejected.
 *   T-5  the keyboard gate goes RED when the literal 42 returns to any of the four
 *        migrated surfaces — the fails-on-revert proof for the product change.
 *   T-6  the keyboard gate goes RED when the ORCH-1170 toolbar is un-nested.
 *   T-7  the ledger gate's KNOWN LIMITATION is stated in its own docstring, and it
 *        is honest: a gate that reads a file and asserts nothing about it still
 *        counts as coverage, and that is pinned as a deliberate boundary.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SG = path.resolve(HERE, "..");
const REPO = path.resolve(SG, "../../..");
const BIZ = path.join(REPO, "mingla-business");

const LEDGER_GATE = path.join(SG, "issue-1850-quarantine-invariant-handoff-complete.mjs");
const KEYBOARD_GATE = path.join(SG, "i-1047-biz-keyboard-toolbar-keyed-offset.mjs");

const ledger = await import(LEDGER_GATE);
const keyboard = await import(KEYBOARD_GATE);

const CONFIG = fs.readFileSync(path.join(BIZ, "jest.config.cjs"), "utf8");
const ROOTS = { repo: REPO, biz: BIZ };

/** Everything the ledger gate needs, resolved from the real tree. */
function realModel(configText = CONFIG) {
  const { entries, error } = ledger.parseLedger(configText);
  assert.equal(error, undefined, `parseLedger failed: ${error}`);

  const testFiles = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/(^|\/)__tests__\/.*\.test\.tsx?$/.test(path.relative(BIZ, full).split(path.sep).join("/"))) {
        testFiles.push(full);
      }
    }
  })(BIZ);

  const testsFor = new Map();
  const gates = new Map();
  for (const entry of entries) {
    const re = new RegExp(entry.pattern);
    testsFor.set(
      entry.pattern,
      testFiles
        .filter((f) => re.test(path.relative(BIZ, f).split(path.sep).join("/")))
        .map((f) => ({ rel: path.relative(BIZ, f), dir: path.dirname(f), source: fs.readFileSync(f, "utf8") })),
    );
    if (!gates.has(entry.gateName)) {
      const abs = path.join(SG, entry.gateName);
      gates.set(entry.gateName, {
        onDisk: fs.existsSync(abs),
        source: fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null,
        dir: SG,
        enforcement: "batch:A",
      });
    }
  }
  return { configText, roots: ROOTS, testsFor, gates, entries };
}

/** Delete one entry's ledger lines from the config, leaving the bare arrow. */
function stripLedgerFor(configText, needle) {
  const lines = configText.split("\n");
  const out = [];
  let dropping = false;
  for (const line of lines) {
    if (line.includes(needle) && line.includes("// invariant ->")) {
      out.push(line);
      dropping = true;
      continue;
    }
    if (dropping) {
      if (/^\s*\/\//.test(line)) continue;
      dropping = false;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** The seven files #1850 consciously dropped from the ORCH-1165 hand-off. */
const DROPPED_BY_1850 = [
  "app/checkout/[eventId]/buyer.tsx",
  "app/checkout/[eventId]/payment.tsx",
  "app/checkout-trip/[tripEventId]/buyer.tsx",
  "app/checkout-trip/[tripEventId]/intake.tsx",
  "app/checkout-trip/[tripEventId]/payment.tsx",
  "app/checkout-experience/[experienceEventId]/buyer.tsx",
  "app/checkout-experience/[experienceEventId]/payment.tsx",
];

// ── T-1 ────────────────────────────────────────────────────────────────────
test("T-1 the ledger gate is green on the tree, as CI runs it", () => {
  // Plain mode only. The gate's own fixture battery is wired in MANIFEST.json
  // (modes carries the self-test mode, selfTest:"wired") and run-batch --class A
  // already runs it that way on every PR; re-spawning it here would duplicate a
  // check rather than add one.
  const r = spawnSync(process.execPath, [LEDGER_GATE], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, `expected exit 0\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /11 invariant hand-offs reconcile/);
});

// ── T-2 ────────────────────────────────────────────────────────────────────
test("T-2 removing #1850's ledger turns the gate RED and names every dark file", () => {
  const model = realModel(stripLedgerFor(CONFIG, "orch_1165_keyboard_toolbar_mount_coverage"));
  const r = ledger.run(model);
  assert.equal(r.code, 1, `expected a rule violation, got exit ${r.code}`);
  const text = r.failures.join("\n");
  for (const dark of DROPPED_BY_1850) {
    assert.ok(text.includes(dark), `failure did not name the dark file ${dark}`);
  }
  // Named files only, never a count with no list.
  assert.match(text, /7 of 17 file\(s\)/);
});

// ── T-3 ────────────────────────────────────────────────────────────────────
test("T-3 an empty scan exits 2 — a gate that finds nothing is never green", () => {
  const emptied = CONFIG.replace(
    /(#1047 \[business-jest-suite-audit\] — Part 1 quarantine)[\s\S]*?(\n\s*\],)/,
    "$1$2",
  );
  const r = ledger.run({ ...realModel(), configText: emptied });
  assert.equal(r.code, 2, `an emptied quarantine block must exit 2, got ${r.code}`);
  assert.match(r.failures.join("\n"), /V-ENTRIES|V-MARKER/);
});

// ── T-4 ────────────────────────────────────────────────────────────────────
test("T-4 a drop with no successor is rejected", () => {
  const gutted = CONFIG.replace(
    /\/\/ dropped: app\/checkout\/\[eventId\]\/buyer\.tsx —[^\n]*\n\s*\/\/\s{2,}[^\n]*\n/,
    "    // dropped: app/checkout/[eventId]/buyer.tsx\n",
  );
  assert.notEqual(gutted, CONFIG, "fixture did not modify the config — the ledger shape moved");
  const r = ledger.run(realModel(gutted));
  assert.equal(r.code, 1);
  assert.match(r.failures.join("\n"), /no usable reason/);
});

// ── T-5 ────────────────────────────────────────────────────────────────────
test("T-5 the keyboard gate goes RED when a literal 42 returns to any migrated surface", () => {
  const DERIVED = [
    "src/components/groupChat/GroupChatPanel.tsx",
    "src/components/support/SupportThread.native.tsx",
    "src/components/brand/BrandPaystackOnboardView.tsx",
    "src/screens/ari/AriChatScreen.tsx",
  ];
  const MOUNT = ["app/_layout.tsx", "src/components/ui/SheetMobile.tsx", "src/components/ui/Modal.tsx"];
  const KEYED = [
    ["src/components/auth/BusinessWelcomeScreen.tsx", /keyboardPad\s*>\s*0\s*\?\s*keyboardPad\s*\+\s*42/],
    ["src/components/waitlist/JoinWaitlistSheet.tsx", /keyboardPadding\s*>\s*0\s*\?\s*42/],
    [
      "src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
      /keyboardHeight\s*>\s*0\s*\?\s*keyboardHeight\s*\+\s*42/,
    ],
  ];
  const NESTED = ["src/components/ui/SheetMobile.tsx", "src/components/ui/Modal.tsx"];

  const load = () => {
    const files = new Map();
    for (const rel of new Set([...MOUNT, ...KEYED.map(([r]) => r), ...NESTED, ...DERIVED])) {
      files.set(rel, fs.readFileSync(path.join(BIZ, rel), "utf8"));
    }
    return files;
  };
  const base = () => ({
    files: load(),
    mountHosts: MOUNT,
    keyed: KEYED,
    nestedHosts: NESTED,
    derivedHosts: DERIVED,
  });

  assert.equal(keyboard.run(base()).code, 0, "the tree as committed must be green");

  // Each surface, one at a time, back to the literal it shipped with.
  for (const rel of DERIVED) {
    const m = base();
    const reverted = m.files
      .get(rel)
      .replace(/keyboardVerticalOffset=\{DONE_BAR_OCCUPIED\}/g, "keyboardVerticalOffset={42}")
      .replace(/\bDONE_BAR_OCCUPIED \+\n(\s*)composerHeight/g, "42 +\n$1composerHeight");
    assert.notEqual(reverted, m.files.get(rel), `fixture did not revert ${rel}`);
    m.files.set(rel, reverted);
    const r = keyboard.run(m);
    assert.equal(r.code, 1, `${rel}: reverting to the literal must fail the gate`);
    assert.ok(
      r.failures.some((f) => f.includes(rel)),
      `${rel}: the failure must name the file it is about`,
    );
  }
});

// ── T-6 ────────────────────────────────────────────────────────────────────
test("T-6 the keyboard gate goes RED when the ORCH-1170 toolbar is un-nested", () => {
  const MOUNT = ["app/_layout.tsx", "src/components/ui/SheetMobile.tsx", "src/components/ui/Modal.tsx"];
  const NESTED = ["src/components/ui/SheetMobile.tsx", "src/components/ui/Modal.tsx"];
  const DERIVED = [
    "src/components/groupChat/GroupChatPanel.tsx",
    "src/components/support/SupportThread.native.tsx",
    "src/components/brand/BrandPaystackOnboardView.tsx",
    "src/screens/ari/AriChatScreen.tsx",
  ];
  const KEYED = [
    ["src/components/auth/BusinessWelcomeScreen.tsx", /keyboardPad\s*>\s*0\s*\?\s*keyboardPad\s*\+\s*42/],
    ["src/components/waitlist/JoinWaitlistSheet.tsx", /keyboardPadding\s*>\s*0\s*\?\s*42/],
    [
      "src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
      /keyboardHeight\s*>\s*0\s*\?\s*keyboardHeight\s*\+\s*42/,
    ],
  ];
  for (const rel of NESTED) {
    const files = new Map();
    for (const r of new Set([...MOUNT, ...KEYED.map(([x]) => x), ...NESTED, ...DERIVED])) {
      files.set(r, fs.readFileSync(path.join(BIZ, r), "utf8"));
    }
    // Move the toolbar OUT of the provider: rule (A) still passes, (C) must not.
    const src = files.get(rel);
    const unnested = src.replace(/(\s*)<KeyboardToolbarRoot \/>/, "").replace(
      /(<\/KeyboardRoot>)/,
      "$1\n      <KeyboardToolbarRoot />",
    );
    assert.notEqual(unnested, src, `fixture did not un-nest ${rel}`);
    files.set(rel, unnested);
    const r = keyboard.run({ files, mountHosts: MOUNT, keyed: KEYED, nestedHosts: NESTED, derivedHosts: DERIVED });
    assert.equal(r.code, 1, `${rel}: a sibling toolbar must fail rule (C)`);
    assert.match(r.failures.join("\n"), /separate native window/);
  }
});

// ── T-7 ────────────────────────────────────────────────────────────────────
test("T-7 the ledger gate states its own limitation, and the limitation is real", () => {
  const source = fs.readFileSync(LEDGER_GATE, "utf8");
  const header = source.slice(0, source.indexOf("import fs"));
  assert.match(header, /KNOWN LIMITATION/, "the gate must state its limitation in its own docstring");
  assert.match(header, /FILE level/i);
  assert.match(header, /PaymentPlanEditor/, "the limitation must name the case it would NOT have caught");

  // And the limitation is not decoration: a gate that reads the right file and
  // asserts NOTHING about it still counts as coverage. Pinned deliberately, so
  // nobody later reads a green run as assertion-level proof.
  const model = realModel();
  const entry = model.entries.find((e) => e.pattern.includes("orch_1165"));
  const hollow = model.gates.get(entry.gateName);
  hollow.source = [...ledger.extractTargets(hollow.source, SG, ROOTS)]
    .map((p) => `read(${JSON.stringify(p)});`)
    .join("\n");
  const r = ledger.run(model);
  assert.equal(
    r.code,
    0,
    "a gate that only READS its targets still passes — this is the documented boundary, " +
      "not an undiscovered hole. If this ever starts failing the limitation shrank; update the header.",
  );
});
