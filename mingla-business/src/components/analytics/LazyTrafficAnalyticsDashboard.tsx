/**
 * #4037 — the host traffic dashboard is code-split off the eager web boot path.
 *
 * The dashboard (charts, cards, contracts) is only needed on Analytics and
 * Listing insights, but a static import from both screens put ~30 KB into the
 * shared `__common` chunk every visitor loads (bundle-budget gate, #943). This
 * wrapper keeps the same component name and the dashboard's props, loads the
 * real dashboard on first render, and shows the calling screen's own loading
 * and retryable error UI. It carries no UI of its own on purpose: both screens
 * import it, so whatever it imports is hoisted into `__common`.
 *
 * Only `import type` from the dashboard here; a value import would pull it back.
 */
import React, { Suspense, useCallback, useState } from "react";
import type { TrafficAnalyticsDashboardProps } from "./TrafficAnalyticsDashboard";

const loadDashboard = () =>
  React.lazy(async () => {
    const mod = await import("./TrafficAnalyticsDashboard");
    return { default: mod.TrafficAnalyticsDashboard };
  });

class LoadBoundary extends React.Component<
  { renderError: () => React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn(
      "[analytics] traffic dashboard failed to load",
      error instanceof Error ? error.message : String(error),
    );
  }

  render(): React.ReactNode {
    return this.state.failed ? this.props.renderError() : this.props.children;
  }
}

export interface LazyTrafficAnalyticsDashboardProps extends TrafficAnalyticsDashboardProps {
  /** Shown while the dashboard code loads (never a blank screen). */
  loadingFallback: React.ReactNode;
  /** Shown if the dashboard code cannot load; call `retry` to try again. */
  renderLoadError: (retry: () => void) => React.ReactNode;
}

export const TrafficAnalyticsDashboard: React.FC<
  LazyTrafficAnalyticsDashboardProps
> = ({ loadingFallback, renderLoadError, ...props }) => {
  const [attempt, setAttempt] = useState(0);
  const [Dashboard, setDashboard] = useState(loadDashboard);
  const retry = useCallback((): void => {
    setDashboard(loadDashboard);
    setAttempt((value) => value + 1);
  }, []);
  return (
    <LoadBoundary key={attempt} renderError={() => renderLoadError(retry)}>
      <Suspense fallback={loadingFallback}>
        <Dashboard {...props} />
      </Suspense>
    </LoadBoundary>
  );
};
