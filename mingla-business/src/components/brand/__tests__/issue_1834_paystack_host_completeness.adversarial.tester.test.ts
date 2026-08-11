/**
 * #1834 [keyboard-blocks-bank-field] — TESTER ADVERSARIAL regression.
 *
 * The implementor's happy-path proof
 * (`issue_1834_bank_field_smartscroll.render.test.tsx`) mounts the TWO named
 * screens and asserts each one's scroll host is the wrapper's
 * KeyboardAwareScrollView. That answers "are these two right?". It cannot
 * answer any of the three questions below, which is why this file exists and
 * why it is NOT a renamed copy of that one:
 *
 *   TA-1  ORPHAN / FIXED-POINT — is there a THIRD host nobody migrated?
 *         Discovers every render site of <BrandPaystackOnboardView> by walking
 *         the tree, resolves each host's `ScrollView` BINDING back to the module
 *         it actually came from, and requires every native-reachable host to
 *         resolve to the SmartScrollView wrapper. A newly-added host that uses
 *         react-native's ScrollView fails here even though both named screens
 *         are still correct.
 *
 *   TA-2  CRITERION BOUNDARY — can the success criterion be quietly weakened
 *         back to "clears the keyboard"? The whole point of #1834 is that the
 *         ORCH-1165 Done bar sits ON TOP of the keyboard, so clearing the
 *         keyboard is NOT clearing the bar: Android/R2 pre-fix cleared the
 *         keyboard by 5.7dp and was still 36.3dp under the bar. This encodes
 *         the real measured cells as data and pins the classifier, so anyone
 *         who redefines success as "clears the keyboard", or drops the
 *         wrapper's DEFAULT_BOTTOM_OFFSET below 42+12, turns this red.
 *
 *   TA-3  DEAD COMPENSATION — D1 deleted a 42dp Android bank-list pad that
 *         compensated for a Done bar that is not rendered in that raw RN
 *         <Modal> window. This asserts SET EQUALITY over the whole repo: the
 *         only file still carrying that shape is the deliberately out-of-scope
 *         partner twin. Reverting D1 puts BrandPaystackOnboardView back into
 *         the set and the equality fails; a NEW dead compensator anywhere else
 *         also fails; and when the twin is fixed on its own issue this goes red
 *         and the expected set is tightened to empty. That is intentional and
 *         self-documenting — a deliberate non-fix that cannot rot silently.
 *
 * ANTI-CLONE RULES THIS FILE OBEYS (SPEC §11.0, and the reason the existing
 * `KeyboardRoot.sweep.v2.adversarial.test.tsx` is rejected as a model):
 *   - It re-declares NO regex that lives in a strict-grep gate. TA-1 resolves
 *     import BINDINGS (which module does this identifier come from?) instead of
 *     pattern-matching an import line; TA-3 keys on <Modal> + KeyboardToolbarRoot
 *     + an Android-keyed 42 pad, none of which any gate looks at.
 *   - It branches on NO gitignored build artifact. There is no `dist/`, no
 *     `existsSync` escape hatch, no `console.warn`-and-pass, no `it.skip`.
 *   - EVERY scan carries a vacuity guard and an EMPTY SCAN FAILS LOUDLY:
 *     TA-1 fails if it discovers fewer than 3 render sites, TA-2 fails if the
 *     cell table or the parsed wrapper constant is missing, TA-3 fails if it
 *     visits zero files. A test that passes by finding nothing is the exact bug
 *     class (#1627) this issue exists to end.
 *
 * FAILS-ON-REVERT (demonstrated by the tester at real commit SHAs):
 *   - revert R1 or R2 (restore `ScrollView` to the react-native import) → TA-1 fails
 *   - revert D1 (restore `bankListKbPad` + `androidKbOpen`)            → TA-3 fails
 *   - weaken MIN_CLEARANCE / DEFAULT_BOTTOM_OFFSET                     → TA-2 fails
 *
 * Append-only: NEW file. No existing test is modified or deleted.
 * Runs under the DEFAULT jest.config.cjs (ts-jest / node). No new config, no RTL.
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Shared filesystem walk. One helper, used by TA-1 and TA-3, so the two
// assertions provably scan the SAME universe of files.
// ---------------------------------------------------------------------------

const BIZ_ROOT = path.resolve(__dirname, "../../../..");
const SCAN_ROOTS = ["src", "app"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".expo",
  ".expo-shared",
  "coverage",
  "__snapshots__",
]);

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
}

function collectSourceFiles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = path.join(BIZ_ROOT, root);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `[#1834 TA] scan root missing: ${abs}. The tree moved; this test must be ` +
          `repointed rather than left to scan nothing.`,
      );
    }
    walk(abs, files);
  }
  return files;
}

/** Strip block + line comments so a commented-out shape never counts as real code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const rel = (abs: string): string =>
  path.relative(BIZ_ROOT, abs).split(path.sep).join("/");

/** Production code only — excludes test suites (including this file). */
const isProductCode = (file: string): boolean =>
  !file.includes("/__tests__/") && !/\.test\.tsx?$/.test(file);

