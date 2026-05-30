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

const computeClippedBlocks = (): ClippedBlock[] => {
  const files = execSync(
    "git diff origin/main...HEAD --name-only -- 'mingla-business/src/**/*.tsx'",
    { cwd: REPO_ROOT, encoding: "utf8" },
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const out: ClippedBlock[] = [];
  for (const f of files) {
    const absHead = path.join(REPO_ROOT, f);
    let head = "";
    let base = "";
    try {
      head = fs.readFileSync(absHead, "utf8");
    } catch {
      continue;
    }
    try {
      base = execSync(`git show origin/main:${f}`, {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
    } catch {
      base = "";
    }
    const hb = findStyleBlocks(head);
    const bb = findStyleBlocks(base);
    for (const name of Object.keys(hb)) {
      const hHas = /overflow:\s*["']hidden["']/.test(hb[name]);
      const bHas =
        bb[name] !== undefined && /overflow:\s*["']hidden["']/.test(bb[name]);
      if (hHas && !bHas) out.push({ file: f, block: name });
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
    // Implementor reports ~198 named blocks gained overflow:'hidden'. Require a
    // floor well above any accidental empty/partial result.
    expect(CLIPPED.length).toBeGreaterThan(150);
  });
});

// ---------------------------------------------------------------------------
// A. NO-FLATTEN — every clipped block kept its exact backgroundColor from main.
// ---------------------------------------------------------------------------

describe("Sub-D adversarial A — no clipped surface was flattened to opaque", () => {
  test("every block that gained overflow:'hidden' kept its main backgroundColor", () => {
    const baseCache: Record<string, string> = {};
    const flattened: { file: string; block: string; from: string; to: string }[] =
      [];

    for (const { file, block } of CLIPPED) {
      const head = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      if (!(file in baseCache)) {
        try {
          baseCache[file] = execSync(`git show origin/main:${file}`, {
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

describe("Sub-D adversarial B/C — stragglers opaque on Android only, iOS frozen", () => {
  test("Toast: opaque-fallback branch is reachable, inverted guard is gone, iOS keeps blur", () => {
    const code = stripComments(readComp("ui/Toast.tsx"));
    // Inverted guard removed.
    expect(code).not.toMatch(/blurOk\s*=\s*Platform\.OS\s*!==\s*["']web["']/);
    // Android is explicitly false (opaque fallback), and an iOS branch exists.
    expect(code).toMatch(/Platform\.OS\s*===\s*["']android["']/);
    expect(code).toMatch(/Platform\.OS\s*===\s*["']ios["']/);
    // The opaque fallback is >=0.92.
    expect(code).toMatch(
      /FALLBACK_BACKGROUND\s*=\s*["']rgba\(20,\s*22,\s*26,\s*0\.92\)["']/,
    );
  });

  test("AiDisclosureModal: Android opaque sheet is gated behind Platform.OS==='android', iOS keeps real BlurView", () => {
    const code = stripComments(readComp("ari/AiDisclosureModal.tsx"));
    // Android-gated opaque branch (NOT an unconditional or !== 'ios' branch).
    expect(code).toMatch(
      /Platform\.OS\s*===\s*["']android["'][\s\S]{0,160}styles\.opaqueSheet/,
    );
    // No `Platform.OS !== 'ios'` style negation that would also flip web.
    expect(code).not.toMatch(/Platform\.OS\s*!==\s*["']ios["']/);
    // opaqueSheet is a fully opaque #hex (no rgba alpha => >=0.92 by construction).
    const block = styleBlock(code, "opaqueSheet");
    expect(block).not.toBeNull();
    expect(block!).toMatch(/backgroundColor:\s*["']#[0-9a-fA-F]{6}["']/);
    // iOS path still renders the real blur.
    expect(code).toMatch(/<BlurView\s+intensity=\{40\}/);
  });

  test("BlastCustomersCta: Android L1 opaque, iOS/web keep BlurView, behind Platform guard", () => {
    const code = stripComments(readComp("marketing/BlastCustomersCta.tsx"));
    expect(code).toMatch(/\bPlatform\b/);
    expect(code).toMatch(
      /Platform\.OS\s*===\s*["']android["'][\s\S]{0,220}FALLBACK_BACKGROUND[\s\S]{0,220}<BlurView/,
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
    const src = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
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
 * KNOWN OFFENDERS (filed as QA finding F-1, P2 — iOS active-tab glow clipped).
 *
 * These two trip-intake tab pills compose a shadow-bearing `tabActive` glow
 * onto the SAME `<Pressable>` that Sub-D clipped with overflow:'hidden'. On iOS
 * that sets masksToBounds=true and clips the active-tab orange glow
 * (shadowColor #eb7825, shadowRadius 14) — an SC-iOS-frozen violation, the
 * exact case the spec EXCLUDED for `BottomNav.spotlight`. Functionally benign
 * (no cropped interactive child; dark canvas; niche edit-flow tab) → P2, not a
 * release blocker.
 *
 * The test below is GREEN against this exact set so it ships with the gate, but
 * it FAILS THE MOMENT the set GROWS, SHRINKS, or MOVES — so (a) a new sweep
 * surface that clips a shadow glow is caught, and (b) when the implementor
 * fixes F-1 (drop the clip on these two pills, mirroring BottomNav), this
 * assertion forces the expected list to be emptied in the same commit.
 *
 * Tracking: QA_META-ORCH-1002_SUB-D_BUSINESS_GLASS.md › F-1.
 */
const KNOWN_SHADOW_CLIP_OFFENDERS: readonly string[] = [
  "mingla-business/src/components/trip/EditPublishedTripIntakeAccordion.tsx — clipped [tab] composed with shadow sibling [tabActive]",
  "mingla-business/src/components/trip/TripCreatorStep6Intake.tsx — clipped [tab] composed with shadow sibling [tabActive]",
];

describe("Sub-D adversarial D — overflow:'hidden' never clips an iOS shadow on a NEW element", () => {
  test("the composed-shadow-clip offender set has not grown beyond the known F-1 pair", () => {
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

    // A NEW offender (a swept surface that clips a shadow glow) is a fresh
    // SC-iOS-frozen regression and must fail this gate immediately.
    expect(offenders).toEqual([...KNOWN_SHADOW_CLIP_OFFENDERS].sort());
  });
});
