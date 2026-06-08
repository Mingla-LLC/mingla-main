/**
 * ORCH-1098 Stage 4 — TESTER-AUTHORED ADVERSARIAL regression gate.
 *
 * Context: the entire "business web on phone" saga had ONE root cause — the
 * mobile-web `BottomNav` mounted react-native-reanimated, whose web runtime
 * drove an unbounded re-render / fiber-allocation loop that climbed the V8 heap
 * at ~200 MB/s to ~1 GB and SIGSEGV-crashed the renderer ("Aw, Snap") on EVERY
 * signed-in tab route. The fix web-gates a NON-reanimated `MobileWebCapsule`
 * into `BottomNav.web.tsx` while keeping the reanimated spotlight on native.
 *
 * This test exists so the OOM loop can NEVER silently regress.
 *
 * DIFFERENT ANGLE from the implementor's happy-path test
 * (`orch1098RealAppOnPhone.test.ts`), which does plain comment-stripped
 * substring `toContain` / `not.toContain` checks on the raw source. This
 * adversarial test instead:
 *   (1) parses ONLY real module dependency edges (import / export-from /
 *       require / dynamic import) and asserts reanimated is reachable through
 *       NONE of them on the web path — catching re-export / require / dynamic
 *       vectors a bare `not.toContain('from "./BottomNav"')` would miss;
 *   (2) strips comments AND string/template literals, then asserts no
 *       reanimated-hook INVOCATION (identifier followed by `(`), so a call can
 *       neither hide inside a doc-comment NOR inside a string, and a benign
 *       identifier like `useSharedValueLabel` cannot false-trip;
 *   (3) inverts the parity assertion — proves the NATIVE file still CALLS the
 *       reanimated hooks and renders `<Animated.View`, i.e. the cure is a
 *       web-gate, not a global rip-out that would kill native motion.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const UI = join(__dirname, "..", "src", "components", "ui");
const WEB = join(UI, "BottomNav.web.tsx");
const NATIVE = join(UI, "BottomNav.tsx");

const REANIMATED_MODULE = "react-native-reanimated";
const REANIMATED_HOOKS = [
  "useSharedValue",
  "useAnimatedStyle",
  "useReducedMotion",
  "useDerivedValue",
  "useAnimatedReaction",
  "withSpring",
  "withTiming",
  "withRepeat",
  "withDelay",
];

/** Remove `// line` and block comments. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Remove comments AND string / template literals so a hook *call* cannot hide
 * inside a quoted doc string. (Naive but sufficient for source-shape asserts.) */
function stripCommentsAndStrings(src: string): string {
  return stripComments(src)
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

/** Extract the module specifier of every real dependency edge:
 * `import ... from "x"`, `export ... from "x"`, `require("x")`,
 * `import("x")`. Comments/strings already removed so we only see real edges. */
function moduleEdges(rawSrc: string): string[] {
  const src = stripComments(rawSrc);
  const specs: string[] = [];
  const patterns = [
    /\bimport\b[^;]*?\bfrom\s*["']([^"']+)["']/g, // import ... from "x"
    /\bexport\b[^;]*?\bfrom\s*["']([^"']+)["']/g, // export ... from "x"
    /\bimport\s*["']([^"']+)["']/g, // bare side-effect import "x"
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("x")
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("x")
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

describe("ORCH-1098 Stage 4 adversarial — mobile-web BottomNav can never re-import the OOM loop", () => {
  it("preconditions: both BottomNav source files exist", () => {
    expect(existsSync(WEB)).toBe(true);
    expect(existsSync(NATIVE)).toBe(true);
  });

  describe("web path (BottomNav.web.tsx) — reanimated unreachable through ANY edge", () => {
    const raw = readFileSync(WEB, "utf8");
    const edges = moduleEdges(raw);

    it("does NOT depend on react-native-reanimated via import/export-from/require/dynamic-import", () => {
      const reanimatedEdges = edges.filter(
        (s) => s === REANIMATED_MODULE || s.startsWith(REANIMATED_MODULE + "/"),
      );
      expect(reanimatedEdges).toEqual([]);
    });

    it("does NOT re-export or require the canonical native reanimated capsule (./BottomNav) — the exact original vector", () => {
      // The pre-fix bug was BottomNav.web.tsx re-exporting MobileBottomNav from
      // "./BottomNav" (the reanimated capsule). Assert NO dependency edge points
      // back at the sibling native module by any mechanism.
      const reexportEdges = edges.filter(
        (s) => s === "./BottomNav" || s.endsWith("/BottomNav"),
      );
      expect(reexportEdges).toEqual([]);
    });

    it("invokes NO reanimated hook (call sites survive comment+string stripping)", () => {
      const code = stripCommentsAndStrings(raw);
      for (const hook of REANIMATED_HOOKS) {
        // identifier immediately followed by `(` = an actual call.
        const callRe = new RegExp(`\\b${hook}\\s*\\(`);
        expect(code).not.toMatch(callRe);
      }
      // and the absolute spotlight element must be gone from executable code
      expect(code).not.toContain("Animated.View");
    });
  });

  describe("native path (BottomNav.tsx) — parity preserved (web-gate, not a global rip-out)", () => {
    const raw = readFileSync(NATIVE, "utf8");
    const edges = moduleEdges(raw);
    const code = stripCommentsAndStrings(raw);

    it("still depends on react-native-reanimated", () => {
      const reanimatedEdges = edges.filter(
        (s) => s === REANIMATED_MODULE || s.startsWith(REANIMATED_MODULE + "/"),
      );
      expect(reanimatedEdges.length).toBeGreaterThan(0);
    });

    it("still CALLS the spotlight reanimated hooks and renders <Animated.View", () => {
      expect(code).toMatch(/\buseSharedValue\s*\(/);
      expect(code).toMatch(/\buseAnimatedStyle\s*\(/);
      expect(code).toMatch(/\bwithSpring\s*\(/);
      expect(code).toContain("Animated.View");
    });
  });
});
