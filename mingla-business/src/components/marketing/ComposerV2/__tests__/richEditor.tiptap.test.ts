/**
 * ORCH-0891 M1 — richEditor.tsx Tiptap rewrite happy-path regression test.
 *
 * # What this verifies
 * Asserts that `richEditor.tsx` (the web variant of the RichEditor primitive)
 * (a) imports Tiptap (`@tiptap/react`, `@tiptap/starter-kit`), (b) uses the
 * EventChip + PersonalizationChip custom node modules, (c) installs the chip
 * CSS via the existing `composerChipHtml.ts` constant verbatim, (d) installs
 * the atomic backspace DOM handler via the existing
 * `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` constant verbatim — NOT a Tiptap
 * keymap reimplementation, and (e) exports the imperative API
 * (`commandDOM`, `insertHTML`, `setContentHTML`, `sendAction`, `insertLink`)
 * via a `RichEditorHandle` interface so consumers of `useRef<RichEditorHandle>`
 * compile on both web and native.
 *
 * # Source-grep style
 * Per `mingla-business/jest.config.cjs` (`testEnvironment: "node"`, no
 * jsdom/RTL setup), this test reads the source file as a string and
 * asserts on its contents. Established precedent:
 * `overview-no-revenue.test.ts`. The full Tiptap render-pipeline
 * verification (chip pills visible, ⌘B wires bold, etc.) happens in
 * tester's manual smoke-test on the web preview — source-grep covers
 * the contract; live-fire covers the visual.
 *
 * # Fails-on-revert anchor
 * If a future implementor (a) replaces Tiptap with anything else
 * (textarea, contenteditable div, Slate, Lexical, etc.) or (b) removes
 * the chip CSS injection or (c) removes the backspace handler install,
 * this test fails. The test IS the contract.
 *
 * # Adversarial counterpart
 * `chipBackspace.adversarial.test.ts` covers the atomic-delete invariant
 * from a different angle (handler script content + idempotency flag).
 */

import fs from "node:fs";
import path from "node:path";

const RICH_EDITOR_PATH = path.resolve(__dirname, "..", "richEditor.tsx");
const EVENT_CHIP_PATH = path.resolve(
  __dirname,
  "..",
  "tiptapNodes",
  "EventChip.web.ts",
);
const PERSONALIZATION_CHIP_PATH = path.resolve(
  __dirname,
  "..",
  "tiptapNodes",
  "PersonalizationChip.web.ts",
);
const NATIVE_PATH = path.resolve(__dirname, "..", "richEditor.native.ts");

