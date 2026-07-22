import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * META-ORCH-1002 Sub-D — TESTER ADVERSARIAL regression check.
 *
 * Attacks DIFFERENT angles than the implementor happy-path
 * (`metaOrch1002SubDBusinessGlass.test.ts`, which proves the clip + stragglers
 * were ADDED on a hardcoded sample). This suite proves the sweep did not
 * REGRESS anything it should have left alone, by deriving the truth from the
 * actual `origin/main...HEAD` diff rather than a fixed sample:
 *
 *   A. NO-FLATTEN (whole-sweep): every style block that gained
 *      `overflow:'hidden'` on the dark business canvas KEPT its exact
 *      `backgroundColor` from main — the sweep adds the CLIP, never converts a
 *      translucent glass fill to an opaque one. Guards the "preserve the glass
 *      look" contract across ALL ~198 clipped blocks, not one sample.
 *
 *   B. iOS-FREEZE (stragglers): the 3 Symptom-B opaque fallbacks are reachable
 *      ONLY on Android — iOS keeps a real BlurView, and the opaque branch is
 *      gated behind `Platform.OS === 'android'`, never an unconditional or
 *      iOS-reachable path.
 *
 *   C. STRAGGLER-CORRECTNESS: Toast / AiDisclosureModal / BlastCustomersCta
 *      take the OPAQUE (>=0.92) Android fallback — not the thin/unguarded
 *      BlurView. Toast's inverted `Platform.OS !== 'web'` guard is gone.
 *
 *   D. OVERFLOW-CHILD-SAFETY (iOS-shadow clip): NO clipped surface composes a
 *      shadow-bearing sibling style onto the SAME JSX element. On iOS,
 *      `overflow:'hidden'` sets masksToBounds=true which CLIPS that element's
 *      own drop shadow — so clipping a pill that also receives an
 *      `...Active`-glow style silently kills the glow on iOS (violates
 *      SC-iOS-frozen). This is the exact reason the spec EXCLUDED
 *      `BottomNav.spotlight`. The set of such sites must be empty.
 *
 * ts-jest testEnvironment:node — these are source/diff assertions, the
 * established business CI pattern. On-device pixel verification is deferred to
 * the orchestrator's build decision.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const BIZ_ROOT = path.resolve(__dirname, "..", "..", ".."); // mingla-business/
const componentsDir = path.resolve(__dirname, "..");

const read = (abs: string): string => fs.readFileSync(abs, "utf8");
const readComp = (rel: string): string => read(path.join(componentsDir, rel));

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// Parse `name: { ... },` blocks at 2-space indent into a map.
const findStyleBlocks = (src: string): Record<string, string> => {
  const map: Record<string, string> = {};
  const re = /^  ([A-Za-z0-9_]+):\s*\{([\s\S]*?)\n  \},/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) map[m[1]] = m[2];
  return map;
};

const styleBlock = (code: string, name: string): string | null => {
  const m = code.match(new RegExp(name + ":\\s*\\{[\\s\\S]*?\\n\\s{2}\\},"));
  return m ? m[0] : null;
};

// ---------------------------------------------------------------------------
// Diff-derived ground truth: which named style blocks gained overflow:'hidden'
// on THIS branch vs origin/main, computed once.
// ---------------------------------------------------------------------------

interface ClippedBlock {
  file: string; // repo-relative
  block: string;
}

// #1062 RE-BASELINE — META-ORCH-1002 Sub-D is MERGED into origin/main, so
// `git diff origin/main...HEAD` no longer surfaces the sweep (it lives in the
// merge-base → an empty set → the >150 sanity floor could never pass). Re-anchor
// the diff base to the FIXED pre-sweep commit and derive the EXACT Sub-D clipped
// set from the sweep commit itself: the ~196 style blocks that gained
// overflow:'hidden' in 6d714b567 (#261) vs its parent. This isolates Sub-D's own
// surfaces (excluding clips added by LATER, unrelated ORCHs — e.g. the ari chat
// composer, offering/trip bars) so the standing no-flatten (A) + shadow-clip (D)
// guards keep validating the Sub-D surfaces against the CURRENT source. The
// threshold is UNCHANGED (>150) and met by real data (196), not lowered.
const SUBD_SWEEP_COMMIT = "6d714b567"; // META-ORCH-1002 Sub-D (#261)
const SUBD_PRE_SWEEP = `${SUBD_SWEEP_COMMIT}^`;

