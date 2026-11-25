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
 * The station board (spec 08 §2 screen 12, floor-design "Landscape tablet and
 * desktop: three columns. Phone: tabs."): three columns (New · Cooking ·
 * Ready) at desk widths and on a tablet held in landscape; Tabs on a phone and
 * on a tablet in portrait (O3 part B; part A gave a tablet columns in both).
 * Without a height (older callers) a tablet keeps columns.
 */
export function stationBoardColumns(layout: FloorLayout, width?: number, height?: number): boolean {
  if (layout === "phone") return false;
  if (layout === "desk") return true;
  if (width === undefined || height === undefined) return true;
  return width > height;
}
