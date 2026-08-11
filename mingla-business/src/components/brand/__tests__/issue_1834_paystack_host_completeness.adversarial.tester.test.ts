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
 *         wrapper's DEFAULT_BOTTOM_OFFSET below the bar + 12, turns this red.
 *
 *         REPAIRED at RETEST (#1834, SPEC AMENDMENTS 1-3). The first version of
 *         TA-2 was BLIND, and blind in the exact bug class this issue exists to
 *         end. It executed the wrapper exactly once, under the default jest
 *         config, whose `moduleNameMapper` sends `react-native` to
 *         `__manual_mocks__/react-native.js` where `Platform.OS === "web"`. On
 *         that branch `INPUT_CHROME_BELOW_TEXT_FRAME` collapses to `default: 0`
 *         and `OPENED_OFFSET` is 0, so the derivation summed to 54 and the old
 *         `toEqual({ bottomOffset: DONE_BAR + 12 })` passed — by exercising the
 *         ONE platform branch on which the reported bug cannot occur. Three
 *         instances of that shape have now appeared in this single issue
 *         (#1627's guard that never ran; the KeyboardRoot clone that prints SKIP
 *         and reports a tick; this). TA-2 now LOADS THE REAL WRAPPER ONCE PER
 *         PLATFORM BRANCH — iOS 26+, iOS <26, Android — with `Platform` driven
 *         from a branch table, and pins each branch's arithmetic, the deltas
 *         BETWEEN branches (which is what a re-hardcoded literal destroys), and
 *         the library's own `>= 26` boundary.
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
 *     cell table, the branch table, or any branch's module load is missing —
 *     AND fails if the three branches do not produce three DIFFERENT offsets,
 *     which is the specific way TA-2 was blind before — TA-3 fails if it visits
 *     zero files. A test that passes by finding nothing, or by finding the same
 *     thing three times, is the exact bug class (#1627) this issue exists to end.
 *
 * FAILS-ON-REVERT (demonstrated by the tester at real commit SHAs):
 *   - revert R1 or R2 (restore `ScrollView` to the react-native import) → TA-1 fails
 *   - revert D1 (restore `bankListKbPad` + `androidKbOpen`)            → TA-3 fails
 *   - re-hardcode DEFAULT_BOTTOM_OFFSET to ANY literal (54, 78.5, …)   → TA-2 fails
 *   - re-hardcode DONE_BAR_OCCUPIED to 42 or to 53                     → TA-2 fails
 *   - move the library's iOS-26 rounded-corner boundary                → TA-2 fails
 *   - drop MIN_VISIBLE_CLEARANCE below 12 on any branch                → TA-2 fails
 *
 * Append-only: NEW file. No existing test is modified or deleted.
 * Runs under the DEFAULT jest.config.cjs (ts-jest / node). No new config, no RTL.
 */

// The native keyboard library cannot be loaded under the default node/ts-jest
// runtime (it needs the linked native module). Mocking it with a DISTINCT
// sentinel is what lets TA-2 EXECUTE the real SmartScrollView wrapper module
// instead of reading its text: the assertions there drive the wrapper's own
// default-prop logic and inspect the element it actually produces, so the
// offset constant propagates from the shipped module rather than being retyped
// in this file. The sentinel is deliberately NOT react-native's ScrollView —
// substituting that would erase the distinction the suite measures.
jest.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: "KeyboardAwareScrollView@library",
}));

