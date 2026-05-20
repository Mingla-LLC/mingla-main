/**
 * Tiptap custom node — PersonalizationChip (ORCH-0891 §3.5.1 / DESIGN_SPEC §10).
 *
 * Mirrors native pell's chip-rendering exactly: emits a `<span>` with the
 * canonical class name `mingla-personalization-chip` + `data-token="..."`
 * attribute. The chip CSS in `composerChipHtml.ts` `COMPOSER_CHIP_CSS`
 * handles all visual styling (the same string is injected into the
 * Tiptap editor's host document via the `<style>` tag in `richEditor.tsx`).
 *
 * # Invariants honoured
 * - **I-TIPTAP-WEB-ONLY** — this file uses `*.web.ts` extension; Metro
 *   never bundles it on native (iOS/Android use the real pell SDK).
 * - **I-CHIP-DOM-CONTRACT** — class name `mingla-personalization-chip` +
 *   `data-token` attribute match `composerChipHtml.ts`
 *   `personalizationChipHtml()` output byte-for-byte. CI gate
 *   `orch-0891-chip-dom-contract.mjs` enforces.
 * - **I-CHIP-BACKSPACE-VIA-DOM-HANDLER** — `atom: true` makes Tiptap
 *   treat the chip as atomic for selection AND we DO NOT add a
 *   Backspace keymap here. Atomic delete is handled by the verbatim
 *   `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` script installed by
 *   `richEditor.tsx` on mount. CI gate enforces no `addKeyboardShortcuts`
 *   with `Backspace` in this directory.
 *
 * Per DESIGN_SPEC §10: token form `{token}` is preserved as the rendered
 * text content, mirroring native pell's `personalizationChipHtml()`
 * output. Round-trips through `tenTapTokenBridge.htmlToTokenString` as
 * `{token}`.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export interface PersonalizationChipAttributes {
  token: string | null;
}

export const PersonalizationChip = Node.create({
  name: "personalizationChip",

  // Inline node — sits inline within paragraph text (next to letters).
  group: "inline",
  inline: true,

  // Atomic — Tiptap treats the chip as a single character for selection
  // and delete operations. Selection navigates around the chip; the
  // atomic-backspace DOM handler removes the chip in one keypress.
  atom: true,

  // Selectable so the operator can highlight + delete the chip via the
  // DOM handler (which listens for keydown on a contenteditable host).
  selectable: true,

  addAttributes() {
    return {
      token: {
        default: null,
        parseHTML: (el: HTMLElement): string | null =>
          el.getAttribute("data-token"),
        renderHTML: (attrs: PersonalizationChipAttributes): Record<string, string> => {
          if (attrs.token === null) return {};
          return { "data-token": attrs.token };
        },
      },
    };
  },

  parseHTML() {
    // Match any <span> with a data-token attribute. The native pell
    // output is `<span class="mingla-personalization-chip" contenteditable="false" data-token="X">X</span>`;
    // we match leniently via attribute presence so Tiptap can load legacy
    // drafts that may have minor markup variation.
    return [
      {
        tag: "span[data-token]",
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const token = (node.attrs as PersonalizationChipAttributes).token ?? "";
    return [
      "span",
      mergeAttributes(
        {
          class: "mingla-personalization-chip",
          contenteditable: "false",
        },
        HTMLAttributes,
      ),
      token,
    ];
  },

  // No `addKeyboardShortcuts` — atomic delete is the DOM handler's job.
  // See file header invariant I-CHIP-BACKSPACE-VIA-DOM-HANDLER.
});
