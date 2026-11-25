/**
 * #4490 P1-8 — add or edit one space (`sp-panel`). A right-side inspector on
 * wide web, a bottom sheet on phones. Every count is a stepper, the setting is
 * three chips, and the only free text is the name and the list of what is in
 * the space. Delete asks once and names what goes with it.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  OTHER_VENUE_LAYOUTS,
  type OtherVenueLayout,
} from "@mingla/brand-rendering/venueOffers/layoutModel";

import { color, space, type } from "../../../constants/designSystem";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";
import type {
  SpaceDraft,
  SpaceSetting,
  VenueSpace,
  VenueSpaceCombination,
} from "../../../services/venueFeaturesService";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { BrandSwitch } from "../../ui/BrandSwitch";
import { Button } from "../../ui/Button";
import { ChipInput } from "../../ui/ChipInput";
import { Input } from "../../ui/Input";
import { NumberStepper } from "../../ui/NumberStepper";
import { Segmented } from "../../ui/Pill";
import { SelectSheet } from "../../ui/SelectSheet";
import { Sheet } from "../../ui/Sheet";
import { PickerSheetHead } from "../../ui/PickerSheetHead";
import { spaceDraftIssues, starterSetting } from "./spaceModel";

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});

const SETTING_OPTIONS: ReadonlyArray<{ key: SpaceSetting; label: string }> = [
  { key: "indoor", label: "Indoor" },
  { key: "covered", label: "Covered" },
  { key: "outdoor", label: "Outdoor" },
];

const CAPACITY_MAX = 100_000;

export function emptySpaceDraft(name = "", hireOn = true): SpaceDraft {
  return {
    name,
    // #4490 D14 — "Outdoor area" / "Rooftop" start outdoor.
    setting: starterSetting(name),
    capacityStanding: null,
    capacitySeated: null,
    layouts: [],
    photos: [],
    // #4490 N57: only starts "can be hired" when Private hire is on.
    canBeHired: hireOn,
    stepFree: null,
    amenities: [],
  };
}

function draftFromSpace(spaceRow: VenueSpace): SpaceDraft {
  return {
    name: spaceRow.name,
    setting: spaceRow.setting,
    capacityStanding: spaceRow.capacityStanding,
    capacitySeated: spaceRow.capacitySeated,
    layouts: spaceRow.layouts.map((layout) => ({ ...layout })),
    photos: spaceRow.photos,
    canBeHired: spaceRow.canBeHired,
    stepFree: spaceRow.stepFree,
    amenities: spaceRow.amenities,
  };
}

export interface SpaceEditorSheetProps {
  visible: boolean;
  /** null = a new space. */
  space: VenueSpace | null;
  /** Prefilled name for a starter ("Main floor"). */
  initialName?: string;
  combinations: readonly VenueSpaceCombination[];
  /** Label for the amenities list ("Games here" at a play venue). */
  amenitiesLabel: string;
  /** #4490 N18: examples that fit the venue's type. */
  amenitiesPlaceholder?: string;
  /** #4490 N57: whether Private hire is on (a new space starts hireable only then). */
  hireOn?: boolean;
  canEdit: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  onSave: (draft: SpaceDraft) => void;
  onDelete: () => void;
  onClose: () => void;
  onCombine: () => void;
}

