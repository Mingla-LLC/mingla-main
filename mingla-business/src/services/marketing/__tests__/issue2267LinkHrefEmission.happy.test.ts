/**
 * issue #2267 — the link href is escaped where it is emitted, and only
 * http/https/mailto survive the parse.
 *
 * WHAT THIS PINS. `tenTapTokenBridge` is an allow-list re-serializer: node text
 * goes through `escapeHtmlText`, the two chip `<span>` shapes carry only
 * enum- and hex-constrained attributes, and the `<a>` href was the single value
 * interpolated into an attribute without escaping. These tests pin (a) that the
 * attribute the emitter opens is the attribute it closes, (b) that a link mark
 * only ever carries a scheme `normalizeUrl` (ComposerV2Editor.tsx:102-107) can
 * produce, and (c) that neither change moved an existing legitimate href —
 * including one with a query string — in meaning.
 *
 * The two emit paths are deliberately NOT symmetric, and (c) is what proves the
 * asymmetry is correct rather than an oversight:
 *
 *   toBodyHtml → the STORED token string. Its reader, `bodyHtmlToTenTapDoc`,
 *     does no entity decoding, so only `"` is escaped; escaping `&` there would
 *     grow one `amp;` per save and break the byte-identical V1 round trip
 *     (I-PROPOSED-MKT-COMPOSER-V2-TOKEN-ROUNDTRIP-LOSSLESS).
 *   docToHtml → the editor's HTML. Its reader, `htmlToTokenString`, decodes
 *     `&amp;`/`&lt;`/`&gt;`/`&quot;`, so full attribute escaping applies and
 *     decodes back to exactly the same URL.
 */

import {
  bodyHtmlToTenTapDoc,
  docToHtml,
  htmlToTokenString,
  toBodyHtml,
  type TenTapDocument,
} from "../tenTapTokenBridge";

/** Build a one-paragraph doc whose single text node carries a link mark. */
const linkDoc = (href: string, label = "link"): TenTapDocument => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }],
    },
  ],
});

/** Every href a link mark ended up carrying after parsing `input`. */
const parsedHrefs = (input: string): string[] => {
  const out: string[] = [];
  for (const block of bodyHtmlToTenTapDoc(input).content) {
    for (const node of block.content ?? []) {
      for (const mark of node.type === "hardBreak" ? [] : (node.marks ?? [])) {
        if (mark.type === "link") out.push(mark.attrs.href);
      }
    }
  }
  return out;
};

describe("issue #2267 — href escaping on emit", () => {
  it("a single-quoted href carrying a double quote cannot break out of the attribute it is emitted into", () => {
    // The single-quoted branch of the parse regex excludes only `'`, so a `"`
    // reaches the mark. Both emitters must render it as an entity, leaving the
    // opening quote and the closing quote as the only two `"` in the tag.
    const parsed = bodyHtmlToTenTapDoc(`<a href='https://x.com/a"b'>link</a>`);
    expect(parsedHrefs(`<a href='https://x.com/a"b'>link</a>`)).toEqual(['https://x.com/a"b']);

    const tokenString = toBodyHtml(parsed);
    expect(tokenString).toBe('<a href="https://x.com/a&quot;b">link</a>');

    const editorHtml = docToHtml(parsed);
    expect(editorHtml).toBe('<a href="https://x.com/a&quot;b">link</a>');

    // The structural property, stated independently of the exact escape: the
    // opening tag holds exactly two double quotes — the attribute delimiters.
    for (const emitted of [tokenString, editorHtml]) {
      const openTag = emitted.slice(0, emitted.indexOf(">") + 1);
      expect(openTag.split('"').length - 1).toBe(2);
    }
  });

  it("escapes `<` and `>` in the href on the editor-bound emitter", () => {
    const html = docToHtml(linkDoc("https://x.com/<p>"));
    expect(html).toBe('<a href="https://x.com/&lt;p&gt;">link</a>');
    expect(html.indexOf("<", 1)).toBe(html.indexOf("</a>"));
  });

  it("emits an ordinary href byte-identically on both paths", () => {
    const doc = linkDoc("https://example.com/x");
    expect(toBodyHtml(doc)).toBe('<a href="https://example.com/x">link</a>');
    expect(docToHtml(doc)).toBe('<a href="https://example.com/x">link</a>');
  });
});

