import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1136 R3 — TESTER adversarial regression (different angle than the
 * implementor's happy-path `orch1136R3WebSheetCssTransition.test.ts`).
 *
 * The implementor's test proves, at FILE level, that a web CSS `transition:` on
 * transform/opacity is present, web-gated, layout-free, and that the file still
 * imports reanimated for native. It does NOT prove two things the SPEC's
 * success criteria actually require:
 *
 *   ANGLE 1 — SC-8 close-before-unmount NUMERIC contract. The lazy-unmount timer
 *     (`UNMOUNT_DELAY_MS`) MUST be ≥ the web CLOSE transition duration + a safety
 *     margin, or an element pops off-screen mid-close (abrupt disappear). The
 *     implementor's test never reads the numbers. This asserts the inequality
 *     per primitive from the actual source constants.
 *
 *   ANGLE 2 — the WEB VARIANT BODY calls ZERO reanimated animation hooks. The
 *     freeze root cause (F-1) is `withTiming`/`useAnimatedStyle` running on the
 *     web JS-rAF. A file-level "still imports reanimated" check (the
 *     implementor's) is satisfied even if the WEB component body still called a
 *     reanimated hook (native import is shared). This slices the web-variant
 *     function body specifically and asserts it contains none of
 *     useSharedValue / useAnimatedStyle / withTiming / withSpring /
 *     cancelAnimation — the construct that reintroduces the freeze.
 *
 * Fails-on-revert: re-driving any web variant via a reanimated hook (Angle 2),
 * or shrinking a primitive's UNMOUNT_DELAY_MS below its close duration + safety
 * (Angle 1), makes the corresponding assertion fail. Append-only; never edits
 * the implementor's test.
 */

const root = path.resolve(__dirname, "..", "..", "..", "..");
const ui = (rel: string): string =>
  fs.readFileSync(path.join(root, "src/components/ui", rel), "utf8");

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** First numeric assignment of a `const NAME = <num>` (ignoring expressions). */
const readNumConst = (src: string, name: string): number | null => {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\b`).exec(src);
  return m ? Number(m[1]) : null;
};

const SAFETY_MS = 40;

// Per-file: the close-duration constant name(s) the lazy-unmount must clear.
// Each primitive's web close transition uses these exact constants.
const CLOSE_TIMING: Record<string, string> = {
  "TopSheet.tsx": "EXIT_DURATION", // 240
  "SheetMobile.tsx": "SHEET_CLOSE_DURATION", // 240
  "Modal.tsx": "EXIT_DURATION", // 160
  "Toast.tsx": "EXIT_DURATION", // 160
  "Sheet.web.tsx": "CLOSE_DURATION_MS", // 180
};

describe("ORCH-1136 R3 — TESTER adversarial: close-before-unmount + web hook purity", () => {
  describe("ANGLE 1 — SC-8: UNMOUNT_DELAY_MS clears the web close duration + safety", () => {
    it.each(Object.keys(CLOSE_TIMING))(
      "%s never unmounts before its close transition completes",
      (file) => {
        const src = stripComments(ui(file));

        // UNMOUNT_DELAY_MS may be a literal OR `EXIT_DURATION + 40` (Toast).
        let unmount = readNumConst(src, "UNMOUNT_DELAY_MS");
        const closeName = CLOSE_TIMING[file];
        const closeDur = readNumConst(src, closeName);
        expect(closeDur).not.toBeNull();

        if (unmount === null) {
          // Form `const UNMOUNT_DELAY_MS = EXIT_DURATION + 40;`
          const expr = new RegExp(
            `const\\s+UNMOUNT_DELAY_MS\\s*=\\s*${closeName}\\s*\\+\\s*(\\d+)`,
          ).exec(src);
          expect(expr).not.toBeNull();
          unmount = (closeDur as number) + Number(expr![1]);
        }

        expect(unmount as number).toBeGreaterThanOrEqual(
          (closeDur as number) + SAFETY_MS,
        );
      },
    );
  });

  describe("ANGLE 2 — the web variant body calls ZERO reanimated animation hooks", () => {
    const REANIMATED_HOOK_RE =
      /\b(?:useSharedValue|useAnimatedStyle|withTiming|withSpring|cancelAnimation)\b/;

    // Shared files: slice the `<Name>Web` component body (from its declaration
    // to the next top-level `const <Cap>` declaration / EOF) and assert purity.
    const webComponents: Array<[string, string]> = [
      ["TopSheet.tsx", "TopSheetWeb"],
      ["SheetMobile.tsx", "SheetWeb"],
      ["Modal.tsx", "ModalWeb"],
      ["Toast.tsx", "ToastWeb"],
    ];

    const sliceComponent = (src: string, name: string): string => {
      const startRe = new RegExp(`const\\s+${name}\\s*:`);
      const startM = startRe.exec(src);
      if (startM === null) return "";
      const after = src.slice(startM.index + startM[0].length);
      // Stop at the next top-level component/const declaration.
      const endM = /\nconst\s+[A-Z][A-Za-z0-9_]*\s*[:=]/.exec(after);
      return after.slice(0, endM ? endM.index : after.length);
    };

    it.each(webComponents)(
      "%s web variant (%s) calls no reanimated animation hook",
      (file, comp) => {
        const src = stripComments(ui(file));
        const body = sliceComponent(src, comp);
        expect(body.length).toBeGreaterThan(0); // the web variant exists
        expect(REANIMATED_HOOK_RE.test(body)).toBe(false);
      },
    );

    it("Sheet.web.tsx (web-only) body calls no reanimated animation hook anywhere", () => {
      const src = stripComments(ui("Sheet.web.tsx"));
      expect(REANIMATED_HOOK_RE.test(src)).toBe(false);
    });
  });

  describe("guard — the native dispatch still exists (web is gated, not global)", () => {
    it.each([
      ["TopSheet.tsx", "TopSheetNative"],
      ["SheetMobile.tsx", "SheetNative"],
      ["Modal.tsx", "ModalNative"],
      ["Toast.tsx", "ToastNative"],
    ])("%s keeps a native variant (%s) so the web swap is gated", (file, comp) => {
      const src = stripComments(ui(file));
      expect(new RegExp(`const\\s+${comp}\\s*:`).test(src)).toBe(true);
    });
  });
});
