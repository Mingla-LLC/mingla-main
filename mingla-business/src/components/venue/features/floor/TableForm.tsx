/**
 * #4490 P5-2 — one table's panel (`fl-edit` side card, the phone sheet and
 * Spaces › Tables): name, space, shape, seats, smallest party, minimum spend
 * (Minimum-spend tables), a hold per guest that comes off the bill, "Guests can
 * pick this table" (Pick a table), joins, step-free and walk-ins only.
 *
 * Smart fields only (steppers, money, chips, switches); free text is the name.
 * Saves through `issue_4490_manage_table`; refusals are plain words.
 */
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";

import { color, space, type } from "../../../../constants/designSystem";
import { useTouchFloor } from "../../../../hooks/useTouchFloor";
import { useManageVenueTable } from "../../../../hooks/useVenueTables";
import type { TableDepositMode, VenueFloorTable } from "../../../../services/venueFloorService";
import { BrandSwitch } from "../../../ui/BrandSwitch";
import { Button } from "../../../ui/Button";
import { Input } from "../../../ui/Input";
import { MoneyField } from "../../../ui/MoneyField";
import { NumberStepper, NumberStepperPair } from "../../../ui/NumberStepper";
import { Chip } from "../../../ui/Pill";
import { SelectSheet } from "../../../ui/SelectSheet";
import { floorErrorCopy, SHAPE_LABEL, TABLE_SHAPES } from "./floorModel";
import {
  tableDraftDirty,
  tableDraftFrom,
  tableDraftIssues,
  tableDraftValid,
  tableDepositModePatch,
  tableDepositShareMinor,
  tablePayload,
  type TableDraft,
} from "./tableDraft";

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});

const DEPOSIT_OPTIONS: ReadonlyArray<{ value: TableDepositMode; label: string }> = [
  { value: "venue_rule", label: "Your usual deposit rule" },
  { value: "per_guest", label: "Per guest" },
  { value: "per_table", label: "Per table" },
  { value: "min_spend_share", label: "Share of the minimum spend" },
];

export interface TableFormProps {
  brandId: string | null;
  venueId: string | null;
  /** null = a new table. */
  table: VenueFloorTable | null;
  spaces: ReadonlyArray<{ id: string; name: string }>;
  /** Every table at the venue (for joins and a free name). */
  allTables: readonly VenueFloorTable[];
  defaultSpaceId: string | null;
  defaultName?: string;
  /** #4490 N24: a new table starts like this one (shape and seats). */
  defaultLike?: Pick<VenueFloorTable, "shape" | "capacity"> | null;
  currency: string | null;
  /** `till`: the Till runs at this venue (VENUE_TILL and the venue's Sell in person), so a paid deposit comes off the bill there (spec 07 §11 B1, 08 O4 T12). */
  features: { minSpendTables: boolean; pickATable: boolean; floorPlan: boolean; till?: boolean };
  canEdit: boolean;
  onSaved: (table: VenueFloorTable | null, message: string) => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Settings › Venue type and features (to switch on Minimum-spend tables or Pick a table). */
  onOpenSettings?: () => void;
  testID?: string;
}

function SwitchRow({
  title,
  hint,
  value,
  onChange,
  disabled,
  testID,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  testID: string;
}): React.ReactElement {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text style={styles.switchTitle}>{title}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <BrandSwitch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={title} testID={testID} />
    </View>
  );
}

