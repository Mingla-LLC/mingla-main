/**
 * #4347 wave 4 — the leaf half of the venue page's Explorer layer: the error
 * boundary. Imports only React, so the venue route can hold it statically while
 * VenueExplorerLayer (i18n, React Query, ActionButtons and the calendar stack)
 * loads lazily, exactly like the #4111 Message add-on. A load or render failure
 * hides only the Explorer block and is reported; the host's page stays up.
 */
import React from "react";

interface BoundaryState {
  failed: boolean;
}

export class VenueExplorerBoundary extends React.Component<
  { children: React.ReactNode; part: string; onError?: (part: string, error: unknown) => void },
  BoundaryState
> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn(
      `[venue-explorer] ${this.props.part} hidden after an error`,
      error instanceof Error ? error.message : String(error),
    );
    this.props.onError?.(this.props.part, error);
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
