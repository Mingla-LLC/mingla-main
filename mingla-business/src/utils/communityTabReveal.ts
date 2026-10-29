export type HorizontalFrame = { x: number; width: number };

/** Returns a new rail offset only when the selected tab is clipped. */
export function selectedCommunityTabOffset(input: {
  tab: HorizontalFrame;
  viewportWidth: number;
  currentOffset: number;
  contentWidth: number;
  edgePadding?: number;
}): number | null {
  const edgePadding = input.edgePadding ?? 4;
  const visibleLeft = input.currentOffset + edgePadding;
  const visibleRight = input.currentOffset + input.viewportWidth - edgePadding;
  const tabLeft = input.tab.x;
  const tabRight = input.tab.x + input.tab.width;

  if (tabLeft >= visibleLeft && tabRight <= visibleRight) return null;
  const wanted = tabLeft < visibleLeft
    ? tabLeft - edgePadding
    : tabRight - input.viewportWidth + edgePadding;
  return Math.max(0, Math.min(wanted, Math.max(0, input.contentWidth - input.viewportWidth)));
}
