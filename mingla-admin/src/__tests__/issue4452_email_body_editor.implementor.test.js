// #4452 §5.7 (T-5.7, SC-80): the Email composer's body editor is extracted to
// components/email/EmailBodyEditor.jsx and shared, not forked.
//   E-1 Communications › Email renders <EmailBodyEditor> with today's TOKENS and
//       its own empty document; the composer no longer holds a block editor.
//   E-2 the editor draws the composer's format bar, blocks and body token menu
//       from the tokens it is given (the forms step passes formTokens).
//   E-3 the document operations are the composer's: update, remove (never an
//       empty document), divider (+ a text block after it), add text, and
//       flush (the focused block's live HTML), so the same edits give the same
//       document JSON the senders render.
//   E-4 only https:// and mailto: links are accepted.
//
// FAILS-ON-REVERT: a second block editor in EmailComposer (a fork) fails E-1;
// dropping the divider's trailing text block or letting remove empty the
// document fails E-3.
//
// Run: node --test src/__tests__/issue4452_email_body_editor.implementor.test.js (from mingla-admin).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHarness, readSrc } from "./support/issue4452Harness.js";
import { appendDivider, appendText, flushActive, removeBlock, safeLinkHref, updateBlock } from "../lib/emailDocument.js";

let h;
before(async () => {
  h = await buildHarness(`
import { renderToStaticMarkup } from "react-dom/server";
import { EmailBodyEditor } from "../../components/email/EmailBodyEditor.jsx";
export const editor = (props) => renderToStaticMarkup(<EmailBodyEditor onChange={() => {}} {...props} />);
`, { name: "issue4452-body-editor", stubs: { "context/ToastContext": "export const useToast = () => ({ addToast() {} });" } });
});

const DOC = [
  { id: "a", type: "rich_text", html: "<p>Hi {first_name}</p>" },
  { id: "d", type: "divider" },
  { id: "b", type: "rich_text", html: "<p>Bye</p>" },
];

describe("#4452 E-1 the composer uses the shared editor", () => {
  const composer = readSrc("components/email/EmailComposer.jsx");
  it("renders EmailBodyEditor with TOKENS and its own empty document", () => {
    assert.match(composer, /<EmailBodyEditor\s+ref=\{bodyEditorRef\}\s+value=\{documentValue\}\s+onChange=\{setDocumentValue\}\s+tokens=\{TOKENS\}/);
    assert.match(composer, /emptyDocument=\{defaultDocument\}/);
    assert.match(composer, /bodyEditorRef\.current\?\.flush\(documentValue\)/, "review reads the focused block's live HTML");
  });
  it("holds no block editor of its own (no fork)", () => {
    assert.doesNotMatch(composer, /<EditableRichBlock/);
    assert.doesNotMatch(composer, /document\.execCommand/);
    assert.doesNotMatch(composer, /title="Add divider"/);
  });
  it("keeps today's tokens, byte for byte", () => {
    const tokens = composer.slice(composer.indexOf("const TOKENS = ["), composer.indexOf("];", composer.indexOf("const TOKENS = [")) + 2);
    assert.equal(tokens, `const TOKENS = [
  { value: "{first_name}", label: "First name", example: "Maya" },
  { value: "{display_name}", label: "Display name", example: "Maya Okafor" },
  { value: "{username}", label: "Username", example: "mayaexplores" },
  { value: "{country}", label: "Country", example: "Nigeria" },
  { value: "{language}", label: "Language", example: "English" },
  { value: "{joined_date}", label: "Joined date", example: "15 Jan 2026" },
];`);
  });
});

describe("#4452 E-2 the editor", () => {
  const FORM_TOKENS = [{ value: "{first_name}", label: "First name" }, { value: "{answers.city}", label: "Your city" }];
  it("draws the format bar, every block and the given tokens", () => {
    const html = h.editor({ value: DOC, tokens: FORM_TOKENS });
    for (const t of ["Heading", "Paragraph", "Bold", "Italic", "Underline", "Link", "Bullet list", "Numbered list"]) assert.match(html, new RegExp(`aria-label="${t}"`), t);
    assert.match(html, /title="Add divider"/);
    assert.equal((html.match(/contentEditable="true"|contenteditable="true"/gi) || []).length, 2, "two text blocks");
    assert.match(html, /<hr/);
    assert.match(html, />Your city</);
    assert.doesNotMatch(html, />Display name</, "the composer's tokens are not baked in");
  });
  it("offers Image, GIF and Blog post only when the host handles them", () => {
    const bare = h.editor({ value: DOC, tokens: FORM_TOKENS });
    assert.doesNotMatch(bare, /title="Add image"|title="Add GIF"|title="Add blog post"/);
    const full = h.editor({ value: DOC, tokens: FORM_TOKENS, imageUpload: () => {}, onPickBlogPost: () => {} });
    assert.match(full, /title="Add image"/);
    assert.match(full, /title="Add GIF"/);
    assert.match(full, /title="Add blog post"/);
  });
});

describe("#4452 E-3 the document operations", () => {
  it("update and remove; the last block never leaves an empty document", () => {
    assert.deepEqual(updateBlock(DOC, "b", { html: "<p>x</p>" })[2], { id: "b", type: "rich_text", html: "<p>x</p>" });
    assert.deepEqual(removeBlock(DOC, "d").map((b) => b.id), ["a", "b"]);
    const only = removeBlock([DOC[0]], "a", () => [{ id: "z", type: "rich_text", html: "<p>Hi</p>" }]);
    assert.deepEqual(only, [{ id: "z", type: "rich_text", html: "<p>Hi</p>" }]);
    const fallback = removeBlock([DOC[0]], "a");
    assert.equal(fallback.length, 1);
    assert.equal(fallback[0].type, "rich_text");
  });
  it("a divider is followed by a text block; Add text appends one", () => {
    const next = appendDivider(DOC);
    assert.deepEqual(next.slice(-2).map((b) => b.type), ["divider", "rich_text"]);
    assert.equal(next.at(-1).html, "<p><br></p>");
    assert.deepEqual(appendText(DOC).at(-1).type, "rich_text");
  });
  it("flush writes the focused block's live HTML and nothing else", () => {
    const out = flushActive(DOC, "a", "<p>Hi {first_name}, typed</p>");
    assert.equal(out[0].html, "<p>Hi {first_name}, typed</p>");
    assert.deepEqual(out.slice(1), DOC.slice(1));
    assert.equal(flushActive(DOC, null, "x"), DOC);
  });
});

describe("#4452 E-4 links", () => {
  it("accepts https and mailto only", () => {
    assert.equal(safeLinkHref("https://usemingla.com/x"), "https://usemingla.com/x");
    assert.equal(safeLinkHref("mailto:info@usemingla.com"), "mailto:info@usemingla.com");
    for (const bad of ["http://x.com", "javascript:alert(1)", "mailto:nope", "", "ftp://x"]) assert.equal(safeLinkHref(bad), null, bad);
  });
});
