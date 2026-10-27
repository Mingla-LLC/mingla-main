/**
 * #4111 — keeps an optional, lazily-loaded add-on (the venue page's Message
 * controller) from taking the page down: if its chunk fails to load or it
 * throws, the add-on renders nothing and the failure is logged, never thrown.
 */
import React from "react";

interface Props {
  name: string;
  children: React.ReactNode;
}

interface State {
  failed: boolean;
}

export class OptionalFeatureBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn(
      `[optional-feature] ${this.props.name} failed and was hidden`,
      error instanceof Error ? error.message : String(error),
    );
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
