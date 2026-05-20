/**
 * ORCH-0891 M1 — tenTapTokenBridge size-suffix round-trip tests.
 *
 * New test file (append-only enforcement per ORCH-0840: existing tests are
 * immutable; new test surface ships as a sibling file). Verifies that
 * event-chip tokens with the new optional `|size` suffix round-trip
 * byte-identical through `bodyHtmlToTenTapDoc` → `toBodyHtml` AND through
 * the `docToHtml` → `htmlToTokenString` pell-side pipeline.
 *
 * # Backwards-compatibility contract (I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT)
 * Legacy size-less tokens (`{{event:UUID}}`) MUST round-trip byte-identical
 * — no spurious `|medium` suffix added. The "no change for legacy" tests
 * are the fails-on-revert anchor: if a future implementor adds a default-
 * size emission on the legacy branch, T-SIZE-04 will fail and they'll
 * notice they broke every stored campaign.
 */

import {
  bodyHtmlToTenTapDoc,
  toBodyHtml,
  docToHtml,
  htmlToTokenString,
  extractEmbeddedEventIds,
  type TenTapDocument,
} from "../tenTapTokenBridge";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("ORCH-0891 M1 — event chip |size suffix round-trip", () => {
  describe("token string ↔ doc round-trip via toBodyHtml", () => {
    it("(T-SIZE-01) compact size round-trips byte-identical", () => {
      const input = `see {{event:${UUID}|compact}} this fri`;
      expect(toBodyHtml(bodyHtmlToTenTapDoc(input))).toBe(input);
    });

    it("(T-SIZE-02) medium size round-trips byte-identical", () => {
      const input = `see {{event:${UUID}|medium}} this fri`;
      expect(toBodyHtml(bodyHtmlToTenTapDoc(input))).toBe(input);
    });

    it("(T-SIZE-03) large size round-trips byte-identical", () => {
      const input = `see {{event:${UUID}|large}} this fri`;
      expect(toBodyHtml(bodyHtmlToTenTapDoc(input))).toBe(input);
    });

    it("(T-SIZE-04) legacy size-less token round-trips byte-identical (backwards-compat)", () => {
      // CRITICAL: the absence of `|size` must NOT introduce `|medium` on
      // the output. Legacy stored campaigns rely on this byte-identity to
      // avoid spurious diffs / re-render storms.
      const input = `see {{event:${UUID}}} this fri`;
      expect(toBodyHtml(bodyHtmlToTenTapDoc(input))).toBe(input);
    });

    it("(T-SIZE-05) invalid size value is treated as no-size (literal text falls back)", () => {
      // `huge` is not in the (compact|medium|large) alternation, so the
      // regex falls through and the entire literal `{{event:UUID|huge}}`
      // is NOT recognized as a chip — it stays as literal text. This
      // protects against typos becoming silent corruptions.
      const input = `see {{event:${UUID}|huge}} this fri`;
      const out = toBodyHtml(bodyHtmlToTenTapDoc(input));
      // Either the doc treats the whole thing as literal text (preferred)
      // OR matches only the UUID portion and leaves `|huge}}` as text.
      // Both outcomes are acceptable as long as no chip with size="huge"
      // is created. The contract test: output does NOT contain
      // `|huge` inside a recognized chip form.
      const doc = bodyHtmlToTenTapDoc(input);
      const allChips = collectChips(doc);
      for (const chip of allChips) {
        if (chip.size !== undefined) {
          expect(["compact", "medium", "large"]).toContain(chip.size);
        }
      }
      // Sanity: the literal `huge` must appear SOMEWHERE in the output
      // (either inside the unmatched chip text, or as plain text).
      expect(out.includes("huge")).toBe(true);
    });
  });

  describe("doc ↔ pell HTML round-trip via docToHtml + htmlToTokenString", () => {
    it("(T-SIZE-06) eventChip with size=compact emits data-size attribute in HTML", () => {
      const doc: TenTapDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "eventChip", attrs: { eventId: UUID, size: "compact" } },
            ],
          },
        ],
      };
      const html = docToHtml(doc);
      expect(html.includes(`data-size="compact"`)).toBe(true);
      expect(html.includes(`data-event-id="${UUID}"`)).toBe(true);
    });

    it("(T-SIZE-07) eventChip without size attr emits HTML WITHOUT data-size (backwards-compat)", () => {
      const doc: TenTapDocument = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "eventChip", attrs: { eventId: UUID } }],
          },
        ],
      };
      const html = docToHtml(doc);
      expect(html.includes("data-size")).toBe(false);
      expect(html.includes(`data-event-id="${UUID}"`)).toBe(true);
    });

    it("(T-SIZE-08) pell HTML with data-size=large round-trips to {{event:UUID|large}}", () => {
      const html = `<span class="mingla-event-chip" contenteditable="false" data-event-id="${UUID}" data-cta="tickets" data-size="large">▣ Event</span>`;
      const token = htmlToTokenString(html);
      expect(token).toBe(`{{event:${UUID}|large}}`);
    });

    it("(T-SIZE-09) pell HTML without data-size round-trips to {{event:UUID}} (legacy form)", () => {
      const html = `<span class="mingla-event-chip" contenteditable="false" data-event-id="${UUID}" data-cta="tickets">▣ Event</span>`;
      const token = htmlToTokenString(html);
      // CRITICAL: must NOT add `|medium` suffix. Legacy chip → legacy token.
      expect(token).toBe(`{{event:${UUID}}}`);
    });
  });

  describe("extractEmbeddedEventIds preserves backwards-compat with size suffix", () => {
    it("(T-SIZE-10) extracts UUID from token with size suffix", () => {
      const body = `see {{event:${UUID}|compact}} this fri`;
      expect(extractEmbeddedEventIds(body)).toEqual([UUID]);
    });

    it("(T-SIZE-11) extracts UUID from legacy size-less token (unchanged)", () => {
      const body = `see {{event:${UUID}}} this fri`;
      expect(extractEmbeddedEventIds(body)).toEqual([UUID]);
    });

    it("(T-SIZE-12) deduplicates the same UUID across mixed size variants", () => {
      const body = `first {{event:${UUID}|compact}}, then {{event:${UUID}|large}}, then {{event:${UUID}}}`;
      expect(extractEmbeddedEventIds(body)).toEqual([UUID]);
    });
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

interface ChipSummary {
  eventId: string;
  size: string | undefined;
}

function collectChips(doc: TenTapDocument): ChipSummary[] {
  const out: ChipSummary[] = [];
  for (const block of doc.content) {
    if (block.type !== "paragraph") continue;
    for (const node of block.content ?? []) {
      if (node.type === "eventChip") {
        out.push({ eventId: node.attrs.eventId, size: node.attrs.size });
      }
    }
  }
  return out;
}
