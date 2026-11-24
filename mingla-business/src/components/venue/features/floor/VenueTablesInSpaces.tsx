/**
 * #4490 P5-2 — Spaces › Tables: tables live in spaces (reconciliation 35).
 *
 * The old Tables module moved here; `?module=tables` opens this view. Pick a
 * space, then:
 *  - Floor plan on: the floor editor (room, landmarks, tables, layout);
 *  - Floor plan off: the table list with Add / Edit (the floor plan is one
 *    switch away, with its dependency said in plain words).
 * Tables with no space yet (none after the server's backfill) are listed so a
 * host can give them one.
 */
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useBrandCurrency } from "../../../../hooks/useBrandCurrency";
import { useSetVenueFeature, useVenueFeatures } from "../../../../hooks/useVenueFeatures";
import { useTillReleased } from "../../../../hooks/useTillReleased";
import { useTouchFloor } from "../../../../hooks/useTouchFloor";
import { useVenueEditAccess } from "../../../../hooks/useVenueEditAccess";
import { useVenueFloorPlan } from "../../../../hooks/useVenueTables";
import type { VenueFloorTable } from "../../../../services/venueFloorService";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { BrandSwitch } from "../../../ui/BrandSwitch";
import { Button } from "../../../ui/Button";
import { CenteredState } from "../../../ui/CenteredState";
import { Chip } from "../../../ui/Pill";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Sheet } from "../../../ui/Sheet";
import type { VenueModuleLeaveHandle } from "../../venueLeaveContract";
import { FloorEditor } from "./FloorEditor";
import { seatsLine, SHAPE_LABEL } from "./floorModel";
import { TableForm } from "./TableForm";
import { nextTableNameAfter, tableDepositLine } from "./tableDraft";

export interface VenueTablesInSpacesProps {
  brandId: string | null;
  venueId: string | null;
  initialSpaceId?: string | null;
  onOpenSettings?: () => void;
  onOpenSpacesList?: () => void;
  onToast: (message: string) => void;
}

