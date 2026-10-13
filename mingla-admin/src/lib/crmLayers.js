// Issue #3802 — the ONE stacking order for the Hosts and Creators screens.
//
// Pure module: no React, no DOM. From the bottom up:
//
//   board   the page itself (the board, list and tables; in the page flow)
//   card    a card panel, or the add form, opened over the board
//   dialog  anything opened FROM an open card that asks a question (the
//           "Why is this lost?" prompt)
//   toast   messages; always on top, and never able to hide a dialog's buttons
//           for long (they clear by themselves or with Dismiss)
//
// Each overlay layer is drawn at the top of the page, outside the page's own
// box, in a box of its own that carries the number below. Whatever is inside
// a layer (a drawer, a modal and their own z-index values) is stacked inside
// that box, so a higher layer is always wholly above a lower one. Nothing on
// these screens sets a stacking number anywhere else.
//
// `toast` is not drawn by a layer box: the app's toast stack uses the theme
// value --z-toast (globals.css). A test pins that it is above `dialog`.
export const CRM_LAYER_ORDER = ["board", "card", "dialog", "toast"];

/** The stacking number of each overlay layer that is drawn in a layer box. */
export const CRM_LAYER_Z = Object.freeze({ card: 40, dialog: 45 });

/** The style of a layer's box: a stacking context of its own, with no size. */
export function layerStyle(name) {
  if (!Object.hasOwn(CRM_LAYER_Z, name)) throw new Error(`Unknown layer: ${name}`);
  return { position: "relative", zIndex: CRM_LAYER_Z[name] };
}
