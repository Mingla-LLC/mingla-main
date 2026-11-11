/**
 * #4389 Door mode — "Scan to pay" as a sheet over the door sale screen (design
 * DM "code"). The code is made by the existing door-pay-code create; this sheet
 * reads it with the existing hooks (realtime on the code row, a 15s poll
 * backstop, and the server settle once the phone's clock passes its time), so it
 * moves on by itself the moment the provider confirms: `onPaid` closes it and the
 * door screen shows the green Paid overlay.
 *
 * - While the code can still be paid the sheet can't be swiped away: the only
 *   way out is "Cancel this sale", which closes the code on the server first. A
 *   cancel the server can't confirm keeps the sheet up (no double charge).
 * - Checking / payment landing hold the sheet with no cancel (money in flight).
 * - Expired, failed and cancelled say whether money moved (doorPayHostEndBody,
 *   with the server's late-payment read) and go back to the sale with the
 *   tickets kept.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { accent, semantic, spacing, text as textTokens } from "../../constants/designSystem";
import {
  useCancelDoorPayCode,
  useDoorPayCode,
  useDoorPayLatePayment,
  useSettleDoorPayCode,
} from "../../hooks/useDoorPayCodes";
import { useDoorScreenAwake } from "../../hooks/useDoorScreenAwake";
import { DoorPayCodeError, type DoorPayLiveStatus } from "../../services/doorPayCodeService";
import { formatCurrency } from "../../utils/currency";
import { Button } from "../ui/Button";
import { CenteredState } from "../ui/CenteredState";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { DoorPayQr } from "./DoorPayQr";
import { DoorStatusPill } from "./DoorStatusPill";
import { DOOR_MODE_COPY } from "./doorModeCopy";
import { doorModeCodeStep } from "./doorModeState";
import {
  doorPayHostEndBody,
  doorPayHostEndCopy,
  doorPayHostStatus,
  formatDoorPayCountdown,
  isDoorPayPastTime,
  type DoorPayLatePaymentRead,
} from "./doorPayCodeState";
import { formatDoorPayCode, isDoorPayCode, makeDoorPayUrl } from "./doorPayUrl";

const QR_SIZE = 200;
const SETTLE_RETRY_MS = 5_000;

export interface DoorModePayCodeSheetProps {
  visible: boolean;
  codeId: string | null;
  /** The guest paid: close the sheet and celebrate. */
  onPaid: (paid: { total: string; ticketCount: number }) => void;
  /** Back to the sale, tickets kept (cancelled, expired or failed). */
  onDone: () => void;
  onDismissed?: () => void;
}