describe("issue #2267 — scheme allow-list at parse time", () => {
  it.each([
    ["https", '<a href="https://example.com/x">link</a>', "https://example.com/x"],
    ["http", '<a href="http://example.com/x">link</a>', "http://example.com/x"],
    ["mailto", '<a href="mailto:hi@example.com">link</a>', "mailto:hi@example.com"],
  ])("keeps a %s link — exactly what normalizeUrl produces", (_label, input, href) => {
    expect(parsedHrefs(input)).toEqual([href]);
  });

  it.each([
    ["javascript", "<a href=\"javascript:doThing()\">x</a>"],
    ["data", '<a href="data:text/plain,hello">x</a>'],
    ["vbscript", '<a href="vbscript:msgbox">x</a>'],
    ["file", '<a href="file:///some/path">x</a>'],
    ["scheme-relative", '<a href="//example.com/x">x</a>'],
    ["path-relative", '<a href="/settings">x</a>'],
    ["fragment", '<a href="#anchor">x</a>'],
    ["leading whitespace + control chars", '<a href=" \tjava\nscript:doThing()">x</a>'],
    ["uppercased", '<a href="JAVASCRIPT:doThing()">x</a>'],
    ["single-quoted", "<a href='javascript:doThing()'>x</a>"],
  ])("does not let a %s href become a link mark", (_label, input) => {
    expect(parsedHrefs(input)).toEqual([]);
  });

  it.each([
    '<a href="data:text/plain,x">click</a>',
    "<a href='javascript:doThing()'>click</a>",
  ])("keeps a rejected link's text and drops only its markup: %s", (input) => {
    // NOT the general "unknown HTML becomes literal text" rule, deliberately.
    // The matching `</a>` is recognised unconditionally, so keeping the opening
    // tag as text would leave an UNCLOSED anchor in the stored token string —
    // a worse artefact than the tag that was declined. Both emitters therefore
    // produce the link's words and nothing else, on both paths.
    const doc = bodyHtmlToTenTapDoc(input);
    expect(docToHtml(doc)).toBe("click");
    expect(toBodyHtml(doc)).toBe("click");
  });

  it("a rejected link does not disturb the marks around it", () => {
    const doc = bodyHtmlToTenTapDoc('<strong>bold <a href="data:x">y</a> tail</strong>');
    expect(toBodyHtml(doc)).toBe("<strong>bold y tail</strong>");
  });
});

describe("issue #2267 — existing legitimate hrefs still round-trip in meaning", () => {
  const LEGIT = [
    "https://example.com/x",
    "http://example.com/x",
    "mailto:hi@example.com",
    "https://usemingla.com/e/brand/event?utm_source=email&utm_campaign=launch&a=1",
    "https://example.com/path%20with%20space",
    "https://example.com/?q=a+b&r=c%26d",
  ];

  it.each(LEGIT)("token string round-trips %s byte-identically", (href) => {
    const input = `<a href="${href}">Get tickets</a>`;
    // Parse → emit → parse → emit: stable, and stable at the FIRST emit, which
    // is what "byte-identical" means for the V1 contract.
    const once = toBodyHtml(bodyHtmlToTenTapDoc(input));
    const twice = toBodyHtml(bodyHtmlToTenTapDoc(once));
    expect(once).toBe(input);
    expect(twice).toBe(input);
  });

  it.each(LEGIT)("editor HTML round-trips %s back to the same URL", (href) => {
    const doc = linkDoc(href, "Get tickets");
    const html = docToHtml(doc);
    // `&` becomes `&amp;` — correct HTML for an attribute — and the inverse
    // decodes it straight back, so the URL that comes out is the URL that
    // went in.
    expect(htmlToTokenString(html)).toBe(`<a href="${href}">Get tickets</a>`);
  });

  it("a query-string `&` emits as `&amp;` on the editor path and as a bare `&` on the stored path", () => {
    const href = "https://usemingla.com/e/b/e?a=1&b=2";
    expect(docToHtml(linkDoc(href))).toBe(
      '<a href="https://usemingla.com/e/b/e?a=1&amp;b=2">link</a>',
    );
    expect(toBodyHtml(linkDoc(href))).toBe(
      '<a href="https://usemingla.com/e/b/e?a=1&b=2">link</a>',
    );
  });

  it("repeated saves do not accumulate entities in a query-string href", () => {
    // The reason the stored-string emitter escapes `"` only. Five cycles of
    // "open the draft, save it" must leave the href exactly as authored.
    let s = '<a href="https://usemingla.com/e/b/e?a=1&b=2">Get tickets</a>';
    for (let i = 0; i < 5; i++) s = toBodyHtml(bodyHtmlToTenTapDoc(s));
    expect(s).toBe('<a href="https://usemingla.com/e/b/e?a=1&b=2">Get tickets</a>');
  });

  it("the composer's own insertLink output survives unchanged", () => {
    // normalizeUrl prepends https:// to a schemeless entry, so this is the
    // exact shape the product creates.
    const input = "Come through: <a href=\"https://usemingla.com/e/brand/event\">tickets</a>.";
    expect(toBodyHtml(bodyHtmlToTenTapDoc(input))).toBe(input);
  });
});