const computeClippedBlocks = (): ClippedBlock[] => {
  const files = execSync(
    `git diff ${SUBD_PRE_SWEEP} ${SUBD_SWEEP_COMMIT} --name-only -- 'mingla-business/src/**/*.tsx'`,
    { cwd: REPO_ROOT, encoding: "utf8" },
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const out: ClippedBlock[] = [];
  for (const f of files) {
    let sweep = "";
    let pre = "";
    try {
      sweep = execSync(`git show ${SUBD_SWEEP_COMMIT}:${f}`, {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
    } catch {
      continue;
    }
    try {
      pre = execSync(`git show ${SUBD_PRE_SWEEP}:${f}`, {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
    } catch {
      pre = "";
    }
    const sb = findStyleBlocks(sweep);
    const pb = findStyleBlocks(pre);
    for (const name of Object.keys(sb)) {
      const sHas = /overflow:\s*["']hidden["']/.test(sb[name]);
      const pHas =
        pb[name] !== undefined && /overflow:\s*["']hidden["']/.test(pb[name]);
      if (sHas && !pHas) out.push({ file: f, block: name });
    }
  }
  return out;
};

// Guard: if git is unavailable (shallow CI checkout etc.), fail loudly rather
// than silently passing on an empty set.
let CLIPPED: ClippedBlock[] = [];
let GIT_OK = true;
try {
  CLIPPED = computeClippedBlocks();
} catch (e) {
  GIT_OK = false;
}

describe("Sub-D adversarial — diff harness sanity", () => {
  test("git diff harness resolved a non-trivial clipped-block set", () => {
    expect(GIT_OK).toBe(true);
    // Sub-D swept ~196 named blocks to overflow:'hidden' (implementor: ~198).
    // Require a floor well above any accidental empty/partial result. #1062:
    // the set is now the FIXED Sub-D sweep set (see computeClippedBlocks), so
    // this floor is met by real data even though the sweep has merged.
    expect(CLIPPED.length).toBeGreaterThan(150);
  });
});

// ---------------------------------------------------------------------------
// A. NO-FLATTEN — every clipped block kept its exact backgroundColor from main.
// ---------------------------------------------------------------------------

// #1062 RE-BASELINE — fills that a LATER, intentional (non-Sub-D) restyle
// changed since the sweep. Each entry is `file:block` with its cited reason;
// these are NOT Sub-D flattens, so documenting them keeps Part A honest without
// matching an unrelated redesign as a regression. (Mirrors the file's existing
// KNOWN_SHADOW_CLIP_OFFENDERS allowlist pattern for Part D.)
const KNOWN_REDESIGNED_FILLS: ReadonlySet<string> = new Set<string>([
  // The ari chat thread redesign gave the composer a cohesive OPAQUE dark
  // surface (glass.tint.profileBase → ariThread.composerSurface "#191c21");
  // Sub-D only added the clip, a later ari restyle changed the fill.
  "mingla-business/src/components/ari/InputBar.tsx:host",
]);

describe("Sub-D adversarial A — no clipped surface was flattened to opaque", () => {
  test("every block Sub-D clipped kept its pre-sweep backgroundColor (bar cited later restyles)", () => {
    const baseCache: Record<string, string> = {};
    const flattened: { file: string; block: string; from: string; to: string }[] =
      [];

    for (const { file, block } of CLIPPED) {
      // #1062: the no-flatten reference is the FIXED pre-Sub-D baseline; skip
      // blocks a later, cited restyle intentionally changed.
      if (KNOWN_REDESIGNED_FILLS.has(`${file}:${block}`)) continue;
      let head = "";
      try {
        head = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      } catch {
        continue;
      }
      if (!(file in baseCache)) {
        try {
          baseCache[file] = execSync(`git show ${SUBD_PRE_SWEEP}:${file}`, {
            cwd: REPO_ROOT,
            encoding: "utf8",
          });
        } catch {
          baseCache[file] = "";
        }
      }
      const hb = findStyleBlocks(head)[block];
      const bb = findStyleBlocks(baseCache[file])[block];
      if (!hb || !bb) continue;
      const bgH = (hb.match(/backgroundColor:\s*([^,\n]+)/) || [])[1];
      const bgB = (bb.match(/backgroundColor:\s*([^,\n]+)/) || [])[1];
      if (bgH && bgB && bgH.trim() !== bgB.trim()) {
        flattened.push({
          file,
          block,
          from: bgB.trim(),
          to: bgH.trim(),
        });
      }
    }

    // The sweep is clip-only on the dark canvas: zero fill changes permitted.
    expect(flattened).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B + C. Straggler iOS-freeze + opaque-Android correctness.
// ---------------------------------------------------------------------------

// [TEST-MOD-APPROVED ORCH-1100] — RC-2 generalized the Android opaque-fallback
// decision into `utils/glassBlur.shouldUseRealBlur(windowWidth)` (so the
// mobile-web < 768px blur-kill is covered too). The adversarial guarantees here
// — iOS keeps real blur, opaque fallback is ≥0.92, no iOS-reachable opaque path
// — are preserved; the decision just moved to the shared helper. The "iOS never
// opaque" cross-file assertion below is UNCHANGED (still load-bearing). The
// no-flatten diff harness (Part A) and shadow-clip detector (Part D) are
// untouched. The shared helper's own iOS=blur / Android=opaque / web<768=opaque
// behavior is independently pinned in `utils/__tests__/glassBlur.test.ts`.
describe("Sub-D adversarial B/C — stragglers opaque via shared helper, iOS frozen", () => {
  test("Toast: blurOk via shared shouldUseRealBlur, inverted guard gone, kit fallback ≥0.92", () => {
    const code = stripComments(readComp("ui/Toast.tsx"));
    // Inverted guard removed.
    expect(code).not.toMatch(/blurOk\s*=\s*Platform\.OS\s*!==\s*["']web["']/);
    // Decision delegated to the shared helper (which keeps iOS=blur, Android=opaque).
    expect(code).toMatch(/blurOk\s*=\s*shouldUseRealBlur\(windowWidth\)/);
    // The opaque fallback is >=0.92.
    expect(code).toMatch(
      /FALLBACK_BACKGROUND\s*=\s*["']rgba\(20,\s*22,\s*26,\s*0\.92\)["']/,
    );
  });

  test("AiDisclosureModal: opaque sheet gated behind !shouldUseRealBlur, iOS keeps real BlurView", () => {
    const code = stripComments(readComp("ari/AiDisclosureModal.tsx"));
    // Opaque branch is reached only when the shared helper says no real blur.
    expect(code).toMatch(
      /!\s*shouldUseRealBlur\(windowWidth\)[\s\S]{0,160}styles\.opaqueSheet/,
    );
    // No `Platform.OS !== 'ios'` style negation that would also flip web.
    expect(code).not.toMatch(/Platform\.OS\s*!==\s*["']ios["']/);
    // opaqueSheet is a fully opaque #hex (no rgba alpha => >=0.92 by construction).
    const block = styleBlock(code, "opaqueSheet");
    expect(block).not.toBeNull();
    expect(block!).toMatch(/backgroundColor:\s*["']#[0-9a-fA-F]{6}["']/);
    // Real-blur path still renders the real blur at intensity 40. #1062 B2
    // drift-to-truth: a `pointerEvents="none"` prop now precedes `intensity`
    // on the <BlurView>, so tolerate intervening props (still pins intensity 40).
    expect(code).toMatch(/<BlurView[\s\S]{0,80}intensity=\{40\}/);
  });

  test("BlastCustomersCta: L1 BlurView when blurOk else opaque, via shared helper", () => {
    const code = stripComments(readComp("marketing/BlastCustomersCta.tsx"));
    expect(code).toMatch(/blurOk\s*=\s*shouldUseRealBlur\(windowWidth\)/);
    expect(code).toMatch(
      /blurOk\s*\?[\s\S]{0,120}<BlurView[\s\S]{0,400}FALLBACK_BACKGROUND/,
    );
    expect(code).toMatch(
      /FALLBACK_BACKGROUND\s*=\s*["']rgba\(20,\s*22,\s*26,\s*0\.92\)["']/,
    );
  });

  test("no straggler opaque branch leaked onto an unconditional/iOS path", () => {
    // None of the 3 stragglers may opaque-fill on a path iOS can reach. We assert
    // the opaque fallback token never appears OUTSIDE an android guard by proving
    // the file does not also expose it via a bare `Platform.OS === 'ios'` opaque.
    for (const rel of [
      "ui/Toast.tsx",
      "ari/AiDisclosureModal.tsx",
      "marketing/BlastCustomersCta.tsx",
    ]) {
      const code = stripComments(readComp(rel));
      // an iOS branch that hands iOS the opaque fallback would be a regression
      expect(code).not.toMatch(
        /Platform\.OS\s*===\s*["']ios["'][\s\S]{0,80}FALLBACK_BACKGROUND/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// D. OVERFLOW-CHILD-SAFETY — iOS shadow-clip regression detector.
//    A clipped element must not also receive a shadow-bearing composed style on
//    the SAME JSX element (overflow:'hidden' => masksToBounds => iOS shadow
//    clipped). Mirrors the spec's BottomNav.spotlight exclusion.
// ---------------------------------------------------------------------------

const detectComposedShadowClips = (): {
  file: string;
  line: number;
  clipped: string[];
  shadowSibling: string[];
}[] => {
  const byFile: Record<string, Set<string>> = {};
  for (const b of CLIPPED) (byFile[b.file] ||= new Set()).add(b.block);

  const out: {
    file: string;
    line: number;
    clipped: string[];
    shadowSibling: string[];
  }[] = [];

  for (const file of Object.keys(byFile)) {
    // #1062: a Sub-D-swept file may have been deleted/renamed since the sweep —
    // it can no longer clip a live shadow, so skip it rather than throwing.
    let src = "";
    try {
      src = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
    } catch {
      continue;
    }
    const sb = findStyleBlocks(src);
    const shadowStyles = new Set(
      Object.entries(sb)
        .filter(([, body]) =>
          /shadow(Color|Offset|Opacity|Radius)\s*:/.test(body),
        )
        .map(([n]) => n),
    );
    if (!shadowStyles.size) continue;

    // Every JSX style array: style={[ ... ]} or style={({pressed})=>[ ... ]}.
    const arrRe = /style=\{(?:\([^)]*\)\s*=>\s*)?\[([\s\S]*?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = arrRe.exec(src)) !== null) {
      const list = m[1];
      const refs = [...list.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map(
        (x) => x[1],
      );
      const clippedHere = [...new Set(refs.filter((r) => byFile[file].has(r)))];
      const shadowHere = [...new Set(refs.filter((r) => shadowStyles.has(r)))];
      if (clippedHere.length && shadowHere.length) {
        const line = src.slice(0, m.index).split("\n").length;
        out.push({
          file,
          line,
          clipped: clippedHere,
          shadowSibling: shadowHere,
        });
      }
    }
  }
  return out;
};

/*
 * F-1 RESOLVED (QA finding F-1, P2 — iOS active-tab glow clipped) — REWORK 2026-05-29.
 *
 * Originally the two trip-intake tab pills below composed a shadow-bearing
 * `tabActive` glow onto the SAME `<Pressable>` that Sub-D had clipped with
 * overflow:'hidden'. On iOS that sets masksToBounds=true and clipped the
 * active-tab orange glow (shadowColor #eb7825, shadowRadius 14) — an
 * SC-iOS-frozen violation, the exact case the spec EXCLUDED for
 * `BottomNav.spotlight`:
 *   - mingla-business/src/components/trip/EditPublishedTripIntakeAccordion.tsx [tab]
 *   - mingla-business/src/components/trip/TripCreatorStep6Intake.tsx [tab]
 *
 * The F-1 rework REMOVED overflow:'hidden' from those two `tab` blocks (the
 * first-strike Android `elevation:0` already kills the rectangular Android
 * shadow artifact on these full-radius pills, and the iOS glow must not be
 * clipped). So the composed-shadow-clip offender set is now EMPTY.
 *
 * This gate asserts the set stays EMPTY: if ANY swept surface clips a
 * shadow-bearing glow on the same element (including a regression that re-adds
 * overflow:'hidden' to these two pills), the offender list becomes non-empty
 * and this test FAILS — locking F-1 fixed and catching any new violation.
 *
 * Tracking: QA_META-ORCH-1002_SUB-D_BUSINESS_GLASS.md › F-1 (RESOLVED).
 */
const KNOWN_SHADOW_CLIP_OFFENDERS: readonly string[] = [];

describe("Sub-D adversarial D — overflow:'hidden' never clips an iOS shadow on any element (F-1 RESOLVED)", () => {
  test("the composed-shadow-clip offender set is empty (F-1 fixed, cannot regress)", () => {
    // Line-agnostic identity so unrelated edits to these files don't flap the test.
    const offenders = detectComposedShadowClips()
      .map(
        (o) =>
          `${o.file} — clipped [${[...o.clipped].sort().join(
            ",",
          )}] composed with shadow sibling [${[...o.shadowSibling]
            .sort()
            .join(",")}]`,
      )
      .sort();

    // Post-F-1 the set MUST be empty: any swept surface that clips a shadow glow
    // on the same element (including a regression re-adding overflow:'hidden' to
    // the two trip-intake `tab` pills) is a fresh SC-iOS-frozen violation and
    // must fail this gate immediately.
    expect(offenders).toEqual([...KNOWN_SHADOW_CLIP_OFFENDERS].sort());
  });
});
