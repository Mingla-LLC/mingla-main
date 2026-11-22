/** #4490 spec 08 O1 — the Till route for a venue (opaque id only). */
export function tillHref(venueId: string): string {
  return `/venue/${venueId}/till`;
}

/** The Till destination inside a workspace (the launcher a Till-only login lands on). */
export const TILL_LAUNCHER_COPY = {
  title: "Till",
  body: "Sell anything you offer from one screen.",
  open: "Open the Till",
} as const;
