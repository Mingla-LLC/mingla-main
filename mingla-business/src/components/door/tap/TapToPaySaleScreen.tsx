/**
 * #4271 — Tap to Pay door sale (design T2 ready/reading, T3 needs PIN / declined,
 * H4 paid, T1 "not on this phone").
 *
 * Door polish: every end state takes its tone from tapSaleTone (green paid,
 * grey nothing charged, amber money not settled, red declined or blocked), the
 * ready/reading/saving line sits in the shared DoorStatusPill, "Send receipt"
 * is a quiet text link (same handler and string), and the header names Tap to
 * Pay the way Apple asks on this device (tapToPayName).
 *
 * On iPhone the tap prompt is Apple's own sheet; on Android it is Stripe's. This
 * screen shows the amount and tickets behind it, and every end state says
 * whether money was taken. Tickets only exist once the server records the
 * succeeded payment (door-tap-intent complete).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Platform, Share, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import {
  canvas,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { HELP_AND_SUPPORT_ROUTE } from "../../../constants/supportHostFacing";
import {
  TAP_CARD_NEEDS_INSERT_COPY,
  TAP_PROCESSING_TEXT,
  TAP_SEND_RECEIPT,
  TAP_TIMED_OUT_COPY,
  TAP_UNKNOWN_RESULT_COPY,
  tapPaidAfterCloseCopy,
  tapToPayName,
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
  DoorTapError,
  markDoorTapOutcomeSeen,
} from "../../../services/terminal/doorTapEdge";
import {
  encodeTapToPayDraft,
  sellAnotherDraft,
  parseTapToPayDraft,
  type TapToPayDraft,
} from "../../../services/terminal/tapToPayDraft";
import {
  shouldReportTapSeen,
  TapToPaySaleFlow,
  type TapAmount,
  type TapSaleState,
} from "../../../services/terminal/tapToPayFlow";
import { buildTapReceiptText } from "../../../services/terminal/tapReceipt";
import { consumeDoorTapPress } from "../../../services/terminal/tapTiming";
import { formatCurrency, majorFromMinor } from "../../../utils/currency";
import { HapticFeedback } from "../../../utils/hapticFeedback";
import { randomUuid } from "../../../utils/randomId";
import { GlassCard } from "../../ui/GlassCard";
import { IconChrome } from "../../ui/IconChrome";
import { Spinner } from "../../ui/Spinner";
import { DoorStatusPill } from "../DoorStatusPill";
import { doorPayCodeCreateErrorCopy } from "../doorPaymentOptions";
import { TapStatusView, type TapStatusAction } from "./TapStatusView";
import { TAP_SAVE_FAILED_PAID_LINE, tapSaleTone } from "./tapSaleTone";
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
  // "Check again" on an unknown result: true only while that re-check runs.
  const [rechecking, setRechecking] = useState<boolean>(false);
  const checkAgain = useCallback(async (): Promise<void> => {
    setRechecking(true);
    try {
      await flowRef.current?.retryConfirm();
    } finally {
      setRechecking(false);
    }
  }, []);

  const lineSummary = useMemo(
    () => (draft === null ? "" : summarizeTapLines(draft.lines, route.event?.tickets ?? [])),
    [draft, route.event?.tickets],
  );

  const goToDoor = useCallback((): void => {
    // orch-strict-grep-allow route-by-event-type — door Tap to Pay routes exist only under /event/[id]/door.
    router.replace(`/event/${eventId}/door` as never);
  }, [router, eventId]);

  const handleClose = useCallback((): void => {
    void flowRef.current?.closeSale().catch((error: unknown) => reportNonFatal("door-tap.close", error));
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
      // The screen may be gone: a native alert still reaches the host.
      onPaidAfterClose: ({ amount, saved }) => {
        void queryClient.invalidateQueries({ queryKey: doorSaleKeys.byEvent(eventId) });
        const copy = tapPaidAfterCloseCopy(formatAmount(amount), saved);
        Alert.alert(copy.title, copy.body);
      },
    });
    flowRef.current = flow;
    void flow.start();
  }, [draft, availability.available, availability.needsSetup, terminal.status, terminal.client, eventId, queryClient]);

  // A phone that slept on the ready screen: the flow rechecks the intent's age.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void flowRef.current?.recheckOnForeground().catch((error: unknown) => reportNonFatal("door-tap.wake", error));
    });
    return () => subscription.remove();
  }, []);

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

  // The host saw how this tap ended, so the server needn't push about it later.
  // Rendered while backgrounded doesn't count; coming back to it does.
  useEffect(() => {
    const report = (appState: string | null): void => {
      const facts = flowRef.current?.getReceiptFacts();
      if (!shouldReportTapSeen(state.kind, appState) || !facts?.paymentIntentId) return;
      void markDoorTapOutcomeSeen({
        paymentIntentId: facts.paymentIntentId,
        clientRequestId: facts.clientRequestId,
      }).catch((error: unknown) => reportNonFatal("door-tap.seen", error));
    };
    report(AppState.currentState);
    if (AppState.currentState === "active") return undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") report(next);
    });
    return () => subscription.remove();
  }, [state.kind]);

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
      if (outcome === "already_paid" || outcome === "blocked") return;
      const created = await createDoorPayCodeForLines({
        eventId,
        eventDateId: draft.eventDateId,
        lines: draft.lines,
      });
      // orch-strict-grep-allow route-by-event-type — door Tap to Pay routes exist only under /event/[id]/door.
      router.replace(`/event/${eventId}/door/pay/${created.codeId}` as never);
    } catch (error) {
      // The tap screen stays: a tap may start again (on a fresh intent).
      flowRef.current?.reopen();
      setPayCodeError(doorPayCodeCreateErrorCopy(error instanceof DoorTapError ? error.code : "unknown"));
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
    // The next guest is someone else: keep the tickets and date, never this
    // guest's name or phone.
    router.replace(
      `/event/${eventId}/door/sell?source=sell_another&draft=${encodeURIComponent(encodeTapToPayDraft(sellAnotherDraft(draft)))}` as never,
    );
  }, [draft, eventId, router, goToDoor]);

  const sendReceipt = useCallback(
    async (outcome: "approved" | "declined", amount: TapAmount, cardLabel: string | null): Promise<void> => {
      const facts = flowRef.current?.getReceiptFacts();
      const message = buildTapReceiptText({
        eventName: route.event?.name ?? null,
        brandName: route.brand?.displayName ?? null,
        outcome,
        totalCents: amount.totalCents,
        feeCents: facts?.feeCents ?? null,
        currency: amount.currency,
        cardLabel,
        whenIso: new Date().toISOString(),
        paymentIntentId: facts?.paymentIntentId ?? null,
      });
      try {
        // SHARE-NON-CONTENT:receipt
        await Share.share({ message });
      } catch (error) {
        reportNonFatal("door-tap.receipt", error);
      }
    },
    [route.event?.name, route.brand?.displayName],
  );

  // Apple's receipt offer stays on every screen that had it: a quiet 44pt text link.
  const receiptLink = (
    outcome: "approved" | "declined",
    amount: TapAmount,
    cardLabel: string | null,
  ): TapStatusAction => ({
    label: TAP_SEND_RECEIPT,
    onPress: () => void sendReceipt(outcome, amount, cardLabel),
    testID: "tap-send-receipt",
  });

  const chrome = (
    <View style={styles.chromeRow}>
      <IconChrome icon="close" size={44} onPress={handleClose} accessibilityLabel="Close" />
      <Text style={styles.chromeTitle} numberOfLines={1}>
        {tapToPayName(Platform.OS)}
      </Text>
      <View style={styles.chromeRightSlot} />
    </View>
  );

  // "Get help" on every failed result: the same Help & Support screen as
  // Account → Settings → Help & Support. A push, so the sale stays underneath.
  const openHelp = (): void => {
    router.push(HELP_AND_SUPPORT_ROUTE as never);
  };

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
          tone="neutral"
          title="This sale couldn't be opened"
          body="Nothing was charged. Start the sale again from door sales."
          primary={{ label: "Back to door sales", onPress: goToDoor }}
        />
      );
    }
    const device = currentTapToPayDevice();
    const belowFloor = isIosBelowTapFloor(device.os, device.version);
    const updateIos = (
      <TapUpdateIos onUsePayCode={() => void showPayCodeInstead()} loading={payCodeBusy} onHelp={openHelp} />
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
            tone="neutral"
            icon={Platform.OS === "ios" ? "globe" : "tap"}
            title={`${tapToPayName(Platform.OS)} isn't available here`}
            body="This brand can't take taps. Use a pay code instead. It works on any phone."
            primary={{ label: "Use a pay code", onPress: () => void showPayCodeInstead(), loading: payCodeBusy }}
            onHelp={openHelp}
            testID="tap-state-not_available"
          />
        );
      }
      return <TapNotOnThisPhone onUsePayCode={() => void showPayCodeInstead()} loading={payCodeBusy} onHelp={openHelp} />;
    }
    if (terminal.config.installing) return <TapConfiguringView progress={terminal.config.progress} />;
    if (terminal.status === "unavailable") {
      return <TapNotOnThisPhone onUsePayCode={() => void showPayCodeInstead()} loading={payCodeBusy} onHelp={openHelp} />;
    }
    if (terminal.status === "error") {
      return (
        <TapStatusView
          tone="neutral"
          icon={Platform.OS === "ios" ? "clock" : "tap"}
          title={tapReaderProblemTitle(Platform.OS)}
          body={`${terminal.errorMessage ?? "Try again."} Nothing was charged.`}
          primary={{ label: "Try again", onPress: terminal.retryInitialize }}
          secondary={payCodeAction}
          onHelp={openHelp}
          testID="tap-state-terminal_error"
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
              <DoorStatusPill
                variant={state.kind === "ready" ? "waiting" : "busy"}
                text={
                  state.kind === "ready"
                    ? Platform.OS === "ios"
                      ? "Hold the card near the top of the iPhone."
                      : "Hold the card on the back of the phone."
                    : state.kind === "reading"
                      ? TAP_PROCESSING_TEXT
                      : "Saving the sale…"
                }
                stateLabel={state.kind === "ready" ? "Ready to tap" : state.kind === "reading" ? TAP_PROCESSING_TEXT : "Saving the sale…"}
                testID="tap-status-pill"
              />
            </View>
          </View>
        );
      case "approved":
        return (
          <TapStatusView
            tone={tapSaleTone("approved")}
            title={`Paid ${formatAmount(state.amount)}`}
            body={state.cardLabel}
            primary={{ label: "Sell another", onPress: sellAnother, testID: "tap-sell-another" }}
            secondary={{ label: "Done", onPress: goToDoor }}
            secondaryGhost
            link={receiptLink("approved", state.amount, state.cardLabel)}
            testID="tap-state-approved"
          >
            <GlassCard variant="base" radius="md" padding={spacing.md}>
              {/* Only a name the host typed. Never a made-up "Walk-up". */}
              {draft.buyerName != null ? (
                <View style={styles.kv} testID="tap-guest-row">
                  <Text style={styles.kvLabel}>Guest</Text>
                  <Text style={styles.kvValue}>{draft.buyerName}</Text>
                </View>
              ) : null}
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
            tone={tapSaleTone("needs_pin")}
            icon="keypad"
            title={TAP_CARD_NEEDS_INSERT_COPY.title}
            body={TAP_CARD_NEEDS_INSERT_COPY.body}
            primary={payCodeAction}
            secondary={{ label: "Try another card", onPress: () => void flowRef.current?.tryAnotherCard() }}
            onHelp={openHelp}
            testID="tap-state-needs_pin"
          />
        );
      case "declined":
        return (
          <TapStatusView
            tone={tapSaleTone("declined")}
            title="Card declined"
            body="Their bank said no. Nothing was charged."
            primary={{
              label: "Try another card",
              onPress: () => void flowRef.current?.tryAnotherCard(),
              testID: "tap-try-another-card",
            }}
            secondary={payCodeAction}
            link={receiptLink("declined", state.amount, state.cardLabel)}
            onHelp={openHelp}
            testID="tap-state-declined"
          />
        );
      case "timed_out":
        return (
          <TapStatusView
            tone={tapSaleTone("timed_out")}
            icon="clock"
            title={TAP_TIMED_OUT_COPY.title}
            body={TAP_TIMED_OUT_COPY.body}
            primary={{ label: "Try again", onPress: () => void flowRef.current?.tryAnotherCard() }}
            secondary={payCodeAction}
            link={receiptLink("declined", state.amount, null)}
            onHelp={openHelp}
            testID="tap-state-timed_out"
          />
        );
      case "unknown_result":
        // Deliberately no pay code here: it could charge the guest twice.
        return (
          <TapStatusView
            tone={tapSaleTone("unknown_result")}
            // A spinner only while a re-check is running; otherwise the caution icon.
            busy={rechecking}
            title={TAP_UNKNOWN_RESULT_COPY.title}
            body={TAP_UNKNOWN_RESULT_COPY.body}
            primary={{
              // It re-checks the same payment; it never takes a new one.
              label: "Check again",
              onPress: () => void checkAgain(),
              loading: rechecking,
              testID: "tap-unknown-retry",
            }}
            testID="tap-state-unknown_result"
          />
        );
      case "cancelled":
        return (
          <TapStatusView
            tone={tapSaleTone("cancelled")}
            title="Tap cancelled"
            body="Nothing was charged."
            testID="tap-state-cancelled"
            primary={{ label: "Try again", onPress: () => void flowRef.current?.tryAnotherCard() }}
            secondary={payCodeAction}
            onHelp={openHelp}
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
            tone={tapSaleTone("reader_problem", state.problem)}
            title={tapReaderProblemTitle(Platform.OS)}
            body={tapReaderProblemCopy(state.problem, Platform.OS)}
            primary={
              tapReaderProblemCanRetry(state.problem)
                ? { label: "Try again", onPress: () => void flowRef.current?.start() }
                : payCodeAction
            }
            secondary={tapReaderProblemCanRetry(state.problem) ? payCodeAction : null}
            onHelp={openHelp}
            testID="tap-state-reader_problem"
          />
        );
      case "not_on_this_phone":
        // Below iOS 17.6 a device-class failure is the iOS version until proven otherwise.
        return belowFloor ? (
          updateIos
        ) : (
          <TapNotOnThisPhone onUsePayCode={() => void showPayCodeInstead()} loading={payCodeBusy} onHelp={openHelp} />
        );
      case "save_failed":
        return (
          <TapStatusView
            tone={tapSaleTone("save_failed")}
            title="Paid, still saving"
            body={state.message}
            primary={{
              label: "Save again",
              onPress: () => void flowRef.current?.retrySave(),
              testID: "tap-save-again",
            }}
            testID="tap-state-save_failed"
          >
            <Text style={styles.paidLine} testID="tap-save-failed-paid-line">
              {TAP_SAVE_FAILED_PAID_LINE}
            </Text>
          </TapStatusView>
        );
      case "failed":
        // Tax added at checkout refuses card AND pay code for this event: no
        // retry and no pay code (both get the same refusal), only the way back.
        return state.refusal === "tax_added_at_checkout" ? (
          <TapStatusView
            tone={tapSaleTone("failed")}
            title="Payment didn't start"
            body={state.message}
            testID="tap-state-failed"
            primary={{ label: "Back to door sales", onPress: handleClose, testID: "tap-back-to-door" }}
            onHelp={openHelp}
          />
        ) : (
          <TapStatusView
            tone={tapSaleTone("failed")}
            title="Payment didn't start"
            body={state.message}
            testID="tap-state-failed"
            primary={{ label: "Try again", onPress: () => void flowRef.current?.start() }}
            secondary={payCodeAction}
            onHelp={openHelp}
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
  chromeTitle: { ...typography.h3, color: textTokens.primary, flexShrink: 1, textAlign: "center" },
  chromeRightSlot: { width: 44 },
  waitHost: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  amountHost: { flex: 1, alignItems: "center", paddingTop: spacing.xxl, gap: spacing.xs },
  amount: { ...typography.display, fontSize: 44, lineHeight: 56, color: textTokens.primary },
  lines: { ...typography.body, color: textTokens.secondary, textAlign: "center", paddingHorizontal: spacing.lg },
  statusRow: { marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  paidLine: { ...typography.bodySm, fontWeight: "600", color: textTokens.primary, textAlign: "center" },
  kv: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
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
