/**
 * ORCH-0864 [Marketing Composer V2] Stage A — token bridge tests.
 *
 * Implementor happy-path coverage per SPEC §8 T-01..T-07.
 * T-04 is the designated fails-on-revert anchor for
 * I-PROPOSED-MKT-COMPOSER-V2-TOKEN-ROUNDTRIP-LOSSLESS — reverting the
 * personalization-token regex MUST make T-04 fail.
 *
 * Note: tester-authored adversarial tests (TA-01..TA-06) ship in a
 * separate `tenTapTokenBridge.tester-adversarial.test.ts` file, written by
 * Claude mingla-forensics TEST mode in Stage H per ORCH-0840 §0.5.
 */

import {
  bodyHtmlToTenTapDoc,
  toBodyHtml,
  extractEmbeddedEventIds,
  isPersonalizationToken,
  type TenTapDocument,
} from "../tenTapTokenBridge";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

const roundTrip = (input: string): string => toBodyHtml(bodyHtmlToTenTapDoc(input));

describe("tenTapTokenBridge — Stage A", () => {
  describe("T-01 empty body", () => {
    it("parses empty string to a single empty paragraph", () => {
      const doc = bodyHtmlToTenTapDoc("");
      expect(doc).toEqual({
        type: "doc",
        content: [{ type: "paragraph" }],
      });
    });

    it("round-trips empty string to empty string", () => {
      expect(roundTrip("")).toBe("");
    });
  });

  describe("T-02 all 11 personalization tokens", () => {
    const all11 =
      "Hi {first_name} from {brand_name}! " +
      "Event {event_name} on {event_date} at {event_time}. " +
      "Doors {doors_open}. RSVP {event_url}. " +
      "Only {spots_left} left. " +
      "Last time: {previous_event_name}. " +
      "Next up: {next_event_name}. " +
      "Reference: {event_id}.";

    it("round-trips byte-identical", () => {
      expect(roundTrip(all11)).toBe(all11);
    });

    it("emits a personalizationChip node for every token", () => {
      const doc = bodyHtmlToTenTapDoc(all11);
      const chips = collectInline(doc).filter((n) => n.type === "personalizationChip");
      expect(chips).toHaveLength(11);
    });
  });

  describe("T-03 multiple event chips interleaved with personalization", () => {
    const mixed =
      `Hey {first_name},\n\n` +
      `Two upcoming:\n` +
      `{{event:${UUID_A}}}\n` +
      `and\n` +
      `{{event:${UUID_B}}}\n` +
      `\n` +
      `Final one is {{event:${UUID_C}}}.\n\n` +
      `See ya,\n{brand_name}`;

    it("round-trips byte-identical (text + chips + event blocks)", () => {
      expect(roundTrip(mixed)).toBe(mixed);
    });

    it("extracts all three event IDs in order", () => {
      expect(extractEmbeddedEventIds(mixed)).toEqual([UUID_A, UUID_B, UUID_C]);
    });
  });

  describe("T-04 HTML marks + tokens (DESIGNATED FAILS-ON-REVERT)", () => {
    // This is the test that breaks if PERSONALIZATION_TOKEN_RE is weakened.
    // To verify: comment out the join("|") part of the regex (so only
    // {first_name} matches and other tokens become literal text) → this
    // test MUST fail. Restore → MUST pass.
    const html =
      `Hi <strong>{first_name}</strong>,\n\n` +
      `Don't miss <em>{event_name}</em> on {event_date}. ` +
      `<a href="https://example.com/x">Get tickets here</a>.\n\n` +
      `Spots left: <strong><em>{spots_left}</em></strong>.\n\n` +
      `From {brand_name}.`;

    it("round-trips with marks + all tokens preserved", () => {
      const out = roundTrip(html);
      // The serializer emits double-quoted href + preserves the mark order
      // it was parsed in. Input already matches that convention, so
      // round-trip is byte-identical.
      expect(out).toBe(html);
    });

    it("every {token} becomes a personalizationChip node (NOT literal text)", () => {
      // This is the fails-on-revert anchor. If PERSONALIZATION_TOKEN_RE is
      // weakened (e.g., reviewer "simplifies" it to only match first_name),
      // the other tokens fall through to literal text — round-trip still
      // succeeds because text passes through unchanged, but the chip count
      // drops and THIS assertion fires. Verified at commit 112f4717.
      const doc = bodyHtmlToTenTapDoc(html);
      const chips: string[] = [];
      for (const block of doc.content) {
        for (const node of block.content ?? []) {
          if (node.type === "personalizationChip") chips.push(node.attrs.token);
        }
      }
      expect(chips).toEqual([
        "first_name",
        "event_name",
        "event_date",
        "spots_left",
        "brand_name",
      ]);
    });

    it("every personalization token survives the round-trip in correct order", () => {
      const out = roundTrip(html);
      const tokensIn = (html.match(/\{[a-z_]+\}/g) ?? []);
      const tokensOut = (out.match(/\{[a-z_]+\}/g) ?? []);
      expect(tokensOut).toEqual(tokensIn);
      expect(tokensOut).toEqual([
        "{first_name}",
        "{event_name}",
        "{event_date}",
        "{spots_left}",
        "{brand_name}",
      ]);
    });
  });

  describe("T-05 V1 draft fixture", () => {
    // Mirror of the simplest V1 composer output: plain text with newline
    // paragraph breaks + tokens + a single event embed. Verifies SC-12
    // backward compat (V2 must open V1 drafts cleanly).
    const v1 = `Hi {first_name},\n\nSee ya at {{event:${UUID_A}}}.\n\nLove,\n{brand_name}`;

    it("round-trips V1 string byte-identical", () => {
      expect(roundTrip(v1)).toBe(v1);
    });

    it("V1 first paragraph yields text + personalization chip + text", () => {
      const doc = bodyHtmlToTenTapDoc(v1);
      const firstPara = doc.content[0];
      if (firstPara === undefined) throw new Error("expected first block");
      expect(firstPara.content?.[0]).toEqual({ type: "text", text: "Hi " });
      expect(firstPara.content?.[1]).toEqual({
        type: "personalizationChip",
        attrs: { token: "first_name" },
      });
      expect(firstPara.content?.[2]).toEqual({ type: "text", text: "," });
    });
  });

  describe("malformed inputs do not crash and do not coerce", () => {
    it("unknown brace expression stays literal", () => {
      const input = "Hello {firstname} world"; // missing underscore → not a real token
      expect(roundTrip(input)).toBe(input);
    });

    it("malformed event UUID stays literal", () => {
      const input = "See {{event:not-a-uuid}} here";
      expect(roundTrip(input)).toBe(input);
    });
  });

  describe("Stage F.5 pell-pivot — docToHtml + htmlToTokenString", () => {
    // The end-to-end round-trip on pell: V1 token-string → doc → HTML
    // (pell sees this) → pell.getContentHtml → htmlToTokenString → token-string.
    // The contract: tokens survive identically; marks survive; whitespace
    // and entities survive in their semantic form.

    const pellRoundTrip = (input: string): string => {
      // Simulate pell: docToHtml gives us the HTML pell will store. We
      // then parse it back as if pell emitted it (which it does verbatim
      // for content that fits its schema).
      const doc = require("../tenTapTokenBridge").bodyHtmlToTenTapDoc(input);
      const html = require("../tenTapTokenBridge").docToHtml(doc);
      return require("../tenTapTokenBridge").htmlToTokenString(html);
    };

    it("preserves all 11 personalization tokens through pell round-trip", () => {
      const input =
        "Hi {first_name} from {brand_name}! Event {event_name} on {event_date} " +
        "at {event_time}. Doors {doors_open}. RSVP {event_url}. Only {spots_left} " +
        "left. Last time: {previous_event_name}. Next up: {next_event_name}. " +
        "Reference: {event_id}.";
      const out = pellRoundTrip(input);
      // Tokens preserved; whitespace may differ (pell collapses some but
      // tokens themselves are intact).
      for (const token of [
        "{first_name}", "{brand_name}", "{event_name}", "{event_date}", "{event_time}",
        "{doors_open}", "{event_url}", "{spots_left}", "{previous_event_name}",
        "{next_event_name}", "{event_id}",
      ]) {
        expect(out).toContain(token);
      }
    });

    it("preserves event embed token through pell round-trip", () => {
      const UUID = "11111111-1111-4111-8111-111111111111";
      const input = `Hey {first_name}, see ya at {{event:${UUID}}}.`;
      const out = pellRoundTrip(input);
      expect(out).toContain("{first_name}");
      expect(out).toContain(`{{event:${UUID}}}`);
    });

    it("docToHtml emits chip spans with the correct data attributes", () => {
      const { bodyHtmlToTenTapDoc, docToHtml } = require("../tenTapTokenBridge");
      const html = docToHtml(bodyHtmlToTenTapDoc("Hi {first_name}!"));
      expect(html).toContain('data-token="first_name"');
      expect(html).toContain('class="mingla-personalization-chip"');
      expect(html).toContain('contenteditable="false"');
    });

    it("htmlToTokenString handles pell's <div> + <br> paragraph wrappers", () => {
      const { htmlToTokenString } = require("../tenTapTokenBridge");
      const pellEmitted =
        '<div>Hi <span class="mingla-personalization-chip" data-token="first_name">first_name</span>,</div>' +
        "<div><br></div>" +
        "<div>See ya!</div>";
      const out = htmlToTokenString(pellEmitted);
      expect(out).toContain("Hi {first_name},");
      expect(out).toContain("See ya!");
    });

    it("htmlToTokenString decodes HTML entities", () => {
      const { htmlToTokenString } = require("../tenTapTokenBridge");
      expect(htmlToTokenString("a &amp; b")).toBe("a & b");
      expect(htmlToTokenString("&lt;not a tag&gt;")).toBe("<not a tag>");
    });

    it("htmlToTokenString preserves bold/italic/link marks", () => {
      const { htmlToTokenString } = require("../tenTapTokenBridge");
      const pellEmitted =
        '<strong>Bold</strong> and <em>italic</em> and <a href="https://x.com">link</a>.';
      const out = htmlToTokenString(pellEmitted);
      expect(out).toBe('<strong>Bold</strong> and <em>italic</em> and <a href="https://x.com">link</a>.');
    });

    it("htmlToTokenString strips unknown tags but keeps inner text", () => {
      const { htmlToTokenString } = require("../tenTapTokenBridge");
      expect(htmlToTokenString('Hello <font color="red">world</font>!')).toBe("Hello world!");
    });

    it("Stage F.8: personalization chip with inline × round-trips to {token}", () => {
      const { htmlToTokenString } = require("../tenTapTokenBridge");
      const pellEmitted =
        'Hi <span class="mingla-personalization-chip" contenteditable="false" data-token="first_name">' +
        '<span class="mingla-chip-content">first_name</span>' +
        '<span class="mingla-chip-x" aria-label="Remove">×</span>' +
        '</span>!';
      expect(htmlToTokenString(pellEmitted)).toBe("Hi {first_name}!");
    });

    it("Stage F.8: event chip with glyph + content + × round-trips to {{event:uuid}}", () => {
      const { htmlToTokenString } = require("../tenTapTokenBridge");
      const UUID = "abc12345-1234-4111-8111-111111111111";
      const pellEmitted =
        'See ya at <span class="mingla-event-chip" contenteditable="false" ' +
        `data-event-id="${UUID}" data-cta="tickets">` +
        '<span class="mingla-chip-glyph">▣</span>' +
        '<span class="mingla-chip-content">Sunset Mixer · Sat Jun 7</span>' +
        '<span class="mingla-chip-x" aria-label="Remove">×</span>' +
        '</span>.';
      expect(htmlToTokenString(pellEmitted)).toBe(`See ya at {{event:${UUID}}}.`);
    });
  });

  describe("isPersonalizationToken type guard", () => {
    it("accepts all 11 tokens", () => {
      [
        "first_name",
        "brand_name",
        "event_name",
        "event_date",
        "event_time",
        "doors_open",
        "event_url",
        "spots_left",
        "previous_event_name",
        "next_event_name",
        "event_id",
      ].forEach((t) => expect(isPersonalizationToken(t)).toBe(true));
    });

    it("rejects unknown tokens", () => {
      expect(isPersonalizationToken("last_name")).toBe(false);
      expect(isPersonalizationToken("")).toBe(false);
      expect(isPersonalizationToken("FIRST_NAME")).toBe(false);
    });
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function collectInline(doc: TenTapDocument): Array<
  { type: string } & Record<string, unknown>
> {
  const out: Array<{ type: string } & Record<string, unknown>> = [];
  for (const block of doc.content) {
    if (block.type === "paragraph") {
      for (const node of block.content ?? []) out.push(node as never);
    }
  }
  return out;
}
