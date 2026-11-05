/**
 * #4271 — design T1 "Set up Tap to Pay (once per phone)".
 *
 * Steps behind "Set up Tap to Pay":
 *   1. Stripe Terminal starts (connection token for this event's brand).
 *   2. runTapToPaySetup (services/terminal/tapToPaySetup.ts): Stripe's device
 *      check, the brand's Terminal Location (door-tap-intent `location`), the
 *      reader connection there (Apple's Tap to Pay terms appear HERE, during
 *      setup, not at the first sale), then on iPhone Apple's "How to Tap"
 *      education (ProximityReaderDiscovery, iOS 18+).
 *   3. The phone remembers setup is done, and the sale continues if one was
 *      waiting (the draft travels in the URL). The reader stays connected
 *      into the sale (one Terminal session for the tap route group).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  TAP_TO_PAY_SHORT,
  TAP_ADMIN_ONLY_COPY,
  TAP_APPLE_TERMS_ROW,
  tapToPaySetupButtonLabel,
} from "../../../constants/tapToPayCopy";
import { reportNonFatal } from "../../../diagnostics/reportNonFatal";
import { useCurrentBrandRole } from "../../../hooks/useCurrentBrandRole";
import { useManagedEventRoute } from "../../../hooks/useManagedEventRoute";
import {
  currentTapToPayDevice,
  isIosBelowTapFloor,
  useTapToPayAvailability,
} from "../../../hooks/useTapToPayAvailability";
import { createDoorPayCodeForLines, fetchDoorTapLocation } from "../../../services/terminal/doorTapEdge";
import { showHowToTapEducation } from "../../../services/terminal/howToTap";
import { markTapToPayWarmHint } from "../../../services/terminal/tapToPaySetupStore";
import { encodeTapToPayDraft, parseTapToPayDraft } from "../../../services/terminal/tapToPayDraft";
import { runTapToPaySetup } from "../../../services/terminal/tapToPaySetup";
import { Button } from "../../ui/Button";
import { GlassCard } from "../../ui/GlassCard";
import { Icon } from "../../ui/Icon";
import { IconChrome } from "../../ui/IconChrome";
import { TapConfiguringView } from "./TapConfiguringView";
import { TapNotOnThisPhone } from "./TapNotOnThisPhone";
import { TapStatusView } from "./TapStatusView";
import { TapUpdateIos } from "./TapUpdateIos";
import { tapToPayAcceptanceFor, useTapToPayTerminal } from "../../../services/terminal/tapToPaySession";
import { BRAND_ROLE_RANK } from "../../../utils/brandRole";

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
      ? TAP_APPLE_TERMS_ROW
      : { title: "Quick phone check", sub: "We check NFC is on and the phone is secure." },
  ];
};

/**
 * Apple: only an admin or authorized party may accept the terms. A loading or
 * failed role check reads as no. This can only be a client check because the
 * terms sheet is native; the server still gates the money.
 */
