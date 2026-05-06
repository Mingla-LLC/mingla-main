/**
 * /event/[id]/scanner — J-S1+S2+S3+S4 Scanner camera screen (Cycle 11).
 *
 * Operator-side route. Camera permission gate → CameraView with QR-only
 * barcode scanner → result overlay (success/duplicate/wrong_event/not_found/
 * void/cancelled_order) → session activity log (collapsible bottom).
 *
 * I-27: Single-device duplicate prevention via getSuccessfulScanByTicketId.
 * Cross-device enforcement deferred to B-cycle DB partial UNIQUE index.
 *
 * [TRANSITIONAL] offlineQueued: true on every scan today (no backend sync).
 *
 * Per Cycle 11 SPEC §4.10/J-S1+J-S2+J-S3+J-S4.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import * as Haptics from "expo-haptics";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../../../src/constants/designSystem";
import { useLiveEventStore } from "../../../../src/store/liveEventStore";
import { useOrderStore } from "../../../../src/store/orderStore";
import {
  useScanStore,
  type ScanResult,
} from "../../../../src/store/scanStore";
import { useAuth } from "../../../../src/context/AuthContext";

import {
  expandTicketIds,
  parseTicketId,
} from "../../../../src/utils/expandTicketIds";
import {
  parseQrPayload,
  type ParsedQrPayload,
} from "../../../../src/utils/qrPayload";

import { Button } from "../../../../src/components/ui/Button";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { Icon } from "../../../../src/components/ui/Icon";
import { IconChrome } from "../../../../src/components/ui/IconChrome";

// ---- Helpers --------------------------------------------------------

const RESULT_OVERLAY_DURATION_MS = 3000;

const RELATIVE_TIME_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

const formatRelativeTime = (iso: string): string => {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const delta = now - then;
  if (delta < RELATIVE_TIME_MS.minute) return "just now";
  if (delta < RELATIVE_TIME_MS.hour) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.minute)}m ago`;
  }
  if (delta < RELATIVE_TIME_MS.day) {
    return `${Math.floor(delta / RELATIVE_TIME_MS.hour)}h ago`;
  }
  return `${Math.floor(delta / RELATIVE_TIME_MS.day)}d ago`;
};

interface ResultOverlayState {
  kind: ScanResult;
  message: string;
  detail?: string;
}

interface ResultOverlaySpec {
  iconName: "check" | "flag" | "close";
  iconColor: string;
  badgeBg: string;
}

const overlaySpec = (kind: ScanResult): ResultOverlaySpec => {
  switch (kind) {
    case "success":
      return {
        iconName: "check",
        iconColor: "#34c759",
        badgeBg: "rgba(52, 199, 89, 0.18)",
      };
    case "duplicate":
      return {
        iconName: "flag",
        iconColor: accent.warm,
        badgeBg: "rgba(235, 120, 37, 0.18)",
      };
    case "wrong_event":
    case "not_found":
    case "void":
    case "cancelled_order":
      return {
        iconName: "close",
        iconColor: semantic.error,
        badgeBg: "rgba(239, 68, 68, 0.18)",
      };
    default: {
      const _exhaust: never = kind;
      return _exhaust;
    }
  }
};

// ---- Screen ---------------------------------------------------------

export default function ScannerCameraRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const operatorAccountId = user?.id ?? "anonymous";

  const event = useLiveEventStore((s) =>
    typeof eventId === "string"
      ? s.events.find((e) => e.id === eventId) ?? null
      : null,
  );

  const [permission, requestPermission] = useCameraPermissions();

  const [overlay, setOverlay] = useState<ResultOverlayState | null>(null);
  const overlayVisibleRef = useRef<boolean>(false);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayAnim = useRef(new Animated.Value(0)).current;
  // Cycle 17c §F.2 — respect OS reduce-motion preference per I-40 spirit.
  // Old RN Animated API has no useReducedMotion; subscribe to AccessibilityInfo.
  const reduceMotionRef = useRef<boolean>(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) reduceMotionRef.current = enabled;
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled: boolean) => {
        reduceMotionRef.current = enabled;
      },
    );
    return (): void => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const [logExpanded, setLogExpanded] = useState<boolean>(false);
  const sessionStartRef = useRef<string>(new Date().toISOString());

  // Session log — raw subscription + useMemo (selector pattern rule).
  const allScans = useScanStore((s) => s.entries);
  const sessionScans = useMemo(() => {
    if (typeof eventId !== "string") return [];
    return allScans
      .filter(
        (s) =>
          s.eventId === eventId &&
          s.scannerUserId === operatorAccountId &&
          s.scannedAt >= sessionStartRef.current,
      )
      .slice(0, 10);
  }, [allScans, eventId, operatorAccountId]);

  const sessionScanTotal = useMemo(() => {
    if (typeof eventId !== "string") return 0;
    return allScans.filter(
      (s) =>
        s.eventId === eventId &&
        s.scannerUserId === operatorAccountId &&
        s.scannedAt >= sessionStartRef.current,
    ).length;
  }, [allScans, eventId, operatorAccountId]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof eventId === "string") {
      router.replace(`/event/${eventId}` as never);
    }
  }, [router, eventId]);

  const handleAllowCamera = useCallback(async (): Promise<void> => {
    await requestPermission();
  }, [requestPermission]);

  const handleOpenSettings = useCallback((): void => {
    void Linking.openSettings();
  }, []);

  const dismissOverlay = useCallback((): void => {
    overlayVisibleRef.current = false;
    if (reduceMotionRef.current) {
      // Cycle 17c §F.2 — instant set when reduce-motion ON; preserves the
      // post-fade callback (setOverlay(null)) by invoking it synchronously.
      overlayAnim.setValue(0);
      setOverlay(null);
    } else {
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        setOverlay(null);
      });
    }
    if (overlayTimerRef.current !== null) {
      clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = null;
    }
  }, [overlayAnim]);

  const showResult = useCallback(
    (next: ResultOverlayState): void => {
      if (overlayTimerRef.current !== null) {
        clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
      overlayVisibleRef.current = true;
      setOverlay(next);
      if (reduceMotionRef.current) {
        // Cycle 17c §F.2 — instant set when reduce-motion ON.
        overlayAnim.setValue(1);
      } else {
        Animated.timing(overlayAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }).start();
      }
      overlayTimerRef.current = setTimeout(() => {
        dismissOverlay();
      }, RESULT_OVERLAY_DURATION_MS);
    },
    [overlayAnim, dismissOverlay],
  );

  // Cleanup the overlay timer on unmount
  useEffect(() => {
    return (): void => {
      if (overlayTimerRef.current !== null) {
        clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
    };
  }, []);

  const recordScanWithResult = useCallback(
    (parsed: ParsedQrPayload, result: ScanResult): void => {
      if (event === null) return;
      useScanStore.getState().recordScan({
        ticketId: parsed.ticketId,
        orderId: parsed.orderId,
        eventId: event.id,
        brandId: event.brandId,
        scannerUserId: operatorAccountId,
        scanResult: result,
        via: "qr",
        offlineQueued: true,
        buyerNameAtScan: "",
        ticketNameAtScan: "",
      });
    },
    [event, operatorAccountId],
  );

  const handleBarcodeScanned = useCallback(
    (scan: BarcodeScanningResult): void => {
      if (overlayVisibleRef.current) return; // guard against double-fire
      if (event === null) return;

      const parsed = parseQrPayload(scan.data);
      if (parsed === null) {
        showResult({ kind: "not_found", message: "Invalid QR code" });
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        );
        return;
      }

      // J-S3 duplicate guard
      const existingSuccess = useScanStore
        .getState()
        .getSuccessfulScanByTicketId(parsed.ticketId);
      if (existingSuccess !== null) {
        const detail =
          existingSuccess.scannerUserId === operatorAccountId
            ? "Scanned by you"
            : "Scanned by another scanner";
        showResult({
          kind: "duplicate",
          message: `Already checked in ${formatRelativeTime(existingSuccess.scannedAt)}`,
          detail,
        });
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning,
        );
        return;
      }

      const order = useOrderStore.getState().getOrderById(parsed.orderId);
      if (order === null) {
        showResult({ kind: "not_found", message: "Ticket not found" });
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        );
        recordScanWithResult(parsed, "not_found");
        return;
      }
      if (order.eventId !== event.id) {
        showResult({ kind: "wrong_event", message: "Different event" });
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        );
        recordScanWithResult(parsed, "wrong_event");
        return;
      }
      if (order.status === "cancelled") {
        showResult({ kind: "cancelled_order", message: "Order cancelled" });
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        );
        recordScanWithResult(parsed, "cancelled_order");
        return;
      }
      if (order.status === "refunded_full") {
        showResult({ kind: "void", message: "Ticket refunded" });
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        );
        recordScanWithResult(parsed, "void");
        return;
      }

      // Validate the ticketId actually maps to a real seat in this order
      const parsedTicket = parseTicketId(parsed.ticketId);
      if (parsedTicket === null) {
        showResult({ kind: "not_found", message: "Invalid ticket ID format" });
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        );
        recordScanWithResult(parsed, "not_found");
        return;
      }
      const expanded = expandTicketIds(parsed.orderId, order.lines);
      const validTicket = expanded.find((t) => t.ticketId === parsed.ticketId);
      if (validTicket === undefined) {
        showResult({ kind: "not_found", message: "Ticket not in this order" });
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        );
        recordScanWithResult(parsed, "not_found");
        return;
      }

      // Per-seat partial-refund check
      const line = order.lines[validTicket.lineIdx];
      if (validTicket.seatIdx >= line.quantity - line.refundedQuantity) {
        showResult({ kind: "void", message: "Ticket refunded" });
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        );
        recordScanWithResult(parsed, "void");
        return;
      }

      // SUCCESS PATH
      const buyerName =
        order.buyer.name.trim().length > 0 ? order.buyer.name : "Anonymous";
      useScanStore.getState().recordScan({
        ticketId: parsed.ticketId,
        orderId: parsed.orderId,
        eventId: event.id,
        brandId: event.brandId,
        scannerUserId: operatorAccountId,
        scanResult: "success",
        via: "qr",
        offlineQueued: true,
        buyerNameAtScan: buyerName,
        ticketNameAtScan: validTicket.ticketName,
      });
      showResult({
        kind: "success",
        message: `${buyerName} checked in`,
        detail: validTicket.ticketName,
      });
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    },
    [event, operatorAccountId, showResult, recordScanWithResult],
  );

  // ---- Not-found shell ---------------------------------------------
  if (event === null || typeof eventId !== "string") {
    return (
      <View
        style={[styles.host, { paddingTop: insets.top }]}
      >
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>Scan tickets</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="ticket"
            title="Event not found"
            description="It may have been deleted."
          />
        </View>
      </View>
    );
  }

  // ---- Permission states -------------------------------------------
  if (permission === null) {
    return (
      <View style={[styles.host, { paddingTop: insets.top }]}>
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>Scan tickets</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.emptyHost}>
          <ActivityIndicator color={textTokens.primary} />
        </View>
      </View>
    );
  }

  if (!permission.granted) {
    const askable = permission.canAskAgain;
    return (
      <View style={[styles.host, { paddingTop: insets.top }]}>
        <View style={styles.chromeRow}>
          <IconChrome
            icon="close"
            size={36}
            onPress={handleBack}
            accessibilityLabel="Back"
          />
          <Text style={styles.chromeTitle}>Scan tickets</Text>
          <View style={styles.chromeRightSlot} />
        </View>
        <View style={styles.permWrap}>
          <View style={styles.permIconBadge}>
            <Icon name="qr" size={36} color={textTokens.primary} />
          </View>
          <Text style={styles.permTitle}>
            {askable
              ? "Camera access needed"
              : "Camera access blocked"}
          </Text>
          <Text style={styles.permCopy}>
            {askable
              ? "Camera access needed to scan tickets at the door."
              : "Camera access blocked. Open settings to enable."}
          </Text>
          <View style={styles.permActions}>
            <Button
              label={askable ? "Allow camera access" : "Open Settings"}
              onPress={askable ? handleAllowCamera : handleOpenSettings}
              variant="primary"
              size="lg"
              fullWidth
              accessibilityLabel={
                askable
                  ? "Allow camera access for scanning"
                  : "Open device settings to enable camera"
              }
            />
          </View>
        </View>
      </View>
    );
  }

  // ---- Granted: camera viewport -----------------------------------
  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Scan tickets</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      {/* TESTING MODE banner — Cycle 11 J-S1 / ORCH-0711.
          [TRANSITIONAL] Cross-device order lookup gap means scanner reads
          only from this device's useOrderStore. In production with two
          devices the scanner cannot validate buyer orders — surface this
          honestly per Constitution #7. EXIT: B-cycle scan-ticket edge
          function wires server-side order lookup and this banner becomes
          unnecessary. */}
      <View style={styles.testingBanner} pointerEvents="none">
        <Icon name="flag" size={14} color={accent.warm} />
        <Text style={styles.testingBannerText} numberOfLines={2}>
          Testing mode — scanner only validates orders made on this device.
          Cross-device scanning lands when the backend ships in B-cycle.
        </Text>
      </View>

      {/* Camera viewport */}
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={handleBarcodeScanned}
          accessibilityLabel="QR scanner camera viewport"
        />
        {/* Reticle overlay */}
        <View style={styles.reticleWrap} pointerEvents="none">
          <View style={styles.reticle} />
          <Text style={styles.reticleHelper}>
            Point camera at ticket QR code
          </Text>
        </View>

        {/* Result overlay (J-S2) */}
        {overlay !== null ? (
          <Animated.View
            style={[
              styles.overlayHost,
              {
                opacity: overlayAnim,
                transform: [
                  {
                    translateY: overlayAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [80, 0],
                    }),
                  },
                ],
              },
            ]}
            pointerEvents="auto"
          >
            <Pressable
              onPress={dismissOverlay}
              style={styles.overlayCard}
              accessibilityRole="button"
              accessibilityLabel="Dismiss scan result"
            >
              <View
                style={[
                  styles.overlayIconBadge,
                  { backgroundColor: overlaySpec(overlay.kind).badgeBg },
                ]}
              >
                <Icon
                  name={overlaySpec(overlay.kind).iconName}
                  size={32}
                  color={overlaySpec(overlay.kind).iconColor}
                />
              </View>
              <Text style={styles.overlayMessage} numberOfLines={2}>
                {overlay.message}
              </Text>
              {overlay.detail !== undefined ? (
                <Text style={styles.overlayDetail} numberOfLines={2}>
                  {overlay.detail}
                </Text>
              ) : null}
            </Pressable>
          </Animated.View>
        ) : null}
      </View>

      {/* Session activity log (J-S4) */}
      <View
        style={[
          styles.logHost,
          { paddingBottom: insets.bottom + spacing.sm },
        ]}
      >
        <Pressable
          onPress={() => setLogExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={
            logExpanded ? "Collapse session log" : "Expand session log"
          }
          style={styles.logHeader}
        >
          <Text style={styles.logHeaderText}>
            Recent scans ({sessionScanTotal})
          </Text>
          <Icon
            name={logExpanded ? "chevD" : "chevU"}
            size={16}
            color={textTokens.tertiary}
          />
        </Pressable>
        {logExpanded ? (
          sessionScans.length === 0 ? (
            <View style={styles.logEmpty}>
              <Text style={styles.logEmptyText}>
                No scans yet. Point the camera at a ticket QR code.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.logScroll}
              contentContainerStyle={styles.logScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {sessionScans.map((scan) => (
                <SessionLogRow key={scan.id} scan={scan} />
              ))}
            </ScrollView>
          )
        ) : null}
      </View>
    </View>
  );
}

