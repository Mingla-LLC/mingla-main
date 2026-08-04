/**
 * #1532 [stay-manager-ux] §5 / D7 — ONE source for the reserve wording.
 *
 * THE DEFECT: a guest on a hotel's public page taps a CTA correctly labelled
 * "Reserve this Stay" and a sheet slides up headed "Reserve a table", directly
 * above `YOUR STAY · Check-in 15:00 · Check-out 11:00`. The heading and the
 * accessibility label were HARDCODED in `PublicVenueReservationSheet.tsx:74,76`
 * and the component took no category prop at all — it was structurally
 * incapable of saying anything else — while the very same file, ten lines
 * above the mount, already branched on `isStay` for the button that opens it.
 * The guest was told two different things about one action, two taps apart.
 *
 * THE SHAPE OF THE FIX MATTERS MORE THAN THE STRING. Passing a category down
 * would have left two call sites free to drift again. Instead the sheet's
 * `title` is a REQUIRED prop and both the CTA and the heading read this one
 * function, so the only way to make them disagree is to stop compiling.
 */

/**
 * The reserve action, in the guest's words.
 *
 * Restaurants keep "Reserve a table" verbatim — it is correct there and it is
 * what the whole restaurant surface already says.
 */
export function reserveActionLabel(isStay: boolean): string {
  return isStay ? "Reserve this Stay" : "Reserve a table";
}

/**
 * The reservation sheet's heading and screen-reader header label.
 *
 * Identical to the CTA on purpose: the sheet is the CTA's destination, and a
 * heading that renames the action the guest just chose is how a booking flow
 * loses people.
 */
export function reserveSheetTitle(isStay: boolean): string {
  return reserveActionLabel(isStay);
}
