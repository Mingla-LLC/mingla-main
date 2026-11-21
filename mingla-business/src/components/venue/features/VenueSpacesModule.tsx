/**
 * #4490 P1-8 — Spaces (`sp`, `sp-panel`, `sp-site`, `sp-empty`, `ph-site`).
 *
 * The rooms, floors, lawns and areas of a venue, what each fits, and which are
 * hired together. List and Site plan views; add, edit, combine, delete. Every
 * write goes through `issue_4490_manage_space(_combination)`. States: loading
 * (skeleton rows), error (Try again), empty (first space + one-tap starters),
 * saved (toast). Arranging the site plan is wide web only; phones keep the list.
 */
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";
import { useVenueEditAccess } from "../../../hooks/useVenueEditAccess";
import { useVenueFeatures } from "../../../hooks/useVenueFeatures";
import { useVenueListing } from "../../../hooks/useVenueListings";
import {
  useManageSpaceCombination,
  useManageVenueSpace,
  useVenueSpaceCombinations,
  useVenueSpaces,
} from "../../../hooks/useVenueSpaces";
import {
  VenueFeatureError,
  updateVenueSpace,
  type SpaceDraft,
  type SpacePlanShape,
  type VenueSpace,
  type VenueSpaceCombination,
} from "../../../services/venueFeaturesService";
import { Button } from "../../ui/Button";
import { CenteredState } from "../../ui/CenteredState";
import { Chip, Pill, Segmented } from "../../ui/Pill";
import { GlassCard } from "../../ui/GlassCard";
import { Skeleton } from "../../ui/Skeleton";
import { combinationCapacity, spaceFitsLabel } from "../../ui/SpacePicker";
import { CombineSpacesSheet } from "./CombineSpacesSheet";
import { SitePlan, SitePlanLegend } from "./SitePlan";
import { SpaceEditorSheet } from "./SpaceEditorSheet";
import { autoPlanShapes, changedShapes, spaceUsedFor } from "./spaceModel";
import { VENUE_FEATURES_COPY, amenityExamplesFor, spaceStartersFor, venueWriteErrorCopy } from "./venueFeaturesCopy";
import { VenueTablesInSpaces } from "./floor/VenueTablesInSpaces";
import type { VenueModuleLeaveHandle } from "../venueLeaveContract";

const LazyToast = React.lazy(async () => {
  const mod = await import("../../ui/Toast");
  return { default: mod.Toast };
});

const SETTING_LABEL: Record<VenueSpace["setting"], string> = {
  indoor: "Indoor",
  covered: "Covered",
  outdoor: "Outdoor",
};

function errorCopy(context: "space" | "combination", error: unknown): string {
  const e = error instanceof VenueFeatureError ? error : null;
  return venueWriteErrorCopy(context, e?.code ?? "unknown", e?.detail ?? null);
}

export interface VenueSpacesModuleProps {
  brandId: string | null;
  venueId: string | null;
  /** #4490 P5 — `?module=tables` (and Spaces › Tables) opens the tables view. */
  initialView?: "list" | "site" | "tables";
  initialSpaceId?: string | null;
  /** Settings (feature switches) — the tables view links there. */
  onOpenSettings?: () => void;
}

type EditorState =
  | { open: false }
  | { open: true; space: VenueSpace | null; initialName: string };

