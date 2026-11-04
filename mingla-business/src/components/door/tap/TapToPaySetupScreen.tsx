/**
 * #4271 — design T1 "Set up Tap to Pay (once per phone)".
 *
 * Steps behind "Set up Tap to Pay":
 *   1. Stripe Terminal starts (connection token for this event's brand).
 *   2. Stripe's device check (supportsReadersOfType tapToPay). A failure shows
 *      "This phone can't take taps".
 *   3. iPhone: Apple's "How to Tap" education (ProximityReaderDiscovery, iOS 18+;
 *      earlier iOS versions rely on this screen's own explanation).
 *   4. The phone remembers setup is done, and the sale continues if one was
 *      waiting (the draft travels in the URL).
 * Apple's Tap to Pay terms appear on the first reader connection, which the sale
 * screen makes at the brand's Terminal Location.
 */
import React, { useCallback, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { useManagedEventRoute } from "../../../hooks/useManagedEventRoute";
import { useTapToPayAvailability } from "../../../hooks/useTapToPayAvailability";
import { createDoorPayCodeForLines } from "../../../services/terminal/doorTapEdge";
import { showHowToTapEducation } from "../../../services/terminal/howToTap";
import { markTapToPaySetupComplete } from "../../../services/terminal/tapToPaySetupStore";
import { encodeTapToPayDraft, parseTapToPayDraft } from "../../../services/terminal/tapToPayDraft";
import { Button } from "../../ui/Button";
import { GlassCard } from "../../ui/GlassCard";
import { Icon } from "../../ui/Icon";
import { IconChrome } from "../../ui/IconChrome";
import { TapNotOnThisPhone } from "./TapNotOnThisPhone";
import { TapStatusView } from "./TapStatusView";
import { useTapToPayTerminal } from "./TapToPayTerminalBoundary";

export interface TapToPaySetupScreenProps {
  eventId: string;
  rawDraft: string | null;
}

interface SetupRow {
  title: string;
  sub: string;
}

export const setupRowsFor = (os: string): SetupRow[] => {
  const ios = os === "ios";
  return [
    {
      title: "No card machine",
      sub: `Guests tap a contactless card, Apple Pay or Google Pay on ${ios ? "the top of the iPhone" : "the back of the phone"}.`,
    },
    {
      title: "Same money as online",
      sub: "Paid out with your online sales. Mingla fee 4.5%.",
    },
    ios
      ? { title: "Apple's terms", sub: "Apple asks the brand owner to accept its Tap to Pay terms once." }
      : { title: "Quick phone check", sub: "We check NFC is on and the phone is secure." },
  ];
};

export const TapToPaySetupScreen = ({ eventId, rawDraft }: TapToPaySetupScreenProps): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const route = useManagedEventRoute(eventId);
  const draft = useMemo(() => parseTapToPayDraft(rawDraft), [rawDraft]);
  const availability = useTapToPayAvailability({
    brand: route.brand,
    currency: route.event?.currency ?? route.brand?.defaultCurrency ?? null,
  });
  const terminal = useTapToPayTerminal();
  const [busy, setBusy] = useState<boolean>(false);
  const [deviceRejected, setDeviceRejected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [payCodeBusy, setPayCodeBusy] = useState<boolean>(false);

  const goToDoor = useCallback((): void => {
    router.replace(`/event/${eventId}/door` as never);
  }, [router, eventId]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else goToDoor();
  }, [router, goToDoor]);

  const startPayCode = useCallback(async (): Promise<void> => {
    if (draft === null) {
      goToDoor();
      return;
    }
    setPayCodeBusy(true);
    setError(null);
    try {
      const created = await createDoorPayCodeForLines({
        eventId,
        eventDateId: draft.eventDateId,
        lines: draft.lines,
      });
      router.replace(`/event/${eventId}/door/pay/${created.codeId}` as never);
    } catch {
      setError("Couldn't make a pay code. Check your connection and try again.");
    } finally {
      setPayCodeBusy(false);
    }
  }, [draft, eventId, router, goToDoor]);

  const runSetup = useCallback(async (): Promise<void> => {
    if (terminal.status === "error") {
      terminal.retryInitialize();
      return;
    }
    if (terminal.client === null) return;
    setBusy(true);
    setError(null);
    try {
      const support = await terminal.client.checkDeviceSupport();
      if (!support.supported) {
        setDeviceRejected(true);
        return;
      }
      if (Platform.OS === "ios") {
        try {
          await showHowToTapEducation();
        } catch {
          setError("Couldn't show Apple's How to Tap guide. Try again.");
          return;
        }
      }
      await markTapToPaySetupComplete();
      if (draft !== null) {
        router.replace(
          `/event/${eventId}/door/tap/new?draft=${encodeURIComponent(encodeTapToPayDraft(draft))}` as never,
        );
      } else {
        goToDoor();
      }
    } catch {
      setError("Setup didn't finish. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [terminal, draft, router, eventId, goToDoor]);

  const chrome = (
    <View style={styles.chromeRow}>
      <IconChrome icon="arrowL" size={36} onPress={handleBack} accessibilityLabel="Back" />
      <Text style={styles.chromeTitle}>Tap to Pay</Text>
      <View style={styles.chromeRightSlot} />
    </View>
  );

  const deviceBlocked =
    deviceRejected ||
    terminal.status === "unavailable" ||
    (!availability.available &&
      (availability.reason === "sdk_missing" ||
        availability.reason === "unsupported_device" ||
        availability.reason === "web"));

  let body: React.ReactElement;
  if (deviceBlocked) {
    body = <TapNotOnThisPhone onUsePayCode={() => void startPayCode()} loading={payCodeBusy} />;
  } else if (!availability.available) {
    body = (
      <TapStatusView
        tone="bad"
        icon="tap"
        title="Tap to pay isn't available here"
        body="This brand can't take taps. Use a pay code instead. It works on any phone."
        primary={{ label: "Use a pay code", onPress: () => void startPayCode(), loading: payCodeBusy }}
      />
    );
  } else {
    const rows = setupRowsFor(Platform.OS);
    body = (
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.heroIcon}>
            <Icon name="tap" size={28} color={accent.warm} />
          </View>
          <Text style={styles.heroTitle} accessibilityRole="header">
            {Platform.OS === "ios" ? "Take cards on this iPhone" : "Take cards on this phone"}
          </Text>
          <View style={styles.rows}>
            {rows.map((row) => (
              <GlassCard key={row.title} variant="base" radius="md" padding={spacing.md}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowSub}>{row.sub}</Text>
              </GlassCard>
            ))}
          </View>
          {terminal.status === "error" && terminal.errorMessage ? (
            <Text style={styles.error}>{terminal.errorMessage}</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.bar}>
          <Button
            label="Set up Tap to Pay"
            onPress={() => void runSetup()}
            loading={busy || terminal.status === "initializing"}
            disabled={busy || terminal.status === "initializing"}
            variant="primary"
            size="lg"
            fullWidth
            testID="tap-setup-start"
          />
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.md, backgroundColor: canvas.discover },
      ]}
    >
      {chrome}
      {body}
      {deviceBlocked && error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  flex: { flex: 1 },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chromeTitle: { ...typography.h3, color: textTokens.primary },
  chromeRightSlot: { width: 36 },
  scrollContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: radiusTokens.lg,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
    marginTop: spacing.sm,
  },
  heroTitle: { ...typography.h3, color: textTokens.primary, textAlign: "center" },
  rows: { gap: spacing.sm, marginTop: spacing.xs },
  rowTitle: { ...typography.bodySm, fontWeight: "600", color: textTokens.primary },
  rowSub: { ...typography.caption, color: textTokens.secondary, marginTop: 2 },
  bar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  error: {
    ...typography.bodySm,
    color: semantic.errorText,
    textAlign: "center",
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
});
