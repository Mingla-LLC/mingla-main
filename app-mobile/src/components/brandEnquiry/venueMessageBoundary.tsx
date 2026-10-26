/**
 * #4111 — the leaf half of the venue page's Message add-on: the opener shape
 * and the boundary. Imports only React, so the venue route can hold it
 * statically while VenueMessageController (i18n, React Query, the message
 * stack) loads lazily.
 */
import React from "react";

export interface VenueMessageOpener {
  open: () => void;
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
