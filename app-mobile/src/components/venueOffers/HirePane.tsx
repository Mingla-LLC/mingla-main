/** #4490 Explorer W3 — the venue page's native Private hire pane (see VenueOfferPane). */
import React from "react";

import { VenueOfferPane, type VenueOfferPaneProps } from "./VenueOfferPane";

export function HirePane(props: Omit<VenueOfferPaneProps, "kind">): React.ReactElement {
  return <VenueOfferPane {...props} kind="hire" />;
}
