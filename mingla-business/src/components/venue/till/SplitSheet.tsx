/**
 * #4490 spec 08 O4 — the split sheet ("split-sheet"): By item / Evenly, then
 * the shares, each paid through the one payment sheet's methods.
 *
 * It is a STEP of the PaymentSheet, rendered inside that sheet's own modal
 * (I-SUB-SHEET-INSIDE-PARENT, 08-O3 fix 3): it never presents a second native
 * sheet. Every amount shown after "Split" is the server's share; the previews
 * before it follow the server's rules (splitModel) and are display only. The
 * client sends who has which item (units) or how many people, never a sum.
 */

import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";
import type { TillSale, TillShare, TillSplitInput } from "../../../services/venueTillService";
import { formatCurrency } from "../../../utils/currency";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { NumberStepper } from "../../ui/NumberStepper";
import { Chip, Pill, Segmented } from "../../ui/Pill";
import { TILL_COPY } from "./tillCopy";
import {
  assignmentComplete,
  byItemPayload,
  byItemPreview,
  evenPreview,
  openShares,
  resizeAssignment,
  setUnits,
  splitUnits,
  SPLIT_MAX_PEOPLE,
  SPLIT_MIN_PEOPLE,
  unassigned,
  unitsElsewhere,
  type SplitAssignment,
} from "./splitModel";

export type SplitMode = "by_item" | "even";

export interface SplitSheetProps {
  sale: TillSale;
  busy: boolean;
  /** Where the editor starts (a "3 ways" chip opens Evenly with 3). */
  initialMode: SplitMode;
  initialCount: number;
  onSetSplit: (split: TillSplitInput) => Promise<void>;
  onPayShare: (share: TillShare) => void;
  onPayInFull: () => void;
  error: string | null;
}

