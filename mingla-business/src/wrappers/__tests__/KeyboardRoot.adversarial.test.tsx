/**
 * ORCH-0892-A: tester adversarial regression tests.
 *
 * Authored by Claude `mingla-tester` per ORCH-0840 [Regression-test
 * enforcement + append-only CI] Step 0.5(b). Attacks angles DIFFERENT
 * from the implementor's happy-path KeyboardRoot.test.tsx — proves
 * structural / build-output / repo-wide invariants the per-file
 * source-text contracts cannot catch.
 *
 * Per SPEC_ORCH-0892-A §11 (T-06..T-08 → TA-1, TA-2, TA-3).
 *
 * Implementor happy-path test: src/wrappers/__tests__/KeyboardRoot.test.tsx
 * (T-01..T-06; 13/13 PASS; fails-on-revert verified at HEAD
 * 05134c6c8a46808a605af7f1aed6a057bd5f0bfd by reverting BrandEditView
 * import → T-03 RED → restore → 13/13 GREEN).
 *
 * Tester adversarial angles:
 *
 *  TA-1: Source-graph ratchet. The `.web.tsx` passthrough prevents
 *        <KeyboardProvider> from MOUNTING on web, but does NOT prevent
 *        Metro from BUNDLING the library when downstream components
 *        import its primitives directly. Asserts that NO web-reachable
 *        source file under mingla-business/{src,app} or packages/
 *        imports react-native-keyboard-controller. Different angle than
 *        T-01 (source-text check of one file) — proves the repo-wide
 *        contract, and carries its own vacuity, comment-blindness and
 *        mutation proofs (TA-1-VACUITY / -COMMENT-BLIND / -MUTATION).
 *
 *        REWRITTEN by #1627 [keyboard-guard-vacuity]. It previously read
 *        a gitignored `mingla-business/dist/` and returned early when it
 *        was absent, which it was on every run CI has ever done — the
 *        required jest job builds no bundle, and all nineteen workflows
 *        that DO export write to `/tmp/…`. It had reported a tick since
 *        the day it was written while the leak it names grew to 60,543 B
 *        raw in the eager guest boot chunk. Its built-artefact half now
 *        lives as T2 in .github/workflows/web-build-check.yml, where an
 *        export already runs.
 *
 *  TA-2: AST mount-position assertion. Verifies _layout.tsx renders
 *        KeyboardRoot OUTSIDE the RootLayoutInner ErrorBoundary while the
 *        root remains free of the route-scoped StripeProviderWrapper.
 *        Different angle than T-02 (presence check) — proves provider order
 *        critical for I-36 ROOT-ERROR-BOUNDARY.
 *
 *  TA-3: Repo-wide grep for prop-deletion completeness. Implementor's
 *        T-06 covers the 7 known caller files; this test scans the
 *        ENTIRE mingla-business/ tree for ANY remaining identifier-use
 *        of `parentScrollRef` or `keyboardScrollExtraOffset`. Different
 *        angle than T-06 (curated file list) — catches files the
 *        implementor missed.
 *
 * Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY (DRAFT).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const repoRoot = path.resolve(root, "..");

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

// ===========================================================================
// #1627 [keyboard-guard-vacuity] — TA-1's replacement machinery.
//
// TA-1 used to read `mingla-business/dist/_expo/static/js/web` and `return`
// early when it was absent. It was absent EVERY time, for two independent
// structural reasons, and fixing either alone would have left it dark:
//
//   A. The only required jest check (`mingla-business jest (full suite)`,
//      bound to ruleset 19583754) runs checkout → setup-node → npm ci → jest.
//      It never runs `expo export`, so no bundle exists when this file runs.
//   B. All nineteen workflows that DO export write to `/tmp/…`
//      (`/tmp/web-build-check`, `/tmp/ratchet-web-build`, `/tmp/issue-NNNN-web`
//      …). Not one writes to `dist/`. So even after merging an export into
//      this job, the assertion would still have pointed at a path CI does not
//      produce.
//
// Two locks on the same door. The fix is therefore also two-part, and the two
// halves live in different places on purpose:
//
//   T1 (this file) asserts on SOURCE. There is no build artefact, so there is
//      no prerequisite that can be missing and no skip branch to write. It runs
//      inside the required check, which makes it the BLOCKING half.
//   T2 (.github/workflows/web-build-check.yml) asserts on the BUILT bundle, in
//      the job that already exports one — ~0s marginal cost. It catches a leak
//      arriving through a transitive node_modules path that source cannot see.
//
// Neither subsumes the other, and that is why both exist.
// ===========================================================================

/** The library that must never be reachable from the web module graph. */
const LIBRARY_SPECIFIER = "react-native-keyboard-controller";

