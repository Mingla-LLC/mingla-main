/** #4490 Explorer W3 — the venue page's native By the hour pane (see VenueOfferPane). */
import React from "react";

import { VenueOfferPane, type VenueOfferPaneProps } from "./VenueOfferPane";

export function HourPane(props: Omit<VenueOfferPaneProps, "kind">): React.ReactElement {
  return <VenueOfferPane {...props} kind="by_the_hour" />;
}
