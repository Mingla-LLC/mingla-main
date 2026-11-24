/**
 * #4490 08-O5 fix 2 (O5-B1) — which Team rows open the member sheet.
 *
 * Pending and accepted rows always do. Your own row ("self") is informational
 * until the Till is released; once it is, it opens a read-only sheet whose only
 * control is your own Till PIN (a member can set their own PIN from nowhere
 * else). Never an inert row while a control for it exists: no dead tap.
 */
export interface TeamRowLike {
  status: "pending" | "self" | "accepted";
  storeEntry: unknown;
}

export function rowTappable(row: TeamRowLike, tillReleased: boolean): boolean {
  if (row.status !== "self") return true;
  return tillReleased && row.storeEntry !== null;
}

/**
 * The "You're working solo" screen lists no rows, so a solo operator (the owner
 * of a one-person brand, or any member whose brand shows only them) would have
 * nowhere to set a PIN: show their own row above it while it is tappable.
 */
export function showSelfRowAboveEmpty(rows: readonly TeamRowLike[], tillReleased: boolean): boolean {
  return rows.length === 1 && rows[0].status === "self" && rowTappable(rows[0], tillReleased);
}
