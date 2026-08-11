// #1890 [keyboard-clearance-overshoot] — the ONE occluder budget, web side.
//
// Same names as keyboardClearance.native.ts, so a platform-agnostic screen can
// import them unconditionally and never read `undefined` on web. That is not a
// hypothetical: #1850 documented the same trap on the SmartScrollView split —
// a name present on only one side of the split evaluates to `undefined` on the
// other platform, and any budget built from it becomes NaN with no error
// anywhere.
//
// Zero is the honest web value, not a placeholder: web has no soft keyboard
// that overlaps content, so there is no Done bar above it and nothing to clear.
// It is NOT measured-and-rounded-down — there is no bar to measure
// (Constitution rule 9: missing is zero-by-argument, never a fabricated
// number).

/** The bar's own height. Mirrors the library's KEYBOARD_TOOLBAR_HEIGHT. */
export const KEYBOARD_TOOLBAR_HEIGHT = 42;

/** No system keyboard on web, so the library's rounded-corner rule never fires. */
export const KEYBOARD_HAS_ROUNDED_CORNERS = false;

/** The library's own OPENED_OFFSET, on a platform where the bar never mounts. */
export const OPENED_OFFSET = 0;

/** No Done bar on web — nothing occupies space above a keyboard that never opens. */
export const DONE_BAR_OCCUPIED = 0;

/** The visible gap every keyboard-compensating surface promises ABOVE the bar. */
export const MIN_VISIBLE_CLEARANCE = 12;

/** There is no raw-<Modal> keyboard window on web, and no bar to be present in it. */
export const DONE_BAR_PRESENT_IN_RAW_MODAL = false;