// `react-native` is module-name-mapped by jest.config.cjs to
// `__manual_mocks__/react-native.js`, whose Platform is HARD-WIRED to
// `OS: "web", Version: 0`. That single fact is what made the first TA-2 blind:
// the wrapper's per-platform derivation collapsed to its `default` branch and
// the assertion passed on the one platform the app never ships this module to
// (`SmartScrollView.native.tsx` is loaded only by iOS and Android).
//
// This decorator keeps every other export of the manual mock EXACTLY as-is
// (`jest.requireActual` — nothing is faked beyond what the repo already fakes)
// and replaces ONLY `Platform` with a branch-drivable one. The mutable state is
// parked on `globalThis` on purpose: `jest.isolateModules` builds a fresh module
// registry and re-invokes this factory, so a closure-local state object would be
// reconstructed per branch and silently reset the OS back to the default.
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope.__ISSUE_1834_PLATFORM__ == null) {
    scope.__ISSUE_1834_PLATFORM__ = { OS: "web", Version: 0 };
  }
  const state = scope.__ISSUE_1834_PLATFORM__ as {
    OS: string;
    Version: number | string;
  };
  return {
    ...actual,
    Platform: {
      get OS(): string {
        return state.OS;
      },
      get Version(): number | string {
        return state.Version;
      },
      // Same contract as react-native's own Platform.select: the OS key wins,
      // `default` is the fallback. Deliberately NOT the manual mock's
      // web-only version, which can never see an ios/android key.
      select: (spec: Record<string, unknown>): unknown =>
        spec != null &&
            Object.prototype.hasOwnProperty.call(spec, state.OS)
          ? spec[state.OS]
          : spec?.default,
    },
  };
});

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
// TA-2 — CRITERION BOUNDARY, EXERCISED ON EVERY REAL PLATFORM BRANCH
// ===========================================================================

interface ForwardRefRenderable {
  readonly render: (
    props: Record<string, unknown>,
    ref: unknown,
  ) => { type: unknown; props: Record<string, unknown> };
}

/** The shape `SmartScrollView.native.tsx` exports. Read, never re-declared. */
interface WrapperModule {
  readonly ScrollView: unknown;
  readonly KEYBOARD_TOOLBAR_HEIGHT: number;
  readonly DONE_BAR_OCCUPIED: number;
  readonly INPUT_CHROME_BELOW_TEXT_FRAME: number;
  readonly MIN_VISIBLE_CLEARANCE: number;
  readonly DEFAULT_BOTTOM_OFFSET: number;
}

/**
 * The one shared platform-state object. Created by whichever side runs first —
 * this module's initialiser or the `react-native` mock factory — and found by
 * the other, so both always hold the SAME reference across every
 * `jest.isolateModules` registry.
 */
const PLATFORM_STATE: { OS: string; Version: number | string } = (() => {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope.__ISSUE_1834_PLATFORM__ == null) {
    scope.__ISSUE_1834_PLATFORM__ = { OS: "web", Version: 0 };
  }
  return scope.__ISSUE_1834_PLATFORM__ as {
    OS: string;
    Version: number | string;
  };
})();

/**
 * Load the REAL wrapper module under a chosen platform, in its own module
 * registry, and EXECUTE its forwardRef so the reported offset is the one the
 * shipped default-prop logic actually produces — not a constant read out of the
 * module namespace, and never the module's source text.
 */
function loadWrapperUnder(
  os: string,
  version: number | string,
): { module: WrapperModule; element: { type: unknown; props: Record<string, unknown> }; renderWith: (props: Record<string, unknown>) => { type: unknown; props: Record<string, unknown> } } {
  PLATFORM_STATE.OS = os;
  PLATFORM_STATE.Version = version;

  let loaded: WrapperModule | null = null;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require("../../../wrappers/SmartScrollView.native") as WrapperModule;
  });
  if (loaded == null) {
    throw new Error(
      `[#1834 TA-2] the wrapper module failed to load under ${os}/${version}.`,
    );
  }
  const mod: WrapperModule = loaded;

  // BLINDNESS GUARD. `SmartScrollView.native.tsx` is loaded ONLY by iOS and
  // Android in production, so on either of those the chrome term must resolve to
  // a real measured correction. Resolving `default: 0` means Platform never
  // switched and this whole suite is back to executing one branch N times — the
  // exact defect this repair exists to remove. Refuse to continue.
  if (mod.INPUT_CHROME_BELOW_TEXT_FRAME === 0) {
    throw new Error(
      `[#1834 TA-2] loading the wrapper under ${os}/${version} resolved ` +
        `INPUT_CHROME_BELOW_TEXT_FRAME to its \`default: 0\` branch. Platform ` +
        `did not switch, so this "branch" is the web branch wearing a different ` +
        `name. An assertion that cannot see the platform it claims to test is a ` +
        `FAILURE, never a pass.`,
    );
  }

  const component = mod.ScrollView as unknown as Partial<ForwardRefRenderable>;
  if (typeof component.render !== "function") {
    throw new Error(
      "[#1834 TA-2] SmartScrollView is no longer a forwardRef component — the " +
        "wrapper could not be EXECUTED. Refusing to fall back to a source-text " +
        "read.",
    );
  }
  const renderWith = (
    props: Record<string, unknown> = {},
  ): { type: unknown; props: Record<string, unknown> } =>
    (component.render as ForwardRefRenderable["render"])(props, null);

  return { module: mod, element: renderWith({}), renderWith };
}