export const VenueSpacesModule = forwardRef<VenueModuleLeaveHandle, VenueSpacesModuleProps>(function VenueSpacesModule(
  { brandId, venueId, initialView, initialSpaceId = null, onOpenSettings },
  ref,
): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const spacesQuery = useVenueSpaces(brandId, venueId);
  const combosQuery = useVenueSpaceCombinations(brandId, venueId);
  const featuresQuery = useVenueFeatures(brandId, venueId);
  const venueQuery = useVenueListing(venueId);
  const access = useVenueEditAccess(brandId, venueId);
  const manageSpace = useManageVenueSpace(brandId, venueId);
  const manageCombo = useManageSpaceCombination(brandId, venueId);

  // #4490 P5 — scoped reservations staff manage tables but not spaces: Tables first.
  const [view, setView] = useState<"list" | "site" | "tables">(
    initialView ?? (!access.canEditSpaces && access.canManageTables ? "tables" : "list"),
  );
  const tablesRef = useRef<VenueModuleLeaveHandle | null>(null);
  useImperativeHandle(
    ref,
    (): VenueModuleLeaveHandle => ({
      isDirty: () => tablesRef.current?.isDirty() ?? false,
      changedLabels: () => tablesRef.current?.changedLabels() ?? [],
      isValid: () => tablesRef.current?.isValid() ?? true,
      save: async () => {
        await tablesRef.current?.save();
      },
      discard: () => tablesRef.current?.discard(),
    }),
  );
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [editorError, setEditorError] = useState<string | null>(null);
  const [comboSheet, setComboSheet] = useState<{ open: boolean; combination: VenueSpaceCombination | null }>({
    open: false,
    combination: null,
  });
  const [comboError, setComboError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const [arrangeShapes, setArrangeShapes] = useState<Record<string, SpacePlanShape>>({});
  const [arrangeSaving, setArrangeSaving] = useState(false);
  const [arrangeError, setArrangeError] = useState<string | null>(null);

  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const combinations = useMemo(() => combosQuery.data ?? [], [combosQuery.data]);
  const features = featuresQuery.data?.features ?? null;
  // #4490 P5 (reconciliation 35) — tables live in spaces.
  const showTablesView = features?.table_reservations.enabled === true || initialView === "tables" || view === "tables";
  const amenitiesLabel = venueQuery.data?.venueCategory === "play" ? "Games here" : "What's here";
  const canEdit = access.canEditSpaces;

  const openNew = useCallback((initialName = ""): void => {
    setEditorError(null);
    setEditor({ open: true, space: null, initialName });
  }, []);
  const openSpace = useCallback((spaceRow: VenueSpace): void => {
    setEditorError(null);
    setEditor({ open: true, space: spaceRow, initialName: "" });
  }, []);
  const openCombine = useCallback((combination: VenueSpaceCombination | null = null): void => {
    setComboError(null);
    setComboSheet({ open: true, combination });
  }, []);

  const handleSaveSpace = useCallback(
    (draft: SpaceDraft): void => {
      if (!editor.open) return;
      setEditorError(null);
      const editing = editor.space;
      const onError = (error: unknown): void => setEditorError(errorCopy("space", error));
      if (editing === null) {
        manageSpace.mutate(
          { action: "create", draft },
          {
            onSuccess: () => {
              setEditor({ open: false });
              setToast(`${draft.name.trim()} added`);
            },
            onError,
          },
        );
      } else {
        manageSpace.mutate(
          {
            action: "update",
            spaceId: editing.id,
            expectedVersion: editing.version,
            patch: {
              name: draft.name.trim(),
              setting: draft.setting,
              capacity_standing: draft.capacityStanding,
              capacity_seated: draft.capacitySeated,
              layouts: draft.layouts.map(({ layout, capacity }) => ({ layout, capacity })),
              can_be_hired: draft.canBeHired,
              step_free: draft.stepFree,
              amenities: draft.amenities,
            },
          },
          {
            onSuccess: () => {
              setEditor({ open: false });
              setToast(VENUE_FEATURES_COPY.saved);
            },
            onError,
          },
        );
      }
    },
    [editor, manageSpace],
  );

  const handleDeleteSpace = useCallback((): void => {
    if (!editor.open || editor.space === null) return;
    const target = editor.space;
    manageSpace.mutate(
      { action: "archive", spaceId: target.id, expectedVersion: target.version },
      {
        onSuccess: () => {
          setEditor({ open: false });
          setToast(`${target.name} deleted`);
        },
        onError: (error) => setEditorError(errorCopy("space", error)),
      },
    );
  }, [editor, manageSpace]);

  const handleSaveCombo = useCallback(
    (input: { name: string; spaceIds: string[] }): void => {
      setComboError(null);
      const existing = comboSheet.combination;
      manageCombo.mutate(
        existing === null
          ? { action: "create", name: input.name, spaceIds: input.spaceIds }
          : {
              action: "update",
              id: existing.id,
              name: input.name,
              spaceIds: input.spaceIds,
              expectedVersion: existing.version,
            },
        {
          onSuccess: () => {
            setComboSheet({ open: false, combination: null });
            setToast(existing === null ? `${input.name} combined` : VENUE_FEATURES_COPY.saved);
          },
          onError: (error) => setComboError(errorCopy("combination", error)),
        },
      );
    },
    [comboSheet.combination, manageCombo],
  );

  const handleRemoveCombo = useCallback((): void => {
    const existing = comboSheet.combination;
    if (existing === null) return;
    manageCombo.mutate(
      { action: "archive", id: existing.id, expectedVersion: existing.version },
      {
        onSuccess: () => {
          setComboSheet({ open: false, combination: null });
          setToast(`${existing.name} removed`);
        },
        onError: (error) => setComboError(errorCopy("combination", error)),
      },
    );
  }, [comboSheet.combination, manageCombo]);

  const startArrange = useCallback((): void => {
    setArrangeError(null);
    setArrangeShapes(autoPlanShapes(spaces));
    setArranging(true);
  }, [spaces]);

  const saveArrange = useCallback(async (): Promise<void> => {
    if (venueId === null) return;
    setArrangeSaving(true);
    setArrangeError(null);
    try {
      for (const { space: target, shape } of changedShapes(spaces, arrangeShapes)) {
        // #4490 P5 — keep the floor plan's room that lives beside the site rectangle.
        const planShape = target.planRoom !== null && target.planRoom !== undefined ? { ...shape, room: target.planRoom } : shape;
        await updateVenueSpace(venueId, target.id, { plan_shape: planShape }, target.version);
      }
      setArranging(false);
      setToast("Layout saved");
    } catch (error) {
      setArrangeError(errorCopy("space", error));
    } finally {
      setArrangeSaving(false);
      void spacesQuery.refetch();
    }
  }, [arrangeShapes, spaces, spacesQuery, venueId]);

  const viewShapes = useMemo(() => {
    if (arranging) return arrangeShapes;
    const out: Record<string, SpacePlanShape> = {};
    for (const s of spaces) if (s.planShape !== null) out[s.id] = s.planShape;
    return out;
  }, [arrangeShapes, arranging, spaces]);
  const hasPlan = Object.keys(viewShapes).length > 0;
  const selected = spaces.find((s) => s.id === selectedId) ?? null;

  // ---------------------------------------------------------------- states
  if (spacesQuery.isLoading) {
    return (
      <View style={styles.host} testID="venue-spaces-loading" accessibilityLabel="Loading spaces">
        <Skeleton height={28} width="40%" />
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height={64} radius="md" />
        ))}
      </View>
    );
  }
  if (spacesQuery.isError) {
    return (
      <CenteredState
        title={VENUE_FEATURES_COPY.loadSpacesError}
        body={VENUE_FEATURES_COPY.loadError}
        tone="error"
        testID="venue-spaces-error"
      >
        <Button
          label={VENUE_FEATURES_COPY.tryAgain}
          variant="secondary"
          size="md"
          onPress={() => {
            void spacesQuery.refetch();
            void combosQuery.refetch();
          }}
        />
      </CenteredState>
    );
  }

  const header = (
    <View style={[styles.header, !isWideDesktop && styles.headerStacked]}>
      <View style={styles.headerTitleRow}>
        <Text style={styles.title} accessibilityRole="header">{VENUE_FEATURES_COPY.spacesTitle}</Text>
        {spaces.length > 0 ? (
          <Segmented
            options={[
              { key: "list", label: "List" },
              { key: "site", label: "Site plan" },
              ...(showTablesView ? [{ key: "tables" as const, label: "Tables", testID: "venue-spaces-view-tables" }] : []),
            ]}
            value={view}
            onChange={(next) => {
              if (arranging) return;
              setView(next);
            }}
            full={false}
            accessibilityLabel="Spaces view"
            testID="venue-spaces-view"
          />
        ) : null}
      </View>
      {canEdit && spaces.length > 0 && view !== "tables" ? (
        <View style={styles.headerActions}>
          <Button
            label={VENUE_FEATURES_COPY.combineSpaces}
            variant="secondary"
            size="sm"
            leadingIcon="link"
            disabled={spaces.length < 2}
            onPress={() => openCombine(null)}
            testID="venue-spaces-combine"
          />
          <Button
            label={VENUE_FEATURES_COPY.addSpace}
            variant="primary"
            size="sm"
            leadingIcon="plus"
            onPress={() => openNew()}
            testID="venue-spaces-add"
          />
        </View>
      ) : null}
    </View>
  );
  const staySeparationHint =
    venueQuery.data?.venueCategory === "stay" ? (
      <Text
        style={styles.staySeparationHint}
        testID="venue-spaces-stay-separation"
      >
        Rooms and places you sell as stays are separate. Don't add the same
        cabana twice.
      </Text>
    ) : null;

  const sheets = (
    <>
      <SpaceEditorSheet
        visible={editor.open}
        space={editor.open ? editor.space : null}
        initialName={editor.open ? editor.initialName : ""}
        combinations={combinations}
        amenitiesLabel={amenitiesLabel}
        amenitiesPlaceholder={amenityExamplesFor(venueQuery.data?.venueCategory)}
        hireOn={features?.private_hire.enabled === true}
        canEdit={canEdit}
        saving={manageSpace.isPending && manageSpace.variables?.action !== "archive"}
        deleting={manageSpace.isPending && manageSpace.variables?.action === "archive"}
        error={editorError}
        onSave={handleSaveSpace}
        onDelete={handleDeleteSpace}
        onClose={() => setEditor({ open: false })}
        onCombine={() => {
          setEditor({ open: false });
          openCombine(null);
        }}
      />
      <CombineSpacesSheet
        visible={comboSheet.open}
        combination={comboSheet.combination}
        spaces={spaces}
        combinations={combinations}
        saving={manageCombo.isPending}
        error={comboError}
        onSave={handleSaveCombo}
        onRemove={handleRemoveCombo}
        onClose={() => setComboSheet({ open: false, combination: null })}
      />
      {toast !== null ? (
        <React.Suspense fallback={null}>
          <LazyToast visible kind="success" message={toast} onDismiss={() => setToast(null)} testID="venue-spaces-toast" />
        </React.Suspense>
      ) : null}
    </>
  );

  if (spaces.length === 0) {
    return (
      <View style={styles.host} testID="venue-spaces-empty">
        {header}
        {staySeparationHint}
        <GlassCard variant="base" padding={space[5]} contentStyle={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{VENUE_FEATURES_COPY.spacesEmptyTitle}</Text>
          <Text style={styles.emptyBody}>{VENUE_FEATURES_COPY.spacesEmptyBody}</Text>
          {canEdit ? (
            <>
              <View style={styles.starters}>
                {spaceStartersFor(venueQuery.data?.venueCategory).map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    onPress={() => openNew(name)}
                    testID={`venue-spaces-starter-${name.replace(/\s+/g, "-").toLowerCase()}`}
                  />
                ))}
              </View>
              <Button
                label={VENUE_FEATURES_COPY.addSpace}
                variant="primary"
                size="md"
                leadingIcon="plus"
                onPress={() => openNew()}
                style={styles.emptyCta}
                testID="venue-spaces-add-first"
              />
            </>
          ) : (
            <Text style={styles.emptyBody}>Ask a brand owner or admin to add spaces.</Text>
          )}
        </GlassCard>
        {sheets}
      </View>
    );
  }

  // ----------------------------------------------------------------- list
  const list = (
    <GlassCard variant="base" padding={0} contentStyle={styles.listCard} testID="venue-spaces-list">
      {isWideDesktop ? (
        <View style={[styles.row, styles.headRow]}>
          <Text style={[styles.headCell, styles.colName]}>Space</Text>
          <Text style={[styles.headCell, styles.colFits]}>Fits</Text>
          <Text style={[styles.headCell, styles.colUsed]}>Used for</Text>
          <Text style={[styles.headCell, styles.colHire]}>Private hire</Text>
        </View>
      ) : null}
      {spaces.map((s, index) => {
        const tags = spaceUsedFor(s, features);
        return (
          <Pressable
            key={s.id}
            onPress={() => openSpace(s)}
            accessibilityRole="button"
            accessibilityLabel={`${s.name}, ${SETTING_LABEL[s.setting]}, fits ${spaceFitsLabel(s)}${s.canBeHired ? ", can be hired" : ""}. Open`}
            style={({ pressed }) => [
              styles.row,
              index > 0 || isWideDesktop ? styles.rowBorder : null,
              pressed && styles.rowPressed,
            ]}
            testID={`venue-space-row-${s.id}`}
          >
            <View style={[styles.colName, styles.cellStack]}>
              <Text style={styles.rowTitle} numberOfLines={1}>{s.name}</Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {SETTING_LABEL[s.setting]}
                {isWideDesktop ? "" : ` · ${spaceFitsLabel(s)}`}
              </Text>
            </View>
            {isWideDesktop ? (
              <>
                <Text style={[styles.cellText, styles.colFits]}>{spaceFitsLabel(s)}</Text>
                <View style={[styles.colUsed, styles.tags]}>
                  {tags.length === 0 ? <Text style={styles.rowMeta}>Nothing yet</Text> : null}
                  {tags.map((tag) => (
                    <Pill key={tag} variant="muted">{tag}</Pill>
                  ))}
                </View>
                <View style={styles.colHire}>
                  <Pill variant={s.canBeHired ? "ok" : "muted"}>{s.canBeHired ? "Can be hired" : "Not for hire"}</Pill>
                </View>
              </>
            ) : null}
          </Pressable>
        );
      })}
      {combinations.map((combo) => {
        const total = combinationCapacity(combo, spaces);
        const parts = spaces.filter((s) => combo.spaceIds.includes(s.id)).map((s) => s.name);
        return (
          <Pressable
            key={combo.id}
            onPress={() => (canEdit ? openCombine(combo) : undefined)}
            disabled={!canEdit}
            accessibilityRole="button"
            accessibilityLabel={`${combo.name}, combined from ${parts.join(" and ")}, fits ${spaceFitsLabel(total)}. Hiring it blocks both`}
            style={({ pressed }) => [styles.row, styles.rowBorder, pressed && styles.rowPressed]}
            testID={`venue-combination-row-${combo.id}`}
          >
            <View style={[styles.colName, styles.cellStack]}>
              <Text style={styles.rowTitle} numberOfLines={1}>{combo.name}</Text>
              <Text style={styles.rowMeta} numberOfLines={2}>
                {VENUE_FEATURES_COPY.combinedRow} · {parts.join(" + ")}
              </Text>
            </View>
            {isWideDesktop ? (
              <>
                <Text style={[styles.cellText, styles.colFits]}>{spaceFitsLabel(total)}</Text>
                <View style={styles.colUsed} />
                <View style={styles.colHire}>
                  <Pill variant="ok">Can be hired</Pill>
                </View>
              </>
            ) : null}
          </Pressable>
        );
      })}
    </GlassCard>
  );

  // ------------------------------------------------------------ site plan
  const site = (
    <View style={styles.siteWrap} testID="venue-spaces-site">
      {!hasPlan && !arranging ? (
        <GlassCard variant="base" padding={space[5]} contentStyle={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{VENUE_FEATURES_COPY.arrangeTitle}</Text>
          <Text style={styles.emptyBody}>
            {isWideDesktop ? VENUE_FEATURES_COPY.arrangeBody : VENUE_FEATURES_COPY.arrangeOnComputer}
          </Text>
          {isWideDesktop && canEdit ? (
            <Button label="Arrange" variant="primary" size="md" onPress={startArrange} style={styles.emptyCta} testID="venue-spaces-arrange" />
          ) : null}
        </GlassCard>
      ) : (
        <View style={[styles.siteGrid, !isWideDesktop && styles.siteGridStacked]}>
          <View style={styles.sitePlanCol}>
            <View style={styles.siteToolbar}>
              <Text style={styles.rowMeta}>
                {arranging ? "Drag a space to move it. Drag its corner to resize." : "Today"}
              </Text>
              {isWideDesktop && canEdit ? (
                arranging ? (
                  <View style={styles.headerActions}>
                    <Button label="Cancel" variant="ghost" size="sm" onPress={() => setArranging(false)} disabled={arrangeSaving} />
                    <Button label="Save layout" variant="primary" size="sm" loading={arrangeSaving} onPress={() => void saveArrange()} testID="venue-spaces-arrange-save" />
                  </View>
                ) : (
                  <Button label="Edit layout" variant="secondary" size="sm" onPress={startArrange} testID="venue-spaces-arrange" />
                )
              ) : null}
            </View>
            <SitePlan
              spaces={spaces}
              shapes={viewShapes}
              selectedId={selectedId}
              onSelect={setSelectedId}
              arranging={arranging}
              onShapeChange={(id, shape) => setArrangeShapes((prev) => ({ ...prev, [id]: shape }))}
              height={isWideDesktop ? 440 : 300}
            />
            {arrangeError !== null ? <Text style={styles.error}>{arrangeError}</Text> : null}
            <SitePlanLegend />
            {!arranging && spaces.some((s) => s.planShape === null) ? (
              <Text style={styles.rowMeta}>
                Not on the plan yet: {spaces.filter((s) => s.planShape === null).map((s) => s.name).join(", ")}
              </Text>
            ) : null}
          </View>
          <GlassCard variant="base" padding={space[4]} style={styles.sideCard} contentStyle={styles.sideCardBody}>
            {selected === null ? (
              <Text style={styles.rowMeta}>Pick a space on the plan to see its day.</Text>
            ) : (
              <>
                <Text style={styles.rowTitle}>{selected.name}</Text>
                <Text style={styles.rowMeta}>{SETTING_LABEL[selected.setting]} · {spaceFitsLabel(selected)}</Text>
                <Pill variant="ok">Open today</Pill>
                <Button label="Edit space" variant="secondary" size="sm" onPress={() => openSpace(selected)} testID="venue-spaces-side-edit" />
              </>
            )}
          </GlassCard>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.host} testID="venue-spaces-module">
      {header}
      {staySeparationHint}
      {view === "tables" ? (
        <VenueTablesInSpaces
          ref={tablesRef}
          brandId={brandId}
          venueId={venueId}
          initialSpaceId={initialSpaceId}
          onOpenSettings={onOpenSettings}
          onOpenSpacesList={() => setView("list")}
          onToast={setToast}
        />
      ) : view === "list" ? (
        list
      ) : (
        site
      )}
      {sheets}
    </View>
  );
});

