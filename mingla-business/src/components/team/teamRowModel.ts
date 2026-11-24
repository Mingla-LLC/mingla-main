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

/**
 * #4490 08-O5 fix 4: the member sheet's height. Half while it shows the
 * member; the tallest sheet while your own Till PIN pad is open, so the dots,
 * the whole keypad, OK and Close fit on a small phone without scrolling.
 */
export const MEMBER_SHEET_PIN_SNAP = 0.95;
export function memberSheetSnap(pinPadOpen: boolean): "half" | number {
  return pinPadOpen ? MEMBER_SHEET_PIN_SNAP : "half";
}

/**
 * #4490 08-O5 fix 4: the Team page when it lists nobody but you. Someone who
 * can invite runs the brand alone ("working solo"); a staff member who cannot
 * invite only sees themselves, so the page says that, not that they are solo.
 */
export const TEAM_EMPTY_COPY = {
  soloTitle: "You're working solo",
  soloBody: "Tap + to invite a team member.",
  staffTitle: "Your team is managed by your brand admin",
  staffBody: "You can see your own place here. Ask a brand admin to add or change team members.",
} as const;
export function teamEmptyCopy(canInvite: boolean): { title: string; description: string } {
  return canInvite
    ? { title: TEAM_EMPTY_COPY.soloTitle, description: TEAM_EMPTY_COPY.soloBody }
    : { title: TEAM_EMPTY_COPY.staffTitle, description: TEAM_EMPTY_COPY.staffBody };
}

/**
 * #4490 08-O5 fix 5: what the Team page shows. While the invitations or the
 * members are still loading it shows a loading list, never "You're working
 * solo" (that flashed before the members arrived). Loaded: the empty state
 * when nobody but you is listed, else the list.
 */
export type TeamListState = "loading" | "empty" | "list";
export function teamListState(input: { loading: boolean; pendingCount: number; acceptedCount: number }): TeamListState {
  if (input.loading) return "loading";
  return input.pendingCount === 0 && input.acceptedCount <= 1 ? "empty" : "list";
}

/**
 * #4490 08-O5 fix 6: the "Your role doesn't include this action" caption shows
 * only under a loaded list (role and people known), never while loading.
 */
export function teamGateCaptionShown(listState: TeamListState, canInvite: boolean): boolean {
  return !canInvite && listState === "list";
}
