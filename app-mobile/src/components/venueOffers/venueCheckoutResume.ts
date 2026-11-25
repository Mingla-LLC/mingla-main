/**
 * #4490 spec 06 W4 fix 1 (W4-N4; spec 06 §5 and §13 item 5, binding): a
 * signed-out guest mid-checkout keeps their choices and comes back to the
 * same step after signing in.
 *
 * When the session ends with the checkout sheet open, the sheet keeps what it
 * had (the reducer state, the step-1 choice, the server's quote or plan
 * amount, the guest's details) HERE, in this module's memory, keyed by the
 * account of the session that ended. "Sign in again" routes to sign-in.
 * After a sign-in:
 *   - the SAME account: the app goes back to the same venue tab (or the same
 *     Purchases booking), and the pane there takes the snapshot once and
 *     reopens the sheet on the same offer and step with the picks kept;
 *   - another account: the snapshot is dropped, unseen.
 * Nothing here is ever written to disk (no AsyncStorage, no SecureStore): it
 * lives for this app session only.
 *
 * #4490 06-W4 fix 2 (W4-D1): this module sits OUTSIDE the React tree on
 * purpose. A forced sign-out clears the store, removes the cached queries and
 * swaps the app root to the welcome screen; the venue route, its pane and the
 * sheet unmount, and sign-in remounts the main app component keyed on the
 * account. Only module memory survives that. Expiry: the app being killed
 * (memory only), or KEPT_FOR_MS after it was kept, whichever comes first; a
 * held booking's own hold is re-read on return (an expired hold restarts at
 * the choose step with the picks kept). A held booking is re-read with the new
 * session before it can be paid (the sheet does that), never trusted from
 * memory.
 */
import type { VenuePlanCharge } from "@mingla/brand-rendering/venueFeaturePage";
import type { PublicVenueTab } from "@mingla/brand-rendering/publicVenueTabState";

import type { VenueCheckoutKind, VenueCheckoutState } from "../../payments/venueOfferCheckoutFlow";
import type { VenueCheckoutChoice, VenueGuestDetails, VenueReviewQuote } from "./venueCheckoutModel";
import type { VenueCheckoutOpen } from "./VenueOfferCheckoutSheet";

export interface VenueCheckoutSnapshot {
  /** The account whose session ended. */
  readonly accountId: string;
  /** Where the checkout lives (the venue tab, or the Purchases booking). */
  readonly route: string;
  /** Which mounted home may take it back (`venueCheckoutHomeKey`). */
  readonly homeKey: string;
  readonly open: VenueCheckoutOpen;
  readonly state: VenueCheckoutState;
  readonly choice: VenueCheckoutChoice | null;
  readonly review: VenueReviewQuote | null;
  readonly planDue: VenuePlanCharge | null;
  readonly guest: VenueGuestDetails;
}

let held: VenueCheckoutSnapshot | null = null;
let keptAt = 0;

/** #4490 06-W4 fix 2 (W4-D1): a kept checkout is dropped 30 minutes after it was kept. */
export const KEPT_FOR_MS = 30 * 60 * 1000;

/** Drop the kept checkout when it is older than KEPT_FOR_MS. */
function expireKept(now: number): void {
  if (held !== null && now - keptAt > KEPT_FOR_MS) held = null;
}

const TAB_FOR_KIND: Record<VenueCheckoutKind, PublicVenueTab> = {
  entry: "entry",
  group_package: "groups",
  private_hire: "hire",
  by_the_hour: "by_the_hour",
  plan: "plans",
};

/** The home that may reopen a checkout: a venue pane (by venue and kind) or a Purchases booking. Pure. */
export function venueCheckoutHomeKey(open: VenueCheckoutOpen): string {
  return open.from === "venue"
    ? `venue:${open.brandSlug}:${open.venueSlug}:${open.kind}`
    : `pay:${open.booking.id}`;
}

/** The route back to that home. Pure. */
export function venueCheckoutRouteFor(open: VenueCheckoutOpen): string {
  return open.from === "venue"
    ? `/b/${encodeURIComponent(open.brandSlug)}/v/${encodeURIComponent(open.venueSlug)}?tab=${TAB_FOR_KIND[open.kind]}`
    : `/purchases/venue_booking/${encodeURIComponent(open.booking.id)}`;
}

/** Keep the checkout of a session that just ended (one at a time; the newest wins). */
export function holdVenueCheckout(snapshot: VenueCheckoutSnapshot, now: number = Date.now()): void {
  held = snapshot;
  keptAt = now;
}

/** Forget it (the guest closed the sheet instead of signing in). */
export function dropVenueCheckout(): void {
  held = null;
}

/**
 * Right after a sign-in: the route back when the SAME account signed in;
 * another account drops the snapshot and gets null.
 */
export function venueCheckoutRouteAfterSignIn(accountId: string, now: number = Date.now()): string | null {
  expireKept(now);
  if (held === null) return null;
  if (held.accountId !== accountId) {
    held = null;
    return null;
  }
  return held.route;
}

/** The mounted home takes its snapshot back, once, for the same account only. */
export function takeVenueCheckout(accountId: string, homeKey: string, now: number = Date.now()): VenueCheckoutSnapshot | null {
  expireKept(now);
  if (held === null || held.accountId !== accountId || held.homeKey !== homeKey) return null;
  const snapshot = held;
  held = null;
  return snapshot;
}

/**
 * The venue pane's take: for whoever is signed in now. Reads the session only
 * when something is held (so a screen with nothing kept never loads the store).
 */
export function takeVenueCheckoutForSignedIn(homeKey: string): VenueCheckoutSnapshot | null {
  if (held === null) return null;
  let accountId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require("../../store/appStore") as typeof import("../../store/appStore");
    accountId = useAppStore.getState().user?.id ?? null;
  } catch {
    accountId = null;
  }
  return accountId === null ? null : takeVenueCheckout(accountId, homeKey);
}

/** Test seam: what is held now (no copy). */
export function heldVenueCheckoutForTests(): VenueCheckoutSnapshot | null {
  return held;
}
