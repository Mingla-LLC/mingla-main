/**
 * EventChipResizable.web — ORCH-0891 M2 NodeView wrapping the M1 EventChip
 * with a hover-revealed S/M/L size picker.
 *
 * # What this exports
 * - `EventChipResizableView` — a Tiptap React NodeView component that
 *   renders the event chip pill PLUS the inline S/M/L picker on hover/focus.
 * - `EventChipWithResize` — the EventChip node extended with
 *   `addNodeView(ReactNodeViewRenderer(EventChipResizableView))`. Use this
 *   in `richEditor.tsx`'s extension list instead of the base `EventChip`
 *   on web; the base `EventChip` is still exported from `./EventChip.web.ts`
 *   for non-resize contexts (currently none, but future M3 use cases).
 *
 * # Behaviour (per SPEC §3.5.5 + DESIGN_SPEC §6)
 * - On hover (or focus-within via Tab navigation), 3 buttons appear at the
 *   right edge of the chip: S / M / L.
 * - Clicking a button mutates the node's `size` attribute via
 *   `updateAttributes({ size: "compact" | "medium" | "large" })`.
 * - The attribute round-trips through `tenTapTokenBridge` to `{{event:UUID|size}}`
 *   and through `marketingEmailRender.ts` (M2 server-side extension) to the
 *   appropriate card layout in the email.
 * - On native or narrow web, the picker NEVER appears — `EventChipWithResize`
 *   is web-only (Metro picks `EventChip.web.ts` on web via the chip nodes
 *   barrel; native bundles use `richEditor.native.ts` which is the pell
 *   passthrough — no Tiptap nodes resolved).
 *
 * # Visual contract (CSS lives in composerChipHtml.ts)
 * - Picker `.mingla-chip-size-picker` is hidden by default; visible on
 *   `.mingla-event-chip:hover` or `.mingla-event-chip:focus-within`.
 * - Each button 18×18pt, radius 4pt, `rgba(255,255,255,0.06)` background,
 *   border `rgba(255,255,255,0.10)`, font `ui-monospace` 10pt 600 weight.
 * - Active button (`[data-active="true"]`): `rgba(235,120,37,0.50)` bg,
 *   `#eb7825` border, `#ffffff` color.
 * - Focus ring: 2px `accent.glow` (`rgba(235,120,37,0.35)`).
 *
 * # Invariants honoured
 * - **I-TIPTAP-WEB-ONLY** — `*.web.tsx` extension; native bundles never resolve.
 * - **I-CHIP-DOM-CONTRACT** — emits `mingla-event-chip` class + `mingla-chip-glyph`
 *   glyph + chip-size-picker structure; CI gate `orch-0891-chip-dom-contract.mjs`
 *   verifies on this file too.
 * - **I-CHIP-BACKSPACE-VIA-DOM-HANDLER** — no `addKeyboardShortcuts.*Backspace`
 *   here; the DOM handler from composerChipHtml.ts handles atomic delete.
 *
 * Per SPEC_ORCH-0891 §3.5.5 + DESIGN_SPEC §6.
 */

import React from "react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

import { EventChip, type EventChipAttributes, type EventChipSize } from "./EventChip.web";

const SIZES: ReadonlyArray<{ id: EventChipSize; label: string; aria: string }> = [
  { id: "compact", label: "S", aria: "Compact size" },
  { id: "medium", label: "M", aria: "Medium size" },
  { id: "large", label: "L", aria: "Large size" },
];

/**
 * Tiptap NodeView component. Tiptap calls this for every EventChip node
 * in the document on render. `node` is the ProseMirror node; `updateAttributes`
 * mutates the node's attrs in the editor doc + triggers `onUpdate` so the
 * parent's onChange callback fires with the new HTML.
 *
 * Per SPEC, the picker uses `contentEditable={false}` on its container so
 * Tiptap doesn't try to edit the buttons (they're chrome, not content).
 */
export const EventChipResizableView: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
}) => {
  const attrs = node.attrs as EventChipAttributes;
  const size = attrs.size;

  const handlePickSize = (next: EventChipSize): void => {
    if (next === size) return;
    updateAttributes({ size: next });
  };

  return (
    <NodeViewWrapper
      as="span"
      className="mingla-event-chip"
      contentEditable={false}
      data-event-id={attrs.eventId ?? ""}
      data-cta={attrs.cta}
      data-size={size}
    >
      <span className="mingla-chip-glyph">▣</span>
      {attrs.title}
      <span className="mingla-chip-size-picker" contentEditable={false}>
        {SIZES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => handlePickSize(s.id)}
            data-active={s.id === size}
            aria-label={s.aria}
            aria-pressed={s.id === size}
          >
            {s.label}
          </button>
        ))}
      </span>
    </NodeViewWrapper>
  );
};

/**
 * EventChipWithResize — extended EventChip with the size-picker NodeView.
 *
 * Tiptap's `Node.extend({ addNodeView })` pattern preserves the base node's
 * attrs, parseHTML, and renderHTML (used for serialization) while
 * substituting the React NodeView for in-editor rendering. This means:
 *   - `editor.getHTML()` still emits `<span class="mingla-event-chip" ...>`
 *     via the base `renderHTML` — `htmlToTokenString` round-trip unaffected.
 *   - In the editor DOM, Tiptap renders this React component instead, so
 *     the operator sees the picker buttons + glyph + title.
 *
 * Use `EventChipWithResize` in the richEditor.tsx extensions list on web.
 */
export const EventChipWithResize = EventChip.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EventChipResizableView);
  },
});

export default EventChipWithResize;
