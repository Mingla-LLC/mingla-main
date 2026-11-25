/**
 * #4490 — the Team sheet's Till PIN section, loaded from the Host venue owner
 * (venueHostScreens.ts) only while the Till is released. The PIN pad, the PIN
 * words and the PIN calls are Till code: importing them here statically put
 * them in the Team page's chunk AND the Host owner's, which web export hoists
 * into the eager `__common` chunk every visitor (guests included) downloads.
 */
import React from "react";

import { useTillReleased } from "../../hooks/useTillReleased";
import { createRetryableLazyErrorBoundary } from "../ui/RetryableLazyBoundary";
import { loadVenueHostScreens } from "../venue/host/venueHostOwner";
import type { TillPinSectionProps } from "./TillPinSection";

const TillPinSectionLazy = createRetryableLazyErrorBoundary<TillPinSectionProps>(
  async () => ({ default: (await loadVenueHostScreens()).TillPinSection }),
  { loadingLabel: "Loading Till PIN" },
);

export function LazyTillPinSection(props: TillPinSectionProps): React.ReactElement | null {
  // Not released: render nothing and load nothing (TillPinSection's own rule).
  const released = useTillReleased();
  if (!released) return null;
  return <TillPinSectionLazy {...props} />;
}
