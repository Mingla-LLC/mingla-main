// #4339 round A (Seth, 8 Nov): no orphan tiles on phones. In a 2-column tile
// grid with an odd number of tiles on screen, the last one spans both columns
// (site.css, max-width 640px). Static grids do this in CSS alone; a grid whose
// shown count changes at runtime marks its last shown tile with this.

/** True for the last shown tile when the shown count is odd. */
export function orphanTile(index: number, shownCount: number): boolean {
  return shownCount % 2 === 1 && index === shownCount - 1
}
