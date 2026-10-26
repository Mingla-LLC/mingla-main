/**
 * #4111 Wave D (D6) — "Message {Brand}" on the consumer venue page, isolated.
 *
 * The venue page is the shared PublicVenueScreen; its Message button is an
 * optional add-on. This component owns the message controller (i18n, the
 * profile query, the lazy sheet host) and hands the route an opener once the
 * brand is known to take messages (null until then: no dead Message button).
 * The route mounts it after its first commit inside VenueMessageBoundary, so a
 * failure here can only hide the button, never take the venue page down.
 */
import React, { useEffect } from "react";
import type { EnquiryVenue } from "@mingla/brand-rendering/enquiry/enquiryTopics";

import type { ExplorerBrandTarget } from "./explorerBrandMessageTypes";
import { useExplorerBrandMessage } from "./useExplorerBrandMessage";

export interface VenueMessageOpener {
  open: () => void;
}

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

interface BoundaryState {
  failed: boolean;
}

/** Hides the optional Message add-on (and logs) instead of crashing the page. */
export class VenueMessageBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn(
      "[venue-message] hidden after an error",
      error instanceof Error ? error.message : String(error),
    );
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
