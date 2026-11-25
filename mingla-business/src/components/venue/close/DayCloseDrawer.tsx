/**
 * #4490 spec 08 O5 part B (T21, A12) — the Cash drawer: the day's float and
 * paid outs, the one owner of both (venue_cash_movements). Steps inside one
 * sheet: the list, "Opening float" (with "Same as yesterday"), and "Paid out
 * of the drawer". Money rights; a closed day's drawer cannot change. Each save
 * carries its own request id, kept while the same save is retried.
 */

import React, { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import type { CashDrawer } from "../../../services/venueDayCloseService";
import { formatCurrency } from "../../../utils/currency";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { GlassCard } from "../../ui/GlassCard";
import { Input } from "../../ui/Input";
import { ListRow } from "../../ui/ListRow";
import { MoneyField } from "../../ui/MoneyField";
import { Chip } from "../../ui/Pill";
import { SheetScrollLayout } from "../../ui/SheetScrollLayout";
import { Spinner } from "../../ui/Spinner";
import { newTillRequestId } from "../till/tillPayModel";
import { CLOSE_COPY } from "./dayCloseCopy";
import { personName } from "./dayCloseModel";

export type DrawerStep = "list" | "float" | "paid_out";

export interface DayCloseDrawerProps {
  drawer: CashDrawer | null;
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  step: DrawerStep;
  onStep: (step: DrawerStep) => void;
  busy: boolean;
  error: string | null;
  onSave: (input: { kind: "float" | "paid_out"; amountMinor: number; note: string | null; clientRequestId: string }) => void;
}

export function DayCloseDrawer({
  drawer,
  loading,
  loadError,
  onRetry,
  step,
  onStep,
  busy,
  error,
  onSave,
}: DayCloseDrawerProps): React.ReactElement {
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  // One request id per save attempt; a retry of the same save keeps it.
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const currency = drawer?.currency ?? "NGN";
  const money = (minor: number): string => formatCurrency(minor, currency, true);

  if (loading) {
    return <View style={styles.center}><Spinner /></View>;
  }
  if (loadError !== null || drawer === null) {
    return (
      <View style={styles.body}>
        <Banner tone="danger" title={loadError ?? CLOSE_COPY.loadFailed}
          action={{ label: CLOSE_COPY.retry, onPress: onRetry, testID: "day-close-drawer-retry" }} />
      </View>
    );
  }

  const save = (kind: "float" | "paid_out"): void => {
    setTouched(true);
    const trimmed = note.trim();
    if (amount === null || amount <= 0 || (kind === "paid_out" && trimmed.length === 0)) return;
    const key = `${kind}:${amount}:${trimmed}`;
    if (attempt.current === null || attempt.current.key !== key) attempt.current = { key, id: newTillRequestId() };
    onSave({ kind, amountMinor: amount, note: trimmed.length > 0 ? trimmed : null, clientRequestId: attempt.current.id });
  };
  const go = (next: DrawerStep): void => {
    setAmount(next === "float" ? (drawer.floatMinor > 0 ? drawer.floatMinor : null) : null);
    setNote("");
    setTouched(false);
    attempt.current = null;
    onStep(next);
  };

  if (step === "float" || step === "paid_out") {
    const isFloat = step === "float";
    const amountError = touched && (amount === null || amount <= 0) ? CLOSE_COPY.amountRequired : null;
    const noteError = touched && !isFloat && note.trim().length === 0 ? CLOSE_COPY.noteRequired : null;
    return (
      <SheetScrollLayout
        keyboardAware
        contentStyle={styles.body}
        footer={
          <View style={styles.footer}>
            <Button
              label={isFloat ? CLOSE_COPY.saveFloat : CLOSE_COPY.recordPaidOut(money(amount ?? 0))}
              variant="primary" size="lg" fullWidth loading={busy} disabled={busy || drawer.dayClosed}
              onPress={() => save(isFloat ? "float" : "paid_out")} testID="day-close-drawer-save" />
            <Button label={CLOSE_COPY.cashDrawer} variant="ghost" fullWidth disabled={busy} onPress={() => go("list")}
              testID="day-close-drawer-back" />
          </View>
        }
      >
        <Text style={styles.sub}>{isFloat ? CLOSE_COPY.floatSub : CLOSE_COPY.paidOutSub}</Text>
        <MoneyField label={isFloat ? CLOSE_COPY.float : CLOSE_COPY.amount} valueMinor={amount} onChangeMinor={setAmount}
          currency={currency} error={amountError} testID="day-close-drawer-amount" />
        {isFloat && drawer.previousFloatMinor !== null ? (
          <View style={styles.chips}>
            <Chip label={CLOSE_COPY.sameAsYesterday(money(drawer.previousFloatMinor))}
              selected={amount === drawer.previousFloatMinor}
              onPress={() => setAmount(drawer.previousFloatMinor)} testID="day-close-float-yesterday" />
          </View>
        ) : null}
        <View style={styles.field}>
          <Text style={styles.label}>{CLOSE_COPY.whatFor}</Text>
          <Input value={note} onChangeText={(v) => setNote(v.slice(0, 140))} placeholder={CLOSE_COPY.whatForPlaceholder}
            accessibilityLabel={CLOSE_COPY.whatFor} testID="day-close-drawer-note" />
          <Text style={[styles.hint, noteError !== null && styles.error]}>{noteError ?? `${note.length} of 140`}</Text>
        </View>
        {drawer.dayClosed ? <Banner tone="info" title={CLOSE_COPY.drawerClosed} /> : null}
        {error !== null ? <Banner tone="danger" title={error} testID="day-close-drawer-error" /> : null}
      </SheetScrollLayout>
    );
  }

  return (
    <SheetScrollLayout contentStyle={styles.body}>
      <GlassCard padding={0} testID="day-close-drawer-list">
        {drawer.movements.length === 0 ? <ListRow title={CLOSE_COPY.noFloat} icon="cash" /> : drawer.movements.map((m, i) => (
          <ListRow key={m.id} divider={i > 0} icon={m.kind === "float" ? "cash" : "refund"}
            title={m.kind === "float" ? CLOSE_COPY.floatRow(money(m.amountMinor)) : CLOSE_COPY.paidOutRow(money(m.amountMinor))}
            subtitle={[m.note, CLOSE_COPY.setAt(m.atLocal, personName(m.by)), m.kind === "float" && !m.current ? CLOSE_COPY.replaced : null]
              .filter((x): x is string => x !== null && x.length > 0).join(" · ")}
            testID={`day-close-movement-${m.id}`} />
        ))}
      </GlassCard>
      {drawer.dayClosed ? (
        <Banner tone="info" title={CLOSE_COPY.drawerClosed} />
      ) : (
        <View style={styles.row}>
          <Button label={CLOSE_COPY.addPaidOut} variant="secondary" leadingIcon="plus" style={styles.grow}
            onPress={() => go("paid_out")} testID="day-close-drawer-paid-out" />
          <Button label={drawer.floatMinor > 0 ? CLOSE_COPY.changeFloat : CLOSE_COPY.setFloat} variant="secondary" style={styles.grow}
            onPress={() => go("float")} testID="day-close-drawer-float" />
        </View>
      )}
      <Text style={styles.hint}>{CLOSE_COPY.drawerHint}</Text>
    </SheetScrollLayout>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[4], paddingBottom: space[4], paddingHorizontal: space[1] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space[6] },
  footer: { gap: space[2] },
  sub: { ...type.small, color: color.text2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  field: { gap: space[1] },
  label: { ...type.label, color: color.text3 },
  hint: { ...type.caption, color: color.text3 },
  error: { color: color.errorText },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  grow: { flexGrow: 1 },
});
