/**
 * #1841 [keyboard-guard-blind-spots] — IMPLEMENTOR happy-path regression proof.
 *
 * ===========================================================================
 * THE ANGLE, AND HOW IT DIFFERS FROM THE TESTER'S ADVERSARIAL SUITE.
 *
 * `KeyboardRoot.sweep.v2.adversarial.test.tsx` plants SYNTHETIC files and
 * proves the gate says red on each shape. That proves the rule. It does not
 * prove that THIS REPO's ten real screens actually reached the end state the
 * issue determined for them, and it cannot: a synthetic fixture passes just as
 * happily on a tree where nothing was fixed.
 *
 * This suite mutates the REAL, SHIPPED product files — in memory, through the
 * gate's injected reader, never on disk — reverting each one to the exact shape
 * it had before #1841, and asserts the corrected gate flags it. So each row
 * below is a per-file fails-on-revert proof executed on real source, and the
 * CONTROL at the end asserts the unmutated tree is clean. Delete a Half A
 * migration and the control goes red; delete a gate repair and the matching
 * mutation stops being flagged and its row goes red.
 *
 * Nothing here re-declares the gate's patterns
 * (I-PROPOSED-1841-A-GUARD-MUST-BE-EXECUTED-NOT-RE-DECLARED). Every verdict is
 * produced by executing the gate's own exported core.
 * ===========================================================================
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

// Promisified on purpose: this suite's verdicts come from AWAITING a real
// subprocess that runs the real gate over the real tree, not from reading
// source text and hoping. The source-text reads further down are corroborating
// detail on top of that, never the proof.
const execFileAsync = promisify(execFile);

const bizRoot = path.resolve(__dirname, "..", "..", "..");
const repoRoot = path.resolve(bizRoot, "..");
const GATE_PATH = path.join(
  repoRoot,
  ".github",
  "scripts",
  "strict-grep",
  "orch-0892-no-bespoke-keyboard-plumbing.mjs",
);

const TIMEOUT_MS = 180_000;

/**
 * One mutation per closed hole, expressed against real product source.
 *
 * `find` must be present in the shipped file — if it is not, the mutation is
 * inapplicable and the row FAILS rather than silently proving nothing. That is
 * the difference between a mutation test and a decorative one.
 */
interface Mutation {
  /** Repo-relative path of the real file to mutate. */
  file: string;
  /** What the mutation reverts, in one line, for the failure message. */
  reverts: string;
  /** Exact substring present in the shipped file. */
  find: string;
  /** What it becomes — the pre-#1841 shape. */
  replace: string;
  /** The warning pattern the corrected gate must raise. */
  expect: string;
}