// ---- SessionLogRow -------------------------------------------------

interface SessionLogRowProps {
  scan: ReturnType<typeof useScanStore.getState>["entries"][number];
}

const SESSION_RESULT_LABEL: Record<ScanResult, string> = {
  success: "PAID",
  duplicate: "DUPE",
  wrong_event: "WRONG",
  not_found: "404",
  void: "VOID",
  cancelled_order: "CXLD",
};

const SESSION_RESULT_ICON: Record<ScanResult, "check" | "flag" | "close"> = {
  success: "check",
  duplicate: "flag",
  wrong_event: "close",
  not_found: "close",
  void: "close",
  cancelled_order: "close",
};

const SessionLogRow: React.FC<SessionLogRowProps> = ({ scan }) => {
  const spec = overlaySpec(scan.scanResult);
  const iconName = SESSION_RESULT_ICON[scan.scanResult];
  const buyer =
    scan.buyerNameAtScan.trim().length > 0 ? scan.buyerNameAtScan : "—";
  const ticketName =
    scan.ticketNameAtScan.trim().length > 0
      ? scan.ticketNameAtScan
      : scan.ticketId.startsWith("cg_")
        ? "Comp"
        : "Ticket";
  return (
    <View style={styles.logRow}>
      <View
        style={[styles.logRowIconBadge, { backgroundColor: spec.badgeBg }]}
      >
        <Icon name={iconName} size={14} color={spec.iconColor} />
      </View>
      <View style={styles.logRowCol}>
        <Text style={styles.logRowName} numberOfLines={1}>
          {buyer}
        </Text>
        <Text style={styles.logRowSubline} numberOfLines={1}>
          {ticketName}
        </Text>
      </View>
      <View style={styles.logRowRight}>
        <Text style={styles.logRowTime}>
          {formatRelativeTime(scan.scannedAt)}
        </Text>
        <View style={styles.logRowBadge}>
          <Text style={styles.logRowBadgeText}>
            {SESSION_RESULT_LABEL[scan.scanResult]}
          </Text>
        </View>
      </View>
    </View>
  );
};

