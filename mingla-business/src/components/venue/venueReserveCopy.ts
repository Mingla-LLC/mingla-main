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
 * #1558 SUPERSEDES THE BOOLEAN. The wording is no longer decided here — it is
 * `profile.reserveAction`, one string per venue category, read straight off the
 * total `VENUE_CATEGORY_PROFILES` table. That is what stopped a gallery and a
 * climbing gym being invited to "Reserve a table": a boolean has two arms and
 * there are five categories, so the third, fourth and fifth silently inherited
 * the restaurant's words.
 *
 * `PublicVenuePage` now reads `profile.reserveAction` directly. What remains
 * below is a boolean-shaped ADAPTER that resolves through the same table, so
 * the two can never disagree.
 *
 * [TRANSITIONAL] boolean adapter — its only remaining caller is the #1532
 * render suite (`stayManagerUx.issue1532.render.test.tsx`), which pins the two
 * strings this file used to own. EXIT CONDITION: delete this module when #1559
 * moves the venue page into `packages/brand-rendering` and that suite is
 * repointed at `VENUE_CATEGORY_PROFILES`.
 */
import {
  VENUE_CATEGORY_PROFILES,
} from "@mingla/brand-rendering/venueCategoryProfile";

/**
 * The reserve action, in the guest's words, for the two categories a boolean
 * can express. Reads the profile table — it does not hold copy of its own.
 */
export function reserveActionLabel(isStay: boolean): string {
  return VENUE_CATEGORY_PROFILES[isStay ? "stay" : "restaurant"].reserveAction;
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
