/**
 * #4490 spec 08 O1 — the one payment sheet. O1 takes Cash (with change) and
 * the venue's own card machine; Charge to room shows disabled (O4 seam); Tap
 * and Scan to pay arrive with O2 and are not shown until then. The amount due
 * is the server's remaining amount; a part payment leaves the rest due.
 *
 * Every payment carries the check version it was taken against (T10) and one
 * client request id per tap, so a retry never charges twice.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";
import type { TillPaymentResult, TillSale } from "../../../services/venueTillService";
import { TillError } from "../../../services/venueTillService";
import { formatCurrency } from "../../../utils/currency";
import { randomId } from "../../../utils/randomId";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { ListRow } from "../../ui/ListRow";
import { MoneyField } from "../../ui/MoneyField";
import { Chip } from "../../ui/Pill";
import { Sheet } from "../../ui/Sheet";
import { SheetScrollLayout } from "../../ui/SheetScrollLayout";
import { TILL_COPY, tillErrorCopy } from "./tillCopy";
import { cashPresets, changeDue, foodAndDrinkMinor, tipChoices } from "./tillModel";

type Step = "choose" | "cash" | "own" | "paid";

export interface PaymentSheetProps {
  visible: boolean;
  sale: TillSale | null;
  tipsEnabled: boolean;
  tipBpsOptions: readonly number[];
  onClose: () => void;
  onPay: (input: {
    method: "cash" | "own_machine";
    amountMinor: number;
    tipMinor: number;
    cashGivenMinor: number | null;
    clientRequestId: string;
    expectedVersion: number;
  }) => Promise<TillPaymentResult>;
  onNewSale: () => void;
  onRefreshSale: () => void;
}

export function PaymentSheet({
  visible,
  sale,
  tipsEnabled,
  tipBpsOptions,
  onClose,
  onPay,
  onNewSale,
  onRefreshSale,
}: PaymentSheetProps): React.ReactElement {
  const [step, setStep] = useState<Step>("choose");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [tipMinor, setTipMinor] = useState(0);
  const [cashGiven, setCashGiven] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ method: "cash" | "own_machine"; amountMinor: number; changeMinor: number | null } | null>(null);
  // One id per payment attempt: a retry of the same tap reuses it.
  const requestId = useRef<string>(randomId());

  const currency = sale?.currency ?? "NGN";
  const due = sale?.remainingMinor ?? 0;
  const money = (minor: number): string => formatCurrency(minor, currency, true);

  useEffect(() => {
    if (!visible) return;
    setStep("choose");
    setAmountMinor(null);
    setTipMinor(0);
    setCashGiven(null);
    setError(null);
    setResult(null);
    requestId.current = randomId();
  }, [visible]);

  const payAmount = amountMinor !== null && amountMinor > 0 && amountMinor <= due ? amountMinor : due;
  const tips = useMemo(
    () => (tipsEnabled ? tipChoices(foodAndDrinkMinor(sale), tipBpsOptions) : []),
    [sale, tipsEnabled, tipBpsOptions],
  );
  const change = changeDue(cashGiven, payAmount, tipMinor);
  const presets = cashPresets(payAmount + tipMinor);

  const take = async (method: "cash" | "own_machine"): Promise<void> => {
    if (sale === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const paid = await onPay({
        method,
        amountMinor: payAmount,
        tipMinor,
        cashGivenMinor: method === "cash" ? cashGiven : null,
        clientRequestId: requestId.current,
        expectedVersion: sale.version,
      });
      setResult({ method, amountMinor: payAmount, changeMinor: paid.changeMinor });
      setStep("paid");
    } catch (err) {
      const code = err instanceof TillError ? err.code : "till_failed";
      if (code === "till_check_changed" || code === "till_amount_over_due" || code === "till_nothing_to_pay") {
        // Nothing moved: refresh the check and start a fresh attempt.
        requestId.current = randomId();
        onRefreshSale();
        setStep("choose");
      }
      // A network failure may have landed: keep the same request id so
      // "Try again" can never take the money twice.
      setError(tillErrorCopy(code));
    } finally {
      setBusy(false);
    }
  };

  const title =
    step === "paid" ? TILL_COPY.paymentTaken : step === "cash" ? TILL_COPY.cash : step === "own" ? TILL_COPY.ownMachine : TILL_COPY.pay(money(due));

  let body: React.ReactNode;
  let footer: React.ReactNode = null;
  if (sale === null) {
    body = <Text style={styles.muted}>{TILL_COPY.payPending}</Text>;
  } else if (step === "choose") {
    body = (
      <View style={styles.body}>
        <View style={styles.dueBox}>
          <Text style={styles.label}>{sale.paidMinor > 0 ? TILL_COPY.leftToPay : TILL_COPY.amountDue}</Text>
          <Text style={styles.big} testID="till-pay-due">{money(due)}</Text>
        </View>
        <MoneyField
          label={TILL_COPY.payInFull}
          valueMinor={amountMinor ?? due}
          onChangeMinor={(next) => setAmountMinor(next)}
          currency={currency}
          error={amountMinor !== null && (amountMinor <= 0 || amountMinor > due) ? tillErrorCopy("till_amount_over_due") : null}
          testID="till-pay-amount"
        />
        {tips.length > 1 ? (
          <View style={styles.chips}>
            {tips.map((t) => (
              <Chip
                key={t.bps}
                label={t.bps === 0 ? TILL_COPY.noTip : `${t.bps / 100}% · ${money(t.minor)}`}
                selected={tipMinor === t.minor}
                onPress={() => setTipMinor(t.minor)}
                testID={`till-tip-${t.bps}`}
              />
            ))}
          </View>
        ) : null}
        <View style={styles.methods}>
          <ListRow title={TILL_COPY.cash} subtitle={TILL_COPY.cashSub} icon="cash" onPress={() => setStep("cash")} testID="till-pay-cash" />
          <ListRow title={TILL_COPY.ownMachine} subtitle={TILL_COPY.ownMachineSub} icon="keypad" onPress={() => setStep("own")} testID="till-pay-own" />
          <ListRow title={TILL_COPY.chargeToRoom} subtitle={TILL_COPY.chargeToRoomLater} icon="home" disabled testID="till-pay-room" />
        </View>
        {error !== null ? <Banner tone="danger" title={error} /> : null}
      </View>
    );
  } else if (step === "cash") {
    body = (
      <View style={styles.body}>
        <View style={styles.dueBox}>
          <Text style={styles.label}>{TILL_COPY.amountDue}</Text>
          <Text style={styles.big}>{money(payAmount + tipMinor)}</Text>
        </View>
        <MoneyField label={TILL_COPY.cashGiven} valueMinor={cashGiven} onChangeMinor={setCashGiven} currency={currency} testID="till-cash-given" />
        <View style={styles.chips}>
          {presets.map((p, i) => (
            <Chip
              key={p}
              label={i === 0 ? TILL_COPY.exact(money(p)) : money(p)}
              selected={cashGiven === p}
              onPress={() => setCashGiven(p)}
              testID={`till-cash-preset-${i}`}
            />
          ))}
        </View>
        <View style={styles.changeBox}>
          <Text style={styles.label}>{TILL_COPY.changeToGive}</Text>
          <Text style={styles.big} testID="till-cash-change">{change === null ? "--" : money(change)}</Text>
        </View>
        {payAmount < due ? <Text style={styles.muted}>{TILL_COPY.partCash}</Text> : null}
        {error !== null ? <Banner tone="danger" title={error} /> : null}
      </View>
    );
    footer = (
      <Button
        label={TILL_COPY.takeCash(money(payAmount + tipMinor))}
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={change === null}
        onPress={() => void take("cash")}
        testID="till-cash-take"
      />
    );
  } else if (step === "own") {
    body = (
      <View style={[styles.body, styles.center]}>
        <Text style={styles.big}>{money(payAmount + tipMinor)}</Text>
        <Text style={styles.title}>{TILL_COPY.ownMachineAsk}</Text>
        <Text style={styles.muted}>{TILL_COPY.ownMachineBody}</Text>
        {error !== null ? <Banner tone="danger" title={error} /> : null}
      </View>
    );
    footer = (
      <View style={styles.footerCol}>
        <Button label={TILL_COPY.yesApproved} variant="primary" size="lg" fullWidth loading={busy} onPress={() => void take("own_machine")} testID="till-own-yes" />
        <Button label={TILL_COPY.noGoBack} variant="secondary" size="md" fullWidth disabled={busy} onPress={() => setStep("choose")} testID="till-own-no" />
      </View>
    );
  } else {
    const left = sale.remainingMinor;
    body = (
      <View style={styles.body}>
        <Text style={styles.big} testID="till-paid-amount">{money(result?.amountMinor ?? 0)}</Text>
        <Text style={styles.muted}>
          {[
            result?.method === "cash" ? TILL_COPY.cash : TILL_COPY.ownMachine,
            result?.changeMinor !== null && result?.changeMinor !== undefined ? TILL_COPY.changeLine(money(result.changeMinor)) : null,
          ].filter(Boolean).join(" · ")}
        </Text>
        {left > 0 ? (
          <View style={styles.dueBox}>
            <Text style={styles.label}>{TILL_COPY.leftToPay}</Text>
            <Text style={styles.big}>{money(left)}</Text>
          </View>
        ) : null}
      </View>
    );
    footer =
      left > 0 ? (
        <Button label={TILL_COPY.pay(money(left))} variant="primary" size="lg" fullWidth onPress={() => setStep("choose")} testID="till-pay-rest" />
      ) : (
        <Button label={TILL_COPY.newSale} variant="primary" size="lg" fullWidth onPress={onNewSale} testID="till-new-sale" />
      );
  }

  return (
    // Tap outside closes, except while money is moving.
    <Sheet visible={visible} onClose={onClose} snapPoint={0.9} dismissDisabled={busy} testID="till-pay-sheet">
      <View style={styles.host}>
        <View style={styles.head}>
          <Text style={styles.heading} accessibilityRole="header">{title}</Text>
          {step === "cash" || step === "own" ? (
            <Button label={TILL_COPY.noGoBack} variant="ghost" size="sm" disabled={busy} onPress={() => setStep("choose")} />
          ) : (
            <Button label={TILL_COPY.close} variant="ghost" size="sm" disabled={busy} onPress={onClose} testID="till-pay-close" />
          )}
        </View>
        <SheetScrollLayout footer={footer} keyboardAware contentStyle={styles.scroll}>
          {body}
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space[4], paddingVertical: space[2], gap: space[2] },
  heading: { ...type.h2, color: color.text1, flexShrink: 1 },
  scroll: { gap: space[3], paddingBottom: space[4], paddingHorizontal: space[1] },
  body: { gap: space[3] },
  center: { alignItems: "center" },
  dueBox: { gap: space[1], padding: space[3], borderRadius: radius.lg, backgroundColor: color.card2 },
  changeBox: { gap: space[1], padding: space[3], borderRadius: radius.lg, backgroundColor: color.card2 },
  label: { ...type.small, color: color.text2 },
  big: { ...type.h1, color: color.text1 },
  title: { ...type.h2, color: color.text1, textAlign: "center" },
  muted: { ...type.small, color: color.text2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  methods: { gap: space[2] },
  footerCol: { gap: space[2] },
});
