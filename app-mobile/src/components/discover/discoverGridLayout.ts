export const DISCOVER_GRID_SIDE_PADDING = 16;
export const DISCOVER_GRID_GAP = 12;

/**
 * Keep exactly two cards inside the measured viewport, including both side
 * paddings and the inter-card gap. Percentage widths can overflow narrow
 * screens because Yoga adds `gap` after resolving the percentages.
 */
export function discoverGridCellWidth(viewportWidth: number): number {
  const contentWidth = Math.max(
    0,
    viewportWidth - DISCOVER_GRID_SIDE_PADDING * 2,
  );

  return Math.max(0, (contentWidth - DISCOVER_GRID_GAP) / 2);
}
