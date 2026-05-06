/**
 * BrandOnboardView — Stripe Connect embedded onboarding (J-A10 §5.3.8, B2 / issue #47).
 *
 * Live path: WebView + Stripe Connect.js (`embeddedSession` from
 * `brand-stripe-connect-session`).
 *
 * Dev fallback: when no session is provided (e.g. stub brand ids), shows the
 * Cycle 2 simulated state machine for layout QA.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import {
  accent,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";

import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Spinner } from "../ui/Spinner";

const SIMULATED_LOADING_MS = 1500;

type OnboardingState = "loading" | "complete" | "failed";

export interface BrandOnboardSession {
  publishableKey: string;
  clientSecret: string;
}

export interface BrandOnboardViewProps {
  brand: Brand | null;
  onCancel: () => void;
  onAfterDone: () => void | Promise<void>;
  /** Stripe embedded session — when set, WebView onboarding is shown. */
  embeddedSession?: BrandOnboardSession | null;
  sessionLoading?: boolean;
  sessionError?: string | null;
  onRetrySession?: () => void;
}

function buildEmbeddedHtml(publishableKey: string, clientSecret: string): string {
  const pk = JSON.stringify(publishableKey);
  const cs = JSON.stringify(clientSecret);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;font-family:system-ui,-apple-system,sans-serif;background:#0b0b0c;color:#fafafa}
#host{min-height:100vh;padding:12px}
</style>
</head><body>
<div id="host"></div>
<script type="module">
try {
  const publishableKey = ${pk};
  const clientSecret = ${cs};
  const { loadConnectAndInitialize } = await import("https://esm.sh/@stripe/connect-js@3.9.6");
  const instance = await loadConnectAndInitialize({
    publishableKey,
    fetchClientSecret: async () => clientSecret,
  });
  const onboarding = instance.create("account-onboarding");
  onboarding.setOnExit(() => {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "exit" }));
    }
  });
  const host = document.getElementById("host");
  host.appendChild(onboarding);
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "error", message: msg }));
  }
}
</script>
</body></html>`;
}

export const BrandOnboardView: React.FC<BrandOnboardViewProps> = ({
  brand,
  onCancel,
  onAfterDone,
  embeddedSession = null,
  sessionLoading = false,
  sessionError = null,
  onRetrySession,
}) => {
  const insets = useSafeAreaInsets();
  const [stubState, setStubState] = useState<OnboardingState>("loading");
  const useLiveStripe = embeddedSession !== null && embeddedSession.clientSecret.length > 0;

  const htmlSource = useMemo(() => {
    if (embeddedSession === null) return null;
    return buildEmbeddedHtml(
      embeddedSession.publishableKey,
      embeddedSession.clientSecret,
    );
  }, [embeddedSession]);

  useEffect(() => {
    if (useLiveStripe || sessionLoading) return;
    if (stubState !== "loading") return;
    const timer = setTimeout(() => {
      setStubState("complete");
    }, SIMULATED_LOADING_MS);
    return (): void => clearTimeout(timer);
  }, [stubState, useLiveStripe, sessionLoading]);

  const handleHeaderLongPress = useCallback((): void => {
    setStubState((prev) => (prev === "failed" ? "loading" : "failed"));
  }, []);

  const handleDone = useCallback(async (): Promise<void> => {
    await onAfterDone();
  }, [onAfterDone]);

  const handleTryAgain = useCallback((): void => {
    setStubState("loading");
  }, []);

  const onWebMessage = useCallback(
    async (ev: WebViewMessageEvent): Promise<void> => {
      try {
        const raw = JSON.parse(ev.nativeEvent.data) as { type?: string };
        if (raw.type === "exit") {
          await onAfterDone();
        }
      } catch {
        /* ignore */
      }
    },
    [onAfterDone],
  );

  if (brand === null) {
    return (
      <View style={styles.host}>
        <View style={[styles.topBarRow, { paddingTop: spacing.sm }]}>
          <View style={styles.topBarSlot}>
            <Button
              label="Cancel"
              onPress={onCancel}
              variant="ghost"
              size="sm"
            />
          </View>
          <Text style={styles.topBarTitle}>Stripe onboarding</Text>
          <View style={styles.topBarSlot} />
        </View>
        <View style={styles.notFoundWrap}>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.notFoundTitle}>Brand not found</Text>
            <Text style={styles.notFoundBody}>
              The brand you tried to onboard doesn{"’"}t exist or has been
              removed.
            </Text>
            <View style={styles.notFoundBtnRow}>
              <Button
                label="Back"
                onPress={onCancel}
                variant="secondary"
                size="md"
                leadingIcon="arrowL"
              />
            </View>
          </GlassCard>
        </View>
      </View>
    );
  }

  if (sessionLoading) {
    return (
      <View style={styles.host}>
        <View style={[styles.topBarRow, { paddingTop: spacing.sm }]}>
          <View style={styles.topBarSlot}>
            <Button label="Cancel" onPress={onCancel} variant="ghost" size="sm" />
          </View>
          <Text style={styles.topBarTitle}>Stripe onboarding</Text>
          <View style={styles.topBarSlot} />
        </View>
        <View style={styles.stateBlock}>
          <Spinner size={48} color={accent.warm} />
          <Text style={styles.stateTitle}>Starting Stripe…</Text>
        </View>
      </View>
    );
  }

  if (sessionError !== null && sessionError !== "") {
    return (
      <View style={styles.host}>
        <View style={[styles.topBarRow, { paddingTop: spacing.sm }]}>
          <View style={styles.topBarSlot}>
            <Button label="Cancel" onPress={onCancel} variant="ghost" size="sm" />
          </View>
          <Text style={styles.topBarTitle}>Stripe onboarding</Text>
          <View style={styles.topBarSlot} />
        </View>
        <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.stateBlock}>
            <View style={[styles.stateIconCircle, styles.stateIconCircleFailed]}>
              <Icon name="flag" size={32} color={semantic.error} />
            </View>
            <Text style={styles.stateTitle}>Couldn{"’"}t start onboarding</Text>
            <Text style={styles.stateSub}>{sessionError}</Text>
          </View>
          <View style={styles.actionsCol}>
            {onRetrySession !== undefined ? (
              <Button
                label="Try again"
                onPress={onRetrySession}
                variant="primary"
                size="lg"
                fullWidth
              />
            ) : null}
            <Button
              label="Back"
              onPress={onCancel}
              variant="secondary"
              size="md"
              fullWidth
            />
          </View>
        </View>
      </View>
    );
  }

  if (useLiveStripe && htmlSource !== null) {
    return (
      <View style={styles.host}>
        <View style={[styles.topBarRow, { paddingTop: spacing.sm }]}>
          <View style={styles.topBarSlot}>
            <Button label="Cancel" onPress={onCancel} variant="ghost" size="sm" />
          </View>
          <Text style={styles.topBarTitle}>Stripe onboarding</Text>
          <View style={styles.topBarSlot} />
        </View>
        <WebView
          originWhitelist={["*"]}
          source={{ html: htmlSource }}
          onMessage={onWebMessage}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          mixedContentMode="always"
          setSupportMultipleWindows={false}
        />
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <View style={[styles.topBarRow, { paddingTop: spacing.sm }]}>
        <View style={styles.topBarSlot}>
          <Button
            label="Cancel"
            onPress={onCancel}
            variant="ghost"
            size="sm"
          />
        </View>
        <Pressable
          onLongPress={handleHeaderLongPress}
          accessibilityRole="header"
          accessibilityLabel="Stripe onboarding (dev: long-press for failure state)"
          delayLongPress={500}
        >
          <Text style={styles.topBarTitle}>Stripe onboarding</Text>
        </Pressable>
        <View style={styles.topBarSlot} />
      </View>

      <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        {stubState === "loading" ? (
          <View style={styles.stateBlock}>
            <Spinner size={48} color={accent.warm} />
            <Text style={styles.stateTitle}>Loading Stripe onboarding…</Text>
            <Text style={styles.stateSub}>
              Stub preview — use a live brand (UUID) for real Connect.
            </Text>
          </View>
        ) : null}

        {stubState === "complete" ? (
          <>
            <View style={styles.stateBlock}>
              <View style={[styles.stateIconCircle, styles.stateIconCircleSuccess]}>
                <Icon name="check" size={32} color={accent.warm} />
              </View>
              <Text style={styles.stateTitle}>Onboarding submitted</Text>
              <Text style={styles.stateSub}>
                Stripe is verifying your details. We{"’"}ll email you when
                ready.
              </Text>
            </View>
            <View style={styles.actionsCol}>
              <Button
                label="Done"
                onPress={handleDone}
                variant="primary"
                size="lg"
                fullWidth
              />
            </View>
          </>
        ) : null}

        {stubState === "failed" ? (
          <>
            <View style={styles.stateBlock}>
              <View style={[styles.stateIconCircle, styles.stateIconCircleFailed]}>
                <Icon name="flag" size={32} color={semantic.error} />
              </View>
              <Text style={styles.stateTitle}>Onboarding couldn{"’"}t complete</Text>
              <Text style={styles.stateSub}>
                Try again or contact support.
              </Text>
            </View>
            <View style={styles.actionsCol}>
              <Button
                label="Try again"
                onPress={handleTryAgain}
                variant="primary"
                size="lg"
                fullWidth
              />
              <Button
                label="Cancel"
                onPress={onCancel}
                variant="secondary"
                size="md"
                fullWidth
              />
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: "#0b0b0c",
  },
  topBarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    minHeight: 56,
  },
  topBarSlot: {
    flexShrink: 0,
    minWidth: 80,
  },
  topBarTitle: {
    flex: 1,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    gap: spacing.xl,
  },
  stateBlock: {
    alignItems: "center",
    gap: spacing.md,
  },
  stateIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  stateIconCircleSuccess: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  stateIconCircleFailed: {
    backgroundColor: semantic.errorTint,
    borderColor: "rgba(239, 68, 68, 0.45)",
  },
  stateTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    textAlign: "center",
  },
  stateSub: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  actionsCol: {
    gap: spacing.sm,
  },
  notFoundWrap: {
    flex: 1,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  notFoundTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  notFoundBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  notFoundBtnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },
});

export default BrandOnboardView;