/**
 * Every root whose sources can end up in the web bundle.
 *
 * `packages` is here, and its absence was the defect rather than a scoping
 * choice. `packages/phone-input` is linked as `node_modules/@mingla/phone-input`
 * and reaches web through the three buyer-checkout routes plus PublicEventPage
 * and GuestVenueReservation — yet orch-0892's SCAN_ROOTS, orch-1296's
 * checkedRoots and #1841's first draft of TA-V3-6 all stopped at the
 * `mingla-business` boundary. That blind spot is precisely how
 * `packages/phone-input/CountryPickerModal.tsx` — the single largest
 * contributor, 60,418 B raw of it — sat unaudited for months while three
 * separate censuses reported "exactly two leaks".
 * See I-PROPOSED-1841-B-GUARDS-ENUMERATE-CLASSES-NOT-HOSTS.
 */
const WEB_GRAPH_ROOTS = ["mingla-business/src", "mingla-business/app", "packages"];

/**
 * The vacuity floor. Measured 1,163 at implementation time — that is the count
 * AFTER the shadow filter below removes platform-shadowed variants; the raw
 * walk sees 1,196 (mingla-business/src 943 · mingla-business/app 138 ·
 * packages 115).
 *
 * 1,100 sits ~5% under that: loose enough to absorb ordinary deletion churn,
 * tight enough that losing any WHOLE root trips it (dropping `packages`
 * leaves ~1,050). It exists because a walk that returns `[]` would otherwise
 * assert "no leaks" and report a pass — the exact bug this issue is named for.
 * The floor catches a gross collapse; the sentinels below catch a single root
 * being silently dropped, which is the failure that actually happened here.
 */
const SCANNED_FLOOR = 1100;

/**
 * One sentinel per root, and one per platform-split convention. If the walk
 * breaks, a root is dropped, or an extension filter rots, at least one of these
 * vanishes and the suite goes red naming it.
 *
 * The two `packages/` entries are not decoration. They are the specific
 * assertion whose absence let this defect live: every previous census would
 * have passed its own vacuity check while being blind to the file that mattered.
 */
const SENTINELS = [
  "packages/phone-input/CountryPickerModal.tsx",
  "packages/phone-input/WebOverlayPortal.web.tsx",
  "mingla-business/src/components/groupChat/GroupChatPanel.tsx",
  "mingla-business/app/checkout/[eventId]/buyer.tsx",
];

/**
 * Files that mention the specifier in PROSE only. Nine files on the tree do;
 * a naive `includes()` flags all nine and the suite is red on a clean tree —
 * and an unfixable red is exactly as useless as a permanent green.
 */
const COMMENT_ONLY_MENTIONS = [
  "mingla-business/app/_layout.tsx",
  "mingla-business/src/wrappers/SmartScrollView.tsx",
  "mingla-business/src/components/ui/Modal.tsx",
];

/**
 * Strip `//` and block comments while respecting string and template literals,
 * so `"https://…"` is not mistaken for a line comment.
 *
 * WHY A LOCAL COPY. `orch-0892-no-bespoke-keyboard-plumbing.mjs` exports a
 * `stripComments`, and #1841's sweep suite executes it in a subprocess rather
 * than restating it. That is right for a suite whose SUBJECT is that gate. It
 * is wrong here: T1 is the blocking assertion inside the only required check,
 * and coupling it to a subprocess launch of a separate gate script would make
 * the required check fail for reasons that have nothing to do with the web
 * bundle. Two independent detectors that both assert "empty" is the same
 * strength as T1-vs-T2, not the hand-copied-regex weakness of #1627 §Discovery
 * 4 — and this copy's correctness is PROVEN in this file, in both directions,
 * by TA-1-COMMENT-BLIND and TA-1-MUTATION below.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === "\\") {
          out += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Any `from "react-native-keyboard-controller"` — `import`, `import type`,
 * `export … from`, all of it.
 *
 * `import type` is erased by the compiler and costs no bytes, and is flagged
 * anyway ON PURPOSE: it is one keyword away from a value import, and a ratchet
 * that has to adjudicate which of the two it is looking at is a ratchet with a
 * judgement call in it. The wrappers this issue added re-declare the one type
 * they need structurally rather than import it, which is the cheap way to
 * comply.
 */
