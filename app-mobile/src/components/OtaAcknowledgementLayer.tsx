// #2107 — the critical-update layer.
//
// The file and component keep their original name so the root mount, the web
// stub and the structural gate stay pointed at one place; the behaviour is the
// 2026-10-19 critical-index flow, NOT the retired one-tap acknowledgement.
//
// Sits INSIDE MandatoryUpdateGate's children, so #2075's native store screen
// always wins: a build below the native minimum cannot be rescued by any OTA.
//
// The app renders underneath at all times. The full-screen "Updating" cover
// appears ONLY while the coordinator is installing a critical update; it has
// no button, no dismiss and no swipe, and it always ends — the coordinator lets
// the person in on every timeout, failure and exhausted attempt count.

import { MINGLA_WORDMARK } from "@mingla/brand-assets";
import React, { useEffect, useRef, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  BackHandler,
  Image,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { backgroundWarmGlow, colors, spacing } from "../constants/designSystem";
import { createOtaGateCoordinator } from "../services/otaUpdateRuntime";

export function OtaAcknowledgementLayer({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const coordinatorRef = useRef<ReturnType<
    typeof createOtaGateCoordinator
  > | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = createOtaGateCoordinator();
  }
  const coordinator = coordinatorRef.current;
  const snapshot = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );

  useEffect(() => {
    void coordinator.check();
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void coordinator.check();
    });
    return () => subscription.remove();
  }, [coordinator]);

  // Rendering children only when open would remount the entire tree around
  // every check, throwing away navigation state and in-flight work.
  return (
    <>
      {children}
      {Platform.OS !== "web" && snapshot.phase === "updating" ? (
        <CriticalUpdateScreen />
      ) : null}
    </>
  );
}

function CriticalUpdateScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const headingRef = useRef<Text>(null);

  useEffect(() => {
    const node = findNodeHandle(headingRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    const backSubscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );
    return () => backSubscription.remove();
  }, []);

  return (
    <View
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={[
        styles.page,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
      testID="critical-update-layer"
    >
      <StatusBar barStyle="dark-content" backgroundColor={backgroundWarmGlow} />
      <Image
        source={MINGLA_WORDMARK}
        resizeMode="contain"
        style={styles.logo}
        accessibilityLabel="Mingla"
        accessibilityRole="image"
      />
      <View style={styles.messageGroup}>
        <Text ref={headingRef} accessibilityRole="header" style={styles.title}>
          Updating Mingla
        </Text>
        <Text style={styles.body}>
          An important update is installing. Mingla will restart by itself in
          a moment.
        </Text>
        <View style={styles.progress} accessibilityLabel="Installing update">
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10_000,
    backgroundColor: backgroundWarmGlow,
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
  },
  logo: { width: 88, height: 31, flexShrink: 0 },
  messageGroup: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "flex-start",
    paddingVertical: spacing.xl,
  },
  title: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    color: colors.text.primary,
    marginBottom: spacing.sm + 4,
  },
  body: { fontSize: 16, lineHeight: 24, color: colors.text.secondary },
  progress: { marginTop: spacing.lg, minHeight: 54, justifyContent: "center" },
});