export function SpaceEditorSheet({
  visible,
  space: spaceRow,
  initialName = "",
  combinations,
  amenitiesLabel,
  amenitiesPlaceholder = "What guests will find here…",
  hireOn = true,
  canEdit,
  saving,
  deleting,
  error,
  onSave,
  onDelete,
  onClose,
  onCombine,
}: SpaceEditorSheetProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const baseline = useMemo(
    () => (spaceRow !== null ? draftFromSpace(spaceRow) : emptySpaceDraft(initialName, hireOn)),
    [hireOn, initialName, spaceRow],
  );
  const [draft, setDraft] = useState<SpaceDraft>(baseline);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  useEffect(() => {
    if (!visible) {
      setConfirmDelete(false);
      setLeaveOpen(false);
      return;
    }
    setDraft(baseline);
    setShowErrors(false);
  }, [baseline, visible]);

  const issues = spaceDraftIssues(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const busy = saving || deleting;
  const partOf = spaceRow === null
    ? []
    : combinations.filter((combo) => combo.spaceIds.includes(spaceRow.id));

  const patch = useCallback((next: Partial<SpaceDraft>) => {
    setDraft((prev) => ({ ...prev, ...next }));
  }, []);

  const handleSave = useCallback((): void => {
    setShowErrors(true);
    if (issues.name !== null || issues.capacity !== null || issues.layouts !== null || !canEdit) return;
    onSave(draft);
  }, [canEdit, draft, issues.capacity, issues.layouts, issues.name, onSave]);

  const handleClose = useCallback((): void => {
    if (busy) return;
    if (dirty && canEdit) {
      setLeaveOpen(true);
      return;
    }
    onClose();
  }, [busy, canEdit, dirty, onClose]);

  const footer = (
    <View style={styles.footer}>
      {error !== null ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID="space-editor-error">
          {error}
        </Text>
      ) : showErrors && (issues.name !== null || issues.capacity !== null || issues.layouts !== null) ? (
        // #4490 D19 — a refused Save always says why beside the button, even
        // when the fields with errors are scrolled out of view.
        <Text style={styles.error} accessibilityLiveRegion="polite" testID="space-editor-issues">
          {[issues.name !== null ? "Add a name" : null, issues.capacity !== null ? "set how many it fits" : null, issues.layouts !== null ? "check the other layouts" : null]
            .filter((part): part is string => part !== null)
            .join(" and ")
            .replace(/^./, (c) => c.toUpperCase())}
          , then save.
        </Text>
      ) : null}
      <View style={styles.footerRow}>
        {spaceRow !== null && canEdit ? (
          <Button
            label="Delete"
            variant="ghost"
            size="md"
            onPress={() => setConfirmDelete(true)}
            disabled={busy}
            testID="space-editor-delete"
          />
        ) : (
          <Button label="Cancel" variant="ghost" size="md" onPress={handleClose} disabled={busy} />
        )}
        {canEdit ? (
          <Button
            label={spaceRow === null ? "Add space" : "Save"}
            variant="primary"
            size="md"
            onPress={handleSave}
            loading={saving}
            disabled={busy}
            testID="space-editor-save"
          />
        ) : null}
      </View>
    </View>
  );

  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      snapPoint={0.9}
      presentation={isWideDesktop ? "panel" : undefined}
      dismissDisabled={busy}
      dismissGuard={() => dirty && canEdit && !busy}
      onRequestClose={handleClose}
      testID="space-editor-sheet"
    >
      <View style={styles.body}>
        <PickerSheetHead title={spaceRow === null ? "Add a space" : spaceRow.name} onClose={handleClose} plain={isWideDesktop} testID="space-editor-head" />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* #4490 D18 — a visible label, not a placeholder alone. */}
          <Text style={styles.fieldLabel} nativeID="space-editor-name-label">Name</Text>
          <Input
            value={draft.name}
            onChangeText={(name) => patch({ name: name.slice(0, 80) })}
            placeholder="The Lounge Side"
            accessibilityLabel="Space name"
            disabled={!canEdit}
            error={showErrors ? issues.name : null}
            testID="space-editor-name"
          />
          <Text style={styles.label}>Setting</Text>
          <Segmented
            options={SETTING_OPTIONS}
            value={draft.setting}
            onChange={(setting) => canEdit && patch({ setting })}
            accessibilityLabel="Setting"
            testID="space-editor-setting"
          />
          <Text style={styles.label}>How many it fits</Text>
          <Text style={styles.hint}>Standing and seated are different numbers. Set at least one.</Text>
          <View style={styles.steppers}>
            <View style={styles.stepper}>
              <NumberStepper
                label="Standing"
                value={draft.capacityStanding ?? 0}
                min={0}
                max={CAPACITY_MAX}
                onChange={(n) => patch({ capacityStanding: n > 0 ? n : null })}
                testID="space-editor-standing"
              />
            </View>
            <View style={styles.stepper}>
              <NumberStepper
                label="Seated"
                value={draft.capacitySeated ?? 0}
                min={0}
                max={CAPACITY_MAX}
                onChange={(n) => patch({ capacitySeated: n > 0 ? n : null })}
                testID="space-editor-seated"
              />
            </View>
          </View>
          {showErrors && issues.capacity !== null ? (
            <Text style={styles.error} testID="space-editor-capacity-error">{issues.capacity}</Text>
          ) : null}

          <View style={styles.layouts} testID="space-editor-layouts">
            <View style={styles.layoutHead}>
              <View style={styles.switchText}>
                <Text style={styles.switchTitle}>Other layouts</Text>
                <Text style={styles.hint}>Add the room setups you offer and how many each holds.</Text>
              </View>
              {canEdit && draft.layouts.length < OTHER_VENUE_LAYOUTS.length ? (
                <Button
                  label="Add a layout"
                  variant="ghost"
                  size="sm"
                  leadingIcon="plus"
                  onPress={() => {
                    const used = new Set(draft.layouts.map((row) => row.layout));
                    const next = OTHER_VENUE_LAYOUTS.find((row) => !used.has(row.key));
                    if (next !== undefined) patch({ layouts: [...draft.layouts, { layout: next.key, capacity: 1 }] });
                  }}
                  testID="space-editor-layout-add"
                />
              ) : null}
            </View>
            {draft.layouts.map((row, index) => {
              const used = new Set(draft.layouts.map((value) => value.layout));
              const options = OTHER_VENUE_LAYOUTS.map((option) => ({
                value: option.key,
                label: option.label,
                disabled: option.key !== row.layout && used.has(option.key),
              }));
              const replace = (next: Partial<{ layout: OtherVenueLayout; capacity: number }>): void =>
                patch({ layouts: draft.layouts.map((value, i) => (i === index ? { ...value, ...next } : value)) });
              return (
                <View key={`${row.layout}-${index}`} style={styles.layoutRow} testID={`space-editor-layout-${index}`}>
                  <SelectSheet
                    label="Layout"
                    value={row.layout}
                    options={options}
                    onChange={(layout) => replace({ layout })}
                    disabled={!canEdit}
                    testID={`space-editor-layout-${index}-select`}
                  />
                  <View style={styles.layoutCapacity}>
                    <NumberStepper
                      label="Capacity"
                      value={row.capacity}
                      min={1}
                      max={CAPACITY_MAX}
                      onChange={(capacity) => canEdit && replace({ capacity })}
                      testID={`space-editor-layout-${index}-capacity`}
                    />
                  </View>
                  {canEdit ? (
                    <Button
                      label="Remove"
                      variant="ghost"
                      size="sm"
                      onPress={() => patch({ layouts: draft.layouts.filter((_value, i) => i !== index) })}
                      testID={`space-editor-layout-${index}-remove`}
                    />
                  ) : null}
                </View>
              );
            })}
            {showErrors && issues.layouts !== null ? <Text style={styles.error}>{issues.layouts}</Text> : null}
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Can be hired privately</Text>
              <Text style={styles.hint}>Offer this space on its own for private hire.</Text>
            </View>
            <BrandSwitch
              value={draft.canBeHired}
              onValueChange={(canBeHired) => patch({ canBeHired })}
              disabled={!canEdit}
              accessibilityLabel="Can be hired privately"
              testID="space-editor-hire"
            />
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Step-free access</Text>
              <Text style={styles.hint}>Guests can reach it without stairs.</Text>
            </View>
            <BrandSwitch
              value={draft.stepFree === true}
              onValueChange={(stepFree) => patch({ stepFree })}
              disabled={!canEdit}
              accessibilityLabel="Step-free access"
              testID="space-editor-step-free"
            />
          </View>

          <ChipInput
            label={amenitiesLabel}
            helper="Type one and press enter. Up to 20."
            values={draft.amenities}
            onChange={(amenities) => patch({ amenities: amenities.slice(0, 20).map((a) => a.slice(0, 40)) })}
            placeholder={amenitiesPlaceholder}
            editable={canEdit}
            testID="space-editor-amenities"
          />

          {spaceRow !== null ? (
            <View style={styles.combines}>
              <Text style={styles.label}>Combines with</Text>
              {partOf.length === 0 ? (
                <Text style={styles.hint}>Not part of a combination.</Text>
              ) : (
                partOf.map((combo) => (
                  <Text key={combo.id} style={styles.comboLine}>
                    {combo.name} · hiring it blocks this space
                  </Text>
                ))
              )}
              {canEdit ? (
                <Button
                  label="Combine spaces"
                  variant="secondary"
                  size="sm"
                  leadingIcon="link"
                  onPress={onCombine}
                  disabled={busy}
                  style={styles.combineBtn}
                  testID="space-editor-combine"
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
        {footer}
      </View>

      {confirmDelete && spaceRow !== null ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            onClose={() => {
              if (!deleting) setConfirmDelete(false);
            }}
            title={`Delete ${spaceRow.name}?`}
            description={
              partOf.length > 0
                ? `${partOf.map((c) => c.name).join(" and ")} will be removed too. Events linked to this space keep their venue.`
                : "Events linked to this space keep their venue. You can add the space again later."
            }
            confirmLabel="Delete space"
            cancelLabel="Keep it"
            destructive
            confirmLoading={deleting}
            closeDisabled={deleting}
            onConfirm={() => {
              setConfirmDelete(false);
              onDelete();
            }}
            testID="space-editor-delete-confirm"
          />
        </React.Suspense>
      ) : null}
      {leaveOpen ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            variant="leave"
            title={spaceRow === null ? "Save this new space?" : "Save your space changes?"}
            description={
              spaceRow === null
                ? "This space has not been saved yet. If you leave, it will be discarded."
                : "You changed this space. If you leave without saving, those changes are gone."
            }
            onClose={() => setLeaveOpen(false)}
            onConfirm={() => {
              setLeaveOpen(false);
              onClose();
            }}
            onDiscard={() => {
              setLeaveOpen(false);
              onClose();
            }}
            onSave={async () => {
              setLeaveOpen(false);
              handleSave();
            }}
            saveDisabled={issues.name !== null || issues.capacity !== null || issues.layouts !== null}
            saveTestID="space-editor-leave-save"
            discardTestID="space-editor-leave-discard"
            keepTestID="space-editor-leave-keep"
            testID="space-editor-leave-dialog"
          />
        </React.Suspense>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2] },
  heading: { ...type.h1, color: color.text1, marginBottom: space[2] },
  scroll: { flex: 1 },
  // #4490 D16 — room below the last field so it scrolls fully clear of the
  // sticky footer.
  scrollContent: { gap: space[2], paddingBottom: space[10] },
  fieldLabel: { ...type.small, color: color.text2 },
  label: { ...type.small, color: color.text2, marginTop: space[2] },
  hint: { ...type.caption, color: color.text3 },
  // One stepper per row: a 400 inspector cannot fit two typeable steppers
  // side by side without scrolling sideways.
  steppers: { gap: space[2] },
  stepper: { alignSelf: "stretch" },
  layouts: { gap: space[2], marginTop: space[2] },
  layoutHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" },
  layoutRow: { gap: space[2], paddingVertical: space[2] },
  layoutCapacity: { alignSelf: "stretch" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingVertical: space[2],
  },
  switchText: { flex: 1, minWidth: 0, gap: 2 },
  switchTitle: { ...type.row, color: color.text1 },
  combines: { gap: space[1] },
  comboLine: { ...type.small, color: color.text1 },
  combineBtn: { alignSelf: "flex-start", marginTop: space[1] },
  footer: {
    gap: space[2],
    paddingTop: space[3],
    paddingBottom: space[4],
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[2] },
  error: { ...type.caption, color: color.errorText },
});
