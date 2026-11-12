/**
 * #4271 — design T1 "Set up Tap to Pay (once per phone)".
 *
 * Steps behind "Set up Tap to Pay":
 *   1. Stripe Terminal is already up in the root host (TapToPayTerminalHost).
 *   2. runTapToPaySetup (services/terminal/tapToPaySetup.ts): Stripe's device
 *      check, the brand's Terminal Location (door-tap-intent `location`), the
 *      reader connection there (Apple's Tap to Pay terms appear HERE, during
 *      setup, not at the first sale), then on iPhone Apple's "How to Tap"
 *      education (ProximityReaderDiscovery, iOS 18+).
 *   3. The phone remembers this brand is worth warming up, and the sale continues
 *      if one was waiting (the draft travels in the URL). The reader stays connected
 *      into the sale. Opened from Settings (no event), the screen stays and shows
 *      that it's on, with the guide. Only a brand owner or admin may accept Apple's
 *      terms; anyone else is told who to ask.
 *
 * Door polish: the three facts are one grouped list (TapFactList) under a
 * left-aligned title, and every "can't here" screen is neutral with a fallback;
 * red is kept for Apple's hard blocks (device banned, merchant blocked).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { HELP_AND_SUPPORT_ROUTE } from "../../../constants/supportHostFacing";
import { loadHasDoorSaleEvent, openDoorSaleFromTapSetup } from "./tapSetupTakePayment";
import {
  TAP_GET_HELP,
  TAP_ON_FOR_BRAND,
  TAP_DONE,
  TAP_TAKE_PAYMENT,
  TAP_ADMIN_ONLY_COPY,
  TAP_APPLE_TERMS_ROW,
  tapToPayName,
  tapToPaySetupButtonLabel,
} from "../../../constants/tapToPayCopy";
import { reportNonFatal } from "../../../diagnostics/reportNonFatal";
import { useBrand } from "../../../hooks/useBrands";
import { useCurrentBrandRole } from "../../../hooks/useCurrentBrandRole";
import { useManagedEventRoute } from "../../../hooks/useManagedEventRoute";
import {
  currentTapToPayDevice,
  isIosBelowTapFloor,
  useTapToPayAvailability,
} from "../../../hooks/useTapToPayAvailability";
import { createDoorPayCodeForLines, DoorTapError, fetchDoorTapLocation } from "../../../services/terminal/doorTapEdge";
import { showHowToTapEducation } from "../../../services/terminal/howToTap";
import { markTapToPayWarmHint } from "../../../services/terminal/tapToPaySetupStore";
import { encodeTapToPayDraft, parseTapToPayDraft } from "../../../services/terminal/tapToPayDraft";
import { runTapToPaySetup, TAP_ADDRESS_MISSING_COPY, tapAddressRoute } from "../../../services/terminal/tapToPaySetup";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { IconChrome } from "../../ui/IconChrome";
import { doorPayCodeCreateErrorCopy } from "../doorPaymentOptions";
import { TapConfiguringView } from "./TapConfiguringView";
import { TapFactList } from "./TapFactList";
import { TapNotOnThisPhone } from "./TapNotOnThisPhone";
import { TapAddressMissing, TapNotReady, TapStatusView } from "./TapStatusView";
import { TapToPayEducation } from "./TapToPayEducation";
import { TapUpdateIos } from "./TapUpdateIos";
import { tapToPayAcceptanceFor, useTapToPayTerminal } from "../../../services/terminal/tapToPaySession";
// Only an admin may accept the terms. A client check, because the terms sheet is
// native; the server still gates the money.
import { tapToPayMayAcceptTerms } from "../../../utils/brandRole";

export interface TapToPaySetupScreenProps {
  /** Settings passes this; a door route gets the brand from its event. */
  brandId?: string | null;
  /** Null when opened from Settings, with no door to go back to. */
  eventId: string | null;
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

