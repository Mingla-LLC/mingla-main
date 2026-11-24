/**
 * #4490 spec 08 O5 part C — Menu › item › Stock: "Track stock", the count
 * (NumberStepper) and "Warn me at" (NumberStepper), with its own Save count.
 * Rendered INSIDE MenuItemSheet (the stockSection slot), never a second sheet.
 *
 * The count changes only through the server (venue-order-staff stock_set:
 * menu manage rights; the database refuses a direct menu_items write), so this
 * section saves separately from the item's own fields and says so. Restock is
 * the same control: set the new count and save.
 */
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { color, space, type } from "../../../constants/designSystem";
import { Button } from "../../ui/Button";
import { NumberStepper, NumberStepperPair } from "../../ui/NumberStepper";
import { Switch } from "../../ui/Switch";
import { menuKeys } from "../../../hooks/useMenus";
import { refreshStockReads } from "../../../hooks/stockRefresh";
import { setMenuItemStock, StockError } from "../../../services/venueStockService";
import { STOCK_COPY, stockErrorCopy } from "./stockCopy";
import {
  STOCK_MAX,
  stockDraftChanged,
  stockDraftFrom,
  stockSaveInput,
  type StockDraft,
} from "./stockModel";

export interface MenuItemStockSectionProps {
  brandId: string | null;
  venueId: string;
  menuItemId: string;
  stockCount: number | null;
  stockWarnAt: number | null;
  stockOutAt: string | null;
  canMutate: boolean;
  /** Formats a server time as the venue's 24-hour clock ("19:58"). */
  formatTime: (iso: string) => string;
}

export function MenuItemStockSection({
  brandId,
  venueId,
  menuItemId,
  stockCount,
  stockWarnAt,
  stockOutAt,
  canMutate,
  formatTime,
}: MenuItemStockSectionProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StockDraft>(() => stockDraftFrom(stockCount, stockWarnAt));
  const [saving, setSaving] = useState<boolean>(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setDraft(stockDraftFrom(stockCount, stockWarnAt));
    setStatus(null);
  }, [menuItemId, stockCount, stockWarnAt]);

  const changed = useMemo(() => stockDraftChanged(draft, stockCount, stockWarnAt), [draft, stockCount, stockWarnAt]);
  const soldOut = stockCount === 0;

  const save = async (): Promise<void> => {
    if (saving || !changed) return;
    setSaving(true);
    setStatus(null);
    try {
      const input = stockSaveInput(draft);
      await setMenuItemStock({ venueId, menuItemId, count: input.count, warnAt: input.warnAt });
      setStatus({ ok: true, text: input.count === null ? STOCK_COPY.stopped : STOCK_COPY.saved });
      // The Till's tiles hear a restock (or a stop) at once, not after their
      // own 30 s: the same stock reads the Till's writes refresh (O5-B2).
      refreshStockReads(queryClient, venueId);
      if (brandId !== null) {
        await queryClient.invalidateQueries({ queryKey: menuKeys.brandMenus(brandId, venueId) });
      }
    } catch (err) {
      setStatus({ ok: false, text: stockErrorCopy(err instanceof StockError ? err.code : "stock_failed") });
    } finally {
      setSaving(false);
    }
  };

  const saveLabel = draft.tracked
    ? soldOut && draft.count > 0
      ? STOCK_COPY.saveCountN(draft.count)
      : STOCK_COPY.saveCount
    : STOCK_COPY.stopTracking;

  return (
    <View style={styles.wrap} testID="menu-item-stock">
      <Text style={styles.label} accessibilityRole="header">{STOCK_COPY.section}</Text>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{STOCK_COPY.track}</Text>
          <Text style={styles.helper}>{STOCK_COPY.trackHint}</Text>
        </View>
        <Switch
          value={draft.tracked}
          onValueChange={(next) => {
            setStatus(null);
            setDraft((d) => ({ ...d, tracked: next }));
          }}
          disabled={!canMutate || saving}
          accessibilityLabel={STOCK_COPY.track}
          testID="menu-item-stock-track"
        />
      </View>
      {draft.tracked ? (
        <NumberStepperPair testID="menu-item-stock-steppers">
          <NumberStepper
            label={STOCK_COPY.count}
            value={draft.count}
            min={0}
            max={STOCK_MAX}
            onChange={(next) => {
              setStatus(null);
              setDraft((d) => ({ ...d, count: next }));
            }}
            testID="menu-item-stock-count"
          />
          <NumberStepper
            label={STOCK_COPY.warnAt}
            value={draft.warnAt}
            min={0}
            max={STOCK_MAX}
            onChange={(next) => {
              setStatus(null);
              setDraft((d) => ({ ...d, warnAt: next }));
            }}
            testID="menu-item-stock-warn"
          />
        </NumberStepperPair>
      ) : null}
      {soldOut && stockOutAt !== null ? (
        <Text style={styles.soldOut} testID="menu-item-stock-sold-out">
          {STOCK_COPY.soldOutAt(formatTime(stockOutAt))}
        </Text>
      ) : null}
      <Text style={styles.helper}>{STOCK_COPY.rule}</Text>
      {status !== null ? (
        <Text
          accessibilityRole={status.ok ? undefined : "alert"}
          accessibilityLiveRegion="polite"
          style={status.ok ? styles.saved : styles.error}
          testID="menu-item-stock-status"
        >
          {status.text}
        </Text>
      ) : null}
      {canMutate ? (
        <Button
          label={saveLabel}
          variant="secondary"
          size="md"
          onPress={() => void save()}
          disabled={!changed || saving}
          loading={saving}
          testID="menu-item-stock-save"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2], paddingTop: space[2] },
  label: { ...type.label, color: color.text3 },
  row: { flexDirection: "row", alignItems: "center", gap: space[3] },
  rowText: { flex: 1, minWidth: 0, gap: space[1] },
  rowTitle: { ...type.row, color: color.text1 },
  helper: { ...type.caption, color: color.text3 },
  soldOut: { ...type.caption, color: color.errorText },
  saved: { ...type.caption, color: color.successText },
  error: { ...type.caption, color: color.errorText },
});

export default MenuItemStockSection;
