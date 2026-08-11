/**
 * [TEST-MOD-APPROVED #1841]
 *
 * ORCH-0892 keyboard-plumbing guard — adversarial verification, v3.
 *
 * ===========================================================================
 * WHY THIS FILE WAS REWRITTEN RATHER THAN EXTENDED.
 *
 * The v2 file at this path was cited by docs/INVARIANT_REGISTRY.md as the
 * INDEPENDENT proof that the orch-0892 gate worked. It was not independent: it
 * re-declared all five of the gate's regexes character-for-character, plus its
 * own walkSourceFiles, its own comment-stripper and its own SAFELIST. A copy
 * cannot verify its original — it inherits every defect it was written to
 * catch, and by #1841 it had already DRIFTED from the thing it claimed to
 * mirror in three separate places:
 *
 *   - its SAFELIST had 7 entries where the gate had 8;
 *   - its comment-stripper removed TRAILING `//` comments where the gate drops
 *     only whole-line ones, so the two "identical" enforcers could disagree
 *     about the same file;
 *   - its scan domain was {src, app} where the gate's was all of
 *     mingla-business.
 *
 * And its TA-V2-2 printed `[TA-V2-2 SKIP]`, returned, and reported a tick —
 * inside `mingla-business jest (full suite)`, the ONLY required status check.
 * `dist/` is gitignored, so that assertion had never once asserted anything.
 *
 * Extending it would have left the vacuous tick in place under a new sibling.
 *
 * ===========================================================================
 * THE CONTRACT THIS FILE HOLDS ITSELF TO
 * (I-PROPOSED-1841-A-GUARD-MUST-BE-EXECUTED-NOT-RE-DECLARED):
 *
 *   1. It EXECUTES the gate — spawning its CLI, or importing its exported pure
 *      core. There is not one `RE_*` literal, one file-walk, one SAFELIST entry
 *      or one comment-stripper restated below. Every value it compares against
 *      is READ FROM THE GATE, so the two can no longer drift apart: there is
 *      only one copy to drift.
 *   2. It carries a VACUITY GUARD. An emptied SCAN_ROOTS or a broken walk makes
 *      the gate print `Scanned 0` and `PASS`; TA-V3-2 fails on the floor and on
 *      every named sentinel, and TA-V3-3 proves an empty input set THROWS.
 *      An empty scan is a failure, never a pass.
 *   3. NOTHING here returns early on a missing prerequisite. A missing
 *      prerequisite is a failure, or the assertion is rewritten to one that
 *      cannot go missing. TA-V3-6 is that rewrite.
 *
 * TA-V3-3's fixtures are deliberately NOT the gate's own self-test fixtures.
 * They are independently written for the same shapes, so a gate whose self-test
 * fixtures had been tuned to keep passing still fails here.
 * ===========================================================================
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const bizRoot = path.resolve(__dirname, "..", "..", "..");
const repoRoot = path.resolve(bizRoot, "..");
const GATE_PATH = path.join(
  repoRoot,
  ".github",
  "scripts",
  "strict-grep",
  "orch-0892-no-bespoke-keyboard-plumbing.mjs",
);

const GATE_TIMEOUT_MS = 120_000;

/**
 * Vacuity floor. 1131 files were in the domain at 3745ea19f (1133 after #1841
 * added the useKeyboardHeight wrapper pair). The floor exists so that a scan
 * which silently collapses — a renamed directory, an emptied SCAN_ROOTS, a walk
 * that throws and returns [] — fails LOUDLY instead of reporting PASS over
 * nothing. It is deliberately well below the real number: this is a
 * catastrophe detector, not a file census, and a census would fail on every
 * ordinary deletion.
 */
const SCANNED_FLOOR = 1100;

/**
 * Files the scan MUST have visited, named individually. The floor alone can be
 * satisfied by scanning 1100 of the wrong files; these five cannot. Two are
 * buyer money paths, one is a live tab surface, one is the wrapper the whole
 * invariant is about.
 */