export const TapToPaySetupScreen = ({
  brandId: brandIdProp = null,
  eventId,
  rawDraft,
}: TapToPaySetupScreenProps): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const route = useManagedEventRoute(eventId);
  const draft = useMemo(() => parseTapToPayDraft(rawDraft), [rawDraft]);
  const brandQuery = useBrand(eventId === null ? brandIdProp : null);
  const brand = route.brand ?? brandQuery.data ?? null;
  const currency = route.event?.currency ?? brand?.defaultCurrency ?? null;
  const availability = useTapToPayAvailability({ brand, currency });
  const terminal = useTapToPayTerminal();
  const brandId = brand?.id ?? route.event?.brandId ?? brandIdProp;
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
  // #4389 — Stripe Terminal starts in the background (TapToPayTerminalHost), e.g.
  // the instant a brand is created, before it can take cards; that start fails
  // and the failure used to stay on screen here before the host tapped anything.
  // A background failure is retried quietly on arrival; an error shows only
  // after the host's own attempt, and that one tap carries on into setup.
  const [hostAttempted, setHostAttempted] = useState<boolean>(false);
  const quietRetryRef = useRef<boolean>(false);
  const pendingSetupRef = useRef<boolean | null>(null);

  const goToDoor = useCallback((): void => {
    if (eventId === null) {
      router.replace("/(tabs)/account" as never);
      return;
    }
    // orch-strict-grep-allow route-by-event-type — door Tap to Pay routes exist only under /event/[id]/door.
    router.replace(`/event/${eventId}/door` as never);
  }, [router, eventId]);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else goToDoor();
  }, [router, goToDoor]);

  // "Get help" on every state that isn't a success: the same Help & Support
  // screen as Account → Settings → Help & Support.
  const openHelp = useCallback((): void => {
    router.push(HELP_AND_SUPPORT_ROUTE as never);
  }, [router]);

  const startPayCode = useCallback(async (): Promise<void> => {
    if (draft === null || eventId === null) {
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
    } catch (error) {
      setError(doorPayCodeCreateErrorCopy(error instanceof DoorTapError ? error.code : "unknown"));
    } finally {
      setPayCodeBusy(false);
    }
  }, [draft, eventId, router, goToDoor]);

  // A probe is the silent "has an admin already accepted?" check: when it can't
  // answer, the "Ask an admin" copy stands and no error text replaces it.
  const runSetup = useCallback(
    async (allowTerms: boolean, probe = false): Promise<void> => {
      if (terminal.status === "error") {
        // Start Terminal again, then carry on with this same attempt.
        pendingSetupRef.current = allowTerms;
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
          fetchLocation: () => fetchDoorTapLocation({ brandId, eventId }),
          ensureReaderConnected: (locationId) =>
            client.ensureReaderConnected(locationId, { mayAcceptTerms: allowTerms }),
          showHowToTap: showHowToTapEducation,
          markComplete: async () => {
            if (brandId !== null) await markTapToPayWarmHint(brandId);
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
          // The server's address_missing answer always shows its T1 entry.
          if (!probe || result.message === TAP_ADDRESS_MISSING_COPY) setError(result.message);
          return;
        }
        // From Settings the screen stays and now reads "On for this brand".
        if (eventId === null) return;
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
        if (!probe) setError("Setup didn't finish. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
    [terminal, draft, router, eventId, goToDoor, brandId],
  );

  useEffect(() => {
    if (terminal.status !== "error" || quietRetryRef.current) return;
    quietRetryRef.current = true;
    terminal.retryInitialize();
  }, [terminal]);

  useEffect(() => {
    if (terminal.client === null || pendingSetupRef.current === null) return;
    const allowTerms = pendingSetupRef.current;
    pendingSetupRef.current = null;
    void runSetup(allowTerms);
  }, [terminal.client, runSetup]);

  // #4389 — "On for this brand" offers Take a payment when there is an event to
  // sell for now (same rule as Home's Take a payment).
  const [canTakePayment, setCanTakePayment] = useState<boolean>(false);
  const onForBrandShown = eventId === null && brandId !== null && availability.available && !availability.needsSetup;
  useEffect(() => {
    if (!onForBrandShown || brandId === null) return undefined;
    let alive = true;
    void loadHasDoorSaleEvent(brandId)
      .then((has) => {
        if (alive) setCanTakePayment(has);
      })
      .catch((readError: unknown) => reportNonFatal("door-tap.setup-events", readError));
    return () => {
      alive = false;
    };
  }, [onForBrandShown, brandId]);
  const takePayment = useCallback((): void => {
    if (brandId === null) return;
    void openDoorSaleFromTapSetup(router, brandId)
      .catch((openError: unknown) => reportNonFatal("door-tap.setup-take-payment", openError));
  }, [brandId, router]);

  const startHostSetup = useCallback((): void => {
    setHostAttempted(true);
    void runSetup(mayAcceptTerms);
  }, [runSetup, mayAcceptTerms]);

  // Someone who may not accept the terms never gets a setup button, but an admin
  // may already have accepted them. Apple only answers when asked, so ask once,
  // never allowing the terms sheet.
  useEffect(() => {
    if (!adminRequired || role.isLoading || terminal.client === null || probedRef.current) return;
    probedRef.current = true;
    setProbing(true);
    void runSetup(false, true).finally(() => setProbing(false));
  }, [adminRequired, role.isLoading, terminal.client, runSetup]);

  const chrome = (
    <View style={styles.chromeRow}>
      <IconChrome icon="arrowL" size={36} onPress={handleBack} accessibilityLabel="Back" />
      <Text style={styles.chromeTitle}>{tapToPayName(Platform.OS)}</Text>
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

  const terminalFailedForHost =
    hostAttempted && terminal.status === "error" && terminal.errorMessage !== null && terminal.errorMessage !== "";

  const pinRow = (currency ?? "").trim().toUpperCase() === "GBP";
  // Settings: nothing to set up (or no brand to set up): say so and keep the guide.
  const settingsGuideOnly = eventId === null && (brandId === null || (availability.available && !availability.needsSetup));

  let body: React.ReactElement;
  // #4389 — while setup runs (Apple's terms, account linking, then How to Tap)
  // the screen stays on "Getting ready": Apple's answer flips to accepted the
  // moment the reader connects, and "On for this brand" + Done used to show
  // before How to Tap, so Done left first and the guide then opened over F4.
  if (settingsGuideOnly && !busy) {
    // #4389 — "On for this brand" ends with a clear way out (back to F4, Home
    // or Settings, wherever the host came from), not only the back arrow.
    body = (
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {brandId !== null ? (
            <Text style={styles.heroTitle} accessibilityRole="header" testID="tap-on-for-brand">
              {TAP_ON_FOR_BRAND}
            </Text>
          ) : null}
          <TapToPayEducation pinRow={pinRow} />
        </ScrollView>
        <View style={styles.bar}>
          <Button
            label={TAP_DONE}
            onPress={handleBack}
            variant="primary"
            size="lg"
            fullWidth
            accessibilityLabel={TAP_DONE}
            testID="tap-on-done"
          />
          {canTakePayment ? (
            <Button
              label={TAP_TAKE_PAYMENT}
              onPress={takePayment}
              variant="secondary"
              size="lg"
              fullWidth
              accessibilityLabel={TAP_TAKE_PAYMENT}
              testID="tap-on-take-payment"
            />
          ) : null}
        </View>
      </View>
    );
  } else if (showIosUpdate) {
    body = <TapUpdateIos onUsePayCode={() => void startPayCode()} loading={payCodeBusy} onHelp={openHelp} />;
  } else if (deviceBlocked) {
    body = <TapNotOnThisPhone onUsePayCode={() => void startPayCode()} loading={payCodeBusy} onHelp={openHelp} />;
  } else if (!availability.available || brandNotAvailable) {
    // #4389 — a US / UK brand without a payment account is told to finish
    // setup; "isn't available here" says why, for brands that truly can't.
    body = (
      <TapNotReady
        reason={
          !availability.available &&
          (availability.reason === "no_card_payments" ||
            availability.reason === "unsupported_country" ||
            availability.reason === "paystack" ||
            availability.reason === "not_released" ||
            availability.reason === "no_brand")
            ? availability.reason
            : "server_not_available"
        }
        os={Platform.OS}
        onFinishSetup={brandId !== null ? () => router.push(`/brand/${brandId}/setup?step=pay` as never) : null}
        onUsePayCode={() => void startPayCode()}
        payCodeBusy={payCodeBusy}
        onHelp={openHelp}
        testID="tap-setup-not-available"
      />
    );
  } else if (adminRequired) {
    body = probing || role.isLoading ? (
      <TapConfiguringView progress={terminal.config.progress} />
    ) : (
      <TapStatusView
        tone="neutral"
        icon="user"
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
        onHelp={openHelp}
        testID="tap-setup-admin-only"
      />
    );
  } else if (busy || terminal.config.installing) {
    body = <TapConfiguringView progress={terminal.config.progress} />;
  } else if (error === TAP_ADDRESS_MISSING_COPY && brandId !== null) {
    // #4389 S-i — no usable card-payment address: open T1, then set up again.
    body = (
      <TapAddressMissing
        onAddAddress={() => {
          setError(null);
          router.push(tapAddressRoute(brandId) as never);
        }}
        onHelp={openHelp}
      />
    );
  } else {
    const rows = setupRowsFor(Platform.OS);
    body = (
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Apple allows no art of the feature on iPhone. */}
          {Platform.OS === "android" ? (
            <View style={styles.heroIcon}>
              <Icon name="tap" size={28} color={accent.warm} />
            </View>
          ) : null}
          <Text style={styles.setupTitle} accessibilityRole="header">
            {Platform.OS === "ios" ? "Take cards on this iPhone" : "Take cards on this phone"}
          </Text>
          <TapFactList facts={rows} testID="tap-setup-facts" />
          {terminalFailedForHost ? (
            <Text style={styles.error}>{terminal.errorMessage}</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {error || terminalFailedForHost ? (
            <HelpLink onPress={openHelp} />
          ) : null}
        </ScrollView>
        <View style={styles.bar}>
          <Button
            label={tapToPaySetupButtonLabel(Platform.OS)}
            onPress={startHostSetup}
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

/** The setup list's own "Get help" once setup failed (the status screens carry theirs). */
const HelpLink = ({ onPress }: { onPress: () => void }): React.ReactElement => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={TAP_GET_HELP}
    style={styles.helpLink}
    testID="tap-get-help"
  >
    <Text style={styles.helpLinkText}>{TAP_GET_HELP}</Text>
  </Pressable>
);

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
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
    marginTop: spacing.sm,
  },
  heroTitle: { ...typography.h3, color: textTokens.primary, textAlign: "center" },
  setupTitle: {
    ...typography.h2,
    lineHeight: 32,
    color: textTokens.primary,
    textAlign: "left",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  bar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  error: {
    ...typography.bodySm,
    color: semantic.errorText,
    textAlign: "center",
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  helpLink: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  helpLinkText: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.secondary,
    textDecorationLine: "underline",
  },
});
