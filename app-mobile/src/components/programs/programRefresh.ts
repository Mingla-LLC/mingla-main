/**
 * #3872 — when a Creator screen re-reads its data.
 *
 * The app's queries stay fresh for five minutes, so a contract reopened from a
 * notification or a link, or the app coming back from the background, showed
 * the old copy (or a stale "isn't available") until a pull-to-refresh. Program
 * screens re-read on every focus and whenever the app returns to the foreground.
 *
 * Pure on purpose (no imports): the unit suite runs it under node directly.
 */

/** True only on the move into the foreground (background/inactive → active). */
export function isForegroundReturn(previous: string | null | undefined, next: string): boolean {
  return next === 'active' && previous !== 'active';
}

/** Refetch options that join a fetch already in flight instead of cancelling it (no refetch loops). */
export const JOIN_IN_FLIGHT = { cancelRefetch: false } as const;
