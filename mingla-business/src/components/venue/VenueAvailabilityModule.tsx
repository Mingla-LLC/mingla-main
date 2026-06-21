/**
 * META-ORCH-1148 sub-ORCH 2.1a — Availability module (config editor).
 *
 * Replaces the Availability ComingSoon slot. Writes venue_availability_config
 * (service periods, turn times by party size, buffer, max-per-slot, granularity,
 * advance window, min notice) + venue_blackouts. This config is exactly what the
 * engine RPC reads — NO client-side slot generation lives here. Manager-plus
 * rank gates the controls (RLS enforces server-side). Every Pressable carries an
 * a11y label (I-39). No dead taps.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import {
  useDeleteVenueBlackout,
  useUpsertVenueAvailabilityConfig,
  useUpsertVenueBlackout,
  useVenueAvailabilityConfig,
  useVenueBlackouts,
} from "../../hooks/useVenueAvailability";
import { useVenueTables } from "../../hooks/useVenueTables";
import { useVenueSuiteStore } from "../../store/venueSuiteStore";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { VenueBlackoutSheet } from "./VenueBlackoutSheet";
import type {
  ServicePeriod,
  VenueBlackout,
  VenueBlackoutUpsert,
} from "../../types/venueReservation";

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager; // 40

const DAY_SHORT: readonly string[] = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
// The turn-time party buckets the engine recognises (keys 'pN').
const TURN_BUCKETS: readonly { key: string; label: string }[] = [
  { key: "p2", label: "Party of 1–2" },
  { key: "p4", label: "Party of 3–4" },
  { key: "p6", label: "Party of 5–6" },
  { key: "p8", label: "Party of 7+" },
];

function periodSummary(p: ServicePeriod): string {
  const days = p.days.map((d) => DAY_SHORT[d]).join(" ");
  return `${days} · ${p.start}–${p.end}`;
}

function parseIntClamp(raw: string, min: number, max: number): number | null {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

export interface VenueAvailabilityModuleProps {
  brandId: string | null;
  testID?: string;
}

export function VenueAvailabilityModule({
  brandId,
  testID,
}: VenueAvailabilityModuleProps): React.ReactElement {
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;

  const configQuery = useVenueAvailabilityConfig(brandId);
  const upsertConfig = useUpsertVenueAvailabilityConfig(brandId);
  const blackoutsQuery = useVenueBlackouts(brandId);
  const upsertBlackout = useUpsertVenueBlackout(brandId);
  const deleteBlackout = useDeleteVenueBlackout(brandId);
  const tablesQuery = useVenueTables(brandId);

  const config = configQuery.data;
  const servicePeriods = useMemo<ServicePeriod[]>(
    () => config?.servicePeriods ?? [],
    [config],
  );
  const turnTimes = useMemo<Record<string, number>>(
    () => config?.turnTimes ?? {},
    [config],
  );
  const blackouts = blackoutsQuery.data ?? [];
  const tables = tablesQuery.data ?? [];

  const [blackoutSheetOpen, setBlackoutSheetOpen] = useState<boolean>(false);
  const [editBlackout, setEditBlackout] = useState<VenueBlackout | null>(null);

  /* ----- service periods (ORCH-1190 #2: READ-ONLY here) -----
   * Service periods are DERIVED from the venue's opening hours (ORCH-1186 Leg 1,
   * brand_hours = the single owner — I-PROPOSED-1186-HOURS-SINGLE-OWNER). This
   * module DISPLAYS them read-only and routes the operator to the Settings hours
   * editor to change them; it NEVER edits/adds hours inline (that would create a
   * second hours owner). The in-suite switch goes through the venueSuiteStore's
   * `selectModule` (a state change, never router.push — preserves the nav-lock).
   */
  const goToSettingsHours = useCallback((): void => {
    useVenueSuiteStore.getState().selectModule?.("settings");
  }, []);

  /* ----- turn times ----- */
  const handleTurnTime = useCallback(
    (key: string, raw: string): void => {
      if (!canMutate) return;
      const n = parseIntClamp(raw, 0, 600);
      const next = { ...turnTimes };
      if (n === null || n === 0) delete next[key];
      else next[key] = n;
      upsertConfig.mutate({ turnTimes: next });
    },
    [canMutate, turnTimes, upsertConfig],
  );

  /* ----- booking controls ----- */
  const commitNumber = useCallback(
    (
      patchKey:
        | "bufferMinutes"
        | "maxReservationsPerSlot"
        | "slotGranularityMinutes"
        | "advanceWindowDays"
        | "minNoticeMinutes",
      raw: string,
      min: number,
      max: number,
      allowNull = false,
    ): void => {
      if (!canMutate) return;
      if (allowNull && raw.trim().length === 0) {
        upsertConfig.mutate({ [patchKey]: null } as never);
        return;
      }
      const n = parseIntClamp(raw, min, max);
      if (n === null) return;
      upsertConfig.mutate({ [patchKey]: n } as never);
    },
    [canMutate, upsertConfig],
  );

  /* ----- blackouts ----- */
  const openAddBlackout = useCallback((): void => {
    setEditBlackout(null);
    setBlackoutSheetOpen(true);
  }, []);
  const openEditBlackout = useCallback((b: VenueBlackout): void => {
    setEditBlackout(b);
    setBlackoutSheetOpen(true);
  }, []);
  const handleSaveBlackout = useCallback(
    (input: VenueBlackoutUpsert): void => {
      upsertBlackout.mutate(input, {
        onSuccess: () => setBlackoutSheetOpen(false),
      });
    },
    [upsertBlackout],
  );
  const handleDeleteBlackout = useCallback((): void => {
    if (editBlackout === null) return;
    deleteBlackout.mutate(editBlackout.id, {
      onSuccess: () => setBlackoutSheetOpen(false),
    });
  }, [editBlackout, deleteBlackout]);

  const numberControls = useMemo(
    () => [
      {
        key: "bufferMinutes" as const,
        label: "Buffer between seatings (min)",
        value: config?.bufferMinutes ?? 0,
        min: 0,
        max: 240,
        allowNull: false,
        testID: "venue-avail-buffer",
      },
      {
        key: "maxReservationsPerSlot" as const,
        label: "Max reservations per slot (blank = all tables)",
        value: config?.maxReservationsPerSlot ?? null,
        min: 1,
        max: 999,
        allowNull: true,
        testID: "venue-avail-maxslot",
      },
      {
        key: "slotGranularityMinutes" as const,
        label: "Slot step (min: 5/10/15/20/30/60)",
        value: config?.slotGranularityMinutes ?? 15,
        min: 5,
        max: 60,
        allowNull: false,
        testID: "venue-avail-granularity",
      },
      {
        key: "advanceWindowDays" as const,
        label: "Book up to (days ahead)",
        value: config?.advanceWindowDays ?? 30,
        min: 0,
        max: 365,
        allowNull: false,
        testID: "venue-avail-advance",
      },
      {
        key: "minNoticeMinutes" as const,
        label: "Minimum notice (min)",
        value: config?.minNoticeMinutes ?? 0,
        min: 0,
        max: 10080,
        allowNull: false,
        testID: "venue-avail-minnotice",
      },
    ],
    [config],
  );

  return (
    <View style={styles.host} testID={testID ?? "venue-availability-module"}>
      <View style={styles.headerText}>
        <Text style={styles.title}>Availability</Text>
        <Text style={styles.subtitle}>
          Set when guests can book, how long a table turns, and any closures.
        </Text>
      </View>

      {/* Service periods — ORCH-1190 #2: READ-ONLY, derived from opening hours.
          No inline add/edit (that would create a second hours owner). The only
          affordance routes to the Settings hours editor. */}
      <GlassCard variant="base" style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Service periods</Text>
        </View>
        <Text style={styles.sectionHint} testID="venue-avail-periods-source-note">
          Pulled from your opening hours. Guests can reserve during the times your
          venue is open.
        </Text>
        {servicePeriods.length === 0 ? (
          <Text style={styles.emptyLine}>
            No service periods yet. Set your opening hours in Settings and they
            show up here automatically.
          </Text>
        ) : (
          servicePeriods.map((p, idx) => (
            <View
              key={`${p.name}-${idx}`}
              accessibilityRole="text"
              accessibilityLabel={`Service period ${p.name}, ${periodSummary(p)}`}
              style={styles.periodRow}
              testID={`venue-avail-period-${idx}`}
            >
              <View style={styles.flex1}>
                <Text style={styles.periodName}>{p.name}</Text>
                <Text style={styles.periodMeta}>{periodSummary(p)}</Text>
              </View>
            </View>
          ))
        )}
        {canMutate ? (
          <Button
            label="Edit hours in Settings"
            onPress={goToSettingsHours}
            variant="secondary"
            size="sm"
            leadingIcon="settings"
            style={styles.periodEditBtn}
            accessibilityLabel="Edit opening hours in Settings"
            testID="venue-avail-edit-hours-in-settings"
          />
        ) : null}
      </GlassCard>

      {/* Turn times */}
      <GlassCard variant="base" style={styles.section}>
        <Text style={styles.sectionTitle}>Turn time by party size</Text>
        <Text style={styles.sectionHint}>
          How long a seating lasts, in minutes. Leave blank to skip a bucket.
        </Text>
        {TURN_BUCKETS.map((b) => (
          <View key={b.key} style={styles.turnRow}>
            <Text style={styles.turnLabel}>{b.label}</Text>
            <View style={styles.turnInput}>
              <Input
                value={turnTimes[b.key] != null ? String(turnTimes[b.key]) : ""}
                onChangeText={(v) => handleTurnTime(b.key, v)}
                variant="number"
                placeholder="90"
                disabled={!canMutate}
                accessibilityLabel={`Turn time minutes for ${b.label}`}
                testID={`venue-avail-turn-${b.key}`}
              />
            </View>
          </View>
        ))}
      </GlassCard>

      {/* Booking controls */}
      <GlassCard variant="base" style={styles.section}>
        <Text style={styles.sectionTitle}>Booking controls</Text>
        {numberControls.map((c) => (
          <View key={c.key} style={styles.turnRow}>
            <Text style={styles.turnLabel}>{c.label}</Text>
            <View style={styles.turnInput}>
              <Input
                value={c.value != null ? String(c.value) : ""}
                onChangeText={(v) =>
                  commitNumber(c.key, v, c.min, c.max, c.allowNull)
                }
                variant="number"
                placeholder={c.allowNull ? "All" : "0"}
                disabled={!canMutate}
                accessibilityLabel={c.label}
                testID={c.testID}
              />
            </View>
          </View>
        ))}
      </GlassCard>

      {/* Blackouts */}
      <GlassCard variant="base" style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Blackout dates</Text>
          {canMutate ? (
            <Button
              label="Add"
              onPress={openAddBlackout}
              variant="secondary"
              size="sm"
              leadingIcon="plus"
              testID="venue-avail-add-blackout"
            />
          ) : null}
        </View>
        {blackouts.length === 0 ? (
          <Text style={styles.emptyLine}>
            No blackouts. Add holidays or closures to block bookings on those
            dates.
          </Text>
        ) : (
          blackouts.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => (canMutate ? openEditBlackout(b) : undefined)}
              disabled={!canMutate}
              accessibilityRole="button"
              accessibilityLabel={`Edit blackout from ${b.dateStart}`}
              style={styles.periodRow}
              testID={`venue-avail-blackout-${b.id}`}
            >
              <View style={styles.flex1}>
                <Text style={styles.periodName}>
                  {b.dateStart === b.dateEnd
                    ? b.dateStart
                    : `${b.dateStart} → ${b.dateEnd}`}
                </Text>
                <Text style={styles.periodMeta}>
                  {b.appliesTo === "all"
                    ? "Whole venue"
                    : b.appliesTo === "zone"
                      ? `Zone: ${b.zone ?? "—"}`
                      : "One table"}
                  {b.reason != null ? ` · ${b.reason}` : ""}
                </Text>
              </View>
              {canMutate ? (
                <Icon name="chevR" size={18} color={textTokens.tertiary} />
              ) : null}
            </Pressable>
          ))
        )}
      </GlassCard>

      {!canMutate ? (
        <Text style={styles.readOnlyNote}>
          You can view availability. Ask a manager or owner to make changes.
        </Text>
      ) : null}

      <VenueBlackoutSheet
        visible={blackoutSheetOpen}
        onClose={() => setBlackoutSheetOpen(false)}
        blackout={editBlackout}
        tables={tables}
        onSave={handleSaveBlackout}
        onDelete={editBlackout !== null ? handleDeleteBlackout : undefined}
        saving={upsertBlackout.isPending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  headerText: {
    gap: spacing.xxs,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
  },
  subtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  sectionHint: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  emptyLine: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  periodRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  flex1: {
    flex: 1,
    gap: spacing.xxs,
  },
  periodName: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  periodMeta: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  periodEditBtn: {
    alignSelf: "flex-start",
    marginTop: spacing.xs,
  },
  turnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  turnLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    flex: 1,
  },
  turnInput: {
    width: 96,
  },
  readOnlyNote: {
    ...typography.caption,
    color: textTokens.tertiary,
    textAlign: "center",
  },
});

export default VenueAvailabilityModule;
