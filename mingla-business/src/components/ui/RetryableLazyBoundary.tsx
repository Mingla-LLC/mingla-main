import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { spacing, text, typography } from "../../constants/designSystem";
import { ErrorBoundary } from "./ErrorBoundary";

type LazyLoader<Props extends object> = () => Promise<{
  default: React.ComponentType<Props>;
}>;

interface RetryableLazyOptions {
  loadingLabel: string;
  accessibilityLiveRegion?: "none" | "polite" | "assertive";
  style?: StyleProp<ViewStyle>;
}

export function RetryableLazyErrorBoundary<Props extends object>({
  loader,
  componentProps,
  loadingLabel,
  accessibilityLiveRegion = "polite",
  style,
}: {
  loader: LazyLoader<Props>;
  componentProps: Props;
  loadingLabel: string;
  accessibilityLiveRegion?: "none" | "polite" | "assertive";
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const [generation, setGeneration] = React.useState(0);
  const LazyComponent = React.useMemo(() => {
    void generation;
    return React.lazy(loader);
  }, [generation, loader]);
  const retry = React.useCallback((): void => {
    setGeneration((current) => current + 1);
  }, []);

  return (
    <ErrorBoundary key={generation} onReset={retry} style={style}>
      <React.Suspense
        fallback={(
          <View style={styles.loading}>
            <Text accessibilityLiveRegion={accessibilityLiveRegion} style={styles.loadingText}>
              {loadingLabel}
            </Text>
          </View>
        )}
      >
        {React.createElement(LazyComponent, componentProps)}
      </React.Suspense>
    </ErrorBoundary>
  );
}

export function createRetryableLazyErrorBoundary<Props extends object>(
  loader: LazyLoader<Props>,
  options: RetryableLazyOptions,
): React.ComponentType<Props> {
  return function RetryableLazyComponent(props: Props): React.ReactElement {
    return (
      <RetryableLazyErrorBoundary
        loader={loader}
        componentProps={props}
        loadingLabel={options.loadingLabel}
        accessibilityLiveRegion={options.accessibilityLiveRegion}
        style={options.style}
      />
    );
  };
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
  },
  loadingText: {
    ...typography.bodySm,
    color: text.secondary,
  },
});
