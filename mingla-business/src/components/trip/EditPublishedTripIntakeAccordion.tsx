/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <EditPublishedTripIntakeAccordion />.
 *
 * Per DESIGN_ORCH-0880 §6. Accordion body for the new "Intake form" section
 * in EditPublishedTripScreen. Reuses Phase 3 IntakeSchemaBuilder +
 * IntakeQuestionPreview primitives for the per-tier edit UI; adds a re-answer
 * warning banner counting how many travelers will be asked to re-answer if
 * the planner edits an existing schema, plus a "Save changes" CTA that opens
 * the existing ChangeSummaryModal with an intake-specific FieldDiff stub
 * (parent owns the modal + RPC plumbing per the existing
 * EditPublishedTripScreen save flow).
 *
 * Tier-picker tab row matches Phase 3 wizard pattern. Single-tier trips
 * collapse to "For all travelers" label. Multi-tier shows pill chips with
 * active orange-glow shadow + Add-CTA for unstaged tiers.
 *
 * Per Phase 1 service contract: `upsertTripIntakeSchema` routes published-
 * trip writes through `biz_update_live_trip` RPC with reason text (10-200
 * chars). Caller in EditPublishedTripScreen synthesizes the FieldDiff +
 * passes reason on save.
 *
 * Composes GlassCard + Icon + Button + IntakeSchemaBuilder +
 * IntakeQuestionPreview + RN useWindowDimensions. No new primitives.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import {
  radius,
  color,
  space,
  type,
  shadow,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Toast } from "../ui/Toast";
import {
  createEmptyIntakeSchema,
  type IntakeSchema,
} from "../../services/intakeSchemaService";
import {
  useTripIntakeSchemasByEvent,
  useUpsertTripIntakeSchema,
} from "../../hooks/useIntakeSchema";
import type { TripPricingTier } from "../../services/tripsService";
import { IntakeQuestionPreview } from "./IntakeQuestionPreview";
import type { IntakeSchemaBuilderProps } from "./IntakeSchemaBuilder";

// #4514 — the question builder (with its editor and type picker) loads on
// demand. Trip create, trip edit and the brand form builder each declare this
// `import()` of the same module, so the builder stays in ONE async chunk; a
// shared static wrapper module would itself be hoisted into the eager
// `__common` chunk every Host web visitor downloads first.
const LazyBuilder = React.lazy(() =>
  import("./IntakeSchemaBuilder").then((m) => ({ default: m.IntakeSchemaBuilder })),
);
const IntakeSchemaBuilder = (props: IntakeSchemaBuilderProps): React.ReactElement => (
  <React.Suspense fallback={null}>
    <LazyBuilder {...props} />
  </React.Suspense>
);

const WIDE_BREAKPOINT_PT = 768;

export interface EditPublishedTripIntakeAccordionProps {
  eventId: string;
  ticketTypes: TripPricingTier[];
  /** Number of travelers who will be asked to re-answer if this saves with
   * structural changes. Parent derives from useTripOrders + diff against
   * persisted schemas. 0 hides the banner. Optional — when omitted the
   * accordion conservatively hides the banner. */
  affectedTravelerCount?: number;
  testID?: string;
}

const REASON_MIN = 10;
const REASON_MAX = 200;

export const EditPublishedTripIntakeAccordion: React.FC<
  EditPublishedTripIntakeAccordionProps
