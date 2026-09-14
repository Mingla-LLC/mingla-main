/**
 * issue #3313 — the "your event is live" toast names how many dates the SERVER
 * created.
 *
 * The pre-publish dialog counts a recurring rule on the phone. It used to say
 * "8 occurrences will be created" while the database kept one, and nothing
 * after publishing contradicted it. The toast now reads the count back from
 * the publish response, so a mismatch is visible the moment it happens.
 *
 * One date (or an unknown count) keeps the original sentence exactly.
 */
export const formatEventLiveToast = (
  name: string,
  occurrenceCount: number | null | undefined,
): string =>
  typeof occurrenceCount === "number" && occurrenceCount > 1
    ? `${name} is live with ${occurrenceCount} dates.`
    : `${name} is live.`;
