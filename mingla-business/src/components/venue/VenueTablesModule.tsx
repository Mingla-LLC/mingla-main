/**
 * META-ORCH-1148 sub-ORCH 2.1a — Tables module (real CRUD).
 *
 * Replaces the Tables ComingSoon slot. Lists venue_tables, add/edit via
 * VenueTableSheet, deactivate inline, and surfaces the Smart Capacity Rules MVP
 * panel. Manager-plus rank gates the mutation controls in the UI (RLS enforces
 * server-side). Android glass via GlassCard (opaque fallback automatic). Every
 * Pressable carries an a11y label (I-39). No dead taps.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import {
  useDeleteVenueTable,
  useSetVenueTableActive,
  useUpsertVenueTable,
  useVenueTables,
} from "../../hooks/useVenueTables";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { ChevronRight, LayoutGrid } from "lucide-react-native";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { VenueCapacityRulesPanel } from "./VenueCapacityRulesPanel";
import { VenueTableSheet } from "./VenueTableSheet";
import type {
  VenueTable,
  VenueTableUpsert,
} from "../../types/venueReservation";

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager; // 40

const ZONE_LABEL: Record<string, string> = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  private_room: "Private room",
  bar: "Bar",
  patio: "Patio",
};

const SEATING_LABEL: Record<string, string> = {
  high_top: "High-top",
  booth: "Booth",
  lounge: "Lounge",
  standard: "Standard",
};

function tableMeta(t: VenueTable): string {
  const parts: string[] = [`${t.capacity} seats`];
  if (t.minParty != null || t.maxParty != null) {
    const lo = t.minParty ?? 1;
    const hi = t.maxParty ?? t.capacity;
    parts.push(`parties ${lo}–${hi}`);
  }
  if (t.zone != null) parts.push(ZONE_LABEL[t.zone] ?? t.zone);
  if (t.seatingType != null) parts.push(SEATING_LABEL[t.seatingType] ?? t.seatingType);
  if (t.reservationPolicy === "walk_in_only") parts.push("walk-in only");
  return parts.join(" · ");
}

export interface VenueTablesModuleProps {
  brandId: string | null;
  testID?: string;
}

export function VenueTablesModule({
  brandId,
  testID,
}: VenueTablesModuleProps): React.ReactElement {
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;

  const tablesQuery = useVenueTables(brandId);
  const upsert = useUpsertVenueTable(brandId);
  const setActive = useSetVenueTableActive(brandId);
  const remove = useDeleteVenueTable(brandId);

  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<VenueTable | null>(null);

  const tables = tablesQuery.data ?? [];
  const isEmpty = !tablesQuery.isLoading && tables.length === 0;

  const openAdd = useCallback((): void => {
    setEditing(null);
    setSheetOpen(true);
  }, []);

  const openEdit = useCallback((t: VenueTable): void => {
    setEditing(t);
    setSheetOpen(true);
  }, []);

  const handleSave = useCallback(
    (input: VenueTableUpsert): void => {
      upsert.mutate(input, {
        onSuccess: () => {
          setSheetOpen(false);
          setEditing(null);
        },
      });
    },
    [upsert],
  );

  const handleToggleActive = useCallback(
    (t: VenueTable): void => {
      if (!canMutate) return;
      setActive.mutate({ id: t.id, isActive: !t.isActive });
    },
    [canMutate, setActive],
  );

  const handleDelete = useCallback(
    (id: string): void => {
      if (!canMutate) return;
      remove.mutate(
        { id },
        {
          onSuccess: () => {
            setSheetOpen(false);
            setEditing(null);
          },
        },
      );
    },
    [canMutate, remove],
  );

  const header = useMemo(
    () => (
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Tables</Text>
          <Text style={styles.subtitle}>
            Your floor plan powers which times guests can book.
          </Text>
        </View>
        {canMutate ? (
          <Button
            label="Add table"
            onPress={openAdd}
            variant="primary"
            size="sm"
            leadingIcon="plus"
            testID="venue-tables-add"
          />
        ) : null}
      </View>
    ),
    [canMutate, openAdd],
  );

  return (
    <View style={styles.host} testID={testID ?? "venue-tables-module"}>
      {header}

      {isEmpty ? (
        <GlassCard variant="elevated" style={styles.emptyCard}>
          <LayoutGrid size={28} color={textTokens.primary} />
          <Text style={styles.emptyTitle}>Set up your tables</Text>
          <Text style={styles.emptyBody}>
            Add your tables, zones, and party-size limits. The availability engine
            uses them to offer guests bookable times.
          </Text>
          {canMutate ? (
            <Button
              label="Add your first table"
              onPress={openAdd}
              variant="primary"
              size="md"
              fullWidth
              testID="venue-tables-empty-add"
            />
          ) : (
            <Text style={styles.readOnlyNote}>
              Ask a manager or owner to set up tables.
            </Text>
          )}
        </GlassCard>
      ) : (
        <View style={styles.list}>
          {tables.map((t) => (
            <GlassCard
              key={t.id}
              variant="base"
              style={[styles.tableCard, !t.isActive ? styles.tableCardInactive : null]}
            >
              {/* ORCH-1190 #8 — the row layout lives on this INNER View, not on the
                  GlassCard wrapper. The card style only sets width:100%; the
                  flexDirection:row + minWidth:0 children here let the meta text
                  shrink/wrap instead of collapsing to one char per line. */}
              <View style={styles.tableRow}>
                <Pressable
                  onPress={() => (canMutate ? openEdit(t) : undefined)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${t.name}`}
                  disabled={!canMutate}
                  style={styles.tableMain}
                  testID={`venue-table-row-${t.id}`}
                >
                  <View style={styles.tableText}>
                    <Text style={styles.tableName}>{t.name}</Text>
                    <Text style={styles.tableMeta}>{tableMeta(t)}</Text>
                  </View>
                  {canMutate ? (
                    <ChevronRight size={18} color={textTokens.tertiary} />
                  ) : null}
                </Pressable>
                {canMutate ? (
                  <Pressable
                    onPress={() => handleToggleActive(t)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      t.isActive ? `Deactivate ${t.name}` : `Reactivate ${t.name}`
                    }
                    style={styles.activeToggle}
                    testID={`venue-table-active-${t.id}`}
                  >
                    <Text
                      style={[
                        styles.activeToggleLabel,
                        t.isActive ? styles.activeOn : styles.activeOff,
                      ]}
                    >
                      {t.isActive ? "Active" : "Inactive"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </GlassCard>
          ))}
        </View>
      )}

      {tablesQuery.isError ? (
        <Text style={styles.errorNote}>
          Couldn&apos;t load your tables. Pull to refresh.
        </Text>
      ) : null}

      {/* Smart Capacity Rules MVP (the 3 rules). */}
      <VenueCapacityRulesPanel brandId={brandId} canMutate={canMutate} />

      <VenueTableSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        table={editing}
        onSave={handleSave}
        saving={upsert.isPending}
        onDelete={handleDelete}
        deleting={remove.isPending}
        canDelete={canMutate}
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
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
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
  emptyCard: {
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.h3,
    color: textTokens.primary,
    textAlign: "center",
  },
  emptyBody: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
  list: {
    gap: spacing.sm,
  },
  tableCard: {
    // ORCH-1190 #8 / R2 — full-width row card. On narrow widths the card
    // previously collapsed to its min-content width (the GlassCard wrapper
    // carried the flexDirection:row, so its single clipped child shrank to
    // min-content), wrapping the meta text one character per line.
    //
    // R2 HARDENING: width:"100%" alone resolves against the PARENT's width, so
    // it only protects the card when every ancestor stretches. A vertical
    // ScrollView content container (the shell's phone path) or any ancestor that
    // sets alignItems other than "stretch" leaves the card sized by its content
    // → the one-char-per-line collapse returns. `alignSelf:"stretch"` forces the
    // card to fill its cross-axis regardless of the ancestor's alignItems, and
    // width:"100%" keeps it edge-to-edge when the parent IS definite. Both are
    // required; neither alone covers every container.
    width: "100%",
    alignSelf: "stretch",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    // R2 — the GlassCard padding wrapper between the width:100% card and this
    // row carries no width of its own; pin the row to 100% so the flex children
    // below (tableMain/tableText with flex:1+minWidth:0) measure against the
    // full card width instead of collapsing to the longest unbreakable word.
    width: "100%",
  },
  tableCardInactive: {
    opacity: 0.55,
  },
  tableMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  tableText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  tableName: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "600",
  },
  tableMeta: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  activeToggle: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  activeToggleLabel: {
    ...typography.caption,
    fontWeight: "700",
  },
  activeOn: {
    color: semantic.success,
  },
  activeOff: {
    color: textTokens.tertiary,
  },
  readOnlyNote: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  errorNote: {
    ...typography.bodySm,
    color: semantic.error,
  },
});

export default VenueTablesModule;