// Read once; every assertion below reuses this exact set.
const ALL_FILES = collectSourceFiles();
const SOURCE: ReadonlyMap<string, string> = new Map(
  ALL_FILES.map((f) => [rel(f), stripComments(fs.readFileSync(f, "utf8"))]),
);

/**
 * Resolve which module a named import binding came from, by parsing the file's
 * import specifiers rather than matching one hard-coded import shape. This is
 * deliberately NOT the strict-grep gate's `import {…ScrollView…} from "react-native"`
 * regex: it answers "where does this identifier come from?" for ANY source, so a
 * host that imports ScrollView from a third module is caught too.
 */
function resolveNamedImportSource(src: string, binding: string): string | null {
  const importRe = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src)) !== null) {
    const isTypeOnly = m[1] != null;
    const specifiers = m[2]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const spec of specifiers) {
      if (spec.startsWith("type ")) continue; // type-only member — not a value binding
      const local = spec.includes(" as ")
        ? spec.split(" as ")[1].trim()
        : spec.trim();
      if (local === binding) {
        if (isTypeOnly) continue; // `import type {...}` never produces a runtime binding
        return m[3];
      }
    }
  }
  return null;
}

// ===========================================================================
// TA-1 — ORPHAN / FIXED-POINT
// ===========================================================================

/**
 * Declared, commented exception. `.web.tsx` files run on web only, where there
 * is no soft keyboard and `SmartScrollView.tsx` (web) re-exports react-native's
 * ScrollView verbatim — migrating it is a behavioural no-op. This is a NAMED
 * exception, not a silent skip: if the file stops being web-only the suffix
 * check below stops excusing it.
 */
const WEB_ONLY_HOSTS = new Set([
  "src/components/brand/BrandBankConnectBody.web.tsx",
]);

const WRAPPER_MODULE_SUFFIX = "wrappers/SmartScrollView";
const MIN_EXPECTED_HOSTS = 3;

