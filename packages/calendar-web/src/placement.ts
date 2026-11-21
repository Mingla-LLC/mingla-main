/**
 * Where the calendar popover opens relative to its trigger (#4523). Pure, so it
 * is unit-tested without a browser: below the trigger when it fits, above when
 * only that fits, else on the side with more room (its scroll container then
 * handles the rest); aligned to the trigger's start unless that would run past
 * the viewport's right edge.
 */
export interface PlacementInput {
  triggerTop: number;
  triggerBottom: number;
  triggerLeft: number;
  popoverHeight: number;
  popoverWidth: number;
  viewportHeight: number;
  viewportWidth: number;
  gap?: number;
  margin?: number;
}

export interface Placement {
  vertical: "below" | "above";
  horizontal: "start" | "end";
}

export function choosePlacement(input: PlacementInput): Placement {
  const gap = input.gap ?? 6;
  const margin = input.margin ?? 8;
  const spaceBelow = input.viewportHeight - input.triggerBottom - gap - margin;
  const spaceAbove = input.triggerTop - gap - margin;
  const vertical: Placement["vertical"] =
    spaceBelow >= input.popoverHeight ? "below" : spaceAbove >= input.popoverHeight ? "above" : spaceAbove > spaceBelow ? "above" : "below";
  const horizontal: Placement["horizontal"] =
    input.triggerLeft + input.popoverWidth > input.viewportWidth - margin ? "end" : "start";
  return { vertical, horizontal };
}
