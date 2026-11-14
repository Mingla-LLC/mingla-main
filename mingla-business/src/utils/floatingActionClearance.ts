/** Height of a floating action button plus a gap above it. */
export const FLOATING_ACTION_CLEARANCE = 72;

/**
 * Bottom padding for scroll content on a screen that shows a floating action
 * button over the bottom nav (#4238 ad screens, #4430 creator screens), so the
 * last button scrolls clear of both. Pure and tiny on purpose: eager screens
 * import it without pulling ad code into the shared bundle.
 */
export function scrollPaddingClearOfFloatingAction(
  stickyFooterOffset: number,
): number {
  return stickyFooterOffset + FLOATING_ACTION_CLEARANCE;
}
