// #4273 rework — pre-fill and the sentences the composer says on the host's behalf.
//
// MINGLA-INVARIANT: I-4273-SAVE-TOUCHES-ONLY-TOKENS | issue #4273 | Saving an SMS or push never changes what the host typed except a raw unsupported token and the space or punctuation it strands.
import { readFileSync } from "fs";
import path from "path";
import {
  blastFallbackSentence,
  emailBodyToPlainText,
  gsmSeptets,
  leadStepsAside,
  prefillPushFromEmail,
  prefillSmsFromEmail,
  pushTitleFromSubject,
  smsReachNote,
  stripUnsupportedTokens,
} from "../blastSendModel";
import { computeSegments, isGsm7, sanitizeGsm7, wireBody } from "../../../utils/smsCost";

const measure = { isGsm7, sanitizeGsm7 };
const hasLoneSurrogate = (text: string): boolean =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

describe("#4273 entities decode to what the author wrote", () => {
  it.each([
    ["it&rsquo;s on", "it\u2019s on"],
    ["it&#8217;s on", "it\u2019s on"],
    ["it&#x2019;s on", "it\u2019s on"],
    ["doors &mdash; 9pm", "doors \u2014 9pm"],
    ["caf&eacute;", "caf\u00E9"],
    ["soon&hellip;", "soon\u2026"],
    ["&euro;5", "\u20AC5"],
    ["&#127881; party", "\u{1F389} party"],
  ])("%s", (html, plain) => {
    expect(emailBodyToPlainText(`<p>${html}</p>`)).toBe(plain);
  });
  it("decodes once, so an escaped entity stays what the author typed", () => {
    expect(emailBodyToPlainText("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
  });
  it("a surrogate code point in an entity cannot produce half a character", () => {
    expect(hasLoneSurrogate(emailBodyToPlainText("a&#xD83C;b"))).toBe(false);
  });
  it("words beside an ampersand are not mistaken for an entity", () => {
    expect(emailBodyToPlainText("R&B; live")).toBe("R live");
    expect(emailBodyToPlainText("R&B live")).toBe("R&B live");
  });
});

describe("#4273 truncation keeps whole characters", () => {
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  const flag = "\u{1F3F3}\uFE0F\u200D\u{1F308}";
  const tone = "\u{1F44D}\u{1F3FD}";
  it.each([["a family", family], ["a flag", flag], ["a skin tone", tone], ["a keycap", "1\uFE0F\u20E3"]])(
    "%s is never cut in the middle",
    (_name, glyph) => {
      for (let pad = 0; pad < 12; pad += 1) {
        const text = prefillPushFromEmail({ bodyHtml: "x".repeat(pad) + glyph.repeat(60), brandName: null });
        const stripped = text.replace(/\.\.\.$/, "").slice(pad);
        expect(stripped.length % glyph.length).toBe(0);
        expect(hasLoneSurrogate(text)).toBe(false);
      }
    },
  );
  it("SMS and title too", () => {
    const text = family.repeat(60);
    expect(hasLoneSurrogate(prefillSmsFromEmail({ subject: "", bodyHtml: text, brandName: null }, measure))).toBe(false);
    expect(hasLoneSurrogate(pushTitleFromSubject(text, null))).toBe(false);
  });
});

describe("#4273 removing a token leaves good punctuation", () => {
  it.each([
    ["See you Friday, {first_name}.", "See you Friday."],
    ["Hello, {first_name}!", "Hello!"],
    ["Hi {first_name}, doors at 9", "Hi, doors at 9"],
    ["Hi, {first_name} welcome", "Hi, welcome"],
    ["{first_name}, welcome", "welcome"],
    ["Hi {first_name}", "Hi"],
    ["{first_name}", ""],
    ["Hi {first_name} {event_name} there", "Hi there"],
    ["Line one {first_name}\nLine two", "Line one\nLine two"],
    ["{{event:abc}} Doors at 9", "Doors at 9"],
  ])("%s", (typed, saved) => {
    expect(stripUnsupportedTokens(typed, "Club")).toBe(saved);
  });
  it("a brand name is literal, whatever it holds", () => {
    for (const brand of ["A$&B", "$1 Club", "$` Bar", "$' Lounge", "Back\\slash"]) {
      expect(stripUnsupportedTokens("From {brand_name}.", brand)).toBe(`From ${brand}.`);
    }
    expect(stripUnsupportedTokens("From {brand_name} today", null)).toBe("From today");
  });
});

describe("#4273 save never rewrites what the host typed", () => {
  it.each([
    "See you there :)",
    "- Doors at 9",
    "...and we are back",
    "!!! Tonight",
    "Wait... what ?",
    "a  double  space",
    "  leading and trailing  ",
    "Line one\n\nLine two",
    "Costs {not_a_token} today",
  ])("%s", (typed) => {
    expect(stripUnsupportedTokens(typed, "Club")).toBe(typed);
  });
});

describe("#4273 auto-filled SMS fits one segment as a carrier counts it", () => {
  it.each([
    ["euro", "Tickets \u20AC5 ".repeat(40)],
    ["brackets", "[VIP] ".repeat(60)],
    ["all extended", "\u20AC[]{}|^~\\".repeat(30)],
    ["plain", "Live band tonight. ".repeat(30)],
  ])("%s", (_name, words) => {
    const text = prefillSmsFromEmail({ subject: "", bodyHtml: words, brandName: "Club" }, measure);
    expect(gsmSeptets(wireBody(text))).toBeLessThanOrEqual(160);
    expect(computeSegments(wireBody(text))).toBe(1);
  });
  it("counts extended characters as two septets", () => {
    expect(gsmSeptets("\u20AC")).toBe(2);
    expect(gsmSeptets("a[b")).toBe(4);
    expect(gsmSeptets("abc")).toBe(3);
  });
});

describe("#4273 a method taken away is said in a sentence", () => {
  it("push on a buyer list falls back to email", () => {
    expect(blastFallbackSentence(["push"], ["email"], ["brand_buyers"]))
      .toBe("Push can't reach a buyer list, so this will go by Email instead.");
  });
  it("push beside email on an event list leaves email", () => {
    expect(blastFallbackSentence(["email", "push"], ["email"], ["event:abc"]))
      .toBe("Push can't reach a buyer list, so this will go by Email only.");
  });
  it("nothing dropped, nothing said", () => {
    expect(blastFallbackSentence(["email"], ["email"], ["book"])).toBeNull();
  });
});

describe("#4273 a lead nobody can receive steps aside", () => {
  it("zero-reach lead with a reachable sibling", () => {
    expect(leadStepsAside(0, [3, 0])).toBe(true);
  });
  it("otherwise the lead stays", () => {
    expect(leadStepsAside(2, [3])).toBe(false);
    expect(leadStepsAside(0, [0, null])).toBe(false);
    expect(leadStepsAside(null, [3])).toBe(false);
  });
});

describe("#4273 the SMS card never sits on Loading forever", () => {
  it("says what is true", () => {
    expect(smsReachNote("none_picked")).toBe("Pick who gets this to see reach");
    expect(smsReachNote("unavailable")).toBe("Reach shows on review");
  });
});

describe("#4273 the composer's wiring", () => {
  const compose = readFileSync(
    path.resolve(__dirname, "../../../../app/(tabs)/marketing/campaigns/compose.tsx"),
    "utf8",
  );
  it("unticking mid-request clears the wait, or Send would stay blocked", () => {
    expect(compose).toMatch(/combinedKey === null \|\| accountId === null \|\| brandId === null\) \{\s+setAudiencePending\(false\);/);
  });
  it("reach resolves for what was picked in the sheet", () => {
    expect(compose).toContain('"sms"');
    expect(compose).toContain("getCombinedAudienceReach(");
    expect(compose).toContain("reachableSms={smsReachable}");
    expect(compose).not.toContain("reachableSms={reach?.reachable_sms ?? null}");
  });
  it("a phone browser lays the cards in the page, not in a box of their own", () => {
    expect(compose).toContain('const methodCardsFlow = Platform.OS === "web" && !isWideDesktop;');
    expect(compose).toContain("<MethodCardsHost");
  });
});
