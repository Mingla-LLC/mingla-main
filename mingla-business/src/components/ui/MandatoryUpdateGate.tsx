import { Ionicons } from "@expo/vector-icons";
import { MINGLA_WORDMARK } from "@mingla/brand-assets";
import * as SplashScreen from "expo-splash-screen";
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  accent,
  backgroundWarmGlow,
  colors,
  spacing,
} from "../../constants/designSystem";
import {
  createAppVersionCoordinator,
  type VersionGateSnapshot,
} from "../../services/appVersionPolicy";

const STORE_TAP_LOCK_MS = 700;

export type VersionForegroundEvent = {
  id: number;
  backgroundDurationMs: number;
};

export function MandatoryUpdateGate({
  children,
  foregroundEvent,
  onRequiredChange,
  onForegroundCheckComplete,
}: {
  children: React.ReactNode;
  foregroundEvent: VersionForegroundEvent | null;
  onRequiredChange: (required: boolean) => void;
  onForegroundCheckComplete: (eventId: number) => void;
}): React.ReactElement {
  const coordinatorRef = useRef<ReturnType<
    typeof createAppVersionCoordinator
  > | null>(null);
  if (coordinatorRef.current === null)
    coordinatorRef.current = createAppVersionCoordinator();
  const coordinator = coordinatorRef.current;
  const snapshot = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );

  useEffect(() => {
    void coordinator.check(true);
  }, [coordinator]);

  useEffect(() => {
    onRequiredChange(snapshot.phase === "required");
    if (snapshot.phase === "required") {
      void SplashScreen.hideAsync().catch(() => {
        console.warn("[app-version-policy] required_gate_splash_hide_failed");
      });
    }
  }, [onRequiredChange, snapshot.phase]);

  useEffect(() => {
    if (foregroundEvent === null) return;
    void coordinator
      .check(true)
      .finally(() => onForegroundCheckComplete(foregroundEvent.id));
  }, [coordinator, foregroundEvent, onForegroundCheckComplete]);

  if (Platform.OS === "web") {
    return <>{children}</>;
  }
  if (foregroundEvent !== null || snapshot.phase === "checking") {
    return <VersionDecisionVeil />;
  }
  if (snapshot.phase === "allowed") return <>{children}</>;
  return <MandatoryUpdateScreen snapshot={snapshot} />;
}

function VersionDecisionVeil(): React.ReactElement {
  return (
    <View style={styles.veil} accessibilityLabel="Checking app availability">
      <StatusBar barStyle="dark-content" backgroundColor={backgroundWarmGlow} />
      <Image
        source={MINGLA_WORDMARK}
        resizeMode="contain"
        style={styles.veilLogo}
        accessibilityLabel="Mingla Host"
        accessibilityRole="image"
      />
    </View>
  );
}

function MandatoryUpdateScreen({
  snapshot,
}: {
  snapshot: VersionGateSnapshot;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const headingRef = useRef<Text>(null);
  const openingRef = useRef(false);
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [opening, setOpening] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const decision = snapshot.decision;

  useEffect(() => {
    const node = findNodeHandle(headingRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    const backSubscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );
    return () => {
      backSubscription.remove();
      if (unlockTimerRef.current !== null) clearTimeout(unlockTimerRef.current);
    };
  }, []);

  if (decision.state !== "required") return <VersionDecisionVeil />;

  const openStore = async (): Promise<void> => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setStoreError(null);
    try {
      const canOpen = await Linking.canOpenURL(decision.storeUrl);
      if (!canOpen) throw new Error("store_url_unavailable");
      await Linking.openURL(decision.storeUrl);
    } catch {
      setStoreError(
        "We couldn't open the app store. Open it manually and search for Mingla.",
      );
    } finally {
      unlockTimerRef.current = setTimeout(() => {
        openingRef.current = false;
        setOpening(false);
      }, STORE_TAP_LOCK_MS);
    }
  };

  return (
    <View
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={styles.page}
      testID="mandatory-update-gate"
    >
      <StatusBar barStyle="dark-content" backgroundColor={backgroundWarmGlow} />
      <ScrollView
        bounces={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <Image
          source={MINGLA_WORDMARK}
          resizeMode="contain"
          style={styles.logo}
          accessibilityLabel="Mingla Host"
          accessibilityRole="image"
        />
        <View style={styles.messageGroup}>
          <View
            style={styles.updateIcon}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            <Ionicons name="arrow-up" size={30} color={accent.warm} />
          </View>
          <Text
            ref={headingRef}
            accessibilityRole="header"
            style={styles.title}
          >
            Update Host to continue
          </Text>
          <Text style={styles.body}>
            This version is no longer supported. Update now to keep your
            workspace, events, and payouts working properly.
          </Text>
          <Text style={styles.context}>
            Version {decision.minimumVersion} or later is required.
          </Text>
        </View>
        <View style={styles.actionGroup}>
          {storeError !== null ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {storeError}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Update now"
            accessibilityHint="Opens Mingla in the app store"
            accessibilityState={{ busy: opening }}
            onPress={() => void openStore()}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonText}>Update now</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  veil: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: backgroundWarmGlow,
  },
  veilLogo: { width: 88, aspectRatio: 1356 / 480 },
  page: { flex: 1, backgroundColor: backgroundWarmGlow },
  scrollContent: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
  },
  logo: { width: 88, aspectRatio: 1356 / 480, flexShrink: 0 },
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
  actionGroup: { width: "100%" },
  error: {
    marginBottom: spacing.md,
    fontSize: 14,
    lineHeight: 20,
    color: "#b91c1c",
  },
  button: {
    width: "100%",
    minHeight: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.warm,
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