const styles = StyleSheet.create({
  host: { gap: space[4], paddingHorizontal: space[4], paddingTop: space[4] },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], flexWrap: "wrap" },
  headerStacked: { flexDirection: "column", alignItems: "stretch" },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" },
  headerActions: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  title: { ...type.h1, color: color.text1 },
  staySeparationHint: { ...type.small, color: color.text2 },
  emptyCard: { gap: space[2], alignItems: "flex-start" },
  emptyTitle: { ...type.h2, color: color.text1 },
  emptyBody: { ...type.small, color: color.text2 },
  emptyCta: { marginTop: space[2] },
  starters: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[2] },
  listCard: { overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: 56,
  },
  headRow: { backgroundColor: color.fill.tableHead, minHeight: 40, paddingVertical: space[2] },
  rowBorder: { borderTopWidth: 1, borderTopColor: color.line },
  rowPressed: { backgroundColor: color.fill.pressed },
  headCell: { ...type.label, color: color.text3 },
  // #4490 D17 — the hire column is sized to its pill ("Can be hired") and
  // never shrinks; name, fits and used-for share the rest and wrap.
  colName: { flex: 3, minWidth: 0 },
  colFits: { flex: 2, minWidth: 0 },
  colUsed: { flex: 2, minWidth: 0 },
  colHire: { width: 128, flexShrink: 0, alignItems: "flex-start" },
  cellStack: { gap: 2 },
  cellText: { ...type.small, color: color.text2 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  rowTitle: { ...type.row, color: color.text1 },
  rowMeta: { ...type.caption, color: color.text3 },
  siteWrap: { gap: space[3] },
  siteGrid: { flexDirection: "row", gap: space[4], alignItems: "flex-start" },
  siteGridStacked: { flexDirection: "column", alignItems: "stretch" },
  sitePlanCol: { flex: 2, gap: space[2], minWidth: 0, alignSelf: "stretch" },
  siteToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" },
  sideCard: { flex: 1, minWidth: 240, borderRadius: radius.lg },
  sideCardBody: { gap: space[2], alignItems: "flex-start" },
  error: { ...type.caption, color: color.errorText },
});
