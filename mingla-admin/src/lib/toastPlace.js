// Issue #3802 — where the toast stack sits while a card is open.
//
// Pure module: no React, no DOM. components/ui/Toast.jsx measures the window
// and the open side panel and asks this file; a test walks every width.

/** The gap kept between the stack and the window edge, and the panel beside it. */
export const EDGE_GAP = 16;
export const PANEL_GAP = 24;
// The narrowest a toast is ever drawn beside a panel. From 640px up a side
// panel is 440px wide, which always leaves at least this much (200px of room
// minus the two gaps); a toast that narrow wraps its words but covers nothing.
export const NARROWEST_TOAST = 152;
/** A toast's usual minimum width (the class on it says the same). */
export const USUAL_TOAST = 320;

/**
 * Where the stack goes while a side panel (an open card) is on screen.
 *   { beside: 0 }         no side panel, or a phone, where the panel is the
 *                         whole screen: the stack stays at the bottom, and the
 *                         card leaves room after its last field instead
 *   { beside: w, fill }   the panel is w pixels wide and there is room to its
 *                         left: the stack sits there, clear of every field and
 *                         button of the card. `fill` is true when that room is
 *                         narrower than a toast's usual width.
 *
 * A toast drawn over an open card covers the card's lower fields until it
 * clears. Beside the card it covers nothing the person is working on.
 */
export function stackPlace(viewportWidth, panelWidth, wide) {
  if (!wide || !(panelWidth > 0)) return { beside: 0, fill: false };
  const room = viewportWidth - panelWidth - EDGE_GAP - PANEL_GAP;
  if (room < NARROWEST_TOAST) return { beside: 0, fill: false };
  return { beside: panelWidth, fill: room < USUAL_TOAST };
}

/** The left and right edges of the stack, in pixels from the window's left. */
export function stackEdges(viewportWidth, place) {
  if (!place || !(place.beside > 0)) return null;
  return { left: EDGE_GAP, right: viewportWidth - place.beside - PANEL_GAP };
}