> = ({ eventId, ticketTypes, affectedTravelerCount = 0, testID }) => {
  const schemasQuery = useTripIntakeSchemasByEvent(eventId);
  const upsertMutation = useUpsertTripIntakeSchema();

  // Local edit state — keyed by ticket_type_id. Seeded from server on first
  // load via useEffect; otherwise lives until save commits + invalidation
  // round-trips.
  const [schemasByTier, setSchemasByTier] = useState<
    Map<string, IntakeSchema | null>
  >(new Map());
  const seededRef = useRef<boolean>(false);
  // Track which tiers have unsaved edits.
  const dirtyTierIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (seededRef.current) return;
    if (schemasQuery.data === undefined) return;
    const seeded = new Map<string, IntakeSchema | null>();
    for (const [tierId, schema] of schemasQuery.data.entries()) {
      seeded.set(tierId, schema);
    }
    setSchemasByTier(seeded);
    seededRef.current = true;
  }, [schemasQuery.data]);

  const onSchemaChange = useCallback(
    (ticketTypeId: string, next: IntakeSchema | null): void => {
      setSchemasByTier((prev) => {
        const cloned = new Map(prev);
        cloned.set(ticketTypeId, next);
        return cloned;
      });
      dirtyTierIdsRef.current = new Set([
        ...dirtyTierIdsRef.current,
        ticketTypeId,
      ]);
    },
    [],
  );

  const hasDirtyTiers = dirtyTierIdsRef.current.size > 0;

  // Reason ConfirmDialog state.
  const [reasonDialogVisible, setReasonDialogVisible] = useState<boolean>(false);
  const [reason, setReason] = useState<string>("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const onSavePressed = useCallback((): void => {
    if (!hasDirtyTiers) return;
    setReason("");
    setReasonError(null);
    setReasonDialogVisible(true);
  }, [hasDirtyTiers]);

  const onConfirmSave = useCallback(async (): Promise<void> => {
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setReasonError(
        `Reason must be between ${REASON_MIN} and ${REASON_MAX} characters.`,
      );
      return;
    }
    setSubmitting(true);
    setReasonError(null);
    try {
      const dirty = Array.from(dirtyTierIdsRef.current);
      // Fire upserts sequentially to avoid hammering the RPC concurrently.
      let okCount = 0;
      for (const ticketTypeId of dirty) {
        const schema = schemasByTier.get(ticketTypeId) ?? null;
        await upsertMutation.mutateAsync({
          eventId,
          ticketTypeId,
          schema,
          reason: trimmed,
        });
        okCount += 1;
      }
      dirtyTierIdsRef.current = new Set();
      setReasonDialogVisible(false);
      const travelerLabel =
        affectedTravelerCount > 0
          ? ` · ${affectedTravelerCount} traveler${affectedTravelerCount === 1 ? "" : "s"} notified`
          : "";
      setToast({
        visible: true,
        message: `Intake form saved (${okCount} ${okCount === 1 ? "tier" : "tiers"})${travelerLabel}.`,
      });
    } catch (e) {
      setReasonError(
        e instanceof Error
          ? e.message
          : "Couldn't save intake form. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    reason,
    schemasByTier,
    upsertMutation,
    eventId,
    affectedTravelerCount,
  ]);

  const onCloseReasonDialog = useCallback((): void => {
    if (submitting) return;
    setReasonDialogVisible(false);
  }, [submitting]);
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT_PT;
  const isSingleTier = ticketTypes.length === 1;

  const [activeTicketTypeId, setActiveTicketTypeId] = useState<string | null>(
    () => {
      const firstWithSchema = ticketTypes.find((t) =>
        schemasByTier.has(t.ticketTypeId),
      );
      return (
        firstWithSchema?.ticketTypeId ??
        ticketTypes[0]?.ticketTypeId ??
        null
      );
    },
  );

  useEffect(() => {
    if (
      activeTicketTypeId !== null &&
      !ticketTypes.some((t) => t.ticketTypeId === activeTicketTypeId)
    ) {
      setActiveTicketTypeId(ticketTypes[0]?.ticketTypeId ?? null);
    }
  }, [activeTicketTypeId, ticketTypes]);

  const activeTier = useMemo<TripPricingTier | null>(
    () =>
      ticketTypes.find((t) => t.ticketTypeId === activeTicketTypeId) ?? null,
    [activeTicketTypeId, ticketTypes],
  );

  const activeSchema = useMemo<IntakeSchema | null>(() => {
    if (activeTicketTypeId === null) return null;
    return schemasByTier.get(activeTicketTypeId) ?? null;
  }, [activeTicketTypeId, schemasByTier]);

  const handleAddIntakeForTier = (ticketTypeId: string): void => {
    const seeded = createEmptyIntakeSchema();
    onSchemaChange(ticketTypeId, seeded);
    setActiveTicketTypeId(ticketTypeId);
  };

  if (ticketTypes.length === 0) {
    return (
      <View style={styles.emptyTiersWrap}>
        <Text style={styles.emptyTiersText}>
          Add a ticket tier first to configure intake forms.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID={testID ?? "intake-accordion-body"}>
      {/* Tier-picker tab row */}
      {isSingleTier ? (
        <View style={styles.singleTierLabelWrap}>
          <Text style={styles.singleTierLabel}>For all travelers</Text>
        </View>
      ) : (
        <View
          style={styles.tabRow}
          accessibilityRole="tablist"
          accessibilityLabel="Intake form tiers"
        >
          {ticketTypes.map((t) => {
            const active = t.ticketTypeId === activeTicketTypeId;
            const hasSchema = schemasByTier.has(t.ticketTypeId);
            if (!hasSchema && !active) {
              return (
                <Pressable
                  key={t.ticketTypeId}
                  onPress={() => handleAddIntakeForTier(t.ticketTypeId)}
                  hitSlop={8}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityLabel={`Add intake form for ${t.tierName}`}
                  style={({ pressed }) => [
                    styles.tab,
                    styles.tabAdd,
                    pressed && styles.tabPressed,
                  ]}
                >
                  <Icon
                    name="plus"
                    size={14}
                    color={color.accent}
                    strokeWidth={2.5}
                  />
                  <Text style={styles.tabAddLabel}>
                    Add intake for {t.tierName}
                  </Text>
                </Pressable>
              );
            }
            return (
              <View key={t.ticketTypeId} style={styles.tabWithUnderline}>
                <Pressable
                  onPress={() => setActiveTicketTypeId(t.ticketTypeId)}
                  hitSlop={8}
                  disabled={submitting}
                  accessibilityRole="tab"
                  accessibilityLabel={`${t.tierName} intake form tab`}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.tab,
                    active && styles.tabActive,
                    pressed && styles.tabPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabLabel,
                      active && styles.tabLabelActive,
                    ]}
                  >
                    {t.tierName}
                  </Text>
                </Pressable>
                {active ? <View style={styles.tabUnderline} /> : null}
              </View>
            );
          })}
        </View>
      )}

      {/* Body — split or stacked */}
      <View
        style={[
          styles.body,
          isWide ? styles.bodyWide : styles.bodyNarrow,
        ]}
      >
        <View style={[styles.pane, isWide ? styles.paneHalf : styles.paneFull]}>
          <GlassCard variant="base" padding={space[4]} radius="lg">
            <IntakeSchemaBuilder
              schema={activeSchema}
              activeTicketTypeId={activeTicketTypeId ?? ""}
              activeTierName={activeTier?.tierName ?? "All travelers"}
              onSchemaChange={(next) =>
                activeTicketTypeId !== null
                  ? onSchemaChange(activeTicketTypeId, next)
                  : undefined
              }
              onClearAll={() =>
                activeTicketTypeId !== null
                  ? onSchemaChange(activeTicketTypeId, null)
                  : undefined
              }
              disabled={submitting}
            />
          </GlassCard>
        </View>
        <View style={[styles.pane, isWide ? styles.paneHalf : styles.paneFull]}>
          <GlassCard variant="base" padding={space[4]} radius="lg">
            <IntakeQuestionPreview
              schema={activeSchema}
              activeTierName={activeTier?.tierName ?? "All travelers"}
            />
          </GlassCard>
        </View>
      </View>

      {/* Re-answer warning banner */}
      {affectedTravelerCount > 0 ? (
        <GlassCard
          variant="base"
          padding={space[4]}
          radius="lg"
          style={styles.warningBanner}
        >
          <View style={styles.warningRow}>
            <Icon
              name="bell"
              size={20}
              color={color.warning}
              strokeWidth={2}
            />
            <Text style={styles.warningText}>
              Editing intake questions will ask {affectedTravelerCount}{" "}
              traveler{affectedTravelerCount === 1 ? "" : "s"} to re-answer.
            </Text>
          </View>
        </GlassCard>
      ) : null}

      {/* Inline reason-and-save row. When Save tapped, reason banner appears
          below with TextInput + Save+Cancel. Skips ChangeSummaryModal because
          intake schemas don't synthesize cleanly into the modal's FieldDiff[]
          shape — documented as Phase 4 deviation; polish follow-up could
          extend ChangeSummaryModal for intake-specific diffs. */}
      {reasonDialogVisible ? (
        <GlassCard
          variant="base"
          padding={space[4]}
          radius="lg"
          style={styles.reasonBanner}
        >
          <Text style={styles.reasonTitle}>Save intake form changes?</Text>
          <Text style={styles.reasonDescription}>
            {affectedTravelerCount > 0
              ? `${affectedTravelerCount} traveler${affectedTravelerCount === 1 ? "" : "s"} will be asked to re-answer the affected questions and notified by email.`
              : "No travelers are currently affected."}
          </Text>
          <Text style={styles.reasonLabel}>Reason for change *</Text>
          <TextInput
            value={reason}
            onChangeText={(t) => setReason(t.slice(0, REASON_MAX))}
            placeholder="e.g., Added passport scan requirement for new visa policy."
            placeholderTextColor={color.text4}
            maxLength={REASON_MAX}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            style={styles.reasonInput}
            accessibilityLabel="Reason for change"
            autoCapitalize="sentences"
          />
          <Text style={styles.reasonCounter}>
            {reason.trim().length} / {REASON_MAX}
          </Text>
          {reasonError !== null ? (
            <Text style={styles.reasonError} accessibilityLiveRegion="polite">
              {reasonError}
            </Text>
          ) : null}
          <View style={styles.reasonButtons}>
            <View style={styles.reasonCancelCell}>
              <Button
                label="Keep editing"
                variant="ghost"
                size="md"
                onPress={onCloseReasonDialog}
                disabled={submitting}
                fullWidth
              />
            </View>
            <View style={styles.reasonConfirmCell}>
              <Button
                label="Save + notify travelers"
                variant="primary"
                size="md"
                onPress={() => {
                  void onConfirmSave();
                }}
                loading={submitting}
                disabled={
                  submitting || reason.trim().length < REASON_MIN
                }
                fullWidth
                testID="intake-accordion-reason-confirm"
              />
            </View>
          </View>
        </GlassCard>
      ) : (
        <View style={styles.saveWrap}>
          <Button
            label="Save changes"
            variant="primary"
            size="md"
            onPress={onSavePressed}
            disabled={!hasDirtyTiers || submitting}
            loading={submitting}
            fullWidth
            testID="intake-accordion-save"
          />
        </View>
      )}

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="success"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: space[4],
  },
  emptyTiersWrap: {
    paddingVertical: space[7],
    paddingHorizontal: space[4],
    alignItems: "center",
  },
  emptyTiersText: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text3,
    textAlign: "center",
  },
  singleTierLabelWrap: {
    paddingVertical: space[1],
  },
  singleTierLabel: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text3,
  },
  tabRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space[1],
  },
  tabWithUnderline: {
    alignItems: "stretch",
  },
  tab: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    minHeight: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  tabActive: {
    backgroundColor: color.accentLine,
    borderColor: color.accentLine,
    // #4420 — the orange glow is retired (shadow tokens only); Android stays 0.
    ...shadow.none,
  },
  tabAdd: {
    borderColor: color.accentLine,
    backgroundColor: "transparent",
  },
  tabPressed: {
    opacity: 0.8,
  },
  tabLabel: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "500",
    color: color.text2,
  },
  tabLabelActive: {
    color: color.text1,
    fontWeight: "600",
  },
  tabAddLabel: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "500",
    color: color.accent,
  },
  tabUnderline: {
    marginTop: space[1],
    height: 2,
    width: "100%",
    backgroundColor: color.accent,
    borderRadius: 1,
  },
  body: {
    gap: space[4],
  },
  bodyWide: {
    flexDirection: "row",
  },
  bodyNarrow: {
    flexDirection: "column",
  },
  pane: {},
  paneHalf: {
    flexBasis: "48%",
    flexGrow: 1,
  },
  paneFull: {
    width: "100%",
  },
  warningBanner: {
    borderColor: color.warning,
    borderWidth: 1,
    backgroundColor: color.warningTint,
    marginTop: space[2],
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  warningText: {
    flex: 1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text1,
  },
  saveWrap: {
    marginTop: space[2],
  },
  reasonBanner: {
    marginTop: space[2],
    borderColor: color.accentLine,
    borderWidth: 1,
  },
  reasonTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
    marginBottom: space[1],
  },
  reasonDescription: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    marginBottom: space[4],
  },
  reasonLabel: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "600",
    color: color.text2,
    marginBottom: space[1],
  },
  reasonInput: {
    minHeight: 80,
    paddingHorizontal: space[4],
    paddingVertical: 10,
    borderRadius: radius.sm,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    color: color.text1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
  },
  reasonCounter: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    textAlign: "right",
    marginTop: 2,
  },
  reasonError: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.danger,
    marginTop: space[1],
  },
  reasonButtons: {
    flexDirection: "row",
    gap: space[2],
    marginTop: space[4],
  },
  reasonCancelCell: {
    flex: 1,
  },
  reasonConfirmCell: {
    flex: 2,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingTop: space[4],
    paddingHorizontal: space[4],
    zIndex: 100,
  },
});

export default EditPublishedTripIntakeAccordion;