export function TableForm({
  brandId,
  venueId,
  table,
  spaces,
  allTables,
  defaultSpaceId,
  defaultName,
  defaultLike = null,
  currency,
  features,
  canEdit,
  onSaved,
  onCancel,
  onDirtyChange,
  onOpenSettings,
  testID = "table-form",
}: TableFormProps): React.ReactElement {
  const touch = useTouchFloor();
  const manage = useManageVenueTable(brandId, venueId);
  const defaults = useMemo(
    () => ({ spaceId: defaultSpaceId, name: defaultName, like: defaultLike }),
    [defaultSpaceId, defaultName, defaultLike],
  );
  const [draft, setDraft] = useState<TableDraft>(() => tableDraftFrom(table, defaults));
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // A different table (or the same one reloaded after a save) starts afresh.
  const tableKey = table === null ? `new:${defaultSpaceId ?? ""}` : `${table.id}`;
  useEffect(() => {
    setDraft(tableDraftFrom(table, defaults));
    setShowErrors(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey]);

  const dirty = tableDraftDirty(draft, table, defaults);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const issues = tableDraftIssues(draft);
  const shareReady = features.minSpendTables && (draft.minSpendMinor ?? 0) > 0;
  const shareMinor = tableDepositShareMinor(draft.minSpendMinor, draft.holdShareBps);
  const patch = (next: Partial<TableDraft>): void => {
    setDraft((d) => ({ ...d, ...next }));
    setError(null);
  };

  const joinCandidates = allTables.filter(
    (t) => t.id !== table?.id && t.spaceId !== null && t.spaceId === draft.spaceId && t.combinable,
  );

  const save = (): void => {
    if (!canEdit || manage.isPending) return;
    setShowErrors(true);
    if (!tableDraftValid(draft)) return;
    const fields = tablePayload(draft, table, { minSpendOn: features.minSpendTables });
    if (table !== null && Object.keys(fields).length === 0) {
      onSaved(table, "Nothing changed");
      return;
    }
    manage.mutate(
      table === null ? { action: "create", fields } : { action: "update", tableId: table.id, fields },
      {
        onSuccess: (saved) => onSaved(saved, table === null ? `${draft.name.trim()} added` : `${draft.name.trim()} saved`),
        onError: (e) => setError(floorErrorCopy(e.code)),
      },
    );
  };

  const remove = (): void => {
    if (table === null) return;
    setRemoveError(null);
    manage.mutate(
      { action: "archive", tableId: table.id },
      {
        onSuccess: () => {
          setConfirmRemove(false);
          onSaved(null, `${table.name} removed`);
        },
        onError: (e) => setRemoveError(floorErrorCopy(e.code)),
      },
    );
  };

  return (
    <View style={styles.host} testID={testID}>
      <Text style={styles.label} nativeID={`${testID}-name-label`}>Name</Text>
      <Input
        value={draft.name}
        onChangeText={(name) => patch({ name: name.slice(0, 60) })}
        placeholder="B1"
        accessibilityLabel="Table name"
        disabled={!canEdit}
        error={showErrors ? issues.name : null}
        testID={`${testID}-name`}
      />
      <SelectSheet
        label="Space"
        value={draft.spaceId}
        options={spaces.map((s) => ({ value: s.id, label: s.name }))}
        onChange={(spaceId) => patch({ spaceId, joinsWith: [] })}
        placeholder="Pick a space"
        disabled={!canEdit || spaces.length === 0}
        hasError={showErrors && issues.space !== null}
        testID={`${testID}-space`}
      />
      {showErrors && issues.space !== null ? <Text style={styles.error}>{issues.space}</Text> : null}

      <Text style={styles.label}>Shape</Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Shape">
        {TABLE_SHAPES.map((shape) => (
          <Chip
            key={shape}
            label={SHAPE_LABEL[shape]}
            selected={draft.shape === shape}
            onPress={canEdit ? () => patch({ shape }) : undefined}
            style={touch > 0 ? { minHeight: touch } : undefined}
            testID={`${testID}-shape-${shape}`}
          />
        ))}
      </View>

      <NumberStepperPair>
        <NumberStepper
          label="Seats"
          value={draft.capacity}
          min={1}
          max={100}
          onChange={(capacity) => patch({ capacity, minParty: Math.min(draft.minParty, capacity) })}
          testID={`${testID}-seats`}
        />
        <NumberStepper
          label="Smallest party"
          value={draft.minParty}
          min={1}
          max={draft.capacity}
          onChange={(minParty) => patch({ minParty })}
          testID={`${testID}-min-party`}
        />
      </NumberStepperPair>
      {showErrors && issues.minParty !== null ? <Text style={styles.error}>{issues.minParty}</Text> : null}

      <Text style={styles.section}>Money</Text>
      {features.minSpendTables ? (
        <>
          <MoneyField
            label="Minimum spend"
            valueMinor={draft.minSpendMinor}
            onChangeMinor={(minSpendMinor) => patch({ minSpendMinor })}
            currency={currency}
            disabled={!canEdit}
            testID={`${testID}-min-spend`}
          />
          <Text style={styles.hint}>What the table spends on food and drinks. Leave empty for none.</Text>
        </>
      ) : (
        <View style={styles.offLine}>
          <Text style={styles.hint}>Turn on Minimum-spend tables in Settings to set a minimum spend.</Text>
          {onOpenSettings !== undefined ? (
            <Button label="Open Settings" variant="secondary" size="sm" onPress={onOpenSettings} testID={`${testID}-open-settings-min`} />
          ) : null}
        </View>
      )}
      <SelectSheet<TableDepositMode>
        label="Deposit to book this table"
        value={draft.depositMode}
        options={DEPOSIT_OPTIONS.map((option) =>
          option.value === "min_spend_share"
            ? {
                ...option,
                disabled: !shareReady,
                helper: !shareReady ? "Turn on Minimum spend tables and set a minimum spend first." : undefined,
              }
            : option,
        )}
        onChange={(depositMode) =>
          patch(tableDepositModePatch(draft, depositMode))
        }
        disabled={!canEdit}
        hasError={showErrors && issues.hold !== null}
        testID={`${testID}-deposit-mode`}
      />
      {draft.depositMode === "per_guest" ? (
        <MoneyField
          label="Per guest"
          valueMinor={draft.holdPerGuestMinor}
          onChangeMinor={(holdPerGuestMinor) => patch({ holdPerGuestMinor })}
          currency={currency}
          disabled={!canEdit}
          error={showErrors ? issues.hold : null}
          testID={`${testID}-hold`}
        />
      ) : draft.depositMode === "per_table" ? (
        <MoneyField
          label="Per table"
          valueMinor={draft.holdPerTableMinor}
          onChangeMinor={(holdPerTableMinor) => patch({ holdPerTableMinor })}
          currency={currency}
          disabled={!canEdit}
          error={showErrors ? issues.hold : null}
          testID={`${testID}-hold-table`}
        />
      ) : draft.depositMode === "min_spend_share" ? (
        <View style={styles.depositShare}>
          <NumberStepper
            label="Share of the minimum spend (%)"
            value={(draft.holdShareBps ?? 500) / 100}
            min={5}
            max={100}
            step={5}
            onChange={(percent) => patch({ holdShareBps: Math.round(percent / 5) * 500 })}
            testID={`${testID}-hold-share`}
          />
          {shareMinor !== null ? (
            <Text style={styles.depositTotal}>{`= ${formatVenueMoney(shareMinor, currency ?? "NGN", 2)} to hold`}</Text>
          ) : null}
          {showErrors && issues.hold !== null ? <Text style={styles.error}>{issues.hold}</Text> : null}
        </View>
      ) : null}
      {/* Spec 07 §11 B1: the short hint is true only where the Till credits the deposit (08 O4 T12). */}
      <Text style={styles.hint}>{features.till === true ? "Comes off their bill." : "Paid when they book. Take it off their bill at the venue."}</Text>

      <Text style={styles.section}>Booking</Text>
      {features.pickATable ? (
        <SwitchRow
          title="Guests can pick this table"
          hint="It shows on your booking page's table map."
          value={draft.guestPickable}
          onChange={(guestPickable) => patch({ guestPickable })}
          disabled={!canEdit}
          testID={`${testID}-pickable`}
        />
      ) : (
        <View style={styles.offLine}>
          <Text style={styles.hint}>Turn on Pick a table in Settings to let guests choose their own table.</Text>
          {onOpenSettings !== undefined ? (
            <Button label="Open Settings" variant="secondary" size="sm" onPress={onOpenSettings} testID={`${testID}-open-settings-pick`} />
          ) : null}
        </View>
      )}
      <SwitchRow
        title="Walk-ins only"
        hint="Keep it for guests who turn up. It can't be booked online."
        value={draft.walkInOnly}
        onChange={(walkInOnly) => patch({ walkInOnly })}
        disabled={!canEdit}
        testID={`${testID}-walk-in`}
      />
      <SwitchRow
        title="Step-free"
        hint="Guests can reach it without stairs."
        value={draft.accessible}
        onChange={(accessible) => patch({ accessible })}
        disabled={!canEdit}
        testID={`${testID}-accessible`}
      />
      <SwitchRow
        title="Can be joined"
        hint="Push it together with another table for a bigger party."
        value={draft.combinable}
        onChange={(combinable) => patch({ combinable, joinsWith: combinable ? draft.joinsWith : [] })}
        disabled={!canEdit}
        testID={`${testID}-combinable`}
      />
      {draft.combinable ? (
        <View style={styles.joins}>
          <Text style={styles.label}>Joins with</Text>
          {joinCandidates.length === 0 ? (
            <Text style={styles.hint}>
              No other table in this space can be joined yet. Switch on ‘Can be joined’ on the table next to it.
            </Text>
          ) : (
            <View style={styles.chips} accessibilityLabel="Joins with">
              {joinCandidates.map((t) => {
                const on = draft.joinsWith.includes(t.id);
                return (
                  <Chip
                    key={t.id}
                    label={`${t.name} · ${t.capacity}`}
                    selected={on}
                    onPress={
                      canEdit
                        ? () =>
                            patch({
                              joinsWith: on ? draft.joinsWith.filter((x) => x !== t.id) : [...draft.joinsWith, t.id].slice(0, 8),
                            })
                        : undefined
                    }
                    style={touch > 0 ? { minHeight: touch } : undefined}
                    testID={`${testID}-join-${t.id}`}
                  />
                );
              })}
            </View>
          )}
          {draft.joinsWith.length > 0 ? (
            <Text style={styles.hint}>
              {`Together they seat ${draft.capacity + joinCandidates.filter((t) => draft.joinsWith.includes(t.id)).reduce((m, t) => Math.max(m, t.capacity), 0)} at most (one pair at a time).`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {error !== null ? (
        <Text style={styles.error} accessibilityRole="alert" testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
      {canEdit ? (
        <View style={styles.actions}>
          {onCancel !== undefined ? <Button label="Cancel" variant="secondary" size="md" onPress={onCancel} testID={`${testID}-cancel`} /> : null}
          <Button
            label={table === null ? "Add table" : "Save table"}
            variant="primary"
            size="md"
            onPress={save}
            loading={manage.isPending && !confirmRemove}
            disabled={manage.isPending}
            testID={`${testID}-save`}
          />
        </View>
      ) : (
        <Text style={styles.hint}>Ask a brand owner, admin or a reservations manager to change tables.</Text>
      )}
      {canEdit && table !== null ? (
        <Button label="Remove table" variant="ghost" size="sm" onPress={() => setConfirmRemove(true)} testID={`${testID}-remove`} />
      ) : null}
      {confirmRemove && table !== null ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            onClose={() => setConfirmRemove(false)}
            onConfirm={remove}
            title={`Remove ${table.name}?`}
            description="Bookings already on it keep their table in your records. Guests can't book it again."
            confirmLabel="Remove table"
            destructive
            confirmLoading={manage.isPending}
            errorMessage={removeError}
            testID={`${testID}-remove-confirm`}
          />
        </React.Suspense>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[3] },
  label: { ...type.label, color: color.text2 },
  section: { ...type.row, color: color.text1, marginTop: space[2] },
  hint: { ...type.caption, color: color.text2 },
  error: { ...type.small, color: color.errorText },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  steppers: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  stepper: { flexGrow: 1, flexBasis: 220 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 44 },
  switchText: { flex: 1, gap: 2 },
  switchTitle: { ...type.row, color: color.text1 },
  offLine: { gap: space[2], alignItems: "flex-start" },
  depositShare: { gap: space[1] },
  depositTotal: { ...type.row, color: color.text1 },
  joins: { gap: space[2] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2], justifyContent: "flex-end", marginTop: space[2] },
});
