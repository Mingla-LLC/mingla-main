/**
 * #2520 happy-path regression — paragraph breaks must reach the recipient.
 *
 * Before this fix every marketing email shipped as one unbroken wall of text:
 * the composer stores paragraphs separated by `\n\n`, and the renderer dropped
 * that straight into `<td style="padding:28px;">` where HTML collapses runs of
 * whitespace to a single space. Proven against the 189 emails sent for the
 * `We Go Again` blast on 2026-08-24.
 *
 * FAILS ON REVERT: delete the `reflowParagraphs` call in `renderMarketingEmail`
 * and `renders each paragraph as its own <p>` drops from 3 to 0 matches.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderMarketingEmail } from "./marketingEmailRender.ts";

const base = {
  variables: {} as never,
  embedded_events: [],
  unsubscribe_url: "https://usemingla.com/u/tok",
  subject: "Subject line",
  brand_name: "Test Brand",
};

/** Body paragraphs carry this exact inline style; the unsubscribe footer
 * uses its own (`margin:32px 0 0 0`), so counting on this prefix keeps the
 * footer out of every assertion below. */
const BODY_P = '<p style="margin:0 0 16px 0;';

/**
 * The authored body only — the shell's body cell up to (not including) the
 * unsubscribe footer, which is appended inside the same `<td>` and carries
 * its own paragraph and newlines.
 */
function bodyCell(html: string): string {
  const start = html.indexOf('<td style="padding:28px;">');
  assert(start !== -1, "body cell not found in rendered shell");
  const footer = html.indexOf('<p style="margin:32px 0 0 0;', start);
  const end = footer === -1 ? html.indexOf("</td>", start) : footer;
  return html.slice(start, end);
}

Deno.test("#2520 renders each paragraph as its own <p>", () => {
  const out = renderMarketingEmail({
    ...base,
    body_html: "First para.\n\nSecond para.\n\nThird para.",
  });
  const cell = bodyCell(out.html);
  const paras = cell.split(BODY_P).length - 1;
  assertEquals(paras, 3);
  assertStringIncludes(cell, ">First para.</p>");
  assertStringIncludes(cell, ">Second para.</p>");
  assertStringIncludes(cell, ">Third para.</p>");
});

Deno.test("#2520 leaves no bare newline between paragraphs in the body cell", () => {
  const out = renderMarketingEmail({
    ...base,
    body_html: "Alpha.\n\nBravo.\n\nCharlie.",
  });
  const cell = bodyCell(out.html);
  // The three authored separators are gone; only the shell's own indentation
  // newline (before the body) may remain.
  const between = cell.slice(cell.indexOf(BODY_P));
  assertEquals(between.includes("\n"), false);
});

Deno.test("#2520 a single newline inside a paragraph becomes <br />", () => {
  const out = renderMarketingEmail({
    ...base,
    body_html: "Line one\nLine two\n\nNext para.",
  });
  const cell = bodyCell(out.html);
  assertStringIncludes(cell, "Line one<br />Line two");
  assertEquals(cell.split(BODY_P).length - 1, 2);
});

Deno.test("#2520 links survive the reflow and are still tracked", () => {
  const out = renderMarketingEmail({
    ...base,
    body_html:
      'Come along.\n\n<a href="https://usemingla.com/s/abc">Get your free ticket</a>',
  });
  assertEquals(out.links.length, 1);
  assertEquals(out.links[0]?.destination_url, "https://usemingla.com/s/abc");
  assertStringIncludes(bodyCell(out.html), ">Get your free ticket</a>");
});

Deno.test("#2520 plain-text alternative keeps its paragraph breaks", () => {
  const out = renderMarketingEmail({
    ...base,
    body_html: "First para.\n\nSecond para.",
  });
  assertStringIncludes(out.text, "First para.\n\nSecond para.");
});
