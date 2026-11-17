/** Name column floor (px): "Facebook & Instagram · Nov 16" needs ~192 plus the row gap (#4238 rework 4). */
export const HOST_AD_NAME_COL_MIN = 220;

/** Status column floor (px). */
export const HOST_AD_STATUS_COL_MIN = 120;
/** Money columns (Spent, Each) floor (px): a code and amount never break. */
export const HOST_AD_MONEY_COL_MIN = 112;
/** Results column (px) at its narrowest ("12 sales"). */
export const HOST_AD_RESULTS_COL_MIN = 64;

/**
 * #4238 W7 (native verdict P3-1): the narrowest the ads table can be without
 * scrolling sideways: the five columns, four 16 px gaps and 20 px padding
 * either side. At 1280 the main column is ~576 px, so the table's "Each"
 * column used to sit out of view.
 */
export const HOST_AD_TABLE_MIN_WIDTH =
  HOST_AD_NAME_COL_MIN +
  HOST_AD_STATUS_COL_MIN +
  2 * HOST_AD_MONEY_COL_MIN +
  HOST_AD_RESULTS_COL_MIN +
  4 * 16 +
  2 * 20;

/**
 * The table only where every column fits; a narrower main column (1280
 * with the side column) gets the list rows, which show the same facts. Before
 * the first layout (width 0) the wide-desktop answer stands.
 */
export function hostAdListUsesTable(isWideDesktop: boolean, mainWidth: number): boolean {
  if (!isWideDesktop) return false;
  return mainWidth <= 0 || mainWidth >= HOST_AD_TABLE_MIN_WIDTH;
}
