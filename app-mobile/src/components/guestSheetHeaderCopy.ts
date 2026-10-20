/**
 * issue #3827 going-box — the "Who's going" sheet header subtitle.
 *
 * `goingCount` is the REAL count (Mingla tickets / RSVPs); it alone drives the
 * "and N more" tail. `extraGuestCount` (guests on the host's own list) is added
 * to the headline number and disclosed beside it, so the total is never
 * presented as Mingla RSVPs or sales (Constitution rule 9).
 *
 * `privateOthersCount` (#3682) is a subset of the real count, not an addend —
 * never prefixed with "+".
 */
export const guestSheetHeaderSubtitle = (
  goingCount: number,
  extraGuestCount: number,
  privateOthersCount: number,
): string => {
  const real = Number.isFinite(goingCount) && goingCount > 0 ? Math.floor(goingCount) : 0;
  const extra =
    Number.isFinite(extraGuestCount) && extraGuestCount > 0 ? Math.floor(extraGuestCount) : 0;
  const parts = [`${real + extra} going`];
  if (extra > 0) parts.push(`${extra} on the host's list`);
  if (privateOthersCount > 0) parts.push(`${privateOthersCount} keep it private`);
  return parts.join(" · ");
};
