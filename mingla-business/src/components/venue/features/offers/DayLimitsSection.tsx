/**
 * #4490 P2-4 — "Day limits" in Availability & pricing (reconciliation 29): a
 * different guest limit, a different number kept for walk-ins, or no entry at
 * all, on one date. DayDateField + NumberStepper + Closed switch, written by
 * `issue_4490_set_capacity_override`; "Back to the usual limit" clears it.
 * Shows only once the venue has a day limit (an Entry offer's capacity).
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../../constants/designSystem";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useCapacityOverrides, useSetCapacityOverride, useVenueOffers } from "../../../../hooks/useVenueOffers";
import { toVenueOfferError } from "../../../../services/venueOffersService";
import type { CapacityOverride, VenueCapacityPool } from "../../../../types/venueOffers";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { BrandSwitch } from "../../../ui/BrandSwitch";
import { Button } from "../../../ui/Button";
import { DayDateField } from "../../../ui/DayDateField";
import { dayDateLabel } from "../../../ui/fieldModels";
import { GlassCard } from "../../../ui/GlassCard";
import { NumberStepper } from "../../../ui/NumberStepper";
import { SelectSheet } from "../../../ui/SelectSheet";
import { Sheet } from "../../../ui/Sheet";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Skeleton } from "../../../ui/Skeleton";
import { dayLimitIssue, offerErrorCopy, overrideLine, type DayLimitDraft as Draft } from "./offersModel";

const LazyToast = React.lazy(async () => {
  const mod = await import("../../../ui/Toast");
  return { default: mod.Toast };
});

export interface DayLimitsSectionProps {
  brandId: string | null;
  venueId: string | null;
  canEdit: boolean;
  today: string;
}

export function DayLimitsSection({ brandId, venueId, canEdit, today }: DayLimitsSectionProps): React.ReactElement | null {
  const { isWideDesktop } = useResponsiveLayout();
  const offersQuery = useVenueOffers(brandId, venueId);
  const overridesQuery = useCapacityOverrides(brandId, venueId, today);
  const setOverride = useSetCapacityOverride(brandId, venueId);
  const pools = useMemo(() => offersQuery.data?.pools ?? [], [offersQuery.data?.pools]);
  const [editing, setEditing] = useState<{ draft: Draft; existing: boolean } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (editing === null) {
      setShowErrors(false);
      setError(null);
    }
  }, [editing]);

  if (offersQuery.isLoading) return <Skeleton height={64} radius="md" />;
  if (pools.length === 0) return null;
  const overrides = overridesQuery.data ?? [];
  const multiPool = pools.length > 1;
  const poolOf = (id: string): VenueCapacityPool | undefined => pools.find((p) => p.id === id);

  const openNew = (): void => {
    const p = pools[0];
    setEditing({
      existing: false,
      draft: { poolId: p.id, localDate: "", closed: false, dailyLimit: p.dailyLimit, keptForWalkIns: p.keptForWalkIns },
    });
  };
  const openExisting = (o: CapacityOverride): void => {
    const p = poolOf(o.poolId);
    setEditing({
      existing: true,
      draft: {
        poolId: o.poolId,
        localDate: o.localDate,
        closed: o.closed,
        dailyLimit: o.dailyLimit ?? p?.dailyLimit ?? 0,
        keptForWalkIns: o.keptForWalkIns ?? p?.keptForWalkIns ?? 0,
      },
    });
  };

  const draft = editing?.draft ?? null;
  const issue = draft === null ? null : dayLimitIssue(draft, today);
  const patch = (next: Partial<Draft>): void =>
    setEditing((e) => (e === null ? e : { ...e, draft: { ...e.draft, ...next } }));

  const save = (clear: boolean): void => {
    if (draft === null) return;
    if (!clear && issue !== null) {
      setShowErrors(true);
      return;
    }
    setError(null);
    setOverride.mutate(
      {
        poolId: draft.poolId,
        localDate: draft.localDate,
        dailyLimit: clear || draft.closed ? null : draft.dailyLimit,
        keptForWalkIns: clear || draft.closed ? null : draft.keptForWalkIns,
        closed: !clear && draft.closed,
        clear,
      },
      {
        onSuccess: () => {
          setToast(clear ? `${dayDateLabel(draft.localDate)} is back to the usual limit` : `Day limit saved for ${dayDateLabel(draft.localDate)}`);
          setEditing(null);
        },
        onError: (e) => {
          const err = toVenueOfferError(e);
          setError(offerErrorCopy(err.code, err.detail));
        },
      },
    );
  };

  return (
    <GlassCard variant="base" padding={space[4]} contentStyle={styles.card} testID="av-day-limits">
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.title} accessibilityRole="header">Day limits</Text>
          <Text style={styles.body}>
            Usually {pools[0].dailyLimit.toLocaleString("en-GB")} guests a day, {pools[0].keptForWalkIns.toLocaleString("en-GB")} kept for walk-ins. Change it for one date.
          </Text>
        </View>
        {canEdit ? (
          <Button label="Set a day limit" variant="secondary" size="sm" leadingIcon="plus" onPress={openNew} testID="av-day-limit-add" />
        ) : null}
      </View>
      {overridesQuery.isError ? (
        <View style={styles.inline}>
          <Text style={styles.error}>Couldn&apos;t load your day limits.</Text>
          <Button label="Try again" variant="ghost" size="sm" onPress={() => void overridesQuery.refetch()} />
        </View>
      ) : overrides.length === 0 ? (
        <Text style={styles.body}>No dates with a different limit.</Text>
      ) : (
        overrides.map((o) => (
          <Pressable
            key={`${o.poolId}-${o.localDate}`}
            onPress={() => (canEdit ? openExisting(o) : undefined)}
            disabled={!canEdit}
            accessibilityRole="button"
            accessibilityLabel={`${dayDateLabel(o.localDate)}: ${overrideLine(o, poolOf(o.poolId))}${canEdit ? ". Edit" : ""}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            testID={`av-day-limit-${o.localDate}`}
          >
            <Text style={styles.rowTitle}>
              {dayDateLabel(o.localDate)}
              {multiPool ? ` · ${poolOf(o.poolId)?.name ?? ""}` : ""}
            </Text>
            <Text style={[styles.body, o.closed ? styles.warn : null]}>{overrideLine(o, poolOf(o.poolId))}</Text>
          </Pressable>
        ))
      )}

      <Sheet
        visible={editing !== null}
        onClose={() => {
          if (!setOverride.isPending) setEditing(null);
        }}
        snapPoint={0.85}
        presentation={isWideDesktop ? "panel" : undefined}
        dismissDisabled={setOverride.isPending}
        testID="av-day-limit-sheet"
      >
        {draft !== null ? (
          <View style={styles.sheetBody}>
            <PickerSheetHead
              title={editing?.existing === true ? dayDateLabel(draft.localDate) : "Set a day limit"}
              onClose={() => {
                if (!setOverride.isPending) setEditing(null);
              }}
              plain={isWideDesktop}
              testID="av-day-limit-head"
            />
            <ScrollView style={styles.scroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              {multiPool ? (
                <SelectSheet
                  label="Limit"
                  value={draft.poolId}
                  options={pools.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(poolId) => {
                    const p = poolOf(poolId);
                    patch({ poolId, dailyLimit: p?.dailyLimit ?? draft.dailyLimit, keptForWalkIns: p?.keptForWalkIns ?? draft.keptForWalkIns });
                  }}
                  disabled={editing?.existing === true}
                />
              ) : null}
              {editing?.existing !== true ? (
                <DayDateField
                  label="Date"
                  value={draft.localDate}
                  onChangeValue={(localDate) => patch({ localDate })}
                  accessibilityLabel="Day limit date"
                  min={today}
                  today={today}
                  error={showErrors && issue !== null && issue.startsWith("Pick") ? issue : null}
                  testID="av-day-limit-date"
                />
              ) : null}
              <View style={styles.switchRow}>
                <View style={styles.headText}>
                  <Text style={styles.rowTitle}>Closed</Text>
                  <Text style={styles.hint}>No entry sold that day, online or at the gate.</Text>
                </View>
                <BrandSwitch
                  value={draft.closed}
                  onValueChange={(closed) => patch({ closed })}
                  accessibilityLabel="Closed that day"
                  testID="av-day-limit-closed"
                />
              </View>
              {!draft.closed ? (
                <>
                  <NumberStepper
                    label="Guests that day"
                    value={draft.dailyLimit}
                    min={0}
                    max={100000}
                    onChange={(dailyLimit) => patch({ dailyLimit, keptForWalkIns: Math.min(draft.keptForWalkIns, dailyLimit) })}
                    testID="av-day-limit-limit"
                  />
                  <NumberStepper
                    label="Kept for walk-ins"
                    value={draft.keptForWalkIns}
                    min={0}
                    max={draft.dailyLimit}
                    onChange={(keptForWalkIns) => patch({ keptForWalkIns })}
                    testID="av-day-limit-kept"
                  />
                  <Text style={styles.hint}>Guests who already bought for that day keep their passes.</Text>
                </>
              ) : (
                <Text style={styles.hint}>Guests who already bought for that day keep their passes. Contact them if you won&apos;t let them in.</Text>
              )}
              {showErrors && issue !== null && !issue.startsWith("Pick") ? <Text style={styles.error}>{issue}</Text> : null}
            </ScrollView>
            <View style={styles.footer}>
              {error !== null ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
              <View style={styles.footerRow}>
                {editing?.existing === true ? (
                  <Button label="Back to the usual limit" variant="ghost" size="md" onPress={() => save(true)} disabled={setOverride.isPending} testID="av-day-limit-clear" />
                ) : (
                  <Button label="Cancel" variant="ghost" size="md" onPress={() => setEditing(null)} disabled={setOverride.isPending} />
                )}
                <Button label="Save" variant="primary" size="md" loading={setOverride.isPending} onPress={() => save(false)} testID="av-day-limit-save" />
              </View>
            </View>
          </View>
        ) : null}
      </Sheet>
      {toast !== null ? (
        <React.Suspense fallback={null}>
          <LazyToast visible kind="success" message={toast} onDismiss={() => setToast(null)} />
        </React.Suspense>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" },
  headText: { flex: 1, minWidth: 180, gap: 2 },
  title: { ...type.h2, color: color.text1 },
  body: { ...type.small, color: color.text2 },
  warn: { color: color.warning },
  hint: { ...type.caption, color: color.text3 },
  error: { ...type.caption, color: color.errorText },
  inline: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  row: { minHeight: 52, paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.line, gap: 2 },
  pressed: { backgroundColor: color.fill.pressed },
  rowTitle: { ...type.row, color: color.text1 },
  sheetBody: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2] },
  sheetTitle: { ...type.h1, color: color.text1, marginBottom: space[2] },
  scroll: { flex: 1 },
  sheetContent: { gap: space[3], paddingBottom: space[10] },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[2] },
  footer: { gap: space[2], paddingTop: space[3], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.line },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[2] },
});
