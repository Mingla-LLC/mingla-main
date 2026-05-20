/**
 * ORCH-0891 M1 — atomic chip backspace ADVERSARIAL regression test.
 *
 * # Different angle than the implementor happy-path
 * The happy-path test (`richEditor.tiptap.test.ts`) asserts the file
 * imports the verbatim DOM handler constant. This adversarial test
 * attacks DIFFERENT angles:
 *
 *   (a) The handler script content itself MUST remain correct — if a
 *       future implementor refactors `composerChipHtml.ts` to "improve"
 *       the backspace handler and accidentally breaks the DOM
 *       traversal, this test catches the script-shape regression.
 *   (b) The handler script's idempotency flag MUST be intact — if the
 *       script can be installed twice, the second install double-fires
 *       on every Backspace, causing the chip-AND-the-character-before
 *       to disappear in one keypress. The idempotency flag
 *       `window.__minglaChipBackspaceInstalled` is the only protection.
 *   (c) The handler MUST attach a 'keydown' listener (not 'keyup' /
 *       'keypress' / 'input'). Wrong event type = chip never deletes.
 *   (d) The handler MUST call `e.preventDefault()` AND `e.stopPropagation()`
 *       on the Backspace press — otherwise Tiptap's default Backspace
 *       fires and deletes only one character from inside the chip's
 *       text content instead of the whole atom.
 *   (e) The handler MUST handle BOTH the trailing-nbsp-followed-by-chip
 *       case AND the cursor-immediately-after-chip case — the chip
 *       inserts `<span>...</span>&nbsp;` so the cursor sits after the
 *       nbsp; the handler must walk back past the nbsp to find the chip.
 *
 * # Source-grep style
 * Same rationale as the happy-path test: no jsdom/RTL in
 * `jest.config.cjs`. The handler is pure DOM-string content; source-grep
 * is the right verification layer. Live DOM behavior (actually pressing
 * Backspace and observing chip deletion) is tester's smoke-test on the
 * web preview.
 *
 * # Fails-on-revert
 * Each test in this suite catches a DIFFERENT regression:
 *   - T-M1-AD-01 fails if the keydown listener is swapped to keyup
 *   - T-M1-AD-02 fails if the idempotency guard is removed
 *   - T-M1-AD-03 fails if preventDefault is removed
 *   - T-M1-AD-04 fails if nbsp-walkback is removed
 *   - T-M1-AD-05 fails if either chip class name match is dropped
 *
 * The implementor's happy-path test does NOT cover any of these — it
 * only confirms the handler constant is imported. This adversarial
 * suite covers the handler's actual content correctness.
 */

import fs from "node:fs";
import path from "node:path";

const CHIP_HTML_PATH = path.resolve(
  __dirname,
  "..",
  "composerChipHtml.ts",
);

