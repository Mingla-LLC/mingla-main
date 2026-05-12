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
import {
  useScanStore,
  type ScanResult,
} from "../../../../src/store/scanStore";
import { useAuth } from "../../../../src/context/AuthContext";
import { useManagedEventRoute } from "../../../../src/hooks/useManagedEventRoute";
import {
  ScanTicketError,
  scanTicket,
} from "../../../../src/services/scanTicketService";

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

// ORCH-0793 — render an upcoming door time as the operator reads it.
// Same day → "at 9:00 PM"; tomorrow → "tomorrow 9:00 PM";
// further out → "Fri Nov 14, 9:00 PM". UTC ISO in, locale string out.
const formatDoorTime = (iso: string): string => {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const now = new Date();
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    then.getFullYear() === tomorrow.getFullYear() &&
    then.getMonth() === tomorrow.getMonth() &&
    then.getDate() === tomorrow.getDate();
  const time = then.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return `at ${time}`;
  if (isTomorrow) return `tomorrow ${time}`;
  const date = then.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${date}, ${time}`;
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
    // ORCH-0793 — time-window discriminators. Warning tone (amber/flag)
    // matches "duplicate" because both are recoverable: the ticket stays
    // valid and the buyer can re-scan inside the window.
    case "not_yet_open":
    case "event_ended":
      return {
        iconName: "flag",
        iconColor: accent.warm,
        badgeBg: "rgba(235, 120, 37, 0.18)",
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

  const routeEvent = useManagedEventRoute(
    typeof eventId === "string" ? eventId : null,
  );
  const event = routeEvent.event;

  useEffect(() => {
    if (routeEvent.replacementEventId !== null) {
      router.replace(`/event/${routeEvent.replacementEventId}/scanner` as never);
    }
  }, [routeEvent.replacementEventId, router]);

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

  const recordServerScan = useCallback(
    (scan: {
      result: ScanResult;
      ticketId: string | null;
      orderId: string | null;
      buyerName: string | null;
      ticketName: string | null;
    }): void => {
      if (event === null || scan.ticketId === null) return;
      useScanStore.getState().recordScan({
        ticketId: scan.ticketId,
        orderId: scan.orderId ?? "",
        eventId: event.id,
        brandId: event.brandId,
        scannerUserId: operatorAccountId,
        scanResult: scan.result,
        via: "qr",
        offlineQueued: false,
        buyerNameAtScan: scan.buyerName ?? "",
        ticketNameAtScan: scan.ticketName ?? "",
      });
    },
    [event, operatorAccountId],
  );

  const handleBarcodeScanned = useCallback(
    (scan: BarcodeScanningResult): void => {
      if (overlayVisibleRef.current) return; // guard against double-fire
      if (event === null) return;
      overlayVisibleRef.current = true;
      void (async () => {
        try {
          const result = await scanTicket(event.id, scan.data);
          const kind = result.result as ScanResult;
          recordServerScan({
            result: kind,
            ticketId: result.ticketId,
            orderId: result.orderId,
            buyerName: result.buyerName,
            ticketName: result.ticketName,
          });
          if (kind === "success") {
            showResult({
              kind,
              message: `${result.buyerName ?? "Guest"} checked in`,
              detail: result.ticketName ?? "Ticket",
            });
            void Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            );
            return;
          }
          // ORCH-0793 — explicit branches so the time-window cases can
          // pull nextStartAt / lastEndAt off the server response.
          let message: string;
          let detail: string | undefined = result.ticketName ?? undefined;
          if (kind === "duplicate") {
            message = "Already checked in";
          } else if (kind === "wrong_event") {
            message = "Different event";
          } else if (kind === "void") {
            message = "Ticket not valid";
          } else if (kind === "not_yet_open") {
            message = "Doors aren't open yet";
            detail = result.nextStartAt
              ? `Opens ${formatDoorTime(result.nextStartAt)}`
              : "Try again closer to start time";
          } else if (kind === "event_ended") {
            message = result.lastEndAt
              ? `Event ended ${formatRelativeTime(result.lastEndAt)}`
              : "Event has ended";
            detail = "Ticket can't be used after the event";
          } else {
            message = "Ticket not found";
          }
          showResult({ kind, message, detail });
          // Warning tone for recoverable states (duplicate + the two new
          // time-window states); Error tone for the not-recoverable ones.
          void Haptics.notificationAsync(
            kind === "duplicate" ||
              kind === "not_yet_open" ||
              kind === "event_ended"
              ? Haptics.NotificationFeedbackType.Warning
              : Haptics.NotificationFeedbackType.Error,
          );
        } catch (error) {
          // ORCH-0795: surface the real edge-function failure reason.
          // ScanTicketError.code tells us whether the scanner is not
          // authorized (403/scanner_not_authorized) vs. a generic failure.
          let message = "Scan failed";
          let detail: string | undefined =
            error instanceof Error && error.message
              ? error.message
              : undefined;
          if (error instanceof ScanTicketError) {
            if (error.code === "scanner_not_authorized") {
              message = "You're not authorized to scan this event";
              detail = "Ask the event owner to add you as a scanner.";
            } else if (error.code === "auth_required") {
              message = "Please sign in again";
              detail = "Your session expired.";
            }
          }
          showResult({
            kind: "not_found",
            message,
            detail,
          });
          void Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Error,
          );
        }
      })();
    },
    [event, showResult, recordServerScan],
  );

  // ---- Not-found shell ---------------------------------------------
  if (event === null && routeEvent.isLoading && typeof eventId === "string") {
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
          <Text style={styles.loadingText}>Loading event...</Text>
        </View>
      </View>
    );
  }

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
  // ORCH-0793 — time-window discriminators in the session log tail.
  not_yet_open: "EARLY",
  event_ended: "LATE",
};

const SESSION_RESULT_ICON: Record<ScanResult, "check" | "flag" | "close"> = {
  success: "check",
  duplicate: "flag",
  wrong_event: "close",
  not_found: "close",
  void: "close",
  cancelled_order: "close",
  not_yet_open: "flag",
  event_ended: "flag",
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
  emptyHost: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    fontSize: 14,
    color: textTokens.secondary,
    textAlign: "center",
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