export const VenueTablesInSpaces = forwardRef<VenueModuleLeaveHandle, VenueTablesInSpacesProps>(function VenueTablesInSpaces(
  { brandId, venueId, initialSpaceId = null, onOpenSettings, onOpenSpacesList, onToast },
  ref,
): React.ReactElement {
  const touch = useTouchFloor();
  const currency = useBrandCurrency(brandId);
  const access = useVenueEditAccess(brandId, venueId);
  const floorQuery = useVenueFloorPlan(brandId, venueId, null);
  const featuresQuery = useVenueFeatures(brandId, venueId);
  const setFeature = useSetVenueFeature(brandId, venueId);
  const plan = floorQuery.data ?? null;
  const [spaceId, setSpaceId] = useState<string | null>(initialSpaceId);
  const [formFor, setFormFor] = useState<{ tableId: string | null } | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [featureError, setFeatureError] = useState<string | null>(null);
  const [pendingSpace, setPendingSpace] = useState<string | null>(null);
  const editorRef = useRef<VenueModuleLeaveHandle | null>(null);

  const spaces = useMemo(() => plan?.spaces ?? [], [plan?.spaces]);
  useEffect(() => {
    if (spaces.length === 0) return;
    if (spaceId === null || !spaces.some((s) => s.id === spaceId)) {
      const firstWithTables = spaces.find((s) => s.tables.length > 0) ?? spaces[0];
      setSpaceId(firstWithTables?.id ?? null);
    }
  }, [spaceId, spaces]);

  const allTables = useMemo<VenueFloorTable[]>(
    () => [...spaces.flatMap((s) => s.tables), ...(plan?.unplaced ?? [])],
    [plan?.unplaced, spaces],
  );
  const selected = spaces.find((s) => s.id === spaceId) ?? null;
  const tillReleased = useTillReleased();
  const features = {
    minSpendTables: plan?.features.minSpendTables ?? false,
    pickATable: plan?.features.pickATable ?? false,
    floorPlan: plan?.features.floorPlan ?? false,
    // 08 O4 (T12): where the Till runs, a paid table deposit comes off the bill.
    till: tillReleased && featuresQuery.data?.features.till?.enabled === true,
  };
  const tableReservationsOn = featuresQuery.data?.features.table_reservations.enabled === true;
  const canEdit = access.canManageTables;
  // #4490 P5 — "Large parties can ask" (table_reservations.settings.largePartyRequest, default on).
  const tablesFeature = featuresQuery.data?.features.table_reservations ?? null;
  const largeOn = tablesFeature !== null && tablesFeature.settings.largePartyRequest !== false;
  const [largeError, setLargeError] = useState<string | null>(null);
  const toggleLarge = (next: boolean): void => {
    if (tablesFeature === null) return;
    setLargeError(null);
    setFeature.mutate(
      {
        key: "table_reservations",
        enabled: tablesFeature.enabled,
        cascade: false,
        expectedVersion: tablesFeature.version,
        settings: { ...tablesFeature.settings, largePartyRequest: next },
      },
      {
        onSuccess: () => onToast(next ? "Large parties can ask" : "Large parties can't ask online"),
        onError: () => setLargeError("Couldn't change that. Try again."),
      },
    );
  };

  useImperativeHandle(
    ref,
    (): VenueModuleLeaveHandle => ({
      isDirty: () => editorDirty || formDirty,
      changedLabels: () => editorRef.current?.changedLabels() ?? (formDirty ? ["Table details"] : []),
      isValid: () => true,
      save: async () => {
        await editorRef.current?.save();
      },
      discard: () => {
        editorRef.current?.discard();
        setFormFor(null);
        setFormDirty(false);
      },
    }),
  );

  // #4490 N25: the "Save this floor first?" question belongs to one attempt
  // to leave. Once the floor is saved (or nothing is unsaved) it goes away.
  useEffect(() => {
    if (!editorDirty) setPendingSpace(null);
  }, [editorDirty]);

  const chooseSpace = (id: string): void => {
    if (id === spaceId) return;
    if (editorDirty) {
      setPendingSpace(id);
      return;
    }
    setSpaceId(id);
  };

  const turnOnFloor = (): void => {
    setFeatureError(null);
    setFeature.mutate(
      { key: "floor_plan", enabled: true, cascade: true },
      {
        onSuccess: () => {
          onToast("Floor plan turned on");
          void floorQuery.refetch();
        },
        onError: () => setFeatureError("Couldn't turn on Floor plan. Try again, or switch it on in Settings."),
      },
    );
  };

  if (floorQuery.isLoading) {
    return (
      <View style={styles.loading} testID="venue-tables-loading">
        <ActivityIndicator />
        <Text style={styles.hint}>Loading your tables…</Text>
      </View>
    );
  }
  if (floorQuery.isError || plan === null) {
    return (
      <CenteredState title="Couldn't load your tables" body="Check your connection and try again." tone="error" testID="venue-tables-error">
        <Button label="Try again" variant="secondary" size="md" onPress={() => void floorQuery.refetch()} />
      </CenteredState>
    );
  }
  if (spaces.length === 0) {
    return (
      <CenteredState
        title="Add a space first"
        body="Tables sit in a space, like Main floor or Terrace. Add your first space, then its tables."
        testID="venue-tables-no-space"
      >
        {onOpenSpacesList !== undefined ? <Button label="Add a space" variant="primary" size="md" onPress={onOpenSpacesList} /> : null}
      </CenteredState>
    );
  }

  const formTable = formFor !== null && formFor.tableId !== null ? (allTables.find((t) => t.id === formFor.tableId) ?? null) : null;

  return (
    <View style={styles.host} testID="venue-tables-in-spaces">
      {!tableReservationsOn ? (
        <Banner
          tone="info"
          title="Table reservations are off"
          body="You can set up tables now. Guests book them once Table reservations is on in Settings."
          action={onOpenSettings !== undefined ? { label: "Open Settings", onPress: onOpenSettings, testID: "venue-tables-open-settings" } : undefined}
        />
      ) : null}
      {tableReservationsOn && access.canSwitchFeatures ? (
        <View style={styles.switchRow}>
          <View style={styles.rowText}>
            <Text style={styles.rowName}>Large parties can ask</Text>
            <Text style={styles.hint}>
              {largeOn
                ? allTables.length === 0
                  ? "Once you add tables, groups bigger than your largest table can send a request you confirm."
                  : `On to start with. Groups bigger than your largest table${plan.partyMax > 0 ? ` (${plan.partyMax})` : ""} send a request you confirm; nothing is paid until you do. Switch it off to take only what your tables seat.`
                : "Guests can only book parties your tables seat."}
            </Text>
          </View>
          <BrandSwitch value={largeOn} onValueChange={toggleLarge} disabled={setFeature.isPending} accessibilityLabel="Large parties can ask" testID="venue-tables-large-party" />
        </View>
      ) : null}
      {largeError !== null ? <Text style={styles.error}>{largeError}</Text> : null}
      <View style={styles.chips} accessibilityRole="tablist" accessibilityLabel="Spaces">
        {spaces.map((s) => (
          <Chip
            key={s.id}
            label={s.name}
            count={s.tables.length}
            selected={s.id === spaceId}
            onPress={() => chooseSpace(s.id)}
            style={touch > 0 ? { minHeight: touch } : undefined}
            testID={`venue-tables-space-${s.id}`}
          />
        ))}
      </View>
      {pendingSpace !== null ? (
        <Banner
          tone="warning"
          title="Save this floor first?"
          body="This floor has changes you haven't saved. Save the floor, or leave without saving."
          action={{
            label: "Leave without saving",
            onPress: () => {
              editorRef.current?.discard();
              setSpaceId(pendingSpace);
              setPendingSpace(null);
            },
            testID: "venue-tables-leave-floor",
          }}
          testID="venue-tables-unsaved"
        />
      ) : null}

      {plan.unplaced.length > 0 ? (
        <Banner
          tone="warning"
          title={`${plan.unplaced.length} ${plan.unplaced.length === 1 ? "table has" : "tables have"} no space`}
          body={`${plan.unplaced.map((t) => t.name).join(", ")}. Edit each one and pick its space.`}
          testID="venue-tables-no-space-tables"
        />
      ) : null}

      {selected !== null && features.floorPlan ? (
        <FloorEditor
          key={selected.id}
          ref={editorRef}
          brandId={brandId}
          venueId={venueId}
          space={selected}
          spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
          allTables={allTables}
          currency={currency}
          features={features}
          canEdit={canEdit}
          onOpenSettings={onOpenSettings}
          onToast={onToast}
          onReload={() => void floorQuery.refetch()}
          onDirtyChange={setEditorDirty}
        />
      ) : selected !== null ? (
        <View style={styles.listCard} testID="venue-tables-list">
          <View style={styles.listHead}>
            <Text style={styles.title}>{`Tables in ${selected.name}`}</Text>
            {canEdit ? (
              <Button label="Add a table" variant="primary" size="sm" leadingIcon="plus" onPress={() => setFormFor({ tableId: null })} testID="venue-tables-add" />
            ) : null}
          </View>
          {selected.tables.length === 0 ? (
            <Text style={styles.hint}>{`No tables in ${selected.name} yet. Add one, or draw the floor to place them.`}</Text>
          ) : (
            selected.tables.map((t) => (
              <View key={t.id} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{t.name}</Text>
                  <Text style={styles.hint}>
                    {[
                      SHAPE_LABEL[t.shape],
                      seatsLine(t.capacity, t.minParty),
                      tableDepositLine(t, (minor) => formatVenueMoney(minor, currency ?? "NGN", 2)),
                      t.combinable ? `joins ${t.joinsWith.length > 0 ? t.joinsWith.map((id) => allTables.find((x) => x.id === id)?.name ?? "").filter(Boolean).join(", ") : "nothing yet"}` : null,
                      t.reservationPolicy === "walk_in_only" ? "walk-ins only" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <Button label="Edit" variant="secondary" size="sm" onPress={() => setFormFor({ tableId: t.id })} accessibilityLabel={`Edit ${t.name}`} testID={`venue-tables-edit-${t.id}`} />
              </View>
            ))
          )}
          <View style={styles.floorOff}>
            <Text style={styles.rowName}>Draw the floor</Text>
            <Text style={styles.hint}>
              {`Turn on Floor plan to place each table where it stands and see who is on it during service.${tableReservationsOn ? "" : " It needs Table reservations."}`}
            </Text>
            {access.canSwitchFeatures ? (
              <Button
                label={setFeature.isPending ? "Turning on…" : "Turn on Floor plan"}
                variant="secondary"
                size="sm"
                onPress={turnOnFloor}
                disabled={setFeature.isPending}
                testID="venue-tables-floor-on"
              />
            ) : (
              <Text style={styles.hint}>Ask a brand owner or admin to turn it on in Settings.</Text>
            )}
            {featureError !== null ? <Text style={styles.error}>{featureError}</Text> : null}
          </View>
        </View>
      ) : null}

      {/* The non-floor table form (the floor editor carries its own). */}
      <Sheet
        visible={formFor !== null && !features.floorPlan}
        onClose={() => setFormFor(null)}
        snapPoint={0.9}
        presentation="panel"
        dismissGuard={() => formDirty}
        onRequestClose={() => setFormFor(null)}
        testID="venue-tables-sheet"
      >
        <View style={styles.sheetBody}>
          <PickerSheetHead title={formTable !== null ? formTable.name : "Add a table"} onClose={() => setFormFor(null)} testID="venue-tables-sheet-head" />
          <ScrollView style={styles.sheetScrollBox} contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
            {formFor !== null ? (
              <TableForm
                brandId={brandId}
                venueId={venueId}
                table={formTable}
                spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
                allTables={allTables}
                defaultSpaceId={selected?.id ?? null}
                defaultName={nextTableNameAfter(allTables.map((t) => t.name), (selected?.tables ?? [])[(selected?.tables ?? []).length - 1]?.name)}
                defaultLike={(selected?.tables ?? [])[(selected?.tables ?? []).length - 1] ?? null}
                currency={currency}
                features={features}
                canEdit={canEdit}
                onOpenSettings={onOpenSettings}
                onDirtyChange={setFormDirty}
                onCancel={() => setFormFor(null)}
                onSaved={(_t, message) => {
                  setFormFor(null);
                  setFormDirty(false);
                  onToast(message);
                }}
              />
            ) : null}
          </ScrollView>
        </View>
      </Sheet>
    </View>
  );
});

const styles = StyleSheet.create({
  host: { gap: space[4] },
  loading: { flexDirection: "row", gap: space[2], alignItems: "center", padding: space[4] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  listCard: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  listHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  title: { ...type.h2, color: color.text1 },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, paddingTop: space[2] },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { ...type.row, color: color.text1 },
  hint: { ...type.caption, color: color.text2 },
  error: { ...type.small, color: color.errorText },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 44 },
  floorOff: { gap: space[2], alignItems: "flex-start", marginTop: space[3], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  sheetBody: { flex: 1, paddingHorizontal: space[4] },
  sheetScrollBox: { flex: 1 },
  sheetScroll: { gap: space[3], paddingBottom: space[8] },
});
