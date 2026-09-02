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
 *   T-1  the ledger gate is GREEN on the tree, and all 14 live hand-offs reconcile.
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
// [TEST-MOD-APPROVED #2262] — ORCHESTRATOR-GRANTED, not self-granted. The
// authorising token lives in the COMMIT BODY, which is the only place
// `.github/scripts/test-append-only-check.js` reads it; these in-file markers are
// documentation for a human opening the file, and carry no authority on their own.
//
// Renamed in spirit, not in name: this is now "every
// file the quarantined test described that NO gate reads", whoever dropped it.
// #2262 added the composer — see the `dropped:` entry in jest.config.cjs, which
// names both successors.
const DROPPED_BY_1850 = [
  "src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
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
  // [TEST-MOD-APPROVED #3025] The output count must equal the parsed real
  // ledger, so an additive hand-off cannot leave a stale typed count green.
  const parsed = ledger.parseLedger(CONFIG);
  assert.equal(parsed.error, undefined, `parseLedger failed: ${parsed.error}`);
  assert.equal(parsed.entries.length, 14, "#3025 must expose exactly 14 live hand-offs");
  assert.match(r.stdout, new RegExp(`\\b${parsed.entries.length} invariant hand-offs reconcile\\b`));
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
  //
  // [TEST-MOD-APPROVED #2262 — orchestrator-granted; token in the commit body]
  // The count is DERIVED from the list above instead
  // of typed. It used to read `/7 of 17 file\(s\)/`, which is a count-pin: it
  // encodes today's number and breaks on every legitimate addition while
  // catching nothing the naming loop above does not already catch. Deriving it
  // keeps the real assertion — that the message reports a count CONSISTENT with
  // the files it names, never a bare list — and drops only the literal.
  assert.match(text, new RegExp(`${DROPPED_BY_1850.length} of 17 file\\(s\\)`));
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
  // [TEST-MOD-APPROVED #2262 — orchestrator-granted; token in the commit body]
  // The marketing composer was PROMOTED from the KEYED
  // cohort (B) to the DERIVED cohort (D). (B)'s contract is "if you hand-type a
  // 42, at least gate it on keyboard-open"; (D)'s is "never type one — derive it
  // from DONE_BAR_OCCUPIED". (D) is strictly stronger: it FORBIDS the literal
  // that (B) merely tolerates.
  //
  // #2262 deleted the composer's `keyboardHeight > 0 ? keyboardHeight + 42` and
  // the bespoke Keyboard.addListener behind it, and moved the budget to the
  // ROUTE, which reads DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE from
  // wrappers/keyboardClearance. The named gate's own header requires exactly
  // this ordering: "Widening (D) means migrating the surface first — that
  // ordering is the whole point."
  //
  // WHAT THE OLD ENTRY COULD CATCH THAT THIS CANNOT: nothing. It could catch an
  // ungated literal in ComposerV2Editor. That file now holds no keyboard code at
  // all, and i-2262-composer-measured-not-computed-layout.mjs rule R4 forbids
  // `Keyboard.addListener` there outright — marker or no marker — while R1/R3
  // forbid the constants. The composer's clearance is covered here instead, more
  // strictly, at the file that now owns it.
  const DERIVED = [
    "src/components/groupChat/GroupChatPanel.tsx",
    "src/components/support/SupportThread.native.tsx",
    "src/components/brand/BrandPaystackOnboardView.tsx",
    "src/screens/ari/AriChatScreen.tsx",
    "app/(tabs)/marketing/campaigns/compose.tsx",
  ];
  const MOUNT = ["app/_layout.tsx", "src/components/ui/SheetMobile.tsx", "src/components/ui/Modal.tsx"];
  const KEYED = [
    ["src/components/auth/BusinessWelcomeScreen.tsx", /keyboardPad\s*>\s*0\s*\?\s*keyboardPad\s*\+\s*42/],
    ["src/components/waitlist/JoinWaitlistSheet.tsx", /keyboardPadding\s*>\s*0\s*\?\s*42/],
    // [TEST-MOD-APPROVED #2262 — orchestrator-granted] the composer moved to
    // DERIVED, above.
  ];
  const NESTED = ["src/components/ui/SheetMobile.tsx", "src/components/ui/Modal.tsx"];

  const load = () => {
    const files = new Map();
    for (const rel of new Set([...MOUNT, ...KEYED.map(([r]) => r), ...NESTED, ...DERIVED])) {
      files.set(rel, fs.readFileSync(path.join(BIZ, rel), "utf8"));
    }
    return files;
  };
  // [TEST-MOD-APPROVED #1890] rule (E) was INVERTED. It used to require Ari's
  // lift to keep ADDING the composer's measured height; that is the double count
  // #1890 measured on glass (61.0pt of dead gap on an iPhone SE3, 71.8dp on a
  // physical Samsung, against a 12pt contract). It now requires the lift to be
  // EXACTLY the occluder budget and nothing else.
  const MEASURED = [
    {
      rel: "src/screens/ari/AriChatScreen.tsx",
      lift: /keyboardHeight\s*>\s*0\s*\?([^:]*)/,
      terms: ["keyboardHeight", "DONE_BAR_OCCUPIED", "MIN_VISIBLE_CLEARANCE"],
      banned: [
        [/onLayout\s*=\s*\{\s*onComposerLayout\s*\}/, "onLayout={onComposerLayout} on a composer wrapper"],
        [/setComposerHeight\s*\(/, "a setComposerHeight(…) call"],
      ],
    },
  ];
  const base = () => ({
    files: load(),
    mountHosts: MOUNT,
    keyed: KEYED,
    nestedHosts: NESTED,
    derivedHosts: DERIVED,
    measured: MEASURED,
  });

  assert.equal(keyboard.run(base()).code, 0, "the tree as committed must be green");

  // Each surface, one at a time, back to the literal it shipped with.
  //
  // [TEST-MOD-APPROVED #1890] the mutation is re-keyed onto BEHAVIOUR. It used to
  // match the exact string `keyboardVerticalOffset={DONE_BAR_OCCUPIED}`, so it
  // silently stopped mutating the moment a surface's expression changed at all —
  // and a revert-proof that no longer reverts anything proves nothing. It now
  // replaces WHATEVER expression the attribute holds, and rewrites Ari's derived
  // bar term (Ari has no KeyboardAvoidingView; its clearance lives in the lift).
  for (const rel of DERIVED) {
    const m = base();
    const reverted = m.files
      .get(rel)
      .replace(/keyboardVerticalOffset=\{[^}]*\}/g, "keyboardVerticalOffset={42}")
      .replace(/keyboardHeight \+ DONE_BAR_OCCUPIED/g, "keyboardHeight + 42");
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
  // [TEST-MOD-APPROVED #1890] rule (E) was INVERTED. It used to require Ari's
  // lift to keep ADDING the composer's measured height; that is the double count
  // #1890 measured on glass (61.0pt of dead gap on an iPhone SE3, 71.8dp on a
  // physical Samsung, against a 12pt contract). It now requires the lift to be
  // EXACTLY the occluder budget and nothing else.
  const MEASURED = [
    {
      rel: "src/screens/ari/AriChatScreen.tsx",
      lift: /keyboardHeight\s*>\s*0\s*\?([^:]*)/,
      terms: ["keyboardHeight", "DONE_BAR_OCCUPIED", "MIN_VISIBLE_CLEARANCE"],
      banned: [
        [/onLayout\s*=\s*\{\s*onComposerLayout\s*\}/, "onLayout={onComposerLayout} on a composer wrapper"],
        [/setComposerHeight\s*\(/, "a setComposerHeight(…) call"],
      ],
    },
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
    const r = keyboard.run({
      files,
      mountHosts: MOUNT,
      keyed: KEYED,
      nestedHosts: NESTED,
      derivedHosts: DERIVED,
      measured: MEASURED,
    });
    assert.equal(r.code, 1, `${rel}: a sibling toolbar must fail rule (C)`);
    assert.match(r.failures.join("\n"), /separate native window/);
  }
});

// ── T-7 ───────────────────────────────────────────────────────────────────
//
// The first version of this test asserted the docstring CONTAINED the string
// "PaymentPlanEditor" and called that proof. The docstring's claim about
// PaymentPlanEditor was false, so the test pinned the error in place and review
// could not see it — the failure mode #1850 exists to end, reproduced inside
// #1850's own regression suite.
//
// So T-7 no longer reads the paragraph. It RE-DERIVES the limitation from the live
// corpus — strip each entry's ledger, re-run the gate, record whether the ⊆ rule
// reddens — and fails if the docstring and the tree disagree in either direction.
// A documented limitation is an assertion; it gets evidence like any other.

/** Strip the ledger comment lines belonging to ONE entry, leaving the bare arrow. */
function stripOneLedger(configText, entryLine) {
  const out = [];
  let dropping = false;
  for (const line of configText.split("\n")) {
    if (line === entryLine) {
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

/** A stable key per entry: its decoded pattern with regex backslashes removed. */
const patternKey = (pattern) => pattern.replace(/\\/g, "");

/** Read one `LABEL: a, b, c` list out of the gate's header, continuations included. */
function docstringList(header, label) {
  const lines = header.split("\n").map((l) => l.replace(/^\s*\*\s?/, ""));
  const i = lines.findIndex((l) => l.trim().startsWith(`${label}:`));
  assert.ok(i >= 0, `the gate header must carry a ${label}: list — it is the machine-checkable ` +
    "form of its own limitation, and without it this test cannot verify the claim");
  let buf = lines[i].slice(lines[i].indexOf(":") + 1);
  for (let j = i + 1; j < lines.length; j += 1) {
    const t = lines[j].trim();
    if (t === "" || /^[A-Z][A-Z-]+:/.test(t) || !/^[\w.\-,/ ]+$/.test(t)) break;
    buf += ` ${t}`;
  }
  return buf.split(",").map((x) => x.trim()).filter(Boolean);
}

test("T-7 the stated limitation is re-measured against the live corpus, not read back", () => {
  const source = fs.readFileSync(LEDGER_GATE, "utf8");
  const header = source.slice(0, source.indexOf("import fs"));
  assert.match(header, /KNOWN LIMITATION/, "the gate must state its limitation in its own docstring");
  assert.match(header, /FILE level/i);

  // ---- what the docstring claims -----------------------------------------
  const claimedCatches = docstringList(header, "MEASURED-CATCHES");
  const claimedInversionOnly = docstringList(header, "MEASURED-INVERSION-ONLY");
  const claimedMisses = docstringList(header, "MEASURED-MISSES");

  // ---- what the tree actually does ---------------------------------------
  const base = realModel();
  assert.equal(ledger.run(base).code, 0, "the corpus must be green before measuring it");

  const measuredCatches = [];
  const measuredInversionOnly = [];
  const measuredMisses = [];
  for (const entry of base.entries) {
    const stripped = stripOneLedger(CONFIG, entry.raw.split("\n")[0]);
    assert.notEqual(stripped, CONFIG, `could not strip the ledger for ${entry.pattern}`);
    const r = ledger.run(realModel(stripped));
    const key = patternKey(entry.pattern);
    const mine = r.failures.filter((f) => f.includes(entry.pattern));
    if (mine.some((f) => f.includes("covered by NOTHING"))) measuredCatches.push(key);
    else if (mine.length > 0) measuredInversionOnly.push(key);
    else measuredMisses.push(key);
  }

  // ---- every claimed name must resolve to exactly one real entry ----------
  const resolve = (claim, side) => {
    const hits = base.entries.map((e) => patternKey(e.pattern)).filter((k) => k.includes(claim));
    assert.equal(
      hits.length,
      1,
      `the header's ${side} names "${claim}", which matches ${hits.length} quarantine entries. ` +
        "Every name in the limitation must identify exactly one hand-off, or the claim is unfalsifiable.",
    );
    return hits[0];
  };
  const claimedCatchKeys = claimedCatches.map((c) => resolve(c, "MEASURED-CATCHES")).sort();
  const claimedInvKeys = claimedInversionOnly.map((c) => resolve(c, "MEASURED-INVERSION-ONLY")).sort();
  const claimedMissKeys = claimedMisses.map((c) => resolve(c, "MEASURED-MISSES")).sort();

  assert.deepEqual(
    measuredInversionOnly.slice().sort(),
    claimedInvKeys,
    "the header's MEASURED-INVERSION-ONLY list does not match the tree.\n" +
      `  measured: ${measuredInversionOnly.sort().join(", ")}\n  header:   ${claimedInvKeys.join(", ")}\n` +
      "These are hand-offs the subset rule is silent on but R4 still reddens — miscategorising one " +
      "either overstates the blind spot or hides it.",
  );

  // ---- and the two must agree, in BOTH directions ------------------------
  assert.deepEqual(
    measuredCatches.slice().sort(),
    claimedCatchKeys,
    "the header's MEASURED-CATCHES list does not match what the gate actually catches on this tree.\n" +
      `  measured: ${measuredCatches.sort().join(", ")}\n  header:   ${claimedCatchKeys.join(", ")}\n` +
      "Re-measure and correct the header. A limitation paragraph that has drifted from the tree is " +
      "exactly the defect #1850 was opened to fix.",
  );
  assert.deepEqual(
    measuredMisses.slice().sort(),
    claimedMissKeys,
    "the header's MEASURED-MISSES list does not match what the gate actually misses on this tree.\n" +
      `  measured: ${measuredMisses.sort().join(", ")}\n  header:   ${claimedMissKeys.join(", ")}\n` +
      "This is the list a reader trusts to know where the blind spots are; a wrong entry here tells " +
      "them a covered case is uncovered, or an uncovered case is safe.",
  );

  // ---- the specific error P2-4 caught must not come back ------------------
  assert.ok(
    !claimedMisses.some((c) => c.includes("PaymentPlanEditor")),
    "the header lists PaymentPlanEditor as a MISS. It is not: stripping its ledger reddens the gate " +
      "with `6 of 7 file(s) covered by NOTHING`, because the RPC and cache rules it dropped live in " +
      "other files. This exact claim shipped once and was pinned by this test's predecessor.",
  );
  assert.match(
    header,
    /FLAGSHIP BLIND SPOT IS `rsvp\/\[id\]\/preview`/,
    "the header must name the real flagship blind spot — rsvp/[id]/preview, ~24 of 29 assertions " +
      "dark inside one fully-covered file — not merely list keys.",
  );
});

// ── T-8 ───────────────────────────────────────────────────────────────────
test("T-8 the documented boundary is real: a gate that only READS its targets still passes", () => {
  // The limitation is not decoration. Pinned deliberately, so nobody later reads a
  // green run as assertion-level proof. If this ever starts failing the limitation
  // shrank — which is good news, and the header must be updated to say so.
  const model = realModel();
  const entry = model.entries.find((e) => e.pattern.includes("orch_1165"));
  const hollow = model.gates.get(entry.gateName);
  hollow.source = [...ledger.extractTargets(hollow.source, SG, ROOTS)]
    .map((p) => `read(${JSON.stringify(p)});`)
    .join("\n");
  assert.equal(
    ledger.run(model).code,
    0,
    "a gate that only READS its targets still passes — this is the documented boundary, " +
      "not an undiscovered hole.",
  );
});
