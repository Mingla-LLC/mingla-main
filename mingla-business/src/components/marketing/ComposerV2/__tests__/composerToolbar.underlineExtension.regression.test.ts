/**
 * ORCH-0895 — Composer toolbar (Bold / Italic / Underline / Link / Divider)
 * happy-path regression test.
 *
 * # What this verifies
 * Locks in the contract that the marketing composer's web Tiptap editor
 * (a) imports `@tiptap/extension-underline`, (b) registers Underline in
 * the extensions array, (c) handles `sendAction("underline")` in the
 * imperative API switch by calling `editor.chain().focus().toggleUnderline().run()`,
 * AND that the ComposerV2Editor host routes B/I/U toolbar pills through
 * the `sendAction` imperative API — NOT through `commandDOM(focusExecJs(...))`,
 * which is a no-op on the web Tiptap shim (`richEditor.tsx:312-314`).
 *
 * # Why this exists (bug under repair)
 * In a prior turn the toolbar handlers in `ComposerV2Editor.tsx` were
 * rewritten from `sendAction(actions.setBold, "result")` to
 * `commandDOM(focusExecJs("bold"))`. The intent was to fix an iOS pell
 * focus race, but the web `RichEditor.commandDOM` is intentionally a
 * no-op (Tiptap doesn't have an iframe to inject JS into), so on web
 * every B / I / U / Link button silently did nothing. Underline also
 * never worked on web because `@tiptap/extension-underline` was never
 * installed and the web `sendAction` switch had no `case "underline"`.
 * See full root-cause analysis in
 * `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0895_COMPOSER_TOOLBAR_BOLD_ITALIC_UNDERLINE_BROKEN_ON_WEB.md`.
 *
 * # Fails-on-revert anchor
 * If a future change (a) removes `@tiptap/extension-underline` from
 * dependencies, (b) drops `Underline` from the Tiptap extensions array,
 * (c) removes the `case "underline"` from web `sendAction`, OR
 * (d) re-routes B/I/U handlers through `commandDOM(focusExecJs(...))`
 * instead of `sendAction(actions.setBold|setItalic|setUnderline, "result")`,
 * this test fails. The test IS the contract.
 *
 * # Adversarial counterpart
 * `composerToolbar.commandDomTrap.adversarial.test.ts` attacks the same
 * regression class from the opposite angle — it asserts that the
 * commandDOM-via-focusExecJs anti-pattern is absent and the dead
 * helper functions are not re-introduced.
 *
 * # Source-grep style
 * Per `mingla-business/jest.config.cjs` (`testEnvironment: "node"`),
 * this test reads source files as strings and asserts on contents.
 * Same pattern as `richEditor.tiptap.test.ts`.
 */

import fs from "node:fs";
import path from "node:path";

const RICH_EDITOR_PATH = path.resolve(__dirname, "..", "richEditor.tsx");
const COMPOSER_EDITOR_PATH = path.resolve(
  __dirname,
  "..",
  "ComposerV2Editor.tsx",
);
const INSERTION_BAR_PATH = path.resolve(__dirname, "..", "InsertionBar.tsx");
const PACKAGE_JSON_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "package.json",
);

