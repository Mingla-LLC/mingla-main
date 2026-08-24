/**
 * #2518 adversarial regression — link display text.
 *
 * # Adversarial angle
 * The happy path for #2518 is "the prompt has a second field". THIS file
 * attacks the two ways the fix silently reverts to shipping bare URLs:
 *
 *   1. ARGUMENT ORDER. `RichEditorHandle.insertLink` is `(text, url)` on BOTH
 *      platforms (richEditor.tsx / richEditor.native.ts). The pre-fix call was
 *      `insertLink(url, url)` — correct href, but the anchor text was always
 *      the raw URL because there was no text to pass. Swapping the arguments
 *      produces a link whose href is the LABEL: broken, and invisible to a
 *      test that only greps for "insertLink(".
 *   2. STATE RESET. If the display-text field is not cleared when the prompt
 *      reopens, the next link silently inherits the previous link's words.
 */
import { readFileSync } from "fs";
import { join } from "path";

const DIR = join(__dirname, "..");
const EDITOR_RAW = readFileSync(join(DIR, "ComposerV2Editor.tsx"), "utf8");

/**
 * Strip comments before asserting a dead form is absent. This file DOCUMENTS
 * the pre-#2518 call `insertLink(url, url)` in prose, and a naive
 * `not.toContain` over the raw source matches that prose and fails on a
 * correct implementation. Same trap recorded in
 * `reference_audit_regex_matches_comments_same_file`.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const EDITOR = codeOnly(EDITOR_RAW);
const WEB_SHIM = readFileSync(join(DIR, "richEditor.tsx"), "utf8");
const NATIVE_SHIM = readFileSync(join(DIR, "richEditor.native.ts"), "utf8");

describe("#2518 link display text", () => {
  it("passes (text, url) — never (url, text)", () => {
    expect(EDITOR).toContain(
      "insertLink(label.length > 0 ? label : url, url)",
    );
    // The dead form must stay dead.
    expect(EDITOR).not.toContain("insertLink(url, url)");
    expect(EDITOR).not.toContain("insertLink(url, label");
  });

  it("both shims still declare the (text, url) contract this relies on", () => {
    expect(WEB_SHIM).toContain("insertLink: (text: string, url: string)");
    expect(NATIVE_SHIM).toContain("insertLink: (text: string, url: string)");
  });

  it("falls back to the URL when the operator leaves the text blank", () => {
    // Pre-#2518 behaviour is preserved for anyone who ignores the new field.
    expect(EDITOR).toContain("label.length > 0 ? label : url");
    expect(WEB_SHIM).toContain("const safeText = text.length > 0 ? text : url;");
  });

  it("clears the display text when the prompt reopens", () => {
    const opener = EDITOR.slice(
      EDITOR.indexOf("const handleToggleLinkLocal"),
      EDITOR.indexOf("const handleLinkPromptCancel"),
    );
    expect(opener).toContain('setLinkPromptValue("")');
    expect(opener).toContain('setLinkPromptText("")');
  });

  it("renders a labelled, testable second input", () => {
    expect(EDITOR).toContain('testID="composer-v2-link-prompt-text-input"');
    expect(EDITOR).toContain('accessibilityLabel="Link text shown to the reader"');
  });

  it("trims the label so whitespace does not become the anchor text", () => {
    expect(EDITOR).toContain("const label = linkPromptText.trim();");
  });
});