describe("#1834 TA-1 — every native host of the Paystack bank card scrolls through the wrapper", () => {
  const hosts: string[] = [];
  for (const [file, src] of SOURCE) {
    if (file.endsWith("BrandPaystackOnboardView.tsx")) continue; // the card itself
    // A render SITE is production code. A suite that mounts the component owns
    // no scroll container and ships to no user, so it is not a host — and this
    // file itself quotes the tag, which would otherwise self-match.
    if (!isProductCode(file)) continue;
    if (!/<BrandPaystackOnboardView[\s/>]/.test(src)) continue;
    hosts.push(file);
  }

  it("0. VACUITY GUARD — the scan discovers at least the known render sites", () => {
    expect({ scannedFiles: ALL_FILES.length > 0, hosts }).toEqual({
      scannedFiles: true,
      hosts: expect.any(Array),
    });
    if (hosts.length < MIN_EXPECTED_HOSTS) {
      throw new Error(
        `[#1834 TA-1] expected at least ${MIN_EXPECTED_HOSTS} render sites of ` +
          `<BrandPaystackOnboardView>, found ${hosts.length}: ` +
          `${JSON.stringify(hosts)}. Either the component was renamed or the ` +
          `walk stopped seeing the tree — an empty/short scan is a FAILURE, ` +
          `never a pass. ${ALL_FILES.length} files were scanned.`,
      );
    }
  });

  it("1. every NATIVE-reachable host binds ScrollView to the SmartScrollView wrapper", () => {
    const nativeHosts = hosts.filter((h) => !WEB_ONLY_HOSTS.has(h));
    if (nativeHosts.length === 0) {
      throw new Error(
        `[#1834 TA-1] zero native-reachable hosts after removing the declared ` +
          `WEB_ONLY exceptions ${JSON.stringify([...WEB_ONLY_HOSTS])} from ` +
          `${JSON.stringify(hosts)} — the exception list has swallowed the whole ` +
          `assertion. This is a FAILURE.`,
      );
    }

    const resolved = nativeHosts.map((h) => ({
      host: h,
      scrollViewFrom: resolveNamedImportSource(
        SOURCE.get(h) as string,
        "ScrollView",
      ),
    }));

    const offenders = resolved.filter(
      (r) =>
        r.scrollViewFrom == null ||
        !r.scrollViewFrom.endsWith(WRAPPER_MODULE_SUFFIX),
    );

    expect({
      offenders,
      checked: resolved.length,
    }).toEqual({ offenders: [], checked: resolved.length });
  });

  it("2. every declared WEB_ONLY exception is genuinely a .web file that exists", () => {
    // Pins the exception itself, so it cannot be widened into a general escape
    // hatch and cannot silently outlive the file it was written for.
    const bad = [...WEB_ONLY_HOSTS].filter(
      (f) => !f.endsWith(".web.tsx") || !SOURCE.has(f),
    );
    expect(bad).toEqual([]);
    expect(WEB_ONLY_HOSTS.size).toBeGreaterThan(0);
  });
});

// ===========================================================================
// TA-2 — CRITERION BOUNDARY
// ===========================================================================

const WRAPPER_NATIVE = "src/wrappers/SmartScrollView.native.tsx";

/**
 * Read DEFAULT_BOTTOM_OFFSET out of the REAL wrapper module rather than
 * re-typing 54 here. The wrapper cannot be `import`ed under the default node /
 * ts-jest config (it pulls react-native-keyboard-controller, which is not
 * linked in this runtime), so the value is parsed from the module source — the
 * point being that moving the constant moves this test instead of leaving a
 * stale copy behind.
 */
function readDefaultBottomOffset(): number {
  const src = SOURCE.get(WRAPPER_NATIVE);
  if (src == null) {
    throw new Error(
      `[#1834 TA-2] ${WRAPPER_NATIVE} not found in the scan. The offset ` +
        `constant is the whole basis of the criterion — refusing to pass ` +
        `without it.`,
    );
  }
  const m = /export\s+const\s+DEFAULT_BOTTOM_OFFSET\s*=\s*(\d+(?:\.\d+)?)/.exec(
    src,
  );
  if (m == null) {
    throw new Error(
      `[#1834 TA-2] could not parse DEFAULT_BOTTOM_OFFSET out of ` +
        `${WRAPPER_NATIVE}. Refusing to substitute a hard-coded fallback.`,
    );
  }
  return Number(m[1]);
}

/** ORCH-1165 KEYBOARD_TOOLBAR_HEIGHT — the Done bar sits ON TOP of the keyboard. */
const DONE_BAR = 42;

interface Cell {
  readonly id: string;
  readonly fieldBottom: number;
  readonly keyboardTop: number;
  /** Expected verdict under the #1834 criterion (Done bar, not keyboard). */
  readonly expected: "PASS" | "FAIL";
  /** Whether the cell clears the bare KEYBOARD — the weaker, wrong criterion. */
  readonly clearsKeyboard: boolean;
}

/**
 * Real measured cells. Rows 1–2 are the load-bearing ones: both CLEAR THE
 * KEYBOARD and are still occluded by the Done bar. If anyone ever rewrites the
 * criterion as "clears the keyboard", those two rows flip and this suite goes
 * red — which is the entire job of TA-2.
 */
