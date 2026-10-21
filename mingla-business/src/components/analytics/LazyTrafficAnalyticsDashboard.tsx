/**
 * #4037 — the host traffic dashboard is code-split off the eager web boot path.
 *
 * The dashboard (charts, cards, contracts) is only needed on Analytics and
 * Listing insights, but a static import from both screens put ~30 KB into the
 * shared `__common` chunk every visitor loads (bundle-budget gate, #943). This
 * wrapper keeps the same component name and props, loads the real dashboard on
 * first render, shows a loading state meanwhile, and a retryable error if the
 * chunk cannot load.
 *
 * Only `import type` from the dashboard, and only React Native primitives and
 * tokens here: anything heavier would be hoisted back into `__common`, since
 * both screens import this file.
 */
import React, { Suspense, useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { TrafficAnalyticsDashboardProps } from "./TrafficAnalyticsDashboard";

const loadDashboard = () =>
  React.lazy(async () => {
    const mod = await import("./TrafficAnalyticsDashboard");
    return { default: mod.TrafficAnalyticsDashboard };
  });

const LoadingDashboard: React.FC = () => (
  <View
    style={styles.loading}
    testID="traffic-dashboard-loading"
    accessibilityLabel="Loading analytics"
  >
    <ActivityIndicator color={accent.warm} />
  </View>
);

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
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.error}>
        <Text style={styles.errorTitle} accessibilityRole="header">
          Couldn&apos;t load analytics
        </Text>
        <Text style={styles.errorBody}>
          Check your connection and try again.
        </Text>
        <Pressable
          onPress={this.props.onRetry}
          accessibilityRole="button"
          style={styles.retry}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
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
      <Suspense fallback={<LoadingDashboard />}>
        <Dashboard {...props} />
      </Suspense>
    </DashboardLoadBoundary>
  );
};

const styles = StyleSheet.create({
  loading: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
  },
  error: { minHeight: 180, padding: spacing.lg },
  errorTitle: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  errorBody: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.sm,
  },
  retry: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  retryText: {
    color: accent.warm,
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
  },
});