const MUTATIONS: readonly Mutation[] = [
  {
    file: "mingla-business/app/checkout-trip/[tripEventId]/intake.tsx",
    reverts:
      "A1 — the trip-intake buyer money path back to a bare react-native ScrollView. It has NO TextInput token of its own (its fields come from the Input primitive via IntakeFormRenderer), so only the corrected branch (b) can see it: this row is the token-vs-child hole, on a real money screen.",
    find: 'import { ScrollView } from "../../../src/wrappers/SmartScrollView";',
    replace: 'import { ScrollView } from "react-native";',
    expect: "bare react-native container",
  },
  {
    file: "mingla-business/src/components/venue/VenueListingContent.tsx",
    reverts:
      "A5 — the venue listing screen back to a bare container. Its field is VenuePitchField, again via the Input primitive.",
    find: 'import { ScrollView } from "../../wrappers/SmartScrollView";',
    replace: 'import { ScrollView } from "react-native";',
    expect: "bare react-native container",
  },
  {
    file: "mingla-business/src/components/brand/BrandBankConnectBody.web.tsx",
    reverts:
      "A6 — the bank-connect money surface back to a bare container. Its fields are inside BrandPaystackOnboardView, one module further down the closure.",
    find: 'import { ScrollView } from "../../wrappers/SmartScrollView";',
    replace: 'import { ScrollView } from "react-native";',
    expect: "bare react-native container",
  },
  {
    file: "mingla-business/app/__styleguide.tsx",
    reverts: "A7 — the styleguide back to a bare container hosting the Input primitive.",
    find: 'import { ScrollView } from "../src/wrappers/SmartScrollView";',
    replace: 'import { ScrollView } from "react-native";',
    expect: "bare react-native container",
  },
  {
    file: "mingla-business/src/screens/ari/AriChatScreen.tsx",
    reverts:
      "A8 — the ARI composer back to the bespoke listener pair, written the CROSS-PLATFORM-CORRECT way with the event name hoisted into a variable. The pre-#1841 gate walked straight past exactly this shape.",
    find: "  const keyboardHeight = useKeyboardHeight();",
    replace: [
      "  const [keyboardHeight, setKeyboardHeight] = useState(0);",
      "  const showEvent = Platform.OS === \"ios\" ? \"keyboardWillShow\" : \"keyboardDidShow\";",
      "  const sub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));",
      "  void sub;",
    ].join("\n"),
    expect: "Keyboard.addListener",
  },
  {
    file: "mingla-business/app/checkout/[eventId]/payment.tsx",
    reverts:
      "A2 — the event-checkout payment route's deleted listener, restored in its original hoisted form. Three payment routes carried this shape and all three were silently green.",
    find: "  const scrollViewRef = useRef<ScrollView | null>(null);",
    replace: [
      "  const scrollViewRef = useRef<ScrollView | null>(null);",
      "  const showEvent = Platform.OS === \"ios\" ? \"keyboardWillShow\" : \"keyboardDidShow\";",
      "  const sub = Keyboard.addListener(showEvent, () => undefined);",
      "  void sub;",
    ].join("\n"),
    expect: "Keyboard.addListener",
  },
  {
    file: "mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx",
    reverts:
      "A9 — the SECOND allowlist marker. The file keeps its first, already-approved marker four lines above; before #1841 that one marker immunised this listener too, which is the whole of hole 4 reproduced on real source.",
    find:
      "    // orch-strict-grep-allow orch-0892 — SPEC §8.3 mandated Cycle 3 wizard pattern (Keyboard.addListener + dynamic paddingBottom) per memory rule feedback_keyboard_never_blocks_input.md; SmartScrollView migration belongs in a follow-up ORCH covering all bespoke-keyboard sites uniformly.\n    const hide = Keyboard.addListener",
    replace: "    const hide = Keyboard.addListener",
    expect: "Keyboard.addListener",
  },
  {
    file: "mingla-business/src/components/ari/MessageList.tsx",
    reverts:
      "the ONE authorised allowlist entry. Without it the FlatList that hosts ToolProposalCard's edit field is a violation — which is the point: the entry is load-bearing, not decorative, and the gate can see this container at all only because #1841 added FlatList to the governed class.",
    find:
      "    // orch-strict-grep-allow orch-0892 — no keyboard-aware virtualised container exists",
    replace: "    // (marker deleted by the #1841 happy-path mutation)  ",
    expect: "bare react-native container",
  },
];

interface RowResult {
  file: string;
  mutationApplied: boolean;
  patternsOnMutated: string[];
  patternsOnOriginal: string[];
}

interface HarnessResult {
  controlWarnings: string[];
  controlScanned: number;
  rows: RowResult[];
}

/**
 * One spawn, all rows. Reads the REAL tree through the gate's own walk, swaps
 * one file's contents in the injected reader, and reports what the gate said —
 * for the mutated tree AND for the untouched one, so a row that would have been
 * flagged anyway cannot masquerade as a mutation proof.
 */
async function runHarness(): Promise<HarnessResult> {
  const script =
    `import * as gate from ${JSON.stringify(pathToFileURL(GATE_PATH).href)};\n` +
    `import fs from "node:fs";\n` +
    `import path from "node:path";\n` +
    `const repoRoot = ${JSON.stringify(repoRoot)};\n` +
    `const MUTATIONS = ${JSON.stringify(MUTATIONS)};\n` +
    `const files = gate.collectSourceFiles();\n` +
    `const cache = new Map();\n` +
    `const readReal = (p) => { if (!cache.has(p)) cache.set(p, fs.readFileSync(p, "utf8")); return cache.get(p); };\n` +
    `const control = gate.scanKeyboardPlumbing({ files, readFile: readReal });\n` +
    `const rows = [];\n` +
    `for (const m of MUTATIONS) {\n` +
    `  const abs = path.join(repoRoot, m.file);\n` +
    `  const original = readReal(abs);\n` +
    `  const mutated = original.split(m.find).join(m.replace);\n` +
    `  const applied = mutated !== original;\n` +
    `  const scan = gate.scanKeyboardPlumbing({\n` +
    `    files,\n` +
    `    readFile: (p) => (p === abs ? mutated : readReal(p)),\n` +
    `  });\n` +
    `  rows.push({\n` +
    `    file: m.file,\n` +
    `    mutationApplied: applied,\n` +
    `    patternsOnMutated: scan.warnings.filter((w) => w.path === m.file).map((w) => w.pattern),\n` +
    `    patternsOnOriginal: control.warnings.filter((w) => w.path === m.file).map((w) => w.pattern),\n` +
    `  });\n` +
    `}\n` +
    `process.stdout.write(JSON.stringify({\n` +
    `  controlWarnings: control.warnings.map((w) => w.path + ":" + w.line + " " + w.pattern),\n` +
    `  controlScanned: control.scanned,\n` +
    `  rows,\n` +
    `}));\n`;

  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      encoding: "utf8",
      cwd: repoRoot,
      timeout: TIMEOUT_MS,
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout) as HarnessResult;
}