const CELLS: readonly Cell[] = [
  // Android / R2 create, pre-fix (physical SM-A725F): 5.7dp above the keyboard,
  // 36.3dp UNDER the Done bar.
  {
    id: "android-R2-create-prefix",
    fieldBottom: 489.24,
    keyboardTop: 494.93,
    expected: "FAIL",
    clearsKeyboard: true,
  },
  // iOS / R2 create on an iPhone 17 Pro, pre-fix: 52pt above the keyboard,
  // 10pt above the bar — recorded as a "pass" once, and it was not one.
  {
    id: "ios-R2-create-prefix-17pro",
    fieldBottom: 514,
    keyboardTop: 566,
    expected: "FAIL",
    clearsKeyboard: true,
  },
  // Android / R1 create, POST-fix (physical SM-A725F, screen space): comfortably
  // clear of the bar.
  {
    id: "android-R1-create-postfix",
    fieldBottom: 364.09,
    keyboardTop: 494.93,
    expected: "PASS",
    clearsKeyboard: true,
  },
  // Android / R1 create, pre-fix: 83.2dp UNDER the bare keyboard.
  {
    id: "android-R1-create-prefix",
    fieldBottom: 578.13,
    keyboardTop: 494.93,
    expected: "FAIL",
    clearsKeyboard: false,
  },
  // iOS SE3 / R2 create, POST-fix: clears the keyboard by 40.5pt and is still
  // under the bar. The cell that made #1834 a NEEDS REWORK.
  {
    id: "ios-se3-R2-create-postfix",
    fieldBottom: 391.5,
    keyboardTop: 432,
    expected: "FAIL",
    clearsKeyboard: true,
  },
];

const EXPECTED_CELL_COUNT = 5;

describe("#1834 TA-2 — the success criterion is clearance of the Done bar, not the keyboard", () => {
  const bottomOffset = readDefaultBottomOffset();
  const minClearance = bottomOffset - DONE_BAR;

  const clears = (fieldBottom: number, keyboardTop: number): boolean =>
    fieldBottom <= keyboardTop - (DONE_BAR + minClearance);

  it("0. VACUITY GUARD — the measured cell table is intact", () => {
    expect(CELLS.length).toBe(EXPECTED_CELL_COUNT);
    expect(CELLS.filter((c) => c.clearsKeyboard && c.expected === "FAIL").length)
      .toBeGreaterThanOrEqual(3);
  });

  it("1. the wrapper default still budgets a real visible gap ABOVE the Done bar", () => {
    // 54 = 42 (bar) + 12 (visible clearance). Dropping the offset to the bar's
    // own height, or below it, silently reintroduces the reported bug.
    expect({ bottomOffset, minClearance }).toEqual({
      bottomOffset: DONE_BAR + 12,
      minClearance: 12,
    });
  });

  it("2. every measured cell classifies as recorded", () => {
    const actual = CELLS.map((c) => ({
      id: c.id,
      verdict: clears(c.fieldBottom, c.keyboardTop) ? "PASS" : "FAIL",
    }));
    const expected = CELLS.map((c) => ({ id: c.id, verdict: c.expected }));
    expect(actual).toEqual(expected);
  });

  it("3. clearing the KEYBOARD is provably not sufficient — the weaker criterion disagrees", () => {
    // This is the assertion that makes the criterion un-weakenable. If the
    // criterion is ever redefined as `fieldBottom <= keyboardTop`, these cells
    // stop disagreeing and the expectation below fails.
    const weakenedButStillFailing = CELLS.filter(
      (c) =>
        c.clearsKeyboard &&
        c.expected === "FAIL" &&
        !clears(c.fieldBottom, c.keyboardTop),
    ).map((c) => c.id);

    expect(weakenedButStillFailing).toEqual([
      "android-R2-create-prefix",
      "ios-R2-create-prefix-17pro",
      "ios-se3-R2-create-postfix",
    ]);
  });
});

// ===========================================================================
// TA-3 — DEAD COMPENSATION (set equality)
// ===========================================================================

