/**
 * #2521 adversarial regression — the editor round-trip must not corrupt a link.
 *
 * # What actually happened
 * On 2026-08-24 a draft was written with a clean anchor at 15:22 and verified.
 * At 15:25:59 the composer autosaved and the stored body became:
 *
 *   <a href="<a href="https://…54dQ7kQrV7jwk45N">Get">https://…">Get</a> …</a>
 *
 * The anchor had been substituted into its own `href`. The campaign was one
 * tap from sending that to 23 people.
 *
 * # Adversarial angle
 * The happy-path file for #2521 proves the PREVIEW draws markup. This file
 * attacks the SAVE path — the half that damaged real data. It pins the
 * property the corruption violated: parse → serialise → tokenise must return
 * the input unchanged, and must stay unchanged across repeated saves. A draft
 * that is opened twice must not decay.
 *
 * # Honest scope note
 * The original corruption could not be reproduced once #2517 landed (the
 * empty-editor race, the suspected enabler: the editor held an EMPTY document
 * while the parent held the anchor, so an insert landed at a desynced
 * position). This test does not prove #2517 was the cause. It proves the
 * round-trip itself is lossless, so if corruption returns, it is not here.
 */
import {
  bodyHtmlToTenTapDoc,
  docToHtml,
  htmlToTokenString,
} from "../tenTapTokenBridge";

const save = (body: string): string =>
  htmlToTokenString(docToHtml(bodyHtmlToTenTapDoc(body)));

const BODIES: Array<[string, string]> = [
  ["a bare anchor", '<a href="https://example.test/t">Get your free ticket</a>'],
  [
    "the real We Go Again shape",
    'COME EXPERIENCE THE EXHIBITION\n\n<a href="https://example.test/t">Get your free ticket</a>\n\nDIDI Museum',
  ],
  ["bold inside prose", "Hi <strong>there</strong>."],
  ["italic inside prose", "Hi <em>there</em>."],
  ["plain text", "Just words, no markup at all."],
  ["multiple links", '<a href="https://a.test">One</a> and <a href="https://b.test">Two</a>'],
];

describe("#2521 a save must not change the body", () => {
  it.each(BODIES)("%s survives one save", (_label, body) => {
    expect(save(body)).toBe(body);
  });

  it.each(BODIES)("%s survives five saves — a draft must not decay", (_label, body) => {
    let current = body;
    for (let i = 0; i < 5; i++) current = save(current);
    expect(current).toBe(body);
  });
});

describe("#2521 the specific corruption signature stays dead", () => {
  it("never nests an anchor inside its own href", () => {
    const body = '<a href="https://example.test/t">Get your free ticket</a>';
    let current = body;
    for (let i = 0; i < 5; i++) {
      current = save(current);
      expect(current).not.toContain('href="<a');
      expect(current).not.toMatch(/<a[^>]*<a/);
    }
  });

  it("keeps exactly one opening and one closing tag per link", () => {
    const saved = save('<a href="https://example.test/t">Ticket</a>');
    expect(saved.split("<a ").length - 1).toBe(1);
    expect(saved.split("</a>").length - 1).toBe(1);
  });
});
