// Issue #3980 — a text box that grows with its text and never clips it.
// Browsers with `field-sizing: content` size the box themselves; everywhere
// else the box is measured on every change (see components/ops/useAutoGrow.js).

export const AUTO_GROW_CLASS = "resize-none overflow-hidden [field-sizing:content]";

/** Sets a textarea's height to fit all of its text, border included. */
export function fitHeight(node) {
  if (!node || !node.style) return;
  node.style.height = "auto";
  // scrollHeight leaves out the border; add it back so nothing is clipped.
  const border = Math.max(0, (node.offsetHeight || 0) - (node.clientHeight || 0));
  node.style.height = `${node.scrollHeight + border}px`;
}
