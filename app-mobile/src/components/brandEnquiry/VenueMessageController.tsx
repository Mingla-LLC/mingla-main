/**
 * #4111 Wave D (D6) — "Message {Brand}" on the consumer venue page, isolated.
 *
 * The venue page is the shared PublicVenueScreen; its Message button is an
 * optional add-on. This component owns the message controller (i18n, the
 * profile query, the lazy sheet host) and hands the route an opener once the
 * brand is known to take messages (null until then: no dead Message button).
 * The route loads this module LAZILY (a deferred require) after its first
 * commit, inside VenueMessageBoundary: requiring the venue route never loads
 * i18n, React Query or the message stack, and a failure here can only hide
 * the Message button, never take the venue page down.
 */
import React, { useEffect } from "react";
import type { EnquiryVenue } from "@mingla/brand-rendering/enquiry/enquiryTopics";

import type { ExplorerBrandTarget } from "./explorerBrandMessageTypes";
import type { VenueMessageOpener } from "./venueMessageBoundary";
import { useExplorerBrandMessage } from "./useExplorerBrandMessage";

export type { VenueMessageOpener } from "./venueMessageBoundary";

export interface VenueMessageControllerProps {
  brand: ExplorerBrandTarget;
  venue: EnquiryVenue;
  onOpener: (opener: VenueMessageOpener | null) => void;
}

export default function VenueMessageController({
  brand,
  venue,
  onOpener,
}: VenueMessageControllerProps): React.ReactElement {
  const message = useExplorerBrandMessage({ brand, entry: "offering", venue });
  const { available, open } = message;
  useEffect(() => {
    onOpener(available ? { open: () => open({ contextKind: "venue", contextId: venue.id }) } : null);
  }, [available, onOpener, open, venue.id]);
  useEffect(() => () => onOpener(null), [onOpener]);
  return <>{message.overlays}</>;
}
