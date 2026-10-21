/**
 * #4037 — the host traffic dashboard is code-split off the eager web boot path.
 *
 * The dashboard (charts, cards, contracts) is only needed on Analytics and
 * Listing insights, but those screens sit next to Home in the tab bundle, so a
 * static import put ~30 KB into the shared `__common` chunk every visitor loads
 * (bundle-budget gate, issue #943). This wrapper keeps the same component name
 * and props, loads the real dashboard on first render, shows the analytics
 * skeleton meanwhile, and shows a retryable error if the chunk cannot load.
 *
 * Only `import type` from the dashboard here: a value import would pull it back
 * into `__common`.
 */
import React, { Suspense, useCallback, useState } from "react";
import type { TrafficAnalyticsDashboardProps } from "./TrafficAnalyticsDashboard";
import {
  AnalyticsModuleError,
  AnalyticsModuleSkeleton,
} from "./AnalyticsModuleState";

const loadDashboard = () =>
  React.lazy(async () => {
    const mod = await import("./TrafficAnalyticsDashboard");
    return { default: mod.TrafficAnalyticsDashboard };
  });

class DashboardLoadBoundary extends React.Component<
  { onRetry: () => void; children: React.ReactNode },
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
    if (this.state.failed) {
      return (
        <AnalyticsModuleError
          title="Couldn't load analytics"
          onRetry={this.props.onRetry}
        />
      );
    }
    return this.props.children;
  }
}

export const TrafficAnalyticsDashboard: React.FC<
  TrafficAnalyticsDashboardProps
> = (props) => {
  const [attempt, setAttempt] = useState(0);
  const [Dashboard, setDashboard] = useState(loadDashboard);
  const retry = useCallback((): void => {
    setDashboard(loadDashboard);
    setAttempt((value) => value + 1);
  }, []);
  return (
    <DashboardLoadBoundary key={attempt} onRetry={retry}>
      <Suspense
        fallback={
          <AnalyticsModuleSkeleton testID="traffic-dashboard-loading" />
        }
      >
        <Dashboard {...props} />
      </Suspense>
    </DashboardLoadBoundary>
  );
};