const RE_LIBRARY_FROM = new RegExp(
  `from\\s+["']${LIBRARY_SPECIFIER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
);

/**
 * True when a source file cannot reach the WEB bundle because a
 * platform-specific variant shadows it there. Two shapes, because the two
 * packages in scope use OPPOSITE conventions and imposing one across the
 * boundary was explicitly rejected:
 *
 *   `X.native.tsx`  — mingla-business/src/wrappers (SmartScrollView, KeyboardRoot,
 *                     KeyboardToolbarRoot, useKeyboardIsVisible, useKeyboardHeight).
 *                     `X.tsx` is the web/default file.
 *   `X.tsx` + a     — packages/phone-input (WebOverlayPortal, and now
 *   `X.web.tsx`       keyboardPrimitives). `X.tsx` is the DEFAULT/native file and
 *   sibling           `X.web.tsx` shadows it on web.
 *
 * A suffix-only filter understands the first and MISREADS the second: it would
 * report `packages/phone-input/keyboardPrimitives.tsx` — a file Metro never
 * resolves on web, proven by an export showing zero library markers — as a web
 * leak, and the only ways to make that green are to bank a file that does not
 * leak (a FALSE floor, I-PROPOSED-1841-B's exact failure) or to rename against
 * the package's own proven convention. Resolution order is the honest test, so
 * this asks about resolution order.
 */
function isShadowedOnWeb(absolutePath: string): boolean {
  const base = path.basename(absolutePath);
  if (/\.native\.(ts|tsx)$/.test(base)) return true;
  const stem = base.replace(/\.(ts|tsx)$/, "");
  if (/\.web$/.test(stem)) return false; // the shadowing file itself IS web.
  const directory = path.dirname(absolutePath);
  return (
    fs.existsSync(path.join(directory, `${stem}.web.tsx`)) ||
    fs.existsSync(path.join(directory, `${stem}.web.ts`))
  );
}

/** Every `.ts`/`.tsx` under the given roots that the web bundle can reach. */
function collectWebGraphSources(roots: string[] = WEB_GRAPH_ROOTS): string[] {
  const collected: string[] = [];
  const walk = (directory: string): void => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(absolutePath);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.d\.ts$/.test(entry.name)) continue;
      if (/\.(test|spec)\.[jt]sx?$/.test(entry.name)) continue;
      if (isShadowedOnWeb(absolutePath)) continue;
      collected.push(
        path.relative(repoRoot, absolutePath).split(path.sep).join("/"),
      );
    }
  };
  for (const relativeRoot of roots) walk(path.join(repoRoot, relativeRoot));
  return collected.sort();
}

/** The files among `scanned` that value- or type-import the library. */
function findLibraryImporters(scanned: string[]): string[] {
  return scanned.filter((relativePath) =>
    RE_LIBRARY_FROM.test(
      stripComments(fs.readFileSync(path.join(repoRoot, relativePath), "utf8")),
    ),
  );
}

describe("ORCH-0892-A adversarial regression (tester)", () => {
  // --- TA-1: NO web-reachable source file imports the library ---
  //
  // #1627 rewrote this in place rather than adding a sibling. Leaving the old
  // `dist/`-skipping body behind under a new name would have kept a false tick
  // inside the only required check, which is the whole complaint.
  //
  // It reads SOURCE, so there is no `dist/`, no export, no prerequisite that
  // can be absent — the `if (!fs.existsSync(webBundleDir)) return;` branch is
  // DELETED, not guarded. Doing nothing cannot satisfy it. The built-artefact
  // half of the contract is T2 in web-build-check.yml.
  it("TA-1: no web-reachable source file imports react-native-keyboard-controller", () => {
    const scanned = collectWebGraphSources();
    const offenders = findLibraryImporters(scanned);

    // SC-9 — stdout must name a non-zero scanned count, so a human reading a
    // green log can see the assertion had something to assert ON.
    console.log(
      `[TA-1] scanned ${scanned.length} web-reachable source files across ` +
        `${WEB_GRAPH_ROOTS.join(", ")} — ${offenders.length} importing ${LIBRARY_SPECIFIER}.`,
    );

    if (offenders.length > 0) {
      throw new Error(
        `[TA-1 FAIL] ${offenders.length} web-reachable source file(s) import ${LIBRARY_SPECIFIER}:\n` +
          offenders.map((f) => `  - ${f}`).join("\n") +
          `\n\n` +
          `This is a NATIVE keyboard library. One named import from the package\n` +
          `root drags its whole 12-primitive barrel into __common, the eager\n` +
          `chunk every guest downloads before ANY route renders — measured at\n` +
          `60,543 B raw / 12,751 B gzip / 10,172 B brotli, for twelve primitives\n` +
          `web uses none of.\n\n` +
          `Fix: import through a platform-resolved wrapper instead. Follow the\n` +
          `convention of the package you are in — mingla-business/src/wrappers\n` +
          `uses X.tsx (web) + X.native.tsx (native), e.g.\n` +
          `SmartKeyboardAvoidingView; packages/phone-input uses X.tsx\n` +
          `(default/native) + X.web.tsx, e.g. keyboardPrimitives. Do NOT impose\n` +
          `one convention across the boundary, and do NOT delete the rendered\n` +
          `element — native behaviour is load-bearing (#1834 SC-1).\n`,
      );
    }
    expect(offenders).toEqual([]);
  });

  // --- TA-1-VACUITY: the scan is non-empty and still spans every root ---
  //
  // Without this, a walk returning [] would assert "no leaks" and pass. That is
  // not hypothetical: it is the failure mode that let this issue exist, and the
  // standard #1841 pre-staged as I-PROPOSED-1841-A — a guard may not report a
  // pass on a missing prerequisite, and an empty scan is a failure, never a pass.
  it("TA-1-VACUITY: the scan covers every web-reachable root and clears its floor", () => {
    const scanned = collectWebGraphSources();

    expect(scanned.length).toBeGreaterThanOrEqual(SCANNED_FLOOR);

    const missing = SENTINELS.filter((s) => !scanned.includes(s));
    if (missing.length > 0) {
      throw new Error(
        `[TA-1-VACUITY FAIL] ${missing.length} sentinel file(s) absent from the scan:\n` +
          missing.map((f) => `  - ${f}`).join("\n") +
          `\n\n` +
          `The walk has stopped covering a root it must cover, so TA-1's "no\n` +
          `leaks" verdict is now about a smaller tree than it claims. If a\n` +
          `sentinel was legitimately moved or deleted, repoint it at another\n` +
          `file in the SAME root — do not simply remove the entry, or the root\n` +
          `silently leaves the scan again.\n`,
      );
    }
    expect(missing).toEqual([]);

    // Each root must contribute. Sentinels cover three of them by name; assert
    // the general property too, so a fourth root added later is not free to be
    // decorative.
    for (const relativeRoot of WEB_GRAPH_ROOTS) {
      expect(
        scanned.filter((f) => f.startsWith(`${relativeRoot}/`)).length,
      ).toBeGreaterThan(0);
    }
  });

  // --- TA-1-COMMENT-BLIND: prose mentions are not leaks ---
  it("TA-1-COMMENT-BLIND: files mentioning the library only in comments are NOT flagged", () => {
    const scanned = collectWebGraphSources();
    for (const relativePath of COMMENT_ONLY_MENTIONS) {
      const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
      // Precondition: the file really does mention it, or this proves nothing.
      expect(source).toContain(LIBRARY_SPECIFIER);
      expect(scanned).toContain(relativePath);
      expect(RE_LIBRARY_FROM.test(stripComments(source))).toBe(false);
    }
    expect(findLibraryImporters(COMMENT_ONLY_MENTIONS)).toEqual([]);

    // The stripper must not be blind for the WRONG reason — a URL inside a
    // string literal must survive, or "strips everything" would pass this test.
    expect(stripComments('const u = "https://example.com/x"; // note')).toContain(
      "https://example.com/x",
    );
  });

  // --- TA-1-MUTATION: the collector can still say RED at all ---
  //
  // A green assertion over an empty expected-set is unfalsifiable on its own,
  // so a real leak has to be planted and proven caught.
  //
  // #1627 REWORK — the leak probe must NEVER be planted inside `packages/` or
  // `mingla-business/`. The first version of this test did exactly that, and it
  // is a cross-worker defect, not a flake:
  // `KeyboardRoot.sweep.v2.adversarial.test.tsx` TA-V3-6 walks those same two
  // roots and asserts the leak set is EXACTLY empty. jest runs the two files in
  // DIFFERENT workers concurrently against ONE working tree, so any run where
  // TA-V3-6's walk overlapped the few milliseconds this probe existed saw a
  // genuine library import and failed — naming this probe as a web leak.
  // Observed on PR #1889 as `Expected []` / `Received
  // ["packages/phone-input/__ta1MutationProbe.<pid>.tsx"]`, and reproduced
  // deterministically by planting that same path by hand. It is the same shape
  // as COMMS-0127's `venueGalleryWebPicker` flake — a test mutating state every
  // worker shares, intermittent only because worker assignment is random — and
  // the same shape as the vacuity this whole issue exists to remove: a guard
  // that reports on something other than the product.
  //
  // The claim is therefore split into two halves. NEITHER ever puts a
  // library-importing file under a root any other walker scans:
  //
  //   COVERAGE  — a probe that does NOT import the library, planted under the
  //               real `packages/phone-input`, proves the walk genuinely
  //               descends into the root whose absence let #1627's bug live.
  //               Containing no library import, it cannot make any concurrent
  //               detector red.
  //   DETECTION — a probe that DOES import the library, in a temp directory
  //               outside the repo passed as an explicit root, proves walk +
  //               detector still go RED end-to-end on a real leak.
  //
  // Together these assert everything the single combined probe asserted.
  it("TA-1-MUTATION: the walk reaches packages/, and a planted leak IS flagged", () => {
    // -- COVERAGE: real root, no library import, zero cross-worker hazard. --
    const coverageProbe = path.join(
      repoRoot,
      "packages",
      "phone-input",
      `__ta1CoverageProbe.${process.pid}.tsx`,
    );
    const coverageRelative = path
      .relative(repoRoot, coverageProbe)
      .split(path.sep)
      .join("/");
    try {
      fs.writeFileSync(
        coverageProbe,
        "export const CoverageProbe = (): null => null;\n",
        "utf8",
      );
      const scanned = collectWebGraphSources();
      // The walk descends into packages/phone-input …
      expect(scanned).toContain(coverageRelative);
      // … and does not invent a leak where there is none.
      expect(findLibraryImporters(scanned)).not.toContain(coverageRelative);
    } finally {
      if (fs.existsSync(coverageProbe)) fs.unlinkSync(coverageProbe);
    }
    expect(collectWebGraphSources()).not.toContain(coverageRelative);

    // -- DETECTION: real leak, outside every scanned root. --
    const leakDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ta1-leak-"));
    const leakRoot = path.relative(repoRoot, leakDirectory);
    try {
      const leakProbe = path.join(leakDirectory, "Leak.tsx");
      fs.writeFileSync(
        leakProbe,
        `import { KeyboardProvider } from "${LIBRARY_SPECIFIER}";\n` +
          "export const Probe = KeyboardProvider;\n",
        "utf8",
      );
      const leakRelative = path
        .relative(repoRoot, leakProbe)
        .split(path.sep)
        .join("/");
      // Walking that root end-to-end finds it AND flags it: the collector can
      // still say RED, which is the whole point of this test.
      const scannedLeak = collectWebGraphSources([leakRoot]);
      expect(scannedLeak).toContain(leakRelative);
      expect(findLibraryImporters(scannedLeak)).toContain(leakRelative);

      // The hazard guard: the leak probe must live outside every root a
      // concurrent walker scans. This is the assertion that goes red if someone
      // moves the probe back into the tree and reintroduces the PR #1889 race.
      // TA-V3-6 walks `mingla-business` and `packages`; TA-1 walks those plus
      // `mingla-business/app`.
      const normalizedLeakRoot = leakRoot.split(path.sep).join("/");
      for (const scannedRoot of [...WEB_GRAPH_ROOTS, "mingla-business"]) {
        expect(normalizedLeakRoot.startsWith(`${scannedRoot}/`)).toBe(false);
        expect(normalizedLeakRoot).not.toBe(scannedRoot);
      }
      // And the real tree stays clean throughout — no probe of either kind is
      // visible to a concurrent TA-V3-6.
      expect(findLibraryImporters(collectWebGraphSources())).toEqual([]);

      // A file outside every scanned root must NOT be picked up by the DEFAULT
      // roots — otherwise the walk is wandering and its file count means
      // nothing.
      expect(collectWebGraphSources()).not.toContain(leakRelative);
    } finally {
      fs.rmSync(leakDirectory, { recursive: true, force: true });
    }
  });

  // --- TA-1-WEB-SHIM-FLEX: the web shims must be boxes, not Fragments ---
  //
  // The bundle contract (TA-1 / T2) is satisfied by ANY web variant that does
  // not import the library — including one that renders nothing. That is how a
  // pure bundle fix becomes a visual regression, so the LAYOUT contribution is
  // pinned separately from the byte contract.
  //
  // The library's KeyboardProvider renders its children inside a `flex: 1`
  // container (react-native-keyboard-controller/src/animated.tsx:41-44,
  // 241-249). In `CountryPickerModal.tsx` that element is the ONLY thing
  // between a `presentationStyle="fullScreen"` <Modal> and <SafeAreaProvider>,
  // and in the two mingla-business call sites the KeyboardAvoidingView is a
  // flex sibling. Collapse either to a Fragment and the node the surrounding
  // flex arithmetic depends on disappears.
  //
  // A protective comment alone is not enforcement — a future reader WILL try to
  // simplify these, because they look like pointless wrappers.
  it("TA-1-WEB-SHIM-FLEX: web keyboard shims render a real flex box, not a Fragment", () => {
    const shim = fs.readFileSync(
      path.join(repoRoot, "packages/phone-input/keyboardPrimitives.web.tsx"),
      "utf8",
    );
    // Renders a View, carries flex: 1, and never returns a bare Fragment.
    expect(shim).toMatch(/<View\s+style=\{styles\.container\}>\{children\}<\/View>/);
    expect(shim).toMatch(/container:\s*\{\s*flex:\s*1\s*\}/);
    expect(stripComments(shim)).not.toMatch(/return\s*\(?\s*<>\s*\{\s*children/);

    // Same contract for the mingla-business web variant.
    const kav = read("src/wrappers/SmartKeyboardAvoidingView.tsx");
    expect(kav).toMatch(/<View\s+style=\{style\}>\{children\}<\/View>/);
    expect(stripComments(kav)).not.toMatch(/return\s*\(?\s*<>\s*\{\s*children/);
    // It must not reach for the library, nor for react-native's own KAV — the
    // latter trips orch-0892 pattern 2 (RE_KAV_FROM_RN_NAMED).
    expect(stripComments(kav)).not.toContain(LIBRARY_SPECIFIER);
    expect(stripComments(kav)).not.toMatch(
      /import\s*\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*["']react-native["']/,
    );

    // And the native halves must still be the library, or the split has
    // silently changed native behaviour to buy bytes — which #1834 forbids.
    expect(
      read("src/wrappers/SmartKeyboardAvoidingView.native.tsx"),
    ).toMatch(
      new RegExp(
        `export\\s*\\{\\s*KeyboardAvoidingView\\s*\\}\\s*from\\s*["']${LIBRARY_SPECIFIER}["']`,
      ),
    );
    const nativePrimitives = fs.readFileSync(
      path.join(repoRoot, "packages/phone-input/keyboardPrimitives.tsx"),
      "utf8",
    );
    expect(nativePrimitives).toContain("KeyboardProvider");
    expect(nativePrimitives).toContain("KeyboardToolbar");
    expect(RE_LIBRARY_FROM.test(stripComments(nativePrimitives))).toBe(true);
  });

  // --- TA-2: AST mount-position assertion ---
  it("TA-2: _layout.tsx mounts KeyboardRoot OUTSIDE RootLayoutInner and keeps StripeProviderWrapper route-scoped", () => {
    const source = read("app/_layout.tsx");

    // Find the lines for each marker.
    const lines = source.split("\n");
    const findLineWith = (re: RegExp): number =>
      lines.findIndex((l) => re.test(l));

    const keyboardOpen = findLineWith(/<KeyboardRoot>/);
    const rootLayoutInnerLine = findLineWith(/<RootLayoutInner\s*\/>/);
    const keyboardClose = findLineWith(/<\/KeyboardRoot>/);
    const errorBoundaryOpen = findLineWith(/<ErrorBoundary/);
    const errorBoundaryClose = findLineWith(/<\/ErrorBoundary>/);

    // All present
    expect(keyboardOpen).toBeGreaterThan(-1);
    expect(rootLayoutInnerLine).toBeGreaterThan(-1);
    expect(keyboardClose).toBeGreaterThan(-1);
    expect(source).not.toMatch(/<StripeProviderWrapper>/);

    // RootLayoutInner is INSIDE KeyboardRoot.
    expect(keyboardOpen).toBeLessThan(rootLayoutInnerLine);
    expect(rootLayoutInnerLine).toBeLessThan(keyboardClose);

    // ErrorBoundary lives INSIDE RootLayoutInner's render. KeyboardRoot
    // wraps RootLayoutInner from OUTSIDE — so the ErrorBoundary
    // declaration comes AFTER the KeyboardRoot opening (because
    // RootLayoutInner renders ErrorBoundary inside its function body
    // which is below the import section but above the default export).
    // We assert ErrorBoundary lines exist and are inside RootLayoutInner
    // function (below imports, above the default export's JSX block).
    expect(errorBoundaryOpen).toBeGreaterThan(-1);
    expect(errorBoundaryClose).toBeGreaterThan(-1);
    expect(errorBoundaryOpen).toBeLessThan(keyboardOpen);
    expect(errorBoundaryClose).toBeLessThan(keyboardOpen);
  });

  // --- TA-3: repo-wide prop-deletion completeness ---
  it("TA-3: NO file under mingla-business/src or mingla-business/app references parentScrollRef or keyboardScrollExtraOffset as identifiers", () => {
    // Use git grep for speed; identifier-only pattern via word boundary.
    // Filter out comments by checking if the match line is a comment.
    let parentRefMatches = "";
    let extraOffsetMatches = "";
    try {
      parentRefMatches = execSync(
        `cd "${repoRoot}" && grep -rn "\\bparentScrollRef\\b" mingla-business/src mingla-business/app 2>/dev/null | grep -v "__tests__" || true`,
        { encoding: "utf8" },
      );
      extraOffsetMatches = execSync(
        `cd "${repoRoot}" && grep -rn "\\bkeyboardScrollExtraOffset\\b" mingla-business/src mingla-business/app 2>/dev/null | grep -v "__tests__" || true`,
        { encoding: "utf8" },
      );
    } catch {
      // grep returns non-zero on no matches; that's the success case.
    }

    // Strip comment-only lines (// prefix or inside /* */ comment text).
    const stripComments = (out: string): string =>
      out
        .split("\n")
        .filter((line) => {
          const after = line.split(":").slice(2).join(":").trim();
          if (after.startsWith("//")) return false;
          if (after.startsWith("*")) return false; // block-comment continuation
          if (after === "") return false;
          return true;
        })
        .join("\n")
        .trim();

    const parentNonComment = stripComments(parentRefMatches);
    const offsetNonComment = stripComments(extraOffsetMatches);

    if (parentNonComment.length > 0) {
      throw new Error(
        `[TA-3 FAIL] Found non-comment references to parentScrollRef:\n${parentNonComment}\n` +
          `Rework: delete these references; CoverPicker no longer accepts the prop.`,
      );
    }
    if (offsetNonComment.length > 0) {
      throw new Error(
        `[TA-3 FAIL] Found non-comment references to keyboardScrollExtraOffset:\n${offsetNonComment}\n` +
          `Rework: delete these references; CoverPicker no longer accepts the prop.`,
      );
    }

    expect(parentNonComment).toBe("");
    expect(offsetNonComment).toBe("");
  });
});
