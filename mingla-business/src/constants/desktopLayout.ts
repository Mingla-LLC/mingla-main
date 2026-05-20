/**
 * Desktop web layout constants for the Mingla Business shell.
 *
 * These values are intentionally kept in a plain `.ts` module so regression
 * tests can import them without pulling JSX through the hook test runner.
 */

/**
 * Fixed left rail width on desktop web.
 */
export const DESKTOP_RAIL_WIDTH = 80;

/**
 * Compact bezel between persistent desktop chrome and page content.
 */
export const DESKTOP_BEZEL_MARGIN = 12;

/**
 * Breathing room between the browser chrome/top viewport edge and Mingla's
 * desktop top bar.
 */
export const DESKTOP_TOP_INSET = 16;

/**
 * Hub index screens use four equal columns on desktop web so long event,
 * experience, and trip lists scan like an operations board.
 */
export const DESKTOP_HUB_GRID_COLUMNS = 4;

/**
 * Desktop wizard rail gives creation flows a navigable left pane while the
 * form stays in a readable column.
 */
export const DESKTOP_WIZARD_RAIL_WIDTH = 260;
export const DESKTOP_WIZARD_FORM_MAX_WIDTH = 1120;
