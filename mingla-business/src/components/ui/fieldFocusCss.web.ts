/**
 * #4420 (shots-sheets after-03) — one field, one border, one focus ring.
 *
 * The app's multiline fields are a raw `TextInput multiline` (a <textarea> on
 * web) inside a bordered View that is the field's visible box. The browser drew
 * its own focus outline on the textarea INSIDE that box, so a focused field read
 * as a box within a box ("Why are you making this change?" in Review changes,
 * and ~50 other textareas built the same way). `outlineWidth: 0` on the
 * textarea did not help: Chrome's `outline-style: auto` ignores the width.
 *
 * The rule moves the ring to the field's box: when a textarea is the ONLY
 * child of its wrapper (the bordered-box pattern), the textarea draws no
 * outline and the wrapper draws the kit's input focus (the 1.5px input-focus
 * border plus the 2px focus ring the Input primitive draws). A textarea that
 * shares its wrapper with other controls (a composer with a send button) keeps
 * the browser's own ring, so no field loses its focus indicator.
 *
 * Invariant I-4420-ONE-FIELD-ONE-RING | issue #4420 | A focused web textarea
 * that is the only child of its field box shows exactly one ring, drawn on the
 * box. Enforced by issue_4420_field_focus_css.implementor.test.ts.
 */
import { edge } from "../../constants/designSystem";

const STYLE_ID = "mingla-field-focus-4420";

export const FIELD_FOCUS_CSS = [
  "div:has(> textarea:only-child:focus) > textarea{outline:none}",
  "div:has(> textarea:only-child:focus){",
  `border-color:${edge.ringInputFocus.borderColor} !important;`,
  `outline:${edge.ringFocus.ringWidth}px solid ${edge.ringFocus.ring};`,
  "outline-offset:2px}",
].join("");

export const installFieldFocusCss = (): void => {
  const doc = (globalThis as { document?: Document }).document;
  if (doc === undefined || doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = FIELD_FOCUS_CSS;
  doc.head.appendChild(style);
};
