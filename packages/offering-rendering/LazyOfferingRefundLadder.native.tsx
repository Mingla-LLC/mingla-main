/**
 * Native public-page loading boundary.
 *
 * MINGLA-INVARIANT: I-3988-NATIVE-PUBLIC-PAGES-NO-WEB-CHUNKS | issue #3988 |
 * Native offering details render their shared secondary sections from the main
 * Metro bundle; they must not use deferred chunk loading because production
 * Metro has no browser `location` from which to resolve a web-style chunk URL.
 * The unsuffixed twin retains web's deferred loading and bundle budget.
 */

import type { FollowerCountLineProps } from "./FollowerCountLine";
import { FollowerCountLine } from "./FollowerCountLine";
import * as OfferingRefundLadderModule from "./OfferingRefundLadder";
import type { OfferingRefundLadderProps } from "./OfferingRefundLadder";
import { SaleAvailabilityText } from "./SaleAvailabilityText";
import type { SaleAvailabilityTextProps } from "./SaleAvailabilityText";

export { reservedLadderHeight } from "./offeringRefundLadderReservation";

export const loadOfferingRefundLadder = async () =>
  OfferingRefundLadderModule;

export const LazyOfferingRefundLadder = (props: OfferingRefundLadderProps) => (
  <OfferingRefundLadderModule.OfferingRefundLadder {...props} />
);

export function LazyFollowerCountLine(props: FollowerCountLineProps) {
  return <FollowerCountLine {...props} />;
}

export function LazySaleAvailabilityText(props: SaleAvailabilityTextProps) {
  return <SaleAvailabilityText {...props} />;
}
