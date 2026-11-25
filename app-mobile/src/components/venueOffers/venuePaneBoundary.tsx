/**
 * #4490 Explorer W3 — the leaf error boundary around a lazily loaded venue
 * page pane. Imports only React and React Native, so the venue route can hold
 * it at module scope while the pane (in-app browser, analytics, React Query)
 * loads lazily. A load or render failure never leaves a blank tab: it shows
 * the §6 line with "Try again", which mounts the pane afresh.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontWeights, radius, spacing, typography } from "../../constants/designSystem";

interface Props {
  children: React.ReactNode;
  textColor: string;
  borderColor: string;
  onError?: (error: unknown) => void;
}

interface State {
  failed: boolean;
  attempt: number;
}

export class VenuePaneBoundary extends React.Component<Props, State> {
  state: State = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn("[venue-pane] hidden after an error", error instanceof Error ? error.message : String(error));
    this.props.onError?.(error);
  }

  private retry = (): void => {
    this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));
  };

  render(): React.ReactNode {
    if (!this.state.failed) {
      return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    }
    return (
      <View style={styles.wrap} testID="venue-pane-failed">
        <Text style={[styles.line, { color: this.props.textColor }]}>Something went wrong. Try again.</Text>
        <Pressable
          onPress={this.retry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={[styles.retry, { borderColor: this.props.borderColor }]}
        >
          <Text style={[styles.retryLabel, { color: this.props.textColor }]}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, alignItems: "flex-start" },
  line: { ...typography.sm },
  retry: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
  },
  retryLabel: { ...typography.sm, fontWeight: fontWeights.semibold },
});
