// #2107 — the blocking acknowledgement layer.
//
// Sits INSIDE MandatoryUpdateGate's children, so #2075's native store screen
// always wins: a build below the native minimum cannot be rescued by any OTA,
// and must never see a "download the update" prompt it is incapable of using.
//
// One action, no dismiss, no auto-dismiss timer, no swipe. The tap releases the
// app immediately — the bytes land in the background and expo-updates applies
// them on the next cold launch.

import { Ionicons } from "@expo/vector-icons";
import { MINGLA_WORDMARK } from "@mingla/brand-assets";
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  BackHandler,
  Image,
  Platform,
  Pressable,
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

  // The app renders underneath at all times. Rendering children only when open
  // would remount the entire tree on every acknowledgement, throwing away
  // navigation state and every in-flight query for a one-tap prompt.
  return (
    <>
      {children}
      {Platform.OS !== "web" && snapshot.phase !== "open" ? (
        <OtaAcknowledgementScreen
          message={snapshot.message}
          installing={snapshot.phase === "installing"}
          onAcknowledge={coordinator.acknowledge}
        />
      ) : null}
    </>
  );
}

function OtaAcknowledgementScreen({
  message,
  installing,
  onAcknowledge,
}: {
  message: string;
  installing: boolean;
  onAcknowledge: () => Promise<void>;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const headingRef = useRef<Text>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const node = findNodeHandle(headingRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    const backSubscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );
    return () => backSubscription.remove();
  }, []);

  const pressed = installing || busy;

  return (
    <View
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={[
        styles.page,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
      testID="ota-acknowledgement-layer"
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
        <View
          style={styles.updateIcon}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons name="cloud-download-outline" size={30} color={colors.accent} />
        </View>
        <Text ref={headingRef} accessibilityRole="header" style={styles.title}>
          {installing ? "Installing the update" : "One tap to update"}
        </Text>
        <Text style={styles.body}>{message}</Text>
        <Text style={styles.context}>
          {installing
            ? "Mingla will restart by itself when this finishes."
            : "You can keep using Mingla while it downloads. It finishes the next time you open the app."}
        </Text>
      </View>
      <View style={styles.actionGroup}>
        {installing ? (
          <View style={styles.installing}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Download update"
            accessibilityHint="Downloads the update in the background and returns you to the app"
            accessibilityState={{ busy: pressed }}
            disabled={pressed}
            onPress={() => {
              setBusy(true);
              void onAcknowledge().finally(() => setBusy(false));
            }}
            style={({ pressed: isPressed }) => [
              styles.button,
              isPressed && styles.buttonPressed,
            ]}
            testID="ota-acknowledge-button"
          >
            <Text style={styles.buttonText}>Download update</Text>
          </Pressable>
        )}
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
  updateIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(235, 120, 37, 0.12)",
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    color: colors.text.primary,
    marginBottom: spacing.sm + 4,
  },
  body: { fontSize: 16, lineHeight: 24, color: colors.text.secondary },
  context: {
    marginTop: spacing.md,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text.tertiary,
  },
  actionGroup: { width: "100%", flexShrink: 0 },
  installing: { minHeight: 54, alignItems: "center", justifyContent: "center" },
  button: {
    width: "100%",
    minHeight: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
  },
  buttonPressed: { opacity: 0.88 },
  buttonText: {
    color: colors.text.inverse,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  },
});