describe("ORCH-0891 M1 — chip backspace handler script content (adversarial)", () => {
  let chipHtmlSource: string;
  let handlerScript: string;

  beforeAll(() => {
    chipHtmlSource = fs.readFileSync(CHIP_HTML_PATH, "utf8");
    // Extract the handler script string by matching the export.
    // The script is a template-literal string between the
    // `COMPOSER_CHIP_BACKSPACE_HANDLER_JS = \`` and the closing
    // backtick + semicolon.
    const match = chipHtmlSource.match(
      /COMPOSER_CHIP_BACKSPACE_HANDLER_JS\s*=\s*`([\s\S]*?)`;/,
    );
    if (match === null || match[1] === undefined) {
      throw new Error("COMPOSER_CHIP_BACKSPACE_HANDLER_JS export not found in composerChipHtml.ts");
    }
    handlerScript = match[1];
  });

  it("(T-M1-AD-01) attaches a 'keydown' listener (NOT keyup / keypress / input)", () => {
    expect(handlerScript).toMatch(/addEventListener\(\s*['"]keydown['"]/);
    expect(handlerScript).not.toMatch(/addEventListener\(\s*['"]keyup['"]/);
    expect(handlerScript).not.toMatch(/addEventListener\(\s*['"]keypress['"]/);
  });

  it("(T-M1-AD-02) installs the idempotency flag `window.__minglaChipBackspaceInstalled`", () => {
    // The flag prevents double-installation (each call to
    // ensureBackspaceHandlerInstalled appends the <script> tag once;
    // the script's own internal guard handles the case where the
    // function runs twice in the same session before the flag is set).
    expect(handlerScript).toMatch(/__minglaChipBackspaceInstalled/);
  });

  it("(T-M1-AD-03) calls e.preventDefault AND e.stopPropagation on Backspace handling", () => {
    // Both calls are needed: preventDefault blocks the browser's
    // default delete-one-char behavior; stopPropagation blocks
    // Tiptap's keymap from firing after ours.
    expect(handlerScript).toMatch(/preventDefault\(\)/);
    expect(handlerScript).toMatch(/stopPropagation\(\)/);
  });

  it("(T-M1-AD-04) handles the trailing-nbsp case (cursor walks back past nbsp to find chip)", () => {
    // The chip HTML emits `<span>...</span>&nbsp;` so the cursor sits
    // immediately after the nbsp. The handler MUST walk back past the
    // nbsp to identify the chip behind it. The script checks for
    // a single non-breaking-space character ( ) OR the literal ' '
    // entity.
    // Per the handler source, the check is `node.nodeValue === ' '`
    // where ' ' is the non-breaking space character (Unicode U+00A0).
    // Match both literal ' ' (U+00A0) and the &nbsp; entity reference.
    const hasNbspWalkback =
      handlerScript.includes(" ") ||
      handlerScript.includes("&nbsp;") ||
      /node\.nodeValue\s*===?\s*['"]\s['"]/.test(handlerScript);
    expect(hasNbspWalkback).toBe(true);
  });

  it("(T-M1-AD-05) checks for BOTH chip class names (event AND personalization)", () => {
    // The handler must recognize both chip types. Missing either
    // class-name check = that chip type can't be backspace-deleted.
    expect(handlerScript).toMatch(/mingla-event-chip/);
    expect(handlerScript).toMatch(/mingla-personalization-chip/);
  });

  it("(T-M1-AD-06) dispatches an 'input' event after chip removal so Tiptap onChange fires", () => {
    // Critical: after the handler removes the chip DOM node, Tiptap's
    // onChange callback does NOT fire automatically (DOM-direct
    // mutations bypass ProseMirror's change tracking). The handler
    // MUST dispatch a synthetic 'input' event so Tiptap re-reads the
    // DOM and the parent's onChange callback runs. Without this, the
    // chip visually disappears but the body_html state still contains
    // it — operator sends a blast with the deleted chip still in the
    // server payload.
    expect(handlerScript).toMatch(/new\s+Event\(\s*['"]input['"]/);
    expect(handlerScript).toMatch(/dispatchEvent/);
  });

  it("(T-M1-AD-07) the handler script export is reachable from richEditor.tsx via the named import", () => {
    // Confirm the constant is exported (not just declared internally).
    // This protects against a future "internal use only" refactor that
    // would break richEditor.tsx's import.
    expect(chipHtmlSource).toMatch(
      /export\s+const\s+COMPOSER_CHIP_BACKSPACE_HANDLER_JS\s*=/,
    );
  });

  it("(T-M1-AD-08) handler is wrapped in an IIFE (immediately-invoked function expression)", () => {
    // The IIFE pattern `(function(){ ... })()` ensures the handler
    // runs immediately upon script eval AND scopes its variables so
    // multiple installs don't conflict in the global namespace.
    expect(handlerScript).toMatch(/\(function\s*\(\s*\)\s*\{/);
    expect(handlerScript).toMatch(/\}\s*\)\s*\(\s*\)\s*;?\s*$/);
  });
});