let harness: HarnessResult;

beforeAll(async () => {
  harness = await runHarness();
}, TIMEOUT_MS);

describe("#1841 · the ten screens reached their determined end state, and the gate can now see them", () => {
  it("CONTROL: the shipped tree is clean, and the scan was not empty", () => {
    // The vacuity half. A gate that scanned nothing would also report zero
    // warnings, so the count is asserted alongside the cleanliness.
    expect(harness.controlScanned).toBeGreaterThanOrEqual(1100);
    expect(harness.controlWarnings).toEqual([]);
  });

  it.each(MUTATIONS.map((m, i) => ({ i, file: m.file, reverts: m.reverts })))(
    "reverting $file makes the gate flag it — $reverts",
    ({ i }) => {
      const m = MUTATIONS[i];
      const row = harness.rows[i];

      // A mutation that did not apply proves nothing. Fail loudly rather than
      // pass on an anchor string that has drifted out of the file.
      expect({ file: row.file, applied: row.mutationApplied }).toEqual({
        file: m.file,
        applied: true,
      });

      // It must be clean BEFORE the mutation, or the row is not attributable.
      expect(row.patternsOnOriginal).toEqual([]);

      expect(
        row.patternsOnMutated.some((p) => p.includes(m.expect)),
      ).toBe(true);
    },
  );

  it("the three payment routes still contain no keyboard plumbing at all", () => {
    // The deletions, asserted as an absence the gate cannot express: the gate
    // is silent about a route with no listener AND about one whose listener it
    // cannot see, so silence alone is not evidence. This row reads the source.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const routes = [
      "app/checkout/[eventId]/payment.tsx",
      "app/checkout-trip/[tripEventId]/payment.tsx",
      "app/checkout-experience/[experienceEventId]/payment.tsx",
    ];
    for (const rel of routes) {
      const src = fs.readFileSync(path.join(bizRoot, rel), "utf8");
      const code = src
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      expect({ rel, listener: /Keyboard\s*\.\s*addListener/.test(code) }).toEqual({
        rel,
        listener: false,
      });
      expect({ rel, state: /keyboardHeight/.test(code) }).toEqual({ rel, state: false });
    }
  });

  it("no migrated call site passes bottomOffset — the wrapper owns the derived budget", () => {
    // I-PROPOSED-1834-…-DONE-BAR: re-typing the offset at a call site is the
    // defect #1834 shipped and then removed. A migration that reintroduced one
    // would still satisfy every other assertion here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const migrated = [
      "app/checkout-trip/[tripEventId]/intake.tsx",
      "src/components/venue/VenueListingContent.tsx",
      "src/components/brand/BrandBankConnectBody.web.tsx",
      "app/__styleguide.tsx",
    ];
    for (const rel of migrated) {
      const src = fs.readFileSync(path.join(bizRoot, rel), "utf8");
      // Comments are stripped first — each migrated file carries a protective
      // comment that says never to pass `bottomOffset`, and a naive substring
      // test would read that warning as the violation it warns against.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      expect({ rel, passesOffset: /bottomOffset\s*=/.test(code) }).toEqual({
        rel,
        passesOffset: false,
      });
      expect({ rel, usesWrapper: /wrappers\/SmartScrollView/.test(src) }).toEqual({
        rel,
        usesWrapper: true,
      });
    }
  });
});
