/**
 * ORCH-1098 Stage 6 regression — event-create gesture crash on phone web.
 *
 * Bug: the "Create event, experience, or trip" picker (UniversalCreatorSheet)
 * opens a TopSheet whose `<GestureDetector>` calls react-native-gesture-handler's
 * `useAnimatedGesture()` → `Reanimated.useEvent`, which react-native-reanimated@4
 * removed and the reanimated WEB shim does not provide. Mounting a bare
 * `<GestureDetector>` on web therefore throws
 * `TypeError: Reanimated.useEvent is not a function` and crashes the route into
 * the "Something broke" error boundary.
 *
 * Fix: a web-gated `WebSafeGestureDetector` (native = real GestureDetector;
 * `.web.tsx` = passthrough that never mounts GestureDetector). The three overlay
 * primitives that mount a swipe gesture (TopSheet, SheetMobile, Toast) route
 * through it.
 *
 * These are SOURCE-STRUCTURE assertions (the RN-web overlay components are
 * fragile under jsdom; the Stage-4/5 gates use the same source-parse approach).
 * They fail-on-revert when any of the three reverts to a bare `<GestureDetector>`
 * or when the web wrapper reintroduces GestureDetector.
 */

import { readFileSync } from "fs";
import { join } from "path";

const UI_DIR = join(__dirname, "..", "src", "components", "ui");

const read = (rel: string): string => readFileSync(join(UI_DIR, rel), "utf8");

/** Strip block + line comments so assertions match real code, not prose. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("ORCH-1098 Stage 6 — web-safe gesture detector kills the reanimated useEvent crash", () => {
  describe("WebSafeGestureDetector web/native split exists", () => {
    it("ships both a native .tsx and a web .web.tsx", () => {
      expect(() => read("WebSafeGestureDetector.tsx")).not.toThrow();
      expect(() => read("WebSafeGestureDetector.web.tsx")).not.toThrow();
    });

    it("native variant delegates to the REAL GestureDetector (native byte-equivalent path)", () => {
      const code = stripComments(read("WebSafeGestureDetector.tsx"));
      expect(code).toMatch(
        /import\s*\{[^}]*GestureDetector[^}]*\}\s*from\s*["']react-native-gesture-handler["']/,
      );
      expect(code).toMatch(/<GestureDetector\s+gesture=\{gesture\}>/);
    });

    it("WEB variant NEVER mounts GestureDetector and never imports it from gesture-handler (no useEvent path)", () => {
      const code = stripComments(read("WebSafeGestureDetector.web.tsx"));
      // No JSX GestureDetector at all on web.
      expect(code).not.toMatch(/<GestureDetector\b/);
      // The only allowed gesture-handler import on web is the type-only one.
      const ghImports = code.match(
        /import[^;]*from\s*["']react-native-gesture-handler["']/g,
      );
      (ghImports ?? []).forEach((line) => {
        expect(line).toMatch(/import\s+type/);
        expect(line).not.toMatch(/GestureDetector/);
      });
      // Web wrapper returns the child directly.
      expect(code).toMatch(/return\s+children/);
    });
  });

  describe("all three swipe-overlay primitives route through WebSafeGestureDetector", () => {
    const consumers = ["TopSheet.tsx", "SheetMobile.tsx", "Toast.tsx"] as const;

    consumers.forEach((file) => {
      it(`${file}: no bare <GestureDetector ...> in JSX`, () => {
        const code = stripComments(read(file));
        expect(code).not.toMatch(/<GestureDetector\b/);
      });

      it(`${file}: wraps its gesture with <WebSafeGestureDetector gesture=...>`, () => {
        const code = stripComments(read(file));
        expect(code).toMatch(/<WebSafeGestureDetector\s+gesture=\{panGesture\}>/);
        expect(code).toMatch(
          /import\s*\{[^}]*WebSafeGestureDetector[^}]*\}\s*from\s*["']\.\/WebSafeGestureDetector["']/,
        );
      });

      it(`${file}: does NOT import GestureDetector as a value from gesture-handler`, () => {
        const code = stripComments(read(file));
        const ghImports = code.match(
          /import[^;]*from\s*["']react-native-gesture-handler["']/g,
        );
        (ghImports ?? []).forEach((line) => {
          // GestureHandlerRootView (Toast) is fine — only GestureDetector is the crash source.
          expect(line).not.toMatch(/\bGestureDetector\b/);
        });
      });
    });
  });
});
