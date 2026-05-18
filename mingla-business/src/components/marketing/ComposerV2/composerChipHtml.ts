/**
 * ORCH-0864 [Marketing Composer V2] Stage F.8 — chip HTML + CSS + DOM script.
 *
 * Pell-pivot chip rendering. Chips are inline `<span>` elements with
 * data-* attrs styled to look like dark-elevated pills with the brand
 * orange accent. Each chip now contains a nested `.mingla-chip-x` element
 * (Stage F.8) — tapping it removes the chip from the DOM. The X-handler
 * script is injected once via `richEditor.commandDOM` on init.
 *
 * Exports:
 *   - eventChipHtml(attrs): event chip span (orange accent)
 *   - personalizationChipHtml({token}): personalization pill (slate accent)
 *   - COMPOSER_CHIP_CSS: stylesheet (dark surface + orange border + smart-link)
 *   - COMPOSER_CHIP_X_HANDLER_JS: DOM click handler that removes chips
 *     when their `.mingla-chip-x` element is tapped and triggers pell's
 *     change event so onChange propagates.
 *
 * The underlying body string still preserves the token form
 * (`{{event:uuid}}` and `{token}`) verbatim via the
 * tenTapTokenBridge.htmlToTokenString round-trip — the X spans are
 * stripped before chip regex matching so they never leak into the
 * stored body.
 */

import type { PersonalizationToken } from "../../../services/marketing/tenTapTokenBridge";

export type EventChipCtaLabel = "tickets" | "rsvp" | "details";

export interface EventChipAttrs {
  eventId: string;
  title: string;
  dateLabel: string | null;
  ctaLabel: EventChipCtaLabel;
  coverUrl: string | null;
}

export function ctaLabelToText(cta: EventChipCtaLabel): string {
  if (cta === "rsvp") return "RSVP";
  if (cta === "details") return "See details";
  return "Get tickets";
}

/**
 * HTML for an inline event chip. Stage F.10 compact rendering:
 *   - No inline × close button (backspace deletes the chip atomically).
 *   - No date suffix in display (the chip carries `data-event-id`; the
 *     send pipeline expands {{event:<id>}} server-side with full details
 *     into the actual email card render).
 *   - Trailing &nbsp; so the caret has a typing position right after the
 *     chip and the user can keep typing without nudging.
 *
 * The chip itself is `contenteditable="false"` — browsers treat it as
 * atomic (selection + delete work in one keypress).
 */
export function eventChipHtml(attrs: EventChipAttrs): string {
  const title = escapeHtml(attrs.title);
  return (
    `<span class="mingla-event-chip" contenteditable="false"` +
    ` data-event-id="${escapeAttr(attrs.eventId)}"` +
    ` data-cta="${escapeAttr(attrs.ctaLabel)}"` +
    `>` +
    `<span class="mingla-chip-glyph">▣</span>` +
    `${title}` +
    `</span>&nbsp;`
  );
}

/**
 * HTML for an inline personalization pill. Stage F.10 compact (no ×).
 */
export function personalizationChipHtml(attrs: { token: PersonalizationToken }): string {
  const t = escapeAttr(attrs.token);
  return (
    `<span class="mingla-personalization-chip" contenteditable="false"` +
    ` data-token="${t}"` +
    `>${t}</span>&nbsp;`
  );
}

/**
 * CSS injected into pell's WebView via richEditor.commandDOM on init.
 * Stage F.8: dark-elevated chips matching the Mingla dark canvas with
 * orange accent borders. Smart-link styling so `<a>` tags render as
 * readable orange-underlined text instead of default blue.
 *
 * All colors use hex / rgb / hsl per `feedback_rn_color_formats.md`
 * (rule is for RN inline styles but we keep parity here for visual
 * consistency).
 */
