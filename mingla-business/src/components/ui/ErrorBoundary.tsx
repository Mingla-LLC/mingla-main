/**
 * ErrorBoundary — wraps `react-error-boundary` with the Mingla Host
 * default fallback UI.
 *
 * Sentry hook is the optional `onError` prop — Cycle 14 wires
 * `@sentry/react-native` `captureException` here. For Cycle 0a the
 * default `onError` is undefined (no-op).
 *
 * Default fallback copy: "Something broke. We're on it." plus two
 * buttons — `Try again` (calls `resetErrorBoundary()`) and `Get help`
 * (placeholder console.log; Cycle 14 swaps for Sentry feedback link
 * or in-app support flow).
 */

import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import {
  ErrorBoundary as ReactErrorBoundary,
} from "react-error-boundary";
import type { FallbackProps, ErrorBoundaryProps as ReactErrorBoundaryProps } from "react-error-boundary";

import { color, space, type } from "../../constants/designSystem";

import { Button } from "./Button";
import { Icon } from "./Icon";

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Custom fallback component. Defaults to `<DefaultFallback />`. */
  FallbackComponent?: React.ComponentType<FallbackProps>;
  /** Sentry / monitoring hook. Cycle 14 wires `captureException` here. */
  onError?: ReactErrorBoundaryProps["onError"];
  /** Optional callback when reset is invoked. */
  onReset?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const handleGetHelp = (): void => {
  // [TRANSITIONAL] Cycle 16a J-X3 — Open mail-to support link as the active
  // help path. EXIT condition: Sentry feedback widget integrated in a future
  // polish cycle (would replace mailto with Sentry.captureUserFeedback +
  // attached error context). Until then, mailto is the production support flow.
  // B2a Path C V3 forensics C-3 / O-3: was support@mingla.app — domain drift
  // (4 different conventions across the codebase). Standardize on canonical
  // usemingla.com per ORCH-0350.
  void Linking.openURL("mailto:support@usemingla.com").catch(() => {
    // No-op — operator's device may lack a mail client. Constitution #3
    // documented exemption: this is a fallback help action, not a primary
    // flow. The user can manually email if openURL doesn't resolve.
  });
};

export const DefaultFallback: React.FC<FallbackProps> = ({ resetErrorBoundary }) => (
  <View style={styles.container}>
    <Icon name="flag" size={48} color={color.text3} />
    <Text style={styles.title}>Something broke.</Text>
    <Text style={styles.body}>We&apos;re on it.</Text>
    <View style={styles.actions}>
      <Button
        label="Try again"
        onPress={() => resetErrorBoundary()}
        variant="primary"
        size="md"
      />
      <Button
        label="Get help"
        onPress={handleGetHelp}
        variant="ghost"
        size="md"
      />
    </View>
  </View>
);

export const ErrorBoundary: React.FC<ErrorBoundaryProps> = ({
  children,
  FallbackComponent = DefaultFallback,
  onError,
  onReset,
  testID,
  style,
}) => (
  <View testID={testID} style={[styles.host, style]}>
    <ReactErrorBoundary
      FallbackComponent={FallbackComponent}
      onError={onError}
      onReset={onReset}
    >
      {children}
    </ReactErrorBoundary>
  </View>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[6],
    paddingVertical: space[6],
    gap: space[2],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    letterSpacing: type.h1.letterSpacing,
    color: color.text1,
    marginTop: space[4],
  },
  body: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: type.small.fontWeight,
    color: color.text2,
  },
  actions: {
    marginTop: space[4],
    gap: space[2],
    alignItems: "center",
  },
});

export default ErrorBoundary;