export const DoorModePayCodeSheet = ({
  visible,
  codeId,
  onPaid,
  onDone,
  onDismissed,
}: DoorModePayCodeSheetProps): React.ReactElement => {
  const codeQuery = useDoorPayCode(visible ? codeId : null);
  const cancelCode = useCancelDoorPayCode(codeId);
  const settleCode = useSettleDoorPayCode(codeId);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [serverAnswer, setServerAnswer] = useState<{ status: DoorPayLiveStatus; atMs: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  // A new code starts clean.
  useEffect(() => {
    setServerAnswer(null);
    setActionError(null);
  }, [codeId]);

  const row = codeQuery.data ?? null;
  const status = row === null ? null : doorPayHostStatus(row.status, row.expiresAt, nowMs, serverAnswer?.status ?? null);
  const step = doorModeCodeStep(status);
  useDoorScreenAwake(visible && (step === "live" || step === "paying"));

  // Past its time only the server says what happened; ask again every few seconds.
  const settleInFlight = useRef<boolean>(false);
  const unsettled =
    row !== null &&
    (row.status === "open" || row.status === "opened") &&
    (isDoorPayPastTime(row.status, row.expiresAt, nowMs) || serverAnswer?.status === "payment_landing");
  useEffect(() => {
    if (!visible || !unsettled || settleInFlight.current) return;
    if (serverAnswer !== null && nowMs - serverAnswer.atMs < SETTLE_RETRY_MS) return;
    settleInFlight.current = true;
    settleCode
      .mutateAsync()
      .then((answer) => setServerAnswer({ status: answer, atMs: Date.now() }))
      .catch(() => setServerAnswer({ status: "checking", atMs: Date.now() }))
      .finally(() => {
        settleInFlight.current = false;
      });
  }, [visible, nowMs, serverAnswer, settleCode, unsettled]);

  const amount = row !== null && row.currency.length > 0 ? formatCurrency(row.totalCents, row.currency, true) : "—";

  // Moves on by itself: once, when the code turns paid.
  const paidFor = useRef<string | null>(null);
  useEffect(() => {
    if (step !== "paid" || row === null || paidFor.current === row.id) return;
    paidFor.current = row.id;
    onPaid({ total: amount, ticketCount: row.lines.reduce((sum, line) => sum + line.quantity, 0) });
  }, [amount, onPaid, row, step]);

  const ended = step === "ended";
  const latePaymentQuery = useDoorPayLatePayment(codeId, visible && ended);
  const latePayment: DoorPayLatePaymentRead = latePaymentQuery.isSuccess
    ? latePaymentQuery.data === null
      ? { kind: "none" }
      : {
          kind: "payment",
          state: latePaymentQuery.data.state,
          amount: formatCurrency(
            latePaymentQuery.data.amountCents,
            latePaymentQuery.data.currency.length > 0 ? latePaymentQuery.data.currency : (row?.currency ?? ""),
            true,
          ),
        }
    : latePaymentQuery.isError
      ? { kind: "unknown" }
      : { kind: "checking" };

  const handleCancel = useCallback(async (): Promise<void> => {
    setActionError(null);
    try {
      const answer = await cancelCode.mutateAsync();
      if (answer === "cancelled") {
        onDone();
        return;
      }
      setServerAnswer({ status: answer, atMs: Date.now() });
      setActionError(answer === "checking" ? DOOR_MODE_COPY.codeStillOpen : null);
    } catch (error) {
      if (error instanceof DoorPayCodeError && error.status === 409) {
        void codeQuery.refetch();
        setActionError(DOOR_MODE_COPY.codeAlreadyPaid);
      } else {
        setActionError(DOOR_MODE_COPY.codeCancelFailed);
      }
    }
  }, [cancelCode, codeQuery, onDone]);

  // Swiping away is only allowed once nothing can land on the code.
  const canLeave = step === "ended" || (step === "loading" && codeQuery.isError);

  let body: React.ReactNode;
  // #4389 — buttons pinned under the scroll area (SheetScrollLayout).
  let footer: React.ReactNode = null;
  if (row === null) {
    body = codeQuery.isError ? (
      <CenteredState title={DOOR_MODE_COPY.codeLoadFailed} accessibilityRole="alert" testID="door-mode-code-load-failed">
        <Button label="Try again" onPress={() => void codeQuery.refetch()} variant="primary" size="md" />
      </CenteredState>
    ) : (
      <View style={styles.center}>
        <ActivityIndicator color={accent.warm} />
      </View>
    );
  } else if (step === "settling") {
    body = (
      <View style={styles.center} testID="door-mode-code-settling" accessibilityLiveRegion="assertive">
        <ActivityIndicator color={semantic.warning} />
        <Text style={styles.muted}>
          {status === "payment_landing" ? DOOR_MODE_COPY.codeLanding : DOOR_MODE_COPY.codeChecking}
        </Text>
      </View>
    );
  } else if (step === "ended" && (status === "expired" || status === "failed" || status === "cancelled")) {
    const copy = doorPayHostEndCopy(status);
    body = (
      <View style={styles.center} testID={`door-mode-code-${status}`}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          {doorPayHostEndBody(status, latePayment, row.provider)}
        </Text>
      </View>
    );
    footer = <Button label={DOOR_MODE_COPY.back} onPress={onDone} variant="primary" size="lg" fullWidth />;
  } else {
    const paying = step === "paying";
    body = (
      <View style={styles.center} testID="door-mode-code-live">
        <Text style={styles.title} accessibilityRole="header">
          {DOOR_MODE_COPY.scanToPay(amount)}
        </Text>
        {isDoorPayCode(row.code) ? (
          <View style={paying ? styles.qrDimmed : null}>
            <DoorPayQr url={makeDoorPayUrl(row.code)} size={QR_SIZE} testID="door-mode-code-qr" />
          </View>
        ) : null}
        <Text style={styles.code} accessibilityLabel={`Code ${row.code.split("").join(" ")}`}>
          {formatDoorPayCode(row.code)}
        </Text>
        <DoorStatusPill
          variant={paying ? "busy" : "waiting"}
          text={paying ? DOOR_MODE_COPY.guestPaying : formatDoorPayCountdown(row.expiresAt, nowMs)}
          stateLabel={paying ? "Guest is paying" : "Waiting for payment"}
          testID="door-mode-code-pill"
        />
        <Text style={styles.muted}>{DOOR_MODE_COPY.waitingForPayment}</Text>
        {actionError !== null ? (
          <Text style={styles.error} accessibilityRole="alert">
            {actionError}
          </Text>
        ) : null}
      </View>
    );
    footer = (
      <Button
        label={DOOR_MODE_COPY.cancelSale}
        onPress={() => void handleCancel()}
        variant="secondary"
        size="md"
        fullWidth
        loading={cancelCode.isPending}
        testID="door-mode-code-cancel"
      />
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={canLeave ? onDone : () => undefined}
      dismissDisabled={!canLeave}
      dismissOnScrimTap={canLeave}
      snapPoint="full"
      onDismissed={onDismissed}
      testID="door-mode-code-sheet"
    >
      <SheetScrollLayout footer={footer} testID="door-mode-code-body">
        {body}
      </SheetScrollLayout>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: spacing.md, paddingBottom: spacing.lg },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700", color: textTokens.primary, textAlign: "center" },
  muted: { fontSize: 14, lineHeight: 20, color: textTokens.secondary, textAlign: "center" },
  code: { fontSize: 18, fontWeight: "700", letterSpacing: 2, color: textTokens.primary, fontVariant: ["tabular-nums"] },
  qrDimmed: { opacity: 0.35 },
  error: { fontSize: 13, lineHeight: 18, color: semantic.errorText, textAlign: "center" },
});