const SENTINEL_FILES = [
  "mingla-business/app/checkout-trip/[tripEventId]/intake.tsx",
  "mingla-business/app/checkout/[eventId]/payment.tsx",
  "mingla-business/src/components/venue/VenueListingContent.tsx",
  "mingla-business/src/components/ari/MessageList.tsx",
  "mingla-business/src/wrappers/SmartScrollView.native.tsx",
];

/**
 * Every file permitted to carry an inline `orch-strict-grep-allow orch-0892`
 * marker. Asserted in BOTH directions by TA-V3-5, so an unapproved new marker
 * fails AND a stale registration for a file that has since been migrated fails.
 */
const EXPECTED_ALLOWLISTED_FILES = [
  "mingla-business/src/components/ui/Input.tsx",
  "mingla-business/src/components/auth/BusinessWelcomeScreen.tsx",
  "mingla-business/src/components/marketing/SmsComposeCard.tsx",
  "mingla-business/app/account/support.tsx",
  "mingla-business/src/components/trip/TripDayEditor.tsx",
  "mingla-business/src/components/groupChat/GroupChatPanel.tsx",
  // NOT listed: src/components/support/SupportThread.native.tsx. It carries the
  // marker TEXT at line 13, but inside a `/** … */` JSDoc block on a ` * ` line,
  // which is neither of the two comment forms the gate recognises — so the gate
  // has never honoured it, and never needed to: that file trips none of the four
  // patterns (its KeyboardAvoidingView comes from the library, not react-native).
  // The v2 test registered it because it enumerated markers with a plain
  // substring grep rather than the gate's own regex, so it counted a decorative
  // one. Dropping the registration removes paperwork, not an exemption; if that
  // file ever does trip a pattern, CI will say so instead of waving it through.
  "mingla-business/src/components/brand/BrandCreationFlow.tsx",
  "mingla-business/src/components/experience/ExperienceCreatorWizard.tsx",
  "mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx",
  // #1841 — the ONE new entry, granted because no keyboard-aware virtualised
  // container exists in react-native-keyboard-controller. Reason is written at
  // the marker; follow-up is #1873. Delete both together.
  "mingla-business/src/components/ari/MessageList.tsx",
];

/**
 * TA-V3-6's ratchet, and the ONE constant #1627 will amend.
 *
 * Every platform-agnostic file that still imports react-native-keyboard-
 * controller, and therefore drags it into the WEB bundle. Kept as a plain,
 * separately-declared list — never inlined into a regex — precisely so #1627
 * can shrink it in one obvious edit after this lands.
 *
 * The domain spans BOTH mingla-business and packages/. That is not tidiness:
 * `packages/phone-input/CountryPickerModal.tsx` reaches the web bundle through
 * the three buyer-checkout routes plus PublicEventPage and
 * GuestVenueReservation, and every existing guard in this area
 * (orch-0892's SCAN_ROOTS, orch-1296's checkedRoots) stops at the
 * mingla-business boundary and cannot see it. Seeding only the two
 * mingla-business files would bank a FALSE FLOOR — a live instance of
 * I-PROPOSED-1841-B-GUARDS-ENUMERATE-CLASSES-NOT-HOSTS.
 *
 * Measured by #1627 (rig calibrated to -36 B against the committed baseline):
 * fixing only the two mingla-business files leaves the library present and adds
 * 440 B; fixing only phone-input leaves it present and adds 330 B; fixing all
 * three removes it entirely, -60,418 B raw / -12,719 gzip / -9,966 brotli. One
 * named import from the package root drags the whole 12-primitive barrel into
 * `__common`, the eager guest boot chunk. It is all-three-or-nothing.
 *
 * ---------------------------------------------------------------------------
 * #1627 SHRANK THIS TO EMPTY. All three were split behind platform-resolved
 * wrappers and the leak is closed, re-measured on the post-#1841 tree by a real
 * `expo export -p web --clear`:
 *
 *   __common  raw 2,341,978 -> 2,281,435  (-60,543 B)
 *             gzip  587,087 ->   574,336  (-12,751 B)
 *             brotli 439,775 ->  429,603  (-10,172 B)
 *   library markers in all 180 chunks: 0
 *
 * The ratchet now reads as designed: an EMPTY expected-set means any new leak
 * fails immediately, with no constant to edit first. Keep it empty. If a leak
 * must be granted, it needs an issue and a measured byte cost written here —
 * not a quiet append.
 * ---------------------------------------------------------------------------
 */