export function SplitSheet({
  sale,
  busy,
  initialMode,
  initialCount,
  onSetSplit,
  onPayShare,
  onPayInFull,
  error,
}: SplitSheetProps): React.ReactElement {
  const money = (minor: number): string => formatCurrency(minor, sale.currency, true);
  const shares = openShares(sale);
  const anyPaying = shares.some((s) => s.state === "paying");
  const [editing, setEditing] = useState(shares.length === 0);
  const evenOnly = sale.split?.evenOnly === true;
  const [mode, setMode] = useState<SplitMode>(evenOnly ? "even" : initialMode);
  const [people, setPeople] = useState(Math.min(SPLIT_MAX_PEOPLE, Math.max(SPLIT_MIN_PEOPLE, initialCount)));
  const units = useMemo(() => splitUnits(sale), [sale]);
  const [assign, setAssign] = useState<SplitAssignment>(() => resizeAssignment([], Math.max(SPLIT_MIN_PEOPLE, initialCount)));
  const [active, setActive] = useState(0);
  const left = sale.remainingMinor;
  const scLeft = sale.split?.serviceChargeLeftMinor ?? 0;
  // #4490 08-O5 fix 4: after "Split", go straight to the shares the server
  // made. The shares' ids before the request; once the server's answer brings
  // different shares, the list shows them (a refusal keeps the editor open).
  const shareIds = shares.map((s) => s.id).join(",");
  const [sentFrom, setSentFrom] = useState<string | null>(null);
  useEffect(() => {
    if (sentFrom !== null && shareIds !== sentFrom && shareIds !== "") {
      setSentFrom(null);
      setEditing(false);
    }
  }, [sentFrom, shareIds]);
  useEffect(() => {
    if (error !== null) setSentFrom(null);
  }, [error]);
  const submit = (split: TillSplitInput): void => {
    setSentFrom(shareIds);
    void onSetSplit(split);
  };

  if (!editing && shares.length > 0) {
    // The shares, as the server set them (paid ones stay with a tick).
    return (
      <View style={styles.body} testID="till-split-shares">
        {(sale.shares ?? []).map((share) => {
          const paid = share.state === "paid";
          return (
            // #4490 08-O5 fix 5: stacked, so the share's name, amount and
            // status read in full on a phone and Pay sits under them at full
            // width (side by side they squashed to "Sh a… To pay").
            <View key={share.id} style={styles.share} testID={`till-share-${share.shareNo}`}>
              <View style={styles.shareHead}>
                <Text style={styles.shareTitle}>{paid ? TILL_COPY.sharePaid(share.shareNo) : TILL_COPY.shareN(share.shareNo)}</Text>
                <Text style={styles.shareAmount}>{money(share.amountMinor)}</Text>
              </View>
              {paid ? (
                <Pill variant="ok">{TILL_COPY.sharePaid(share.shareNo)}</Pill>
              ) : (
                <>
                  <Text style={styles.muted}>{share.state === "paying" ? TILL_COPY.sharePaying : TILL_COPY.shareUnpaid}</Text>
                  <Button
                    label={TILL_COPY.payShare(share.shareNo, money(share.amountMinor))}
                    variant={share.state === "paying" ? "secondary" : "primary"}
                    size="md"
                    fullWidth
                    disabled={busy}
                    onPress={() => onPayShare(share)}
                    testID={`till-share-pay-${share.shareNo}`}
                  />
                </>
              )}
            </View>
          );
        })}
        {error !== null ? <Banner tone="danger" title={error} /> : null}
        <View style={styles.row}>
          <Button
            label={TILL_COPY.splitTheBill}
            variant="secondary"
            size="md"
            disabled={busy || anyPaying}
            onPress={() => setEditing(true)}
            style={styles.grow}
            testID="till-split-again"
          />
          <Button
            label={TILL_COPY.payInFull}
            variant="secondary"
            size="md"
            disabled={busy || anyPaying}
            onPress={onPayInFull}
            style={styles.grow}
            testID="till-split-full"
          />
        </View>
      </View>
    );
  }

  const evenAmounts = evenPreview(left, scLeft, people);
  const complete = assignmentComplete(units, assign);
  const missing = unassigned(units, assign);
  const itemAmounts = complete ? byItemPreview(units, assign, Math.min(scLeft, left)) : [];

  return (
    <View style={styles.body} testID="till-split-editor">
      <Segmented
        options={[
          { key: "by_item" as const, label: TILL_COPY.byItem, disabled: evenOnly },
          { key: "even" as const, label: TILL_COPY.evenly },
        ]}
        value={mode}
        onChange={(k) => setMode(k)}
      />
      {evenOnly ? <Text style={styles.muted}>{TILL_COPY.splitEvenOnly}</Text> : null}
      {mode === "even" ? (
        <View style={styles.body}>
          <NumberStepper
            label={TILL_COPY.people(people)}
            value={people}
            min={SPLIT_MIN_PEOPLE}
            max={SPLIT_MAX_PEOPLE}
            onChange={setPeople}
            testID="till-split-people"
          />
          <View style={styles.preview}>
            {evenAmounts.map((amount, i) => (
              <Text key={i} style={styles.previewLine}>{`${TILL_COPY.shareN(i + 1)} · ${money(amount)}`}</Text>
            ))}
          </View>
          {error !== null ? <Banner tone="danger" title={error} /> : null}
          <Button
            label={TILL_COPY.splitInto(people)}
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={left < people}
            onPress={() => submit({ mode: "even", count: people })}
            testID="till-split-even-go"
          />
        </View>
      ) : (
        <View style={styles.body}>
          <NumberStepper
            label={TILL_COPY.splitShares}
            value={assign.length}
            min={SPLIT_MIN_PEOPLE}
            max={SPLIT_MAX_PEOPLE}
            onChange={(n) => {
              setAssign((a) => resizeAssignment(a, n));
              setActive((i) => Math.min(i, n - 1));
            }}
            testID="till-split-count"
          />
          <Text style={styles.muted}>{TILL_COPY.whoHasWhat}</Text>
          <View style={styles.chips}>
            {assign.map((_, i) => (
              <Chip
                key={i}
                label={complete ? `${TILL_COPY.shareN(i + 1)} · ${money(itemAmounts[i] ?? 0)}` : TILL_COPY.shareN(i + 1)}
                selected={i === active}
                onPress={() => setActive(i)}
                testID={`till-split-share-${i + 1}`}
              />
            ))}
          </View>
          {units.map((u) => {
            const elsewhere = unitsElsewhere(assign, u.key, active);
            const mine = assign[active]?.[u.key] ?? 0;
            return (
              <View key={u.key} style={styles.unit}>
                <NumberStepper
                  label={`${u.label} · ${mine + elsewhere}/${u.unitsLeft}`}
                  value={mine}
                  min={0}
                  max={Math.max(0, u.unitsLeft - elsewhere)}
                  onChange={(n) => setAssign((a) => setUnits(a, active, u.key, n))}
                  testID={`till-split-unit-${u.key}`}
                />
              </View>
            );
          })}
          <Text style={missing.units > 0 ? styles.warn : styles.muted} testID="till-split-unassigned">
            {missing.units > 0 ? TILL_COPY.notAssigned(money(missing.valueMinor)) : TILL_COPY.allAssigned}
          </Text>
          {error !== null ? <Banner tone="danger" title={error} /> : null}
          <Button
            label={TILL_COPY.split}
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={!complete}
            onPress={() => submit({ mode: "by_item", shares: byItemPayload(units, assign) })}
            testID="till-split-item-go"
          />
        </View>
      )}
      {shares.length > 0 ? (
        <Button label={TILL_COPY.backToShares} variant="ghost" size="md" disabled={busy} onPress={() => setEditing(false)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[3] },
  share: { gap: space[2], padding: space[3], borderRadius: radius.lg, backgroundColor: color.card2 },
  shareHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", columnGap: space[3], rowGap: space[1] },
  shareTitle: { ...type.row, color: color.text1 },
  shareAmount: { ...type.row, color: color.text1 },
  row: { flexDirection: "row", gap: space[2] },
  grow: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  unit: { paddingVertical: space[1] },
  preview: { gap: space[1], padding: space[3], borderRadius: radius.lg, backgroundColor: color.card2 },
  previewLine: { ...type.small, color: color.text1 },
  muted: { ...type.small, color: color.text2 },
  warn: { ...type.small, color: color.warningText },
});