// ---- Styles --------------------------------------------------------

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#000000",
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: "#ffffff",
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  testingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    backgroundColor: "rgba(235, 120, 37, 0.16)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(235, 120, 37, 0.32)",
  },
  testingBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "500",
    color: textTokens.primary,
    lineHeight: 16,
  },
  emptyHost: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  permWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  permIconBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.md,
  },
  permTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  permCopy: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 320,
    marginBottom: spacing.lg,
  },
  permActions: {
    alignSelf: "stretch",
    paddingHorizontal: spacing.lg,
  },
  cameraWrap: {
    flex: 1,
    backgroundColor: "#000000",
  },
  reticleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  reticle: {
    width: 240,
    height: 240,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: accent.warm,
  },
  reticleHelper: {
    fontSize: 13,
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: "hidden",
  },
  overlayHost: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
  },
  overlayCard: {
    backgroundColor: "rgba(15, 17, 22, 0.94)",
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  overlayIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  overlayMessage: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "center",
  },
  overlayDetail: {
    fontSize: 13,
    color: textTokens.secondary,
    textAlign: "center",
  },
  logHost: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  logHeaderText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.secondary,
    letterSpacing: 0.4,
  },
  logScroll: {
    maxHeight: 220,
  },
  logScrollContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  logEmpty: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  logEmptyText: {
    fontSize: 12,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  logRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  logRowIconBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  logRowCol: {
    flex: 1,
    minWidth: 0,
  },
  logRowName: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  logRowSubline: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
  logRowRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  logRowTime: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
  logRowBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  logRowBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: textTokens.tertiary,
    letterSpacing: 0.8,
  },
});
