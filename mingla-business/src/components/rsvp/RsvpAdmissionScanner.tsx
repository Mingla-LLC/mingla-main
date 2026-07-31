/**
 * /rsvp/[id]/scanner — Issue #1447 web camera fallback.
 *
 * The native scanner component statically imports `expo-camera`
 * (`CameraView`, `useCameraPermissions`) + `expo-haptics`. `expo-camera`'s
 * `CameraView` has no working barcode-scan path on web — `onBarcodeScanned`
 * is native-only — so on a phone browser the route either dead-ends on a
 * camera-permission gate that leads nowhere, or ships native camera refs
 * into the web bundle. Metro resolves this generic file for web while native
 * resolves the `.native.tsx` implementation,
 * so the native `expo-camera`/`expo-haptics` imports never land in the web
 * bundle at all (same hygiene as coverPickerVideoTrimEditor.web.ts and the
 * connect-* .web.tsx route splits).
 *
 * Rather than strand a web operator on a dead camera screen, the web path is
 * an explicit, coherent end state: scanning happens in the Mingla Business
 * app. We keep the same chrome (close + title), reuse the kind-aware copy
 * lens, honor the replacement-event redirect, and offer a clear way forward
 * (back to the event dashboard). No camera, no permission prompt, no crash.
 *
 * The native iOS/Android scanner remains the primary scan surface.
 */

import React, { useCallback, useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { useManagedEventRoute } from "../../hooks/useManagedEventRoute";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";

export default function ScannerCameraWebRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;

  const routeEvent = useManagedEventRoute(
    typeof eventId === "string" ? eventId : null,
  );

  // Honor the same replacement-event redirect the native route uses, so a
  // rescheduled/replaced event resolves to its live id on web too.
  useEffect(() => {
    if (routeEvent.replacementEventId !== null) {
      router.replace(`/rsvp/${routeEvent.replacementEventId}/scanner` as never);
    }
  }, [routeEvent.replacementEventId, router]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (typeof eventId === "string") {
      router.replace(`/rsvp/${eventId}` as never);
    }
  }, [router, eventId]);

  const handleOpenDashboard = useCallback((): void => {
    if (typeof eventId === "string") {
      router.replace(`/rsvp/${eventId}` as never);
    } else {
      handleBack();
    }
  }, [router, eventId, handleBack]);

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Scan RSVP guests</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      <View style={styles.body}>
        <EmptyState
          illustration={<Icon name="qr" size={48} color={textTokens.primary} />}
          title="Scan RSVP invites in the app"
          description="Door scanning uses your phone camera in the Mingla Business app. Open the app on your phone to scan RSVP invite QR codes; manage the guest list here on the web."
        />
        <View style={styles.actions}>
          <Button
            label="Back to RSVP"
            onPress={handleOpenDashboard}
            variant="primary"
            size="lg"
            fullWidth
            accessibilityLabel="Back to the RSVP dashboard"
          />
        </View>
      </View>
    </View>
  );
}

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
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
  },
  actions: {
    alignSelf: "stretch",
    paddingHorizontal: spacing.lg,
  },
});
