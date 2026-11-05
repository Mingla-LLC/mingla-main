/**
 * #4271 — Tap to Pay door sale (design T2 ready/reading, T3 needs PIN / declined,
 * H4 paid, T1 "not on this phone").
 *
 * On iPhone the tap prompt is Apple's own sheet; on Android it is Stripe's. This
 * screen shows the amount and tickets behind it, and every end state says
 * whether money was taken. Tickets only exist once the server records the
 * succeeded payment (door-tap-intent complete).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  accent,
  canvas,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import {
  TAP_TO_PAY_SHORT,
  tapReaderProblemCanRetry,
  tapReaderProblemCopy,
  tapReaderProblemTitle,
} from "../../../constants/tapToPayCopy";
import { useManagedEventRoute } from "../../../hooks/useManagedEventRoute";
import { doorSaleKeys } from "../../../hooks/useEventDoorSales";
import {
  currentTapToPayDevice,
  isIosBelowTapFloor,
  useTapToPayAvailability,
} from "../../../hooks/useTapToPayAvailability";
import { postHogService } from "../../../services/postHogService";
import { reportNonFatal } from "../../../diagnostics/reportNonFatal";
import {
  cancelDoorTapIntent,
  completeDoorTapIntent,
  createDoorPayCodeForLines,
  createDoorTapIntent,
} from "../../../services/terminal/doorTapEdge";
import {
  encodeTapToPayDraft,
  parseTapToPayDraft,
  type TapToPayDraft,
} from "../../../services/terminal/tapToPayDraft";
import {
  TapToPaySaleFlow,
  type TapAmount,
  type TapSaleState,
} from "../../../services/terminal/tapToPayFlow";
import { consumeDoorTapPress } from "../../../services/terminal/tapTiming";
import { formatCurrency, majorFromMinor } from "../../../utils/currency";
import { HapticFeedback } from "../../../utils/hapticFeedback";
import { randomUuid } from "../../../utils/randomId";
import { GlassCard } from "../../ui/GlassCard";
import { IconChrome } from "../../ui/IconChrome";
import { Spinner } from "../../ui/Spinner";
import { TapStatusView } from "./TapStatusView";
import { useTapToPayTerminal } from "../../../services/terminal/tapToPaySession";
import { TapConfiguringView } from "./TapConfiguringView";
import { TapNotOnThisPhone } from "./TapNotOnThisPhone";
import { TapUpdateIos } from "./TapUpdateIos";
import { summarizeTapLines } from "./tapLineSummary";

export interface TapToPaySaleScreenProps {
  eventId: string;
  saleId: string;
  rawDraft: string | null;
}

const formatAmount = (amount: TapAmount): string =>
  formatCurrency(majorFromMinor(amount.totalCents, amount.currency), amount.currency);

export const TapToPaySaleScreen = ({
  eventId,
  saleId,
  rawDraft,
}: TapToPaySaleScreenProps): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const route = useManagedEventRoute(eventId);
  const draft = useMemo<TapToPayDraft | null>(
    () => (saleId === "new" ? parseTapToPayDraft(rawDraft) : null),
    [saleId, rawDraft],
  );
  const availability = useTapToPayAvailability({
    brand: route.brand,
    currency: route.event?.currency ?? route.brand?.defaultCurrency ?? null,
  });
  const terminal = useTapToPayTerminal();
  const [state, setState] = useState<TapSaleState>({ kind: "idle" });
  const [payCodeBusy, setPayCodeBusy] = useState<boolean>(false);
  const [payCodeError, setPayCodeError] = useState<string | null>(null);
  const clientRequestIdRef = useRef<string>(randomUuid());
  const flowRef = useRef<TapToPaySaleFlow | null>(null);

  const lineSummary = useMemo(
    () => (draft === null ? "" : summarizeTapLines(draft.lines, route.event?.tickets ?? [])),
    [draft, route.event?.tickets],
  );

  const goToDoor = useCallback((): void => {
    // orch-strict-grep-allow route-by-event-type — door Tap to Pay routes exist only under /event/[id]/door.
    router.replace(`/event/${eventId}/door` as never);
  }, [router, eventId]);

  const handleClose = useCallback((): void => {
    void flowRef.current?.cancel();
    if (router.canGoBack()) router.back();
    else goToDoor();
  }, [router, goToDoor]);

  // Setup comes first, once per phone. The draft travels with it.
  useEffect(() => {
    if (draft !== null && availability.available && (availability.needsSetup || state.kind === "needs_setup")) {
      // orch-strict-grep-allow route-by-event-type — door Tap to Pay routes exist only under /event/[id]/door.
      router.replace(
        `/event/${eventId}/door/tap/setup?draft=${encodeURIComponent(encodeTapToPayDraft(draft))}` as never,
      );
    }
  }, [draft, availability.available, availability.needsSetup, state.kind, router, eventId]);

  // Start the sale once the reader session is ready.
  useEffect(() => {
    if (
      draft === null ||
      !availability.available ||
      availability.reason === "ios_update_required" ||
      availability.needsSetup ||
      terminal.status !== "ready" ||
      terminal.client === null ||
      flowRef.current !== null
    ) {
      return;
    }
    const flow = new TapToPaySaleFlow({
      eventId,
      draft,
      clientRequestId: clientRequestIdRef.current,
      terminal: terminal.client,
      server: {
        createIntent: createDoorTapIntent,
        completeIntent: completeDoorTapIntent,
        cancelIntent: cancelDoorTapIntent,
      },
      onState: setState,
      onBeforeCollect: () => {
        const timing = consumeDoorTapPress();
        if (timing !== null) postHogService.capture("door_tap_ui_ms", { ms: timing.ms, warm: timing.warm });
      },
      report: reportNonFatal,
    });
    flowRef.current = flow;
    void flow.start();
  }, [draft, availability.available, availability.needsSetup, terminal.status, terminal.client, eventId]);

  // Side effects of the end states.
  useEffect(() => {
    if (state.kind === "approved") {
      HapticFeedback.success();
      void queryClient.invalidateQueries({ queryKey: doorSaleKeys.byEvent(eventId) });
      postHogService.capture("door_sale_recorded", {
        method: "tap_to_pay",
        has_phone: draft?.buyerPhone != null,
        ticket_count: draft?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0,
      });
    } else if (state.kind === "needs_pin" || state.kind === "declined" || state.kind === "failed") {
      postHogService.capture("door_sale_failed", { reason: `tap_${state.kind}` });
    }
  }, [state, queryClient, eventId, draft]);

  const showPayCodeInstead = useCallback(async (): Promise<void> => {
    if (draft === null) {
      goToDoor();
      return;
    }
    setPayCodeBusy(true);
    setPayCodeError(null);
    try {
      // Cancel the open PaymentIntent first so the abandoned tap can never be
      // charged as well. If Stripe says it already succeeded, the flow records
      // that sale instead and no pay code is made.
      const outcome = (await flowRef.current?.abandonForPayCode()) ?? "switch";
      if (outcome === "already_paid") return;
      const created = await createDoorPayCodeForLines({
        eventId,
        eventDateId: draft.eventDateId,
        lines: draft.lines,
      });
      // orch-strict-grep-allow route-by-event-type — door Tap to Pay routes exist only under /event/[id]/door.
      router.replace(`/event/${eventId}/door/pay/${created.codeId}` as never);
    } catch {
      setPayCodeError("Couldn't make a pay code. Check your connection and try again.");
    } finally {
      setPayCodeBusy(false);
    }
  }, [draft, eventId, router, goToDoor]);

  const sellAnother = useCallback((): void => {
    if (draft === null) {
      goToDoor();
      return;
    }
    // orch-strict-grep-allow route-by-event-type — door Tap to Pay routes exist only under /event/[id]/door.
    router.replace(
      `/event/${eventId}/door?sellAnother=1&draft=${encodeURIComponent(encodeTapToPayDraft(draft))}` as never,
    );
  }, [draft, eventId, router, goToDoor]);

  const chrome = (
    <View style={styles.chromeRow}>
      <IconChrome icon="close" size={36} onPress={handleClose} accessibilityLabel="Close" />
      <Text style={styles.chromeTitle}>{TAP_TO_PAY_SHORT}</Text>
      <View style={styles.chromeRightSlot} />
    </View>
  );

  const payCodeAction = {
    label: "Show a pay code instead",
    onPress: () => void showPayCodeInstead(),
    loading: payCodeBusy,
    testID: "tap-show-pay-code",
  };

  const renderBody = (): React.ReactElement => {
    if (draft === null) {
      return (
        <TapStatusView
          tone="bad"
          icon="close"
          title="This sale couldn't be opened"
          body="Nothing was charged. Start the sale again from door sales."
          primary={{ label: "Back to door sales", onPress: goToDoor }}
        />
      );
    }
    const device = currentTapToPayDevice();
    const belowFloor = isIosBelowTapFloor(device.os, device.version);
    const updateIos = (
      <TapUpdateIos onUsePayCode={() => void showPayCodeInstead()} loading={payCodeBusy} />
    );
    if (availability.reason === "ios_update_required") return updateIos;
    if (!availability.available) {
      if (
        availability.reason === "not_released" ||
        availability.reason === "paystack" ||
        availability.reason === "unsupported_country" ||
        availability.reason === "no_card_payments" ||
        availability.reason === "no_brand"
      ) {
        return (
          <TapStatusView
            tone="bad"
            icon="tap"
            title={`${TAP_TO_PAY_SHORT} isn't available here`}
            body="This brand can't take taps. Use a pay code instead. It works on any phone."
            primary={{ label: "Use a pay code", onPress: () => void showPayCodeInstead(), loading: payCodeBusy }}
          />
        );
      }
      return <TapNotOnThisPhone onUsePayCode={() => void showPayCodeInstead()} loading={payCodeBusy} />;
    }
    if (terminal.config.installing) return <TapConfiguringView progress={terminal.config.progress} />;
    if (terminal.status === "unavailable") {
      return <TapNotOnThisPhone onUsePayCode={() => void showPayCodeInstead()} loading={payCodeBusy} />;
    }
    if (terminal.status === "error") {
      return (
        <TapStatusView
          tone="bad"
          icon="tap"
          title="Tap to Pay didn't start"
          body={`${terminal.errorMessage ?? "Try again."} Nothing was charged.`}
          primary={{ label: "Try again", onPress: terminal.retryInitialize }}
          secondary={payCodeAction}
        />
      );
    }
    switch (state.kind) {
      case "idle":
      case "starting":
        return <TapConfiguringView progress={terminal.config.progress} />;
      case "ready":
      case "reading":
      case "saving":
        return (
          <View style={styles.amountHost} testID={`tap-state-${state.kind}`}>
            <Text style={styles.amount}>{formatAmount(state.amount)}</Text>
            <Text style={styles.lines}>{lineSummary}</Text>
            <View style={styles.statusRow}>
              {state.kind === "ready" ? <View style={styles.pulse} /> : <Spinner size={24} />}
              <Text style={styles.statusText}>
                {state.kind === "ready"
                  ? Platform.OS === "ios"
                    ? "Hold the card near the top of the iPhone."
                    : "Hold the card on the back of the phone."
                  : state.kind === "reading"
                    ? "Reading card…"
                    : "Saving the sale…"}
              </Text>
            </View>
          </View>
        );
      case "approved":
        return (
          <TapStatusView
            tone="ok"
            icon="check"
            title={`Paid ${formatAmount(state.amount)}`}
            body={state.cardLabel}
            primary={{ label: "Sell another", onPress: sellAnother, testID: "tap-sell-another" }}
            secondary={{ label: "Done", onPress: goToDoor }}
            secondaryGhost
            testID="tap-state-approved"
          >
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Guest</Text>
                <Text style={styles.kvValue}>Walk-up</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.kvLabel}>Tickets</Text>
                <Text style={styles.kvValue}>{lineSummary}</Text>
              </View>
              <View style={[styles.kv, styles.kvLast]}>
                <Text style={styles.kvLabel}>Entry</Text>
                <Text style={styles.kvValueOk}>Checked in</Text>
              </View>
            </GlassCard>
          </TapStatusView>
        );
      case "needs_pin":
        return (
          <TapStatusView
            tone="bad"
            icon="close"
            title="This card needs a PIN"
            body="Some cards ask for chip and PIN, and a phone can't take that. Try Apple Pay, another card, or a pay code."
            primary={payCodeAction}
            secondary={{ label: "Try another card", onPress: () => void flowRef.current?.tryAnotherCard() }}
            testID="tap-state-needs_pin"
          />
        );
      case "declined":
        return (
          <TapStatusView
            tone="bad"
            icon="close"
            title="Card declined"
            body="Their bank said no. Nothing was charged."
            primary={payCodeAction}
            secondary={{ label: "Try another card", onPress: () => void flowRef.current?.tryAnotherCard() }}
            testID="tap-state-declined"
          />
        );
      case "cancelled":
        return (
          <TapStatusView
            tone="bad"
            icon="close"
            title="Tap cancelled"
            body="Nothing was charged."
            primary={{ label: "Try again", onPress: () => void flowRef.current?.tryAnotherCard() }}
            secondary={payCodeAction}
          />
        );
      case "ios_update_required":
        return updateIos;
      case "needs_setup":
        // The effect above is moving to setup with the draft.
        return (
          <View style={styles.waitHost}>
            <Spinner size={36} />
          </View>
        );
      case "reader_problem":
        return (
          <TapStatusView
            tone="bad"
            icon="close"
            title={tapReaderProblemTitle(Platform.OS)}
            body={tapReaderProblemCopy(state.problem, Platform.OS)}
            primary={
              tapReaderProblemCanRetry(state.problem)
                ? { label: "Try again", onPress: () => void flowRef.current?.start() }
                : payCodeAction
            }
            secondary={tapReaderProblemCanRetry(state.problem) ? payCodeAction : null}
            testID="tap-state-reader_problem"
          />
        );
      case "not_on_this_phone":
        // Below iOS 17.6 a device-class failure is the iOS version until proven otherwise.
        return belowFloor ? (
          updateIos
        ) : (
          <TapNotOnThisPhone onUsePayCode={() => void showPayCodeInstead()} loading={payCodeBusy} />
        );
      case "save_failed":
        return (
          <TapStatusView
            tone="bad"
            icon="clock"
            title="Paid, still saving"
            body={state.message}
            primary={{ label: "Try again", onPress: () => void flowRef.current?.retrySave() }}
            testID="tap-state-save_failed"
          />
        );
      case "failed":
        return (
          <TapStatusView
            tone="bad"
            icon="close"
            title="Payment didn't start"
            body={state.message}
            primary={{ label: "Try again", onPress: () => void flowRef.current?.start() }}
            secondary={payCodeAction}
          />
        );
      default: {
        const exhaustive: never = state;
        return exhaustive;
      }
    }
  };

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.md, backgroundColor: canvas.discover },
      ]}
    >
      {chrome}
      {renderBody()}
      {payCodeError ? <Text style={styles.inlineError}>{payCodeError}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chromeTitle: { ...typography.h3, color: textTokens.primary },
  chromeRightSlot: { width: 36 },
  waitHost: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  amountHost: { flex: 1, alignItems: "center", paddingTop: spacing.xxl, gap: spacing.xs },
  amount: { ...typography.display, fontSize: 44, lineHeight: 56, color: textTokens.primary },
  lines: { ...typography.body, color: textTokens.secondary, textAlign: "center", paddingHorizontal: spacing.lg },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg },
  pulse: { width: 8, height: 8, borderRadius: 999, backgroundColor: accent.warm },
  statusText: { ...typography.bodySm, color: textTokens.secondary },
  kv: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  kvLast: { borderBottomWidth: 0 },
  kvLabel: { ...typography.bodySm, color: textTokens.secondary },
  kvValue: { ...typography.bodySm, color: textTokens.primary, flexShrink: 1, textAlign: "right" },
  kvValueOk: { ...typography.bodySm, color: semantic.success },
  inlineError: {
    ...typography.bodySm,
    color: semantic.errorText,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
});