export const tapToPayMayAcceptTerms = (rank: number): boolean => rank >= BRAND_ROLE_RANK.brand_admin;

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
  const brandId = route.brand?.id ?? route.event?.brandId ?? null;
  const role = useCurrentBrandRole(brandId);
  const mayAcceptTerms = tapToPayMayAcceptTerms(role.rank);
  const acceptance = tapToPayAcceptanceFor(terminal, brandId);
  // iPhone only: Android has no Apple terms, so anyone with door access sets up.
  const adminRequired = Platform.OS === "ios" && !mayAcceptTerms && acceptance !== "accepted";
  const [probing, setProbing] = useState<boolean>(false);
  const probedRef = useRef<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [deviceRejected, setDeviceRejected] = useState<boolean>(false);
  const [iosUpdateRequired, setIosUpdateRequired] = useState<boolean>(false);
  const [brandNotAvailable, setBrandNotAvailable] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [payCodeBusy, setPayCodeBusy] = useState<boolean>(false);

  const goToDoor = useCallback((): void => {
    // orch-strict-grep-allow route-by-event-type — door Tap to Pay routes exist only under /event/[id]/door.
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
      // orch-strict-grep-allow route-by-event-type — door Tap to Pay routes exist only under /event/[id]/door.
      router.replace(`/event/${eventId}/door/pay/${created.codeId}` as never);
    } catch {
      setError("Couldn't make a pay code. Check your connection and try again.");
    } finally {
      setPayCodeBusy(false);
    }
  }, [draft, eventId, router, goToDoor]);

  const runSetup = useCallback(
    async (allowTerms: boolean): Promise<void> => {
      if (terminal.status === "error") {
        terminal.retryInitialize();
        return;
      }
      if (terminal.client === null) return;
      setBusy(true);
      setError(null);
      const client = terminal.client;
      try {
        const result = await runTapToPaySetup({
          os: Platform.OS,
          checkDeviceSupport: () => client.checkDeviceSupport(),
          fetchLocation: () => fetchDoorTapLocation({ brandId: route.brand?.id ?? null, eventId }),
          ensureReaderConnected: (locationId) =>
            client.ensureReaderConnected(locationId, { mayAcceptTerms: allowTerms }),
          showHowToTap: showHowToTapEducation,
          markComplete: async () => {
            if (route.brand?.id) await markTapToPayWarmHint(route.brand.id);
          },
        });
        if (result.kind === "device_rejected") {
          setDeviceRejected(true);
          return;
        }
        if (result.kind === "ios_update_required") {
          setIosUpdateRequired(true);
          return;
        }
        if (result.kind === "not_available") {
          setBrandNotAvailable(true);
          return;
        }
        if (result.kind === "terms_required") {
          // Asking Apple is how we learn this; the admin-only message now stands.
          if (allowTerms) setError("Apple's terms need accepting before this phone can take taps.");
          return;
        }
        if (result.kind === "failed") {
          setError(result.message);
          return;
        }
        if (draft !== null) {
          // orch-strict-grep-allow route-by-event-type — door Tap to Pay routes exist only under /event/[id]/door.
          router.replace(
            `/event/${eventId}/door/tap/new?draft=${encodeURIComponent(encodeTapToPayDraft(draft))}` as never,
          );
        } else {
          goToDoor();
        }
      } catch (setupError) {
        reportNonFatal("door-tap.setup", setupError);
        setError("Setup didn't finish. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
    [terminal, draft, router, eventId, goToDoor, route.brand?.id],
  );

  // Someone who may not accept the terms never gets a setup button, but an admin
  // may already have accepted them. Apple only answers when asked, so ask once,
  // never allowing the terms sheet.
  useEffect(() => {
    if (!adminRequired || role.isLoading || terminal.client === null || probedRef.current) return;
    probedRef.current = true;
    setProbing(true);
    void runSetup(false).finally(() => setProbing(false));
  }, [adminRequired, role.isLoading, terminal.client, runSetup]);

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

  const device = currentTapToPayDevice();
  const showIosUpdate =
    iosUpdateRequired ||
    availability.reason === "ios_update_required" ||
    (deviceRejected && isIosBelowTapFloor(device.os, device.version));

  let body: React.ReactElement;
  if (showIosUpdate) {
    body = <TapUpdateIos onUsePayCode={() => void startPayCode()} loading={payCodeBusy} />;
  } else if (deviceBlocked) {
    body = <TapNotOnThisPhone onUsePayCode={() => void startPayCode()} loading={payCodeBusy} />;
  } else if (!availability.available || brandNotAvailable) {
    body = (
      <TapStatusView
        tone="bad"
        icon="tap"
        title={`${TAP_TO_PAY_SHORT} isn't available here`}
        body="This brand can't take taps. Use a pay code instead. It works on any phone."
        primary={{ label: "Use a pay code", onPress: () => void startPayCode(), loading: payCodeBusy }}
      />
    );
  } else if (adminRequired) {
    body = probing || role.isLoading ? (
      <TapConfiguringView progress={terminal.config.progress} />
    ) : (
      <TapStatusView
        tone="bad"
        icon="close"
        title={TAP_ADMIN_ONLY_COPY.title}
        body={error ?? TAP_ADMIN_ONLY_COPY.body}
        primary={
          draft !== null
            ? {
                label: TAP_ADMIN_ONLY_COPY.usePayCode,
                onPress: () => void startPayCode(),
                loading: payCodeBusy,
                testID: "tap-use-pay-code",
              }
            : null
        }
        testID="tap-setup-admin-only"
      />
    );
  } else if (busy || terminal.config.installing) {
    body = <TapConfiguringView progress={terminal.config.progress} />;
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
            label={tapToPaySetupButtonLabel(Platform.OS)}
            onPress={() => void runSetup(mayAcceptTerms)}
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
