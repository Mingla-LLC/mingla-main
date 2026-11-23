/**
 * #4490 spec 08 O5 part B — where Close the day lives. Entry points (the venue
 * rail, the Till) only navigate here; the screen is its own route chunk.
 */

export function closeHref(venueId: string): string {
  return `/venue/${venueId}/close`;
}

/** The Till settings screen (Settings › Selling in person). */
export function tillSettingsHref(venueId: string): string {
  return `/venue/${venueId}/till-settings`;
}

/**
 * Who sees "Close the day": the Till released at the venue, its Sell in
 * person feature on, and money rights (issue_4490_can_manage_money). The
 * server checks all three again on every call.
 */
export function closeEntryVisible(input: { released: boolean; tillOn: boolean; canManageMoney: boolean }): boolean {
  return input.released && input.tillOn && input.canManageMoney;
}

/** The launcher a money-only login lands on inside the workspace. */
export const CLOSE_LAUNCHER_COPY = {
  title: "Close the day",
  body: "Count the cash, see the day's takings by payment type and by person, and close the day.",
  open: "Open Close the day",
} as const;
