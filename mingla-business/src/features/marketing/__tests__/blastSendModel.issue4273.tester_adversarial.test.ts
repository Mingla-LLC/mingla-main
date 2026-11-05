// #4273 tester adversarial — attacks the pre-fill with the inputs a real email
// holds: GSM extended characters, emoji with no spaces, named and numeric HTML
// entities, and hand-typed text that holds no token at all. The implementor's
// suite proves the plain-ASCII promise; this one proves it against the real
// segment calculator and the real token list.
//
// MINGLA-INVARIANT: I-4273-PREFILL-ONE-SEGMENT-ANY-TEXT | issue #4273 | Auto-filled SMS measures one segment by the same calculator the send path uses, whatever characters the email holds.
import { readFileSync } from "fs";
import path from "path";
import {
  emailBodyToPlainText,
  prefillPushFromEmail,
  prefillSmsFromEmail,
  pushTitleFromSubject,
  stripUnsupportedTokens,
  PUSH_PREFILL_MAX,
} from "../blastSendModel";
import { computeSegments, isGsm7, sanitizeGsm7, wireBody } from "../../../utils/smsCost";

const measure = { isGsm7, sanitizeGsm7 };
const hasLoneSurrogate = (text: string): boolean =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

describe("#4273 adversarial: SMS pre-fill is one segment by the real calculator", () => {
  const cases: Array<[string, string]> = [
    ["plain ascii", "Live band from 8pm. ".repeat(30)],
    ["euro signs (2 septets each)", "Tickets €5 at the door, €10 late. ".repeat(12)],
    ["square brackets (2 septets each)", "[VIP] [Table] [Door] [Bar] ".repeat(15)],
    ["pipes and tildes (2 septets each)", "A|B~C^D ".repeat(40)],
    ["curly quotes folded by the sanitizer", "It’s “the” night — come… ".repeat(12)],
    ["emoji", "Party 🎉 tonight 🎶 ".repeat(12)],
    ["naira", "Entry ₦5000 only. ".repeat(14)],
    ["accented", "Café crème à côté. ".repeat(14)],
  ];
  it.each(cases)("%s", (_name, words) => {
    const text = prefillSmsFromEmail(
      { subject: "Harmattan", bodyHtml: `<p>${words}</p>`, brandName: "Club" },
      measure,
    );
    expect(text.length).toBeGreaterThan(0);
    expect(computeSegments(wireBody(text))).toBe(1);
  });
});

describe("#4273 adversarial: the carrier's count, not the string length", () => {
  // GSM 03.38: each of ^ { } \\ [ ] ~ | € costs two septets. Measured here on
  // its own, separately from computeSegments, as a second opinion on the count.
  const septets = (text: string): number =>
    [...text].reduce((sum, ch) => sum + ("^{}\\[]~|€".includes(ch) ? 2 : 1), 0);
  it("auto-filled text with the footer fits 160 septets", () => {
    const text = prefillSmsFromEmail(
      { subject: "", bodyHtml: `<p>${"Tickets €5 [VIP] €10 ".repeat(12)}</p>`, brandName: "Club" },
      measure,
    );
    expect(septets(wireBody(text))).toBeLessThanOrEqual(160);
    expect(computeSegments(wireBody(text))).toBe(1);
  });
});

describe("#4273 adversarial: truncation never leaves half a character", () => {
  const emoji = "🎉".repeat(200);
  it("SMS", () => {
    const text = prefillSmsFromEmail({ subject: "", bodyHtml: emoji, brandName: null }, measure);
    expect(hasLoneSurrogate(text)).toBe(false);
  });
  it("push body", () => {
    // Odd offset so the 117-unit cut lands inside a pair.
    const text = prefillPushFromEmail({ bodyHtml: emoji, brandName: null });
    expect(text.length).toBeLessThanOrEqual(PUSH_PREFILL_MAX);
    expect(hasLoneSurrogate(text)).toBe(false);
  });
  it("push title", () => {
    expect(hasLoneSurrogate(pushTitleFromSubject(emoji, null))).toBe(false);
  });
});

describe("#4273 adversarial: no raw markup reaches a person", () => {
  it.each([
    ["&rsquo;", "it&rsquo;s on"],
    ["&#8217;", "it&#8217;s on"],
    ["&#x2019;", "it&#x2019;s on"],
    ["&mdash;", "doors &mdash; 9pm"],
    ["&eacute;", "caf&eacute;"],
    ["&hellip;", "soon&hellip;"],
    ["&copy;", "&copy; Mingla"],
  ])("entity %s is not left as text", (_entity, html) => {
    expect(emailBodyToPlainText(`<p>${html}</p>`)).not.toMatch(/&#?[a-z0-9]+;/i);
  });

  it("every token the composer can insert is removed", () => {
    const bridge = readFileSync(
      path.resolve(__dirname, "../../../services/marketing/tenTapTokenBridge.ts"),
      "utf8",
    );
    const list = bridge.slice(bridge.indexOf("PERSONALIZATION_TOKENS:"), bridge.indexOf("as const"));
    const tokens = [...list.matchAll(/^\s*"([a-z_]+)",$/gm)].map((match) => match[1]);
    expect(tokens.length).toBeGreaterThanOrEqual(11);
    for (const token of tokens) {
      const out = stripUnsupportedTokens(`Hello {${token}} there`, "Club");
      expect(out).not.toContain(`{${token}}`);
    }
  });

  it("a body of nothing but markup and tokens fills nothing", () => {
    const html = "<p><br></p><p>&nbsp;</p><p>{first_name}</p>{{event:abc}}";
    expect(prefillPushFromEmail({ bodyHtml: html, brandName: null })).toBe("");
    expect(prefillSmsFromEmail({ subject: "", bodyHtml: html, brandName: null }, measure)).toBe("");
  });
});

describe("#4273 adversarial: words the host typed are not rewritten at save", () => {
  it.each([
    ["an emoticon", "See you there :)"],
    ["a leading dash list", "- Doors at 9"],
    ["a leading ellipsis", "...and we are back"],
    ["a leading exclamation", "!!! Tonight"],
  ])("%s", (_name, typed) => {
    expect(stripUnsupportedTokens(typed, "Club")).toBe(typed);
  });

  it("line breaks a host typed survive", () => {
    const typed = "Doors at 9\n\nBar at 10";
    expect(stripUnsupportedTokens(typed, "Club")).toBe(typed);
  });

  it("a brand name is written in literally", () => {
    expect(stripUnsupportedTokens("From {brand_name}", "A$&B")).toBe("From A$&B");
  });
});
