/**
 * #4453 — what a tap on a notification row does: the first tap opens the row
 * to its full text; a tap on an open row follows its link when it has one,
 * and folds the row when it has none.
 */
export function nextRowTap(expanded: boolean, hasTarget: boolean): "expand" | "open" | "collapse" {
  if (!expanded) return "expand";
  return hasTarget ? "open" : "collapse";
}
