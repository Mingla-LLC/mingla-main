/**
 * Tiptap custom node — EventChip (ORCH-0891 §3.5.1 / DESIGN_SPEC §10).
 *
 * Mirrors native pell's `mingla-event-chip` rendering exactly: emits a
 * `<span>` with the canonical class name + `data-event-id` + `data-cta`
 * + `data-size` attributes + inner `<span class="mingla-chip-glyph">▣</span>`
 * + the event title.
 *
 * # `data-size` attribute (forward-compat for ORCH-0891 §3.5.5)
 * EventChip accepts a `size: "compact" | "medium" | "large"` attribute,
 * default `medium`. M1 ships the attribute + DOM round-trip so legacy
 * drafts continue rendering as `medium` and new drafts can carry size.
 * M2 wires the S/M/L picker NodeView that mutates the attribute; M2
 * also extends the email-render server side. M1 only ships the attribute
 * plumbing.
 *
 * # Invariants honoured
 * - **I-TIPTAP-WEB-ONLY** — `*.web.ts` extension; native bundles never resolve.
 * - **I-CHIP-DOM-CONTRACT** — class name `mingla-event-chip` + `▣` glyph +
 *   title text node match `composerChipHtml.ts` `eventChipHtml()` output
 *   byte-for-byte.
 * - **I-CHIP-BACKSPACE-VIA-DOM-HANDLER** — `atom: true` + no Backspace
 *   keymap; the DOM handler from `composerChipHtml.ts` handles delete.
 * - **I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT** — `size` defaults to `medium`
 *   when parseHTML sees no `data-size` attribute; legacy drafts unaffected.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export type EventChipSize = "compact" | "medium" | "large";
export type EventChipCta = "tickets" | "rsvp" | "details";

export interface EventChipAttributes {
  eventId: string | null;
  cta: EventChipCta;
  size: EventChipSize;
  title: string;
}

const VALID_SIZES: ReadonlySet<EventChipSize> = new Set(["compact", "medium", "large"]);
const VALID_CTAS: ReadonlySet<EventChipCta> = new Set(["tickets", "rsvp", "details"]);

function normalizeSize(raw: string | null | undefined): EventChipSize {
  if (raw === null || raw === undefined) return "medium";
  return VALID_SIZES.has(raw as EventChipSize) ? (raw as EventChipSize) : "medium";
}

function normalizeCta(raw: string | null | undefined): EventChipCta {
  if (raw === null || raw === undefined) return "tickets";
  return VALID_CTAS.has(raw as EventChipCta) ? (raw as EventChipCta) : "tickets";
}

export const EventChip = Node.create({
  name: "eventChip",

  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      eventId: {
        default: null,
        parseHTML: (el: HTMLElement): string | null => el.getAttribute("data-event-id"),
        renderHTML: (attrs: EventChipAttributes): Record<string, string> => {
          if (attrs.eventId === null) return {};
          return { "data-event-id": attrs.eventId };
        },
      },
      cta: {
        default: "tickets" as EventChipCta,
        parseHTML: (el: HTMLElement): EventChipCta =>
          normalizeCta(el.getAttribute("data-cta")),
        renderHTML: (attrs: EventChipAttributes): Record<string, string> => ({
          "data-cta": attrs.cta,
        }),
      },
      size: {
        default: "medium" as EventChipSize,
        parseHTML: (el: HTMLElement): EventChipSize =>
          normalizeSize(el.getAttribute("data-size")),
        renderHTML: (attrs: EventChipAttributes): Record<string, string> => ({
          "data-size": attrs.size,
        }),
      },
      title: {
        default: "",
        parseHTML: (el: HTMLElement): string => {
          // Pell's emitted markup wraps the title in the span itself. We
          // pull the textContent excluding the glyph span (the ▣ marker).
          const glyph = el.querySelector(".mingla-chip-glyph");
          if (glyph !== null) {
            return (el.textContent ?? "").replace(glyph.textContent ?? "", "").trim();
          }
          return (el.textContent ?? "").trim();
        },
        renderHTML: (): Record<string, string> => ({}),
      },
    };
  },

  parseHTML() {
    // Match any <span> with data-event-id. Lenient parsing for legacy drafts.
    return [
      {
        tag: "span[data-event-id]",
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as EventChipAttributes;
    return [
      "span",
      mergeAttributes(
        {
          class: "mingla-event-chip",
          contenteditable: "false",
        },
        HTMLAttributes,
      ),
      ["span", { class: "mingla-chip-glyph" }, "▣"],
      attrs.title,
    ];
  },
});