export const COMPOSER_CHIP_CSS = `
/* ─── Personalization chip (dark surface, orange accent) ─────────────── */
.mingla-personalization-chip {
  display: inline-block;
  padding: 1px 8px;
  margin: 0 1px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(235, 120, 37, 0.45);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.96);
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
  white-space: nowrap;
  vertical-align: middle;
  line-height: 1.4;
}
.mingla-personalization-chip::before {
  content: "{ ";
  opacity: 0.6;
}
.mingla-personalization-chip::after {
  content: " }";
  opacity: 0.6;
}

/* ─── Event chip (dark surface, stronger orange accent) — F.10 compact ── */
.mingla-event-chip {
  display: inline-block;
  padding: 1px 8px;
  margin: 0 1px;
  border-radius: 999px;
  background: rgba(235, 120, 37, 0.16);
  border: 1px solid rgba(235, 120, 37, 0.55);
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.96);
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
  vertical-align: baseline;
  white-space: nowrap;
  line-height: 1.4;
}
.mingla-event-chip .mingla-chip-glyph {
  color: #eb7825;
  font-size: 12px;
  margin-right: 4px;
}

/* ─── Smart link (Stage F.8 visual styling — orange underlined) ───────── */
.pell-content a, [contenteditable="true"] a {
  color: #eb7825;
  text-decoration: underline;
  text-decoration-color: rgba(235, 120, 37, 0.55);
  text-underline-offset: 2px;
  cursor: pointer;
}
.pell-content a:hover, [contenteditable="true"] a:hover {
  text-decoration-color: #eb7825;
}

/* ─── Editor body baseline tweaks for dark canvas ─────────────────────── */
body, .pell-content {
  caret-color: #eb7825;
}
::placeholder, .pell-content [data-placeholder]::before {
  color: rgba(255, 255, 255, 0.42);
}
`;

/**
 * Stage F.10: backspace handler — runs inside pell's WebView. When the
 * user presses Backspace and the caret sits immediately after a chip
 * (or after the trailing &nbsp; the chip injects), delete the chip
 * atomically and trigger pell's onChange.
 *
 * The chip itself is `contenteditable="false"`, so browsers typically
 * require two backspaces (one to select, one to delete) and behavior
 * varies by browser. This handler normalizes that to a single backspace
 * removing the entire chip, matching Notion / Linear / Slack chip UX.
 *
 * Pure DOM — no RN message channel needed.
 */
export const COMPOSER_CHIP_BACKSPACE_HANDLER_JS = `
(function(){
  if (window.__minglaChipBackspaceInstalled) return;
  window.__minglaChipBackspaceInstalled = true;
  function findChipBehindCaret(){
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    if (!range.collapsed) return null;
    var node = range.startContainer;
    var offset = range.startOffset;
    var candidate = null;
    if (node.nodeType === 3) {
      // Text node. If caret is at start, prev sibling is the candidate.
      // If caret is at 1 and the text is a single  , it's the
      // trailing nbsp the chip inserted — prev sibling is the chip.
      if (offset === 0) {
        candidate = node.previousSibling;
      } else if (offset <= 1 && (node.nodeValue === ' ' || node.nodeValue === ' ')) {
        candidate = node.previousSibling;
      } else {
        return null;
      }
    } else if (node.nodeType === 1) {
      candidate = node.childNodes[offset - 1] || null;
    }
    if (!candidate || !candidate.classList) return null;
    if (candidate.classList.contains('mingla-event-chip') || candidate.classList.contains('mingla-personalization-chip')) {
      return candidate;
    }
    return null;
  }
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Backspace') return;
    var chip = findChipBehindCaret();
    if (!chip || !chip.parentNode) return;
    e.preventDefault();
    e.stopPropagation();
    var editable = chip.closest('[contenteditable=true], .pell-content');
    var nextNbsp = chip.nextSibling;
    if (nextNbsp && nextNbsp.nodeType === 3 && (nextNbsp.nodeValue === ' ' || nextNbsp.nodeValue === ' ')) {
      nextNbsp.parentNode.removeChild(nextNbsp);
    }
    chip.parentNode.removeChild(chip);
    if (editable) {
      var ev = new Event('input', { bubbles: true, cancelable: true });
      editable.dispatchEvent(ev);
    }
  }, true);
})();
`;

/**
 * @deprecated F.10: replaced by COMPOSER_CHIP_BACKSPACE_HANDLER_JS. The
 * inline × close button was removed; backspace is the only deletion path.
 * Alias retained for any in-flight callers; safe to remove on next pass.
 */
export const COMPOSER_CHIP_X_HANDLER_JS = COMPOSER_CHIP_BACKSPACE_HANDLER_JS;

// ─── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