/**
 * The ONE declared, out-of-scope exception. `PartnerPaystackOnboardForm.tsx`
 * carries D1 and D2 verbatim on the live Nigerian partner payout rail
 * (ORCH-1331) and was deliberately left alone by #1834's scoping. Pinning it
 * here is the point: a deliberate non-fix that is written down cannot rot.
 * When it IS fixed on its own issue this test goes red and the expected set is
 * tightened to `[]`.
 */
const DECLARED_DEAD_COMPENSATORS = [
  "src/components/partner/PartnerPaystackOnboardForm.tsx",
];

function rendersRawReactNativeModal(src: string): boolean {
  return (
    resolveNamedImportSource(src, "Modal") === "react-native" &&
    /<Modal[\s>]/.test(src)
  );
}

function rendersToolbarRoot(src: string): boolean {
  // Plain substring, not a gate regex: does this file mount the Done bar in
  // its own native window?
  return src.includes("<KeyboardToolbarRoot");
}

function hasAndroidKeyedDoneBarPad(src: string): boolean {
  const androidKeyed =
    /Platform\s*\.\s*OS\s*===\s*["']android["']/.test(src) &&
    /(useKeyboardIsVisible|keyboardVisible|keyboardShown|isKeyboardVisible|keyboardHeight|keyboardPad)/
      .test(src);
  const padsByTheBarsHeight = new RegExp(
    `padding(?:Bottom|Top|Vertical)?\\s*:\\s*${DONE_BAR}\\b`,
  ).test(src);
  return androidKeyed && padsByTheBarsHeight;
}

describe("#1834 TA-3 — no file compensates for a Done bar that is not in its window", () => {
  const visited: string[] = [];
  const offenders: string[] = [];
  for (const [file, src] of SOURCE) {
    visited.push(file);
    if (!rendersRawReactNativeModal(src)) continue;
    if (rendersToolbarRoot(src)) continue; // the bar IS in this window — padding is legitimate
    if (!hasAndroidKeyedDoneBarPad(src)) continue;
    offenders.push(file);
  }

  it("0. VACUITY GUARD — the scan actually visited files and saw raw RN modals", () => {
    if (visited.length === 0) {
      throw new Error(
        "[#1834 TA-3] the scan visited ZERO files. An empty scan is a FAILURE, " +
          "never a pass.",
      );
    }
    const rawModalFiles = [...SOURCE.entries()].filter(([, s]) =>
      rendersRawReactNativeModal(s),
    );
    if (rawModalFiles.length === 0) {
      throw new Error(
        `[#1834 TA-3] visited ${visited.length} files but found NO file rendering ` +
          `a raw react-native <Modal>. The detector has stopped detecting; ` +
          `refusing to report a green tick on a scan that matched nothing.`,
      );
    }
  });

  it("1. the dead-compensator set equals exactly the declared out-of-scope twin", () => {
    expect(offenders.sort()).toEqual([...DECLARED_DEAD_COMPENSATORS].sort());
  });

  it("2. BrandPaystackOnboardView is NOT in the set (D1 stays deleted)", () => {
    expect(
      offenders.filter((f) => f.endsWith("BrandPaystackOnboardView.tsx")),
    ).toEqual([]);
    // …and prove the file is genuinely in the scanned universe, so assertion 1
    // cannot pass merely because the file went missing.
    expect(SOURCE.has("src/components/brand/BrandPaystackOnboardView.tsx")).toBe(
      true,
    );
  });

  it("3. the declared exception still exists and still carries the shape it is excused for", () => {
    for (const declared of DECLARED_DEAD_COMPENSATORS) {
      const src = SOURCE.get(declared);
      if (src == null) {
        throw new Error(
          `[#1834 TA-3] declared exception ${declared} is gone. Delete it from ` +
            `DECLARED_DEAD_COMPENSATORS rather than leaving a dangling excuse.`,
        );
      }
      expect({
        file: declared,
        rawModal: rendersRawReactNativeModal(src),
        mountsToolbar: rendersToolbarRoot(src),
        deadPad: hasAndroidKeyedDoneBarPad(src),
      }).toEqual({
        file: declared,
        rawModal: true,
        mountsToolbar: false,
        deadPad: true,
      });
    }
  });
});
