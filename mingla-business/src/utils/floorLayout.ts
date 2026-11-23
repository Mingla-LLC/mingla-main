/**
 * #4490 spec 08 §2 — the floor screens' width classes, on every platform:
 * phone < 600, tablet 600–1023, desk ≥ 1024 (from the window, so a tablet in
 * either orientation and a resized browser get the same answer). Pure; the
 * hook `useFloorLayout` reads the window and calls this. `useResponsiveLayout`
 * is not used here: its `isWideDesktop` is web-only by contract.
 */
export type FloorLayout = "phone" | "tablet" | "desk";

export function floorLayoutFor(width: number): FloorLayout {
  if (width >= 1024) return "desk";
  if (width >= 600) return "tablet";
  return "phone";
}

/**
 * The station board (spec 08 §2 screen 12): Tabs on a phone, three columns
 * (New · Cooking · Ready) at tablet and desk widths.
 */
export function stationBoardColumns(layout: FloorLayout): boolean {
  return layout !== "phone";
}
