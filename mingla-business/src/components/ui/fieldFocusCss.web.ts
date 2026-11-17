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
 * that is the only child of its field box, or a focused text input, shows
 * exactly one ring, drawn on the box. Enforced by
 * issue_4420_field_focus_css.implementor.test.ts and
 * issue_4420_single_line_focus_ring.implementor.test.ts.
 */
import { edge } from "../../constants/designSystem";

const STYLE_ID = "mingla-field-focus-4420";

/**
 * #4420 (device round 2) — a field box that holds its text control beside
 * other controls (Ari's composer: attach + textarea; Home's Ask Ari: orb +
 * input + send) opts in by spreading FIELD_FOCUS_BOX_PROPS on the box. The
 * browser's rectangular ring inside the rounded pill goes; the pill itself
 * draws the same input focus border and ring as every other field, following
 * its radius. Boxes that do not opt in keep the browser ring.
 */
export const FIELD_FOCUS_BOX_PROPS = { dataSet: { fieldFocus: "box" } } as Record<string, unknown>;

const BOX = '[data-field-focus="box"]';

/**
 * #4420 (web journey 11 / 13) — a focused single-line field showed a second,
 * rectangular browser ring INSIDE its rounded box: the Where step's Address
 * field and the ticket sheet's Capacity / Price / quantity fields are a raw
 * `TextInput` (an <input>) inside a bordered View, like the textareas above.
 * A text <input> never draws its own outline; the box it sits in (its direct
 * parent) draws the kit's 2px focus ring, following the box's radius, so the
 * field keeps exactly one visible focus indicator. The shared Input already
 * draws this same ring on its box. Tick boxes, radios, sliders and file
 * pickers keep the browser's own ring.
 */
const TEXT_INPUT =
  "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):focus";

export const FIELD_FOCUS_CSS = [
  "div:has(> textarea:only-child:focus) > textarea{outline:none}",
  "div:has(> textarea:only-child:focus){",
  `border-color:${edge.ringInputFocus.borderColor} !important;`,
  `outline:${edge.ringFocus.ringWidth}px solid ${edge.ringFocus.ring};`,
  "outline-offset:2px}",
  `div:has(> ${TEXT_INPUT}) > ${TEXT_INPUT}{outline:none}`,
  `div:has(> ${TEXT_INPUT}){`,
  `outline:${edge.ringFocus.ringWidth}px solid ${edge.ringFocus.ring};`,
  "outline-offset:2px}",
  `${BOX} textarea:focus,${BOX} input:focus{outline:none}`,
  `${BOX}:has(textarea:focus),${BOX}:has(input:focus){`,
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