/**
 * The three branches `SmartScrollView.native.tsx` can actually be loaded on in
 * production, with the offset each MUST derive.
 *
 *   iOS 26+   53 (42 bar, floated 11 clear of the rounded keyboard) + 13.5 + 12
 *   iOS < 26  42                                                    + 13.5 + 12
 *   Android   42                                                    +  3.16 + 12
 *
 * The `doneBarOccupied` figures are not free-standing numbers: assertion 2 below
 * re-derives each from the branch's OWN `KEYBOARD_TOOLBAR_HEIGHT`, so pinning
 * 53 (or 42) as a literal in the wrapper fails on the branch where it is wrong.
 */
interface PlatformBranch {
  readonly id: string;
  readonly os: "ios" | "android";
  readonly version: number | string;
  readonly doneBarOccupied: number;
  readonly inputChrome: number;
  readonly bottomOffset: number;
}

const PLATFORM_BRANCHES: readonly PlatformBranch[] = [
  {
    id: "ios-26.5",
    os: "ios",
    version: "26.5",
    doneBarOccupied: 53,
    inputChrome: 13.5,
    bottomOffset: 78.5,
  },
  {
    id: "ios-18.4",
    os: "ios",
    version: "18.4",
    doneBarOccupied: 42,
    inputChrome: 13.5,
    bottomOffset: 67.5,
  },
  {
    id: "android-34",
    os: "android",
    version: 34,
    doneBarOccupied: 42,
    inputChrome: 3.16,
    bottomOffset: 57.16,
  },
];

const EXPECTED_BRANCH_COUNT = 3;

/** Float-safe comparison for a table printed to 4dp. `3.16` is not binary-exact. */
const dp4 = (n: number): number => Number(n.toFixed(4));

interface Cell {
  readonly id: string;
  /** Which PLATFORM_BRANCHES row supplies this cell's criterion constants. */
  readonly branch: string;
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
    branch: "android-34",
    fieldBottom: 489.24,
    keyboardTop: 494.93,
    expected: "FAIL",
    clearsKeyboard: true,
  },
  // iOS / R2 create on an iPhone 17 Pro, pre-fix: 52pt above the keyboard,
  // 10pt above the bar — recorded as a "pass" once, and it was not one.
  {
    id: "ios-R2-create-prefix-17pro",
    branch: "ios-26.5",
    fieldBottom: 514,
    keyboardTop: 566,
    expected: "FAIL",
    clearsKeyboard: true,
  },
  // Android / R1 create, POST-fix (physical SM-A725F, screen space): comfortably
  // clear of the bar.
  {
    id: "android-R1-create-postfix",
    branch: "android-34",
    fieldBottom: 364.09,
    keyboardTop: 494.93,
    expected: "PASS",
    clearsKeyboard: true,
  },
  // Android / R1 create, pre-fix: 83.2dp UNDER the bare keyboard.
  {
    id: "android-R1-create-prefix",
    branch: "android-34",
    fieldBottom: 578.13,
    keyboardTop: 494.93,
    expected: "FAIL",
    clearsKeyboard: false,
  },
  // iOS SE3 / R2 create, POST-fix-R1 (DEFAULT_BOTTOM_OFFSET = 54): clears the
  // keyboard by 40.5pt and is still 12.5pt UNDER the bar. The cell that made
  // #1834 a NEEDS REWORK and forced SPEC AMENDMENT 1.
  {
    id: "ios-se3-R2-create-offset54",
    branch: "ios-26.5",
    fieldBottom: 391.5,
    keyboardTop: 432,
    expected: "FAIL",
    clearsKeyboard: true,
  },
  // ---- RETEST cells: measured on glass after SPEC AMENDMENT 1, in SCREEN
  // space, each after a cold launch. These are the rows that make the fix
  // falsifiable: shrink the budget and every one of them flips to FAIL.
  // iPhone SE3 375x667 / iOS 26.5, Done pill top pixel-measured at 379.0.
  {
    id: "ios-se3-R2-create-postfix",
    branch: "ios-26.5",
    fieldBottom: 367.0,
    keyboardTop: 432,
    expected: "PASS",
    clearsKeyboard: true,
  },
  {
    id: "ios-se3-R2-update-postfix",
    branch: "ios-26.5",
    fieldBottom: 367.0,
    keyboardTop: 432,
    expected: "PASS",
    clearsKeyboard: true,
  },
  // Physical Samsung SM-A725F, Done bar top pixel-measured at 452.98 dp.
  {
    id: "android-R2-create-postfix",
    branch: "android-34",
    fieldBottom: 440.89,
    keyboardTop: 494.93,
    expected: "PASS",
    clearsKeyboard: true,
  },
];

