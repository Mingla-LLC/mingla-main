/**
 * ORCH-0895 — Composer toolbar adversarial regression test.
 *
 * # Adversarial angle (vs happy-path counterpart)
 * Where `composerToolbar.underlineExtension.regression.test.ts` proves
 * the FIX is present (Underline extension registered, sendAction wired
 * for B/I/U, insertLink for link), THIS test proves the BROKEN PATH
 * cannot be reintroduced. It attacks the exact regression class from
 * the opposite angle: asserts the dead anti-pattern stays dead.
 *
 * The original regression was a `commandDOM(focusExecJs(...))` rewrite
 * of the B/I/U handlers in `ComposerV2Editor.tsx`. The web Tiptap shim
 * (`richEditor.tsx:312-314`) defines `commandDOM` as an intentional
 * no-op — so every B/I/U button silently did nothing on web. The fix
 * removed the helpers (`focusExecJs`, `insertLinkJs`) and routed
 * handlers through `sendAction` (works on pell AND Tiptap).
 *
 * If a future implementor (a) reintroduces a `focusExecJs` /
 * `insertLinkJs` helper definition in `ComposerV2Editor.tsx`, or
 * (b) routes any B/I/U/Link handler through `commandDOM(`, this test
 * fails. The test IS the trap.
 *
 * # Why this is "different angle" from the happy-path test
 * - Happy-path tests POSITIVE presence: `case "underline"` exists,
 *   `Underline` is in extensions array, `sendAction(actions.setBold)`
 *   is called.
 * - Adversarial tests NEGATIVE absence: `focusExecJs` is NOT defined,
 *   `commandDOM(` is NOT used by toolbar handlers, the dead helper
 *   bodies are NOT present.
 *
 * The two tests would BOTH have to be silenced (or a refactor would
 * have to dance around both grammars) to reintroduce the bug. That's
 * the safety multiplier.
 */

import fs from "node:fs";
import path from "node:path";

const COMPOSER_EDITOR_PATH = path.resolve(
  __dirname,
  "..",
  "ComposerV2Editor.tsx",
);
const RICH_EDITOR_PATH = path.resolve(__dirname, "..", "richEditor.tsx");

const stripComments = (src: string): string => {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
  return out;
};

describe("ORCH-0895 — Composer toolbar adversarial (commandDOM anti-pattern trap)", () => {
  let composerEditorSource: string;
  let webEditorSource: string;

  beforeAll(() => {
    composerEditorSource = stripComments(
      fs.readFileSync(COMPOSER_EDITOR_PATH, "utf8"),
    );
    webEditorSource = stripComments(fs.readFileSync(RICH_EDITOR_PATH, "utf8"));
  });

  describe("(T-0895-ADV-01) Dead helper functions stay dead", () => {
    it("does NOT define focusExecJs in ComposerV2Editor.tsx", () => {
      expect(composerEditorSource).not.toMatch(
        /(?:const|function)\s+focusExecJs\b/,
      );
    });

    it("does NOT define insertLinkJs in ComposerV2Editor.tsx", () => {
      expect(composerEditorSource).not.toMatch(
        /(?:const|function)\s+insertLinkJs\b/,
      );
    });
  });

  describe("(T-0895-ADV-02) Toolbar handlers never route through commandDOM", () => {
    it("handleToggleBoldLocal does NOT call commandDOM(", () => {
      const block = composerEditorSource.match(
        /handleToggleBoldLocal[\s\S]{0,500}?\}\s*,\s*\[\s*\]\s*\)/,
      );
      expect(block).not.toBeNull();
      expect(block?.[0] ?? "").not.toMatch(/commandDOM\(/);
    });

    it("handleToggleItalicLocal does NOT call commandDOM(", () => {
      const block = composerEditorSource.match(
        /handleToggleItalicLocal[\s\S]{0,500}?\}\s*,\s*\[\s*\]\s*\)/,
      );
      expect(block).not.toBeNull();
      expect(block?.[0] ?? "").not.toMatch(/commandDOM\(/);
    });

    it("handleToggleUnderlineLocal does NOT call commandDOM(", () => {
      const block = composerEditorSource.match(
        /handleToggleUnderlineLocal[\s\S]{0,500}?\}\s*,\s*\[\s*\]\s*\)/,
      );
      expect(block).not.toBeNull();
      expect(block?.[0] ?? "").not.toMatch(/commandDOM\(/);
    });

    it("handleLinkPromptSubmit does NOT call commandDOM(", () => {
      const block = composerEditorSource.match(
        /handleLinkPromptSubmit[\s\S]{0,800}?\}\s*,\s*\[[\s\S]*?\]\s*\)/,
      );
      expect(block).not.toBeNull();
      expect(block?.[0] ?? "").not.toMatch(/commandDOM\(/);
    });
  });

  describe("(T-0895-ADV-03) Web commandDOM intentionally remains a no-op", () => {
    /**
     * The web Tiptap shim's `commandDOM` MUST stay a no-op. If somebody
     * implements it (e.g., by calling `editor.view.dom...eval(js)`),
     * that opens a JS-injection surface and reintroduces the original
     * bug class — toolbar handlers might silently call into it again,
     * AND we'd be evaluating arbitrary JS strings in the host page.
     * Tiptap's correct integration point is the imperative chain API.
     */
    it("commandDOM body is a no-op (returns immediately)", () => {
      const block = webEditorSource.match(
        /commandDOM:\s*\([^)]*\)\s*:\s*void\s*=>\s*\{[\s\S]{0,200}?\}/,
      );
      expect(block).not.toBeNull();
      const body = block?.[0] ?? "";
      // Body must contain a bare `return;` and must NOT call any
      // `document.*`, `editor.*`, or `window.*` evaluator.
      expect(body).toMatch(/return\s*;/);
      expect(body).not.toMatch(/document\./);
      expect(body).not.toMatch(/editor\./);
      expect(body).not.toMatch(/eval\(/);
    });
  });

  describe("(T-0895-ADV-04) Imperative handle's B/I/U cannot regress to commandDOM", () => {
    it("imperative toggleBold does NOT call commandDOM(", () => {
      const block = composerEditorSource.match(
        /toggleBold:\s*\(\)[\s\S]{0,300}?\},/,
      );
      expect(block).not.toBeNull();
      expect(block?.[0] ?? "").not.toMatch(/commandDOM\(/);
    });

    it("imperative toggleItalic does NOT call commandDOM(", () => {
      const block = composerEditorSource.match(
        /toggleItalic:\s*\(\)[\s\S]{0,300}?\},/,
      );
      expect(block).not.toBeNull();
      expect(block?.[0] ?? "").not.toMatch(/commandDOM\(/);
    });

    it("imperative toggleUnderline does NOT call commandDOM(", () => {
      const block = composerEditorSource.match(
        /toggleUnderline:\s*\(\)[\s\S]{0,300}?\},/,
      );
      expect(block).not.toBeNull();
      expect(block?.[0] ?? "").not.toMatch(/commandDOM\(/);
    });
  });
});