describe("ORCH-0891 M1 — richEditor.tsx Tiptap rewrite (happy-path)", () => {
  let webSource: string;
  let eventChipSource: string;
  let personalizationChipSource: string;
  let nativeSource: string;

  beforeAll(() => {
    webSource = fs.readFileSync(RICH_EDITOR_PATH, "utf8");
    eventChipSource = fs.readFileSync(EVENT_CHIP_PATH, "utf8");
    personalizationChipSource = fs.readFileSync(PERSONALIZATION_CHIP_PATH, "utf8");
    nativeSource = fs.readFileSync(NATIVE_PATH, "utf8");
  });

  describe("(T-M1-01) Tiptap is the editor framework on web", () => {
    it("imports @tiptap/react and @tiptap/starter-kit", () => {
      expect(webSource).toMatch(/from\s+["']@tiptap\/react["']/);
      expect(webSource).toMatch(/from\s+["']@tiptap\/starter-kit["']/);
    });

    it("uses the useEditor hook + EditorContent component", () => {
      expect(webSource.includes("useEditor")).toBe(true);
      expect(webSource.includes("EditorContent")).toBe(true);
    });

    it("registers EventChip and PersonalizationChip extensions", () => {
      expect(webSource).toMatch(/extensions:\s*\[[\s\S]*?EventChip/);
      expect(webSource).toMatch(/extensions:\s*\[[\s\S]*?PersonalizationChip/);
    });
  });

  describe("(T-M1-02) Chip CSS is injected from composerChipHtml.ts verbatim", () => {
    it("imports COMPOSER_CHIP_CSS from composerChipHtml", () => {
      expect(webSource).toMatch(/COMPOSER_CHIP_CSS/);
      expect(webSource).toMatch(/from\s+["']\.\/composerChipHtml["']/);
    });

    it("injects the CSS via a <style> tag (not as inline RN styles)", () => {
      // The injection MUST be via a DOM <style> tag so the existing CSS
      // string applies unmodified. Inline RN styles would break the
      // chip pixel-parity contract.
      expect(webSource).toMatch(/createElement\(["']style["']\)/);
    });
  });

  describe("(T-M1-03) Atomic backspace via DOM handler — NOT Tiptap keymap", () => {
    it("imports COMPOSER_CHIP_BACKSPACE_HANDLER_JS from composerChipHtml", () => {
      expect(webSource).toMatch(/COMPOSER_CHIP_BACKSPACE_HANDLER_JS/);
    });

    it("installs the handler via a DOM <script> tag", () => {
      // The DOM <script> + textContent pattern is the canonical way to
      // run the verbatim handler. ANY other pattern (e.g., eval,
      // Function(), Tiptap keymap) is forbidden by
      // I-CHIP-BACKSPACE-VIA-DOM-HANDLER.
      expect(webSource).toMatch(/createElement\(["']script["']\)/);
      expect(webSource).toMatch(/textContent\s*=\s*COMPOSER_CHIP_BACKSPACE_HANDLER_JS/);
    });

    it("does NOT declare a Backspace keymap in Tiptap chip nodes", () => {
      // Asserted on the chip node source files. Tiptap's addKeyboardShortcuts
      // method with a "Backspace" key would shadow the DOM handler.
      expect(eventChipSource).not.toMatch(/addKeyboardShortcuts[\s\S]*?["']Backspace["']/);
      expect(personalizationChipSource).not.toMatch(/addKeyboardShortcuts[\s\S]*?["']Backspace["']/);
    });
  });

  describe("(T-M1-04) Imperative API surface matches native pell", () => {
    it("exports RichEditorHandle interface from web", () => {
      expect(webSource).toMatch(/export\s+interface\s+RichEditorHandle/);
    });

    it("exports RichEditorHandle interface from native (structural parity)", () => {
      expect(nativeSource).toMatch(/export\s+interface\s+RichEditorHandle/);
    });

    it("imperative handle exposes all 5 pell methods", () => {
      // Each method must appear inside useImperativeHandle's handle object.
      // We check for the method name in the same file as the imperative
      // handle setup.
      expect(webSource).toMatch(/commandDOM:/);
      expect(webSource).toMatch(/insertHTML:/);
      expect(webSource).toMatch(/setContentHTML:/);
      expect(webSource).toMatch(/sendAction:/);
      expect(webSource).toMatch(/insertLink:/);
    });
  });

  describe("(T-M1-05) Chip DOM contract — class names match composerChipHtml", () => {
    it("EventChip renders class 'mingla-event-chip' + glyph 'mingla-chip-glyph'", () => {
      expect(eventChipSource).toMatch(/class:\s*["']mingla-event-chip["']/);
      expect(eventChipSource).toMatch(/class:\s*["']mingla-chip-glyph["']/);
    });

    it("EventChip emits ▣ glyph (matches composerChipHtml.eventChipHtml)", () => {
      expect(eventChipSource.includes("▣")).toBe(true);
    });

    it("PersonalizationChip renders class 'mingla-personalization-chip'", () => {
      expect(personalizationChipSource).toMatch(/class:\s*["']mingla-personalization-chip["']/);
    });

    it("both chips set contenteditable='false' for atomic semantics", () => {
      expect(eventChipSource).toMatch(/contenteditable:\s*["']false["']/);
      expect(personalizationChipSource).toMatch(/contenteditable:\s*["']false["']/);
    });
  });

  describe("(T-M1-06) Tiptap nodes use atom: true (required for atomic delete)", () => {
    it("EventChip is atomic", () => {
      expect(eventChipSource).toMatch(/atom:\s*true/);
    });

    it("PersonalizationChip is atomic", () => {
      expect(personalizationChipSource).toMatch(/atom:\s*true/);
    });
  });

  describe("(T-M1-07) Backwards-compat: pell stub copy is gone", () => {
    it("richEditor.tsx no longer contains the 'Available on iOS and Android' placeholder", () => {
      // The ORCH-0886 placeholder explicitly said "Available on iOS and
      // Android. The web preview shows this placeholder...". If this
      // string is still in the file, the Tiptap rewrite did not happen.
      expect(webSource.includes("Available on iOS and Android")).toBe(false);
    });

    it("richEditor.tsx does NOT use a plain <TextInput multiline> as the editor body", () => {
      // The ORCH-0889 Wave-1 textarea fallback is removed. Tiptap's
      // EditorContent replaces it. Confirm no `<TextInput multiline>`
      // pattern remains in the file.
      expect(webSource).not.toMatch(/<TextInput[\s\S]*?multiline/);
    });
  });
});