const EXPECTED_CELL_COUNT = 8;

describe("#1834 TA-2 — the clearance budget is DERIVED per platform, and the criterion is the Done bar", () => {
  // One real load + one real execution PER BRANCH. This is the repair: the
  // previous version executed the wrapper exactly once, on the web branch.
  const loaded = PLATFORM_BRANCHES.map((b) => ({
    branch: b,
    ...loadWrapperUnder(b.os, b.version),
  }));

  const byId = new Map(loaded.map((l) => [l.branch.id, l]));

  const offsetOf = (id: string): number => {
    const entry = byId.get(id);
    if (entry == null) {
      throw new Error(`[#1834 TA-2] unknown branch "${id}".`);
    }
    return entry.element.props.bottomOffset as number;
  };

  /**
   * The #1834 acceptance predicate, per SPEC AMENDMENT 2, sourced from the
   * branch's OWN executed module: a field's visible bottom border must sit at
   * least MIN_VISIBLE_CLEARANCE above the top of the Done bar, and the bar
   * occupies DONE_BAR_OCCUPIED above the keyboard's top edge. Screen space
   * (AMENDMENT 3) — never window space.
   */
  const clears = (cell: Cell): boolean => {
    const entry = byId.get(cell.branch);
    if (entry == null) {
      throw new Error(
        `[#1834 TA-2] cell "${cell.id}" names branch "${cell.branch}", which is ` +
          `not in PLATFORM_BRANCHES. A cell whose criterion cannot be resolved ` +
          `must FAIL, never be skipped.`,
      );
    }
    const { DONE_BAR_OCCUPIED, MIN_VISIBLE_CLEARANCE } = entry.module;
    return (
      cell.fieldBottom <=
        cell.keyboardTop - (DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE)
    );
  };

  it("0. VACUITY GUARD — three DISTINCT branches really loaded, and the cell table is intact", () => {
    // If the Platform decorator ever stops working, all three loads return the
    // same module values and the suite silently degrades to the single-branch
    // blindness it was repaired to remove. Distinctness is therefore the guard,
    // not a nicety: it is the one observable that separates "three branches ran"
    // from "one branch ran three times".
    const offsets = loaded.map((l) => l.element.props.bottomOffset as number);
    const observedOS = loaded.map((l) => l.branch.os);
    expect({
      branchCount: loaded.length,
      distinctOffsets: new Set(offsets).size,
      distinctChrome: new Set(
        loaded.map((l) => dp4(l.module.INPUT_CHROME_BELOW_TEXT_FRAME)),
      ).size,
      anyCollapsedToWebDefault: loaded.some(
        (l) => l.module.INPUT_CHROME_BELOW_TEXT_FRAME === 0,
      ),
      osCovered: [...new Set(observedOS)].sort(),
    }).toEqual({
      branchCount: EXPECTED_BRANCH_COUNT,
      distinctOffsets: EXPECTED_BRANCH_COUNT,
      distinctChrome: 2, // iOS 13.5 and Android 3.16 — never the `default: 0`
      anyCollapsedToWebDefault: false,
      osCovered: ["android", "ios"],
    });

    expect(CELLS.length).toBe(EXPECTED_CELL_COUNT);
    expect(CELLS.filter((c) => c.clearsKeyboard && c.expected === "FAIL").length)
      .toBeGreaterThanOrEqual(3);
  });

  it("0b. the wrapper EXECUTES to the library primitive on every branch and honours an override", () => {
    // Drives the real component: the default element must be the keyboard
    // library's KeyboardAwareScrollView (never react-native's ScrollView), the
    // inherited offset must be that branch's DEFAULT_BOTTOM_OFFSET, and an
    // explicit prop must still win — the three behaviours the criterion rests on.
    const actual = loaded.map((l) => ({
      id: l.branch.id,
      type: l.element.type,
      matchesExportedConstant:
        l.element.props.bottomOffset === l.module.DEFAULT_BOTTOM_OFFSET,
      overriddenOffset: l.renderWith({ bottomOffset: 9 }).props.bottomOffset,
    }));
    expect(actual).toEqual(
      PLATFORM_BRANCHES.map((b) => ({
        id: b.id,
        type: "KeyboardAwareScrollView@library",
        matchesExportedConstant: true,
        overriddenOffset: 9,
      })),
    );
  });

  it("1. every platform branch derives its own budget — the exact arithmetic, on glass-measured terms", () => {
    const actual = loaded.map((l) => ({
      id: l.branch.id,
      doneBarOccupied: dp4(l.module.DONE_BAR_OCCUPIED),
      inputChrome: dp4(l.module.INPUT_CHROME_BELOW_TEXT_FRAME),
      minClearance: dp4(l.module.MIN_VISIBLE_CLEARANCE),
      bottomOffset: dp4(l.element.props.bottomOffset as number),
      // The sum is not merely EQUAL to the terms; it must BE the terms. This is
      // the assertion that catches keeping the exports and hardcoding the total.
      isTheSumOfItsTerms:
        (l.element.props.bottomOffset as number) ===
          l.module.DONE_BAR_OCCUPIED +
            l.module.INPUT_CHROME_BELOW_TEXT_FRAME +
            l.module.MIN_VISIBLE_CLEARANCE,
    }));
    expect(actual).toEqual(
      PLATFORM_BRANCHES.map((b) => ({
        id: b.id,
        doneBarOccupied: dp4(b.doneBarOccupied),
        inputChrome: dp4(b.inputChrome),
        minClearance: 12,
        bottomOffset: dp4(b.bottomOffset),
        isTheSumOfItsTerms: true,
      })),
    );
  });

  it("2. the Done bar's occupied height is DERIVED from the library's own rule, not pinned", () => {
    // `DONE_BAR_OCCUPIED = KEYBOARD_TOOLBAR_HEIGHT - OPENED_OFFSET`, and the
    // library's OPENED_OFFSET is -11 only when it draws rounded corners
    // (iOS >= 26). Pinning 53 fails on the iOS <26 and Android rows; pinning 42
    // fails on the iOS 26 row. Only the derivation satisfies all three.
    const actual = loaded.map((l) => ({
      id: l.branch.id,
      floatAboveKeyboard: dp4(
        l.module.DONE_BAR_OCCUPIED - l.module.KEYBOARD_TOOLBAR_HEIGHT,
      ),
      barHeight: l.module.KEYBOARD_TOOLBAR_HEIGHT,
    }));
    expect(actual).toEqual([
      { id: "ios-26.5", floatAboveKeyboard: 11, barHeight: 42 },
      { id: "ios-18.4", floatAboveKeyboard: 0, barHeight: 42 },
      { id: "android-34", floatAboveKeyboard: 0, barHeight: 42 },
    ]);
  });

  it("3. ANTI-HARDCODE — the deltas BETWEEN branches are exactly the terms that differ", () => {
    // A single re-hardcoded literal (54, 78.5, anything) collapses every delta
    // to 0. A per-platform table of hardcoded totals survives assertion 1 but
    // dies here the moment its numbers stop tracking the terms.
    const ios26 = offsetOf("ios-26.5");
    const ios18 = offsetOf("ios-18.4");
    const android = offsetOf("android-34");
    const iosChrome = (byId.get("ios-26.5") as { module: WrapperModule }).module
      .INPUT_CHROME_BELOW_TEXT_FRAME;
    const androidChrome = (byId.get("android-34") as { module: WrapperModule })
      .module.INPUT_CHROME_BELOW_TEXT_FRAME;

    expect({
      iosVersionDelta: dp4(ios26 - ios18),
      crossPlatformDelta: dp4(ios18 - android),
      expectedCrossPlatformDelta: dp4(iosChrome - androidChrome),
    }).toEqual({
      // The library's OPENED_OFFSET float — the whole reason 54 was wrong.
      iosVersionDelta: 11,
      crossPlatformDelta: dp4(iosChrome - androidChrome),
      expectedCrossPlatformDelta: dp4(iosChrome - androidChrome),
    });
    // And the deltas must be real: three identical offsets is the failure.
    expect(new Set([ios26, ios18, android]).size).toBe(3);
  });

  it("4. the library's iOS-26 rounded-corner BOUNDARY is honoured, not approximated", () => {
    // Straddle the exact version the library switches on. Moving the boundary
    // (>26, >=25, a hardcoded true/false) shows up here and nowhere else.
    const justBelow = loadWrapperUnder("ios", "25.9");
    const atBoundary = loadWrapperUnder("ios", "26.0");
    const wellAbove = loadWrapperUnder("ios", "29.1");
    expect({
      "25.9": dp4(justBelow.element.props.bottomOffset as number),
      "26.0": dp4(atBoundary.element.props.bottomOffset as number),
      "29.1": dp4(wellAbove.element.props.bottomOffset as number),
    }).toEqual({ "25.9": 67.5, "26.0": 78.5, "29.1": 78.5 });
  });

  it("5. the 12pt visible gap and the ORCH-1165 floor survive on EVERY branch", () => {
    const actual = loaded.map((l) => ({
      id: l.branch.id,
      visibleGapAfterBothCosts: dp4(
        (l.element.props.bottomOffset as number) -
          l.module.DONE_BAR_OCCUPIED -
          l.module.INPUT_CHROME_BELOW_TEXT_FRAME,
      ),
      clearsOrch1165Floor:
        (l.element.props.bottomOffset as number) >=
          l.module.KEYBOARD_TOOLBAR_HEIGHT,
    }));
    expect(actual).toEqual(
      PLATFORM_BRANCHES.map((b) => ({
        id: b.id,
        visibleGapAfterBothCosts: 12,
        clearsOrch1165Floor: true,
      })),
    );
  });

  it("6. every measured cell classifies as recorded, under its OWN platform's criterion", () => {
    const actual = CELLS.map((c) => ({
      id: c.id,
      verdict: clears(c) ? "PASS" : "FAIL",
    }));
    const expected = CELLS.map((c) => ({ id: c.id, verdict: c.expected }));
    expect(actual).toEqual(expected);
  });

  it("7. clearing the KEYBOARD is provably not sufficient — the weaker criterion disagrees", () => {
    // This is the assertion that makes the criterion un-weakenable. If the
    // criterion is ever redefined as `fieldBottom <= keyboardTop`, these cells
    // stop disagreeing and the expectation below fails.
    const weakenedButStillFailing = CELLS.filter(
      (c) => c.clearsKeyboard && c.expected === "FAIL" && !clears(c),
    ).map((c) => c.id);

    expect(weakenedButStillFailing).toEqual([
      "android-R2-create-prefix",
      "ios-R2-create-prefix-17pro",
      "ios-se3-R2-create-offset54",
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

/**
 * The bar's own HEIGHT — the number a dead compensator would have been written
 * against. Deliberately NOT the same quantity as TA-2's DONE_BAR_OCCUPIED (which
 * is height + float, and platform-dependent): a pad written to cancel the bar
 * was written against its height, so that is what TA-3 looks for.
 */
const DONE_BAR = 42;

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
