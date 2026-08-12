export function markRsvpPhoneTouchedById<
  T extends { id: string; phoneTouched: boolean },
>(rows: T[], guestId: string): T[] {
  return rows.map((row) => row.id === guestId
    ? { ...row, phoneTouched: true }
    : row);
}