const KNOWN_WEB_LEAKS: string[] = [];

// ---------------------------------------------------------------------------
// Harness — run code INSIDE the real gate module and bring back JSON.
//
// This is the mechanism that makes re-declaration unnecessary: anything the
// test needs to know about the gate (its walk, its safelist, its allowlist
// regex, its comment classifier, its scanner) is obtained by executing the
// module, never by restating it here.
// ---------------------------------------------------------------------------

function inGate<T>(body: string): T {
  const script =
    `import * as gate from ${JSON.stringify(pathToFileURL(GATE_PATH).href)};\n` +
    `import fs from "node:fs";\n` +
    `import path from "node:path";\n` +
    `const repoRoot = ${JSON.stringify(repoRoot)};\n` +
    `const result = await (async () => {\n${body}\n})();\n` +
    `process.stdout.write(JSON.stringify(result));\n`;
  const raw = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    cwd: repoRoot,
    timeout: GATE_TIMEOUT_MS,
    maxBuffer: 128 * 1024 * 1024,
  });
  return JSON.parse(raw) as T;
}

interface GateRun {
  status: number;
  stdout: string;
}

function runGateCli(args: string[] = []): GateRun {
  try {
    const stdout = execFileSync(process.execPath, [GATE_PATH, ...args], {
      encoding: "utf8",
      cwd: repoRoot,
      timeout: GATE_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    return {
      status: typeof e.status === "number" ? e.status : 1,
      stdout: `${e.stdout ?? ""}${e.stderr ?? ""}${e.stdout === undefined && e.stderr === undefined ? (e.message ?? "") : ""}`,
    };
  }
}

// ---------------------------------------------------------------------------

describe("#1841 · orch-0892 keyboard guard — executed, never re-declared", () => {
  // ---- TA-V3-1: the real binary, on the real tree. ----------------------
  //
  // Not a reimplementation that agrees with the gate — the gate itself. If its
  // semantics change, this assertion follows automatically, which is the whole
  // difference between verifying and cloning.

  it("TA-V3-1: the gate binary runs on this tree and PASSES", () => {
    const run = runGateCli();
    expect({ status: run.status, tail: run.stdout.slice(-4000) }).toEqual({
      status: 0,
      tail: expect.stringMatching(/PASS — zero bespoke/),
    });
  }, GATE_TIMEOUT_MS);

  // ---- TA-V3-2: VACUITY GUARD. -----------------------------------------
  //
  // The assertion #1627's whole class was missing. A gate that scans nothing
  // prints PASS, and a green tick over an empty domain is worse than no gate.

  it("TA-V3-2: the scan is non-empty, above its floor, and visited five named real files", () => {
    const run = runGateCli();
    const scanned = /Scanned (\d+) \.ts\/\.tsx files/.exec(run.stdout);
    expect(scanned).not.toBeNull();

    const count = Number((scanned as RegExpExecArray)[1]);
    expect(Number.isFinite(count)).toBe(true);
    expect(count).toBeGreaterThanOrEqual(SCANNED_FLOOR);

    // Ask the GATE what it walked. Not a second walk written here — that would
    // be exactly the drift this rewrite exists to remove.
    const visited = inGate<string[]>(
      `const files = gate.collectSourceFiles();
       return files.map((f) => path.relative(repoRoot, f).split(path.sep).join("/"));`,
    );

    expect(visited.length).toBeGreaterThanOrEqual(SCANNED_FLOOR);
    const visitedSet = new Set(visited);
    const missing = SENTINEL_FILES.filter((f) => !visitedSet.has(f));
    expect(missing).toEqual([]);
  }, GATE_TIMEOUT_MS);

  // ---- TA-V3-3: MUTATION PROOF. ----------------------------------------
  //
  // Green-on-the-repo proves nothing on its own: a regex that silently stops
  // matching also produces green. These fixtures make the gate say RED on each
  // shape it was blind to before #1841, and confirm it stays GREEN on the legal
  // shapes next to them. Driven through the exported pure core with an injected
  // reader, so nothing is ever written into the repo tree.

  const virtualRoot = path.join(os.tmpdir(), "issue1841-ta-v3-3", "mingla-business");
  const v = (rel: string): string => path.join(virtualRoot, rel);

  const INPUT_PRIMITIVE = {
    [v("src/ui/Field.tsx")]: `
      import React from "react";
      import { TextInput } from "react-native";
      export const Field = (p) => <TextInput {...p} />;
    `,
  };

  interface Warning {
    path: string;
    line: number;
    pattern: string;
  }

  function scanVirtual(files: Record<string, string>): Warning[] {
    const payload = JSON.stringify(files);
    return inGate<Warning[]>(
      `const files = ${payload};
       const result = gate.scanKeyboardPlumbing({
         files: Object.keys(files),
         readFile: (p) => files[p],
         repoRoot: ${JSON.stringify(path.dirname(virtualRoot))},
       });
       return result.warnings.map((w) => ({ path: w.path, line: w.line, pattern: w.pattern }));`,
    );
  }

  const RED_CASES: readonly {
    id: string;
    blindSpot: string;
    expect: RegExp;
    files: Record<string, string>;
  }[] = [
    {
      id: "G-1",
      blindSpot:
        "the file renders its fields through the Input primitive, so it carries no TextInput token at all — the house style, invisible for three months",
      expect: /bare react-native container/,
      files: {
        ...INPUT_PRIMITIVE,
        [v("src/screens/PrimitiveOnlyForm.tsx")]: `
          import React from "react";
          import { ScrollView, View } from "react-native";
          import { Field } from "../ui/Field";
          export const PrimitiveOnlyForm = () => (
            <ScrollView>
              <View><Field value="" /></View>
            </ScrollView>
          );
        `,
      },
    },
    {
      id: "G-2",
      blindSpot:
        "the event name is computed, which is the CORRECT cross-platform idiom — the old gate rewarded it with silence",
      expect: /Keyboard\.addListener/,
      files: {
        [v("src/screens/ComputedEventName.tsx")]: `
          import { Keyboard, Platform } from "react-native";
          const EVENTS = { ios: "keyboardWillShow", android: "keyboardDidShow" };
          export function attach() {
            return Keyboard.addListener(EVENTS[Platform.OS], () => undefined);
          }
        `,
      },
    },
    {
      id: "G-3a",
      blindSpot: "FlatList was not a governed container at all",
      expect: /bare react-native container/,
      files: {
        ...INPUT_PRIMITIVE,
        [v("src/screens/ListWithField.tsx")]: `
          import React from "react";
          import { FlatList } from "react-native";
          import { Field } from "../ui/Field";
          export const ListWithField = () => (
            <FlatList data={[]} renderItem={() => <Field value="" />} />
          );
        `,
      },
    },
    {
      id: "G-3b",
      blindSpot: "SectionList was not a governed container either",
      expect: /bare react-native container/,
      files: {
        ...INPUT_PRIMITIVE,
        [v("src/screens/SectionsWithField.tsx")]: `
          import React from "react";
          import { SectionList } from "react-native";
          import { Field } from "../ui/Field";
          export const SectionsWithField = () => (
            <SectionList sections={[]} renderItem={() => <Field value="" />} />
          );
        `,
      },
    },
    {
      id: "G-4",
      blindSpot:
        "the JSX boolean shorthand is semantically ={true} but carries no '=', which the old regex required",
      expect: /automaticallyAdjustKeyboardInsets/,
      files: {
        [v("src/screens/ShorthandInsets.tsx")]: `
          import React from "react";
          import { ScrollView } from "react-native";
          export const ShorthandInsets = () => (
            <ScrollView automaticallyAdjustKeyboardInsets><></></ScrollView>
          );
        `,
      },
    },
    {
      id: "G-5",
      blindSpot:
        "a namespace import reaches the forbidden component with no brace for the named-import regex to match",
      expect: /namespace import/,
      files: {
        [v("src/screens/NamespaceAvoiding.tsx")]: `
          import React from "react";
          import * as ReactNative from "react-native";
          export const NamespaceAvoiding = () => (
            <ReactNative.KeyboardAvoidingView behavior="height">
              <ReactNative.Text>x</ReactNative.Text>
            </ReactNative.KeyboardAvoidingView>
          );
        `,
      },
    },
    {
      id: "G-6",
      blindSpot:
        "one approved marker used to immunise every later occurrence in the same file, forever",
      expect: /Keyboard\.addListener/,
      files: {
        [v("src/screens/MarkerThenMore.tsx")]: `
          import { Keyboard } from "react-native";
          export function attachBoth() {
            // orch-strict-grep-allow orch-0892 — approved: this one only
            const first = Keyboard.addListener("keyboardDidShow", () => undefined);




            const second = Keyboard.addListener("keyboardWillHide", () => undefined);
            return [first, second];
          }
        `,
      },
    },
  ];

  it.each(RED_CASES)(
    "TA-V3-3 RED $id: the gate flags what it was blind to ($blindSpot)",
    ({ expect: expected, files }) => {
      const warnings = scanVirtual(files);
      const patterns = warnings.map((w) => w.pattern);
      expect(patterns.some((p) => expected.test(p))).toBe(true);
    },
    GATE_TIMEOUT_MS,
  );

  it("TA-V3-3 RED G-7: a multi-line import reports a REAL line, not the :0 that misplaced the allowlist window", () => {
    const files = {
      [v("src/screens/MultiLineContainer.tsx")]: `import React from "react";
import {
  ScrollView,
  TextInput,
  View,
} from "react-native";

export const MultiLineContainer = () => (
  <ScrollView>
    <View><TextInput value="" /></View>
  </ScrollView>
);
`,
    };
    const warnings = scanVirtual(files);
    expect(warnings.length).toBeGreaterThan(0);
    for (const w of warnings) expect(w.line).toBeGreaterThan(1);
  }, GATE_TIMEOUT_MS);

  const GREEN_CASES: readonly {
    id: string;
    legalBecause: string;
    files: Record<string, string>;
  }[] = [
    {
      id: "GOOD",
      legalBecause: "it already uses the SmartScrollView wrapper",
      files: {
        ...INPUT_PRIMITIVE,
        [v("src/screens/AlreadyMigrated.tsx")]: `
          import React from "react";
          import { View } from "react-native";
          import { ScrollView } from "../wrappers/SmartScrollView";
          import { Field } from "../ui/Field";
          export const AlreadyMigrated = () => (
            <ScrollView keyboardShouldPersistTaps="handled">
              <View><Field value="" /></View>
            </ScrollView>
          );
        `,
      },
    },
    {
      id: "G-8",
      legalBecause:
        "a type-only ScrollView import is not a container, and the CORRECT migration keeps one for its imperative scroll handle",
      files: {
        ...INPUT_PRIMITIVE,
        [v("src/screens/TypeOnlyHandle.tsx")]: `
          import React, { useRef } from "react";
          import { View } from "react-native";
          import type { ScrollView as RNScrollView } from "react-native";
          import { ScrollView } from "../wrappers/SmartScrollView";
          import { Field } from "../ui/Field";
          export const TypeOnlyHandle = () => {
            const ref = useRef<RNScrollView | null>(null);
            return (
              <ScrollView ref={ref}>
                <View><Field value="" /></View>
              </ScrollView>
            );
          };
        `,
      },
    },
    {
      id: "G-8b",
      legalBecause:
        "the inline `{ type X }` spelling of a type-only import is erased just the same",
      files: {
        [v("src/screens/InlineTypeOnly.tsx")]: `
          import React from "react";
          import { type ScrollView, View, TextInput } from "react-native";
          export const InlineTypeOnly = () => (
            <View><TextInput value="" /></View>
          );
        `,
      },
    },
    {
      id: "G-9",
      legalBecause:
        "a field inside a <Modal> is in its own native window, lifted by the Modal, not by the outer scroll",
      files: {
        ...INPUT_PRIMITIVE,
        [v("src/screens/FieldInsideModal.tsx")]: `
          import React from "react";
          import { Modal, ScrollView, Text, View } from "react-native";
          import { Field } from "../ui/Field";
          export const FieldInsideModal = () => (
            <View>
              <ScrollView><Text>chrome only</Text></ScrollView>
              <Modal visible><Field value="" /></Modal>
            </View>
          );
        `,
      },
    },
    {
      id: "G-10",
      legalBecause:
        "a horizontal chip strip hosts no focusable field, and the rule is about hosting an input, not about importing a ScrollView",
      files: {
        [v("src/screens/ChipStrip.tsx")]: `
          import React from "react";
          import { ScrollView, Text, View } from "react-native";
          export const ChipStrip = () => (
            <ScrollView horizontal><View><Text>chip</Text></View></ScrollView>
          );
        `,
      },
    },
    {
      id: "G-11",
      legalBecause:
        "an explicit ={false} is the one spelling that genuinely turns the iOS-only inset behaviour off",
      files: {
        [v("src/screens/InsetsOff.tsx")]: `
          import React from "react";
          import { ScrollView } from "react-native";
          export const InsetsOff = () => (
            <ScrollView automaticallyAdjustKeyboardInsets={false}><></></ScrollView>
          );
        `,
      },
    },
  ];

  it.each(GREEN_CASES)(
    "TA-V3-3 GREEN $id: stays legal ($legalBecause)",
    ({ files }) => {
      expect(scanVirtual(files)).toEqual([]);
    },
    GATE_TIMEOUT_MS,
  );

  it("TA-V3-3 VACUITY: scanning an EMPTY file set THROWS — an empty scan is a failure, never a pass", () => {
    const outcome = inGate<{ threw: boolean; message: string }>(
      `try {
         gate.scanKeyboardPlumbing({ files: [], readFile: () => "" });
         return { threw: false, message: "" };
       } catch (err) {
         return { threw: true, message: String(err && err.message) };
       }`,
    );
    expect(outcome.threw).toBe(true);
    expect(outcome.message).toMatch(/EMPTY/i);
  }, GATE_TIMEOUT_MS);

  // ---- TA-V3-4: the gate's own self-test must actually run. -------------
  //
  // `--self-test` was passed by issue-1532-stay-manager-ux-tests.yml and
  // silently ignored for months because the script had no argv handling. This
  // makes that workflow line real, and makes the required jest check fail if
  // the gate's own fixtures ever rot.

  it("TA-V3-4: `--self-test` executes and passes", () => {
    const run = runGateCli(["--self-test"]);
    expect({ status: run.status, out: run.stdout }).toEqual({
      status: 0,
      out: expect.stringMatching(/self-test PASS \(GOOD \+ \d+ fixtures\)/),
    });
  }, GATE_TIMEOUT_MS);

  // ---- TA-V3-5: allowlist hygiene, using the GATE's regex. --------------
  //
  // Same spirit as the old TA-V2-3, but the marker regex is imported from the
  // gate instead of copied, so the enumerator and the enforcer can no longer
  // disagree about what a marker is.

  it("TA-V3-5: exactly the approved files carry an inline orch-0892 allowlist marker", () => {
    const found = inGate<string[]>(
      `const files = gate.collectSourceFiles();
       const out = [];
       for (const f of files) {
         const raw = fs.readFileSync(f, "utf8");
         if (raw.split("\\n").some((line) => gate.RE_INLINE_ALLOWLIST.test(line))) {
           out.push(path.relative(repoRoot, f).split(path.sep).join("/"));
         }
       }
       return out.sort();`,
    );

    // Both directions: an unapproved new marker is scope creep, and a stale
    // registration for a file that has since been migrated is dead paperwork.
    expect(found).toEqual([...EXPECTED_ALLOWLISTED_FILES].sort());
  }, GATE_TIMEOUT_MS);

  // ---- TA-V3-6: the web-bundle leak, as a RATCHET that cannot skip. -----
  //
  // Replaces TA-V2-2, which looked for a gitignored `dist/` directory, never
  // found it in CI, and reported a pass. This reads SOURCE, so there is no
  // prerequisite to be missing. Exact equality in both directions makes it a
  // ratchet: adding a leak fails, and FIXING one also fails until the constant
  // above is shrunk in the same commit — which is #1627's job, not this one's.
  // Doing nothing cannot satisfy it.

  it("TA-V3-6: exactly the known files leak react-native-keyboard-controller into the web bundle", () => {
    const leaks = inGate<string[]>(
      `const roots = [
         path.join(repoRoot, "mingla-business"),
         path.join(repoRoot, "packages"),
       ];
       const files = gate.collectSourceFiles(roots);
       const RE_LIBRARY_IMPORT = /from\\s+["']react-native-keyboard-controller["']/;
       // #1627 — "not web-reachable" has TWO spellings, because the two
       // packages in scope use OPPOSITE platform-split conventions and #1627's
       // REVIEW GATE explicitly declined to impose one across the boundary:
       //
       //   X.native.tsx            mingla-business/src/wrappers — X.tsx is web.
       //   X.tsx + X.web.tsx       packages/phone-input (WebOverlayPortal, and
       //                           now keyboardPrimitives) — X.tsx is the
       //                           DEFAULT/native file, shadowed on web by the
       //                           .web sibling Metro resolves first.
       //
       // The suffix test alone understands only the first. Left as-is it would
       // report packages/phone-input/keyboardPrimitives.tsx — the NATIVE half of
       // #1627's own fix, which a real web export proves contributes zero
       // library markers — as a leak, and the only ways to green that are to
       // bank a file that does not leak (a FALSE floor, this suite's own
       // I-PROPOSED-1841-B failure) or to rename against a convention already
       // proven on a real export. Resolution order is the honest question, so
       // ask resolution order.
       const shadowedOnWeb = (f) => {
         const base = path.basename(f);
         if (/\\.native\\.(ts|tsx)$/.test(base)) return true;
         const stem = base.replace(/\\.(ts|tsx)$/, "");
         if (/\\.web$/.test(stem)) return false;
         const dir = path.dirname(f);
         return fs.existsSync(path.join(dir, stem + ".web.tsx")) ||
                fs.existsSync(path.join(dir, stem + ".web.ts"));
       };
       const out = [];
       for (const f of files) {
         const rel = path.relative(repoRoot, f).split(path.sep).join("/");
         if (shadowedOnWeb(f)) continue;
         if (RE_LIBRARY_IMPORT.test(gate.stripComments(fs.readFileSync(f, "utf8")))) out.push(rel);
       }
       return out.sort();`,
    );

    expect(leaks).toEqual([...KNOWN_WEB_LEAKS].sort());
  }, GATE_TIMEOUT_MS);

  // ---- The file's own vacuity guard. ------------------------------------
  //
  // Everything above depends on the harness genuinely reaching the gate. If the
  // path rots, `inGate` throws and every test above fails loudly — but state it
  // once, explicitly, so the reason is legible rather than inferred from six
  // simultaneous stack traces.

  it("the gate module this suite executes actually exists at the path cited by the invariant registry", () => {
    expect(fs.existsSync(GATE_PATH)).toBe(true);
    const exported = inGate<string[]>(`return Object.keys(gate).sort();`);
    expect(exported).toEqual(
      expect.arrayContaining([
        "RE_INLINE_ALLOWLIST",
        "SAFELIST",
        "collectSourceFiles",
        "scanKeyboardPlumbing",
        "stripComments",
      ]),
    );
  }, GATE_TIMEOUT_MS);
});
