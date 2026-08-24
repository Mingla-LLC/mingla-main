/**
 * #2520 adversarial regression — attacks the reflow from angles the
 * implementor's happy-path suite does not touch.
 *
 * The happy-path file proves paragraphs appear. This file proves the reflow
 * cannot CORRUPT anything on the way: block-level event cards must never be
 * nested inside a `<p>` (invalid HTML that real mail clients unwrap or drop),
 * an already-structured body must pass through untouched, and the pass must
 * be idempotent so a re-render never doubles the markup.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  eventBlockIsStandalone,
  reflowParagraphs,
  renderMarketingEmail,
} from "./marketingEmailRender.ts";

const EVENT_ID = "3014ea7e-f3e0-40d0-b112-a51f4e37e964";
const base = {
  variables: {} as never,
  unsubscribe_url: "https://usemingla.com/u/tok",
  subject: "S",
  brand_name: "B",
};
const event = {
  id: EVENT_ID,
  title: "We Go Again Exhibition",
  date_label: "29 Aug",
  url: "https://usemingla.com/e/x",
  // Required by EmbeddedEvent — the full card reads `.length` after a
  // `!== null` guard, so `undefined` would throw. Kept explicit so this
  // fixture stays honest about the type contract.
  cover_image_url: null,
};

Deno.test("adversarial: a block-level event card is never wrapped in <p>", () => {
  const out = renderMarketingEmail({
    ...base,
    embedded_events: [event as never],
    body_html: `Come along.\n\n{{event:${EVENT_ID}}}\n\nSee you there.`,
  });
  // A <table> inside <p> is invalid; assert the card is not opened inside one.
  assertEquals(
    /<p style="margin:0 0 16px[^"]*">\s*<table/.test(out.html),
    false,
  );
  assertStringIncludes(out.html, "<table");
});

Deno.test("adversarial: a compact chip STAYS inline in its sentence", () => {
  // Regression against over-correcting: compact chips are inline <a> pills.
  // Hoisting them out of their paragraph would break the sentence around them.
  assertEquals(eventBlockIsStandalone(`{{event:${EVENT_ID}|compact}}`), false);
  assertEquals(eventBlockIsStandalone(`{{event:${EVENT_ID}|medium}}`), true);
  assertEquals(eventBlockIsStandalone(`{{event:${EVENT_ID}}}`), true);
  assertEquals(eventBlockIsStandalone(`text {{event:${EVENT_ID}}}`), false);
});

Deno.test("adversarial: an already-structured body passes through untouched", () => {
  const structured =
    "<p>Already structured.</p><table><tr><td>x</td></tr></table>";
  assertEquals(
    reflowParagraphs(structured, eventBlockIsStandalone),
    structured,
  );
});

Deno.test("adversarial: reflow is idempotent", () => {
  const once = reflowParagraphs("A.\n\nB.", eventBlockIsStandalone);
  const twice = reflowParagraphs(once, eventBlockIsStandalone);
  assertEquals(twice, once);
});

Deno.test("adversarial: CRLF and ragged blank lines collapse to one break each", () => {
  const out = reflowParagraphs(
    "A.\r\n\r\nB.\n\n\n\nC.",
    eventBlockIsStandalone,
  );
  assertEquals(out.split("<p ").length - 1, 3);
  assertEquals(out.includes("\r"), false);
  // No empty paragraph from the 4-newline run.
  assertEquals(/<p [^>]*><\/p>/.test(out), false);
});

Deno.test("adversarial: an empty or whitespace-only body yields no paragraphs", () => {
  assertEquals(reflowParagraphs("", eventBlockIsStandalone), "");
  assertEquals(reflowParagraphs("   \n\n  \n ", eventBlockIsStandalone), "");
});

Deno.test("adversarial: reflow does not escape or mangle existing inline markup", () => {
  const out = reflowParagraphs(
    'Hi <strong>there</strong>.\n\n<a href="https://x.test/a">Go</a>',
    eventBlockIsStandalone,
  );
  assertStringIncludes(out, "<strong>there</strong>");
  assertStringIncludes(out, '<a href="https://x.test/a">Go</a>');
  // The anchor is prose, so it IS wrapped — but not nested inside itself.
  assertEquals(out.includes('href="<a'), false);
});

Deno.test("adversarial: every authored paragraph survives — none dropped", () => {
  const body = Array.from({ length: 17 }, (_, i) => `Para ${i + 1}.`).join(
    "\n\n",
  );
  const out = renderMarketingEmail({
    ...base,
    embedded_events: [],
    body_html: body,
  });
  for (let i = 1; i <= 17; i++) {
    assertStringIncludes(out.html, `>Para ${i}.</p>`);
  }
  assert(out.text.includes("Para 1.") && out.text.includes("Para 17."));
});
