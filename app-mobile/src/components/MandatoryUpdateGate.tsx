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
  AppState,
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
import { backgroundWarmGlow, colors, spacing } from "../constants/designSystem";
import {
  createAppVersionCoordinator,
  resolveGateLayout,
  type VersionGateSnapshot,
} from "../services/appVersionPolicy";
import { VersionForegroundStateMachine } from "../services/appVersionForeground";

const STORE_TAP_LOCK_MS = 700;
/** #2107 A4 — shown only when the policy carries no message of its own. */
const FALLBACK_BODY =
  "This version is no longer supported. Update now to keep your plans, chats, and bookings working properly.";

export function MandatoryUpdateGate({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const coordinatorRef = useRef<ReturnType<
    typeof createAppVersionCoordinator
  > | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = createAppVersionCoordinator();
  }
  const coordinator = coordinatorRef.current;
  const snapshot = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const foregroundStateRef = useRef(new VersionForegroundStateMachine());
  const childrenMountedRef = useRef(false);

  useEffect(() => {
    void coordinator.check(true);
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (next) => {
      const decision = foregroundStateRef.current.transition(
        next,
        Date.now(),
        snapshotRef.current.phase === "required",
      );
      if (decision !== null) {
        // #2107 A2 — a foreground recheck runs BEHIND the app. It never
        // publishes `checking`, so the tree (navigation, a checkout in
        // progress) stays mounted; only a confirmed `required` covers it.
        void coordinator.check(false);
      }
    });
    return () => subscription.remove();
  }, [coordinator]);

  if (Platform.OS === "web") return <>{children}</>;
  return resolveGateLayers(snapshot, childrenMountedRef, children);
}

/**
 * #2107 A2 — once the app tree has mounted it is never unmounted by this gate.
 * Before the first mount, the cold-launch veil and a cold `required` render
 * alone (the app must not boot behind a store screen). After it, `required`
 * is an overlay above the still-mounted tree.
 */
function resolveGateLayers(
  snapshot: VersionGateSnapshot,
  childrenMountedRef: React.MutableRefObject<boolean>,
  children: React.ReactNode,
): React.ReactElement {
  if (snapshot.phase === "allowed") childrenMountedRef.current = true;
  switch (resolveGateLayout(snapshot.phase, childrenMountedRef.current)) {
    case "veil":
      return <VersionDecisionVeil />;
    case "store_screen":
      return <MandatoryUpdateScreen snapshot={snapshot} />;
    case "app_with_store_overlay":
      return (
        <>
          {children}
          <View style={styles.overlay}>
            <MandatoryUpdateScreen snapshot={snapshot} />
          </View>
        </>
      );
    case "app":
      return <>{children}</>;
  }
}

function VersionDecisionVeil(): React.ReactElement {
  return (
    <View style={styles.veil} accessibilityLabel="Checking app availability">
      <StatusBar barStyle="dark-content" backgroundColor={backgroundWarmGlow} />
      <Image
        source={MINGLA_WORDMARK}
        resizeMode="contain"
        style={styles.veilLogo}
        accessibilityLabel="Mingla"
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
          accessibilityLabel="Mingla"
          accessibilityRole="image"
        />
        <View style={styles.messageGroup}>
          <View
            style={styles.updateIcon}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            <Ionicons name="arrow-up" size={30} color={colors.accent} />
          </View>
          <Text
            ref={headingRef}
            accessibilityRole="header"
            style={styles.title}
          >
            Update Mingla to continue
          </Text>
          <Text style={styles.body}>
            {decision.message.trim().length > 0
              ? decision.message
              : FALLBACK_BODY}
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
  veilLogo: { width: 88, height: 31 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 10_001 },
  page: { flex: 1, backgroundColor: backgroundWarmGlow },
  scrollContent: {
    flexGrow: 1,
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
  error: {
    marginBottom: spacing.md,
    fontSize: 14,
    lineHeight: 20,
    color: colors.error[700],
  },
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