describe("ORCH-0895 — Composer toolbar Bold / Italic / Underline (happy-path)", () => {
  let webEditorSource: string;
  let composerEditorSource: string;
  let insertionBarSource: string;
  let packageJson: { dependencies?: Record<string, string> };

  /**
   * Strips // line comments and /* block comments *\/ from a source string
   * so regex assertions don't accidentally match commented-out code. Naive
   * implementation — does NOT understand strings/regex literals that
   * contain `//` — but sufficient for these structural assertions because
   * the patterns we're checking for don't appear inside string literals
   * in these specific files.
   */
  const stripComments = (src: string): string => {
    let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
    out = out
      .split("\n")
      .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
      .join("\n");
    return out;
  };

  beforeAll(() => {
    webEditorSource = stripComments(fs.readFileSync(RICH_EDITOR_PATH, "utf8"));
    composerEditorSource = stripComments(
      fs.readFileSync(COMPOSER_EDITOR_PATH, "utf8"),
    );
    insertionBarSource = stripComments(
      fs.readFileSync(INSERTION_BAR_PATH, "utf8"),
    );
    packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      dependencies?: Record<string, string>;
    };
  });

  describe("(T-0895-01) @tiptap/extension-underline is a declared dependency", () => {
    it("lists @tiptap/extension-underline in package.json dependencies", () => {
      expect(packageJson.dependencies).toBeDefined();
      expect(packageJson.dependencies?.["@tiptap/extension-underline"]).toBeDefined();
    });

    it("pins underline extension to the ^2.27.x line (matches StarterKit major)", () => {
      const version = packageJson.dependencies?.["@tiptap/extension-underline"] ?? "";
      expect(version).toMatch(/^\^?2\./);
    });
  });

  describe("(T-0895-02) richEditor.tsx registers Underline with Tiptap", () => {
    it("imports Underline from @tiptap/extension-underline", () => {
      expect(webEditorSource).toMatch(
        /import\s+Underline\s+from\s+["']@tiptap\/extension-underline["']/,
      );
    });

    it("registers Underline in the Tiptap extensions array", () => {
      const extensionsBlock = webEditorSource.match(
        /extensions:\s*\[([\s\S]*?)\]/,
      );
      expect(extensionsBlock).not.toBeNull();
      expect(extensionsBlock?.[1]).toMatch(/\bUnderline\b/);
    });
  });

  describe("(T-0895-03) sendAction switch handles bold / italic / underline", () => {
    it("has case 'bold' → toggleBold().run()", () => {
      expect(webEditorSource).toMatch(
        /case\s+["']bold["']\s*:\s*[\s\S]*?toggleBold\(\)\.run\(\)/,
      );
    });

    it("has case 'italic' → toggleItalic().run()", () => {
      expect(webEditorSource).toMatch(
        /case\s+["']italic["']\s*:\s*[\s\S]*?toggleItalic\(\)\.run\(\)/,
      );
    });

    it("has case 'underline' → toggleUnderline().run()", () => {
      expect(webEditorSource).toMatch(
        /case\s+["']underline["']\s*:\s*[\s\S]*?toggleUnderline\(\)\.run\(\)/,
      );
    });
  });

  describe("(T-0895-04) ComposerV2Editor routes B/I/U through sendAction (cross-platform)", () => {
    it("imports actions constants from ./richEditor", () => {
      expect(composerEditorSource).toMatch(
        /import\s+\{[^}]*\bactions\b[^}]*\}\s+from\s+["']\.\/richEditor["']/,
      );
    });

    it("toggleBold local handler calls sendAction(actions.setBold, 'result')", () => {
      expect(composerEditorSource).toMatch(
        /handleToggleBoldLocal[\s\S]{0,400}sendAction\(\s*actions\.setBold\s*,\s*["']result["']\s*\)/,
      );
    });

    it("toggleItalic local handler calls sendAction(actions.setItalic, 'result')", () => {
      expect(composerEditorSource).toMatch(
        /handleToggleItalicLocal[\s\S]{0,400}sendAction\(\s*actions\.setItalic\s*,\s*["']result["']\s*\)/,
      );
    });

    it("toggleUnderline local handler calls sendAction(actions.setUnderline, 'result')", () => {
      expect(composerEditorSource).toMatch(
        /handleToggleUnderlineLocal[\s\S]{0,400}sendAction\(\s*actions\.setUnderline\s*,\s*["']result["']\s*\)/,
      );
    });

    it("imperative handle toggleBold / toggleItalic / toggleUnderline all route through sendAction", () => {
      const toggleBoldBlock = composerEditorSource.match(
        /toggleBold:\s*\(\)[\s\S]{0,200}?\},/,
      );
      const toggleItalicBlock = composerEditorSource.match(
        /toggleItalic:\s*\(\)[\s\S]{0,200}?\},/,
      );
      const toggleUnderlineBlock = composerEditorSource.match(
        /toggleUnderline:\s*\(\)[\s\S]{0,200}?\},/,
      );
      expect(toggleBoldBlock).not.toBeNull();
      expect(toggleItalicBlock).not.toBeNull();
      expect(toggleUnderlineBlock).not.toBeNull();
      expect(toggleBoldBlock?.[0]).toMatch(
        /sendAction\(\s*actions\.setBold\s*,\s*["']result["']\s*\)/,
      );
      expect(toggleItalicBlock?.[0]).toMatch(
        /sendAction\(\s*actions\.setItalic\s*,\s*["']result["']\s*\)/,
      );
      expect(toggleUnderlineBlock?.[0]).toMatch(
        /sendAction\(\s*actions\.setUnderline\s*,\s*["']result["']\s*\)/,
      );
    });
  });

  describe("(T-0895-05) InsertionBar renders B / I / U pills wired to the right callbacks", () => {
    it("declares onToggleUnderline in InsertionBarProps", () => {
      expect(insertionBarSource).toMatch(/onToggleUnderline\s*:\s*\(\)\s*=>\s*void/);
    });

    it("renders the U Pill with onPress={onToggleUnderline}", () => {
      expect(insertionBarSource).toMatch(
        /label=["']U["'][\s\S]{0,400}onPress=\{onToggleUnderline\}/,
      );
    });
  });

  describe("(T-0895-06) Link prompt submit uses insertLink imperative (works on both platforms)", () => {
    it("handleLinkPromptSubmit calls richEditorRef.current?.insertLink(url, url)", () => {
      expect(composerEditorSource).toMatch(
        /handleLinkPromptSubmit[\s\S]{0,600}insertLink\(\s*url\s*,\s*url\s*\)/,
      );
    });
  });
});
