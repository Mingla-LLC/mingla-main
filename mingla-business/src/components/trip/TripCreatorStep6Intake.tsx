/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <TripCreatorStep6Intake />.
 *
 * Per DESIGN_ORCH-0880 §3.1 + §3.2. Body of wizard Step 6.
 *
 * Layout:
 *   - Wide (≥768pt): split-view 50/50 — schema-builder pane LEFT, preview
 *     pane RIGHT. Tier-picker tab row spans full width above.
 *   - Narrow (<768pt): stacked — tier-picker → schema-builder → preview.
 *
 * Tier-picker (D1 per-tier scope LOCKED):
 *   - Multi-tier: pill chips per tier with active-tab orange glow + "Add
 *     intake for tier N" CTA for unstaged tiers.
 *   - Single-tier: collapses to non-clickable "For all travelers" label.
 *
 * Composes GlassCard + IntakeSchemaBuilder + IntakeQuestionPreview. No new
 * primitives. Per-tier state lives in parent (TripCreatorWizard); this
 * component receives a Map<ticketTypeId, IntakeSchema> + onChange callback.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import {
  accent,
  glass,
  radius,
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { IntakeSchema } from "../../services/intakeSchemaService";
import { createEmptyIntakeSchema } from "../../services/intakeSchemaService";
import type { TripPricingTier } from "../../services/tripsService";
import { IntakeQuestionPreview } from "./IntakeQuestionPreview";
import { IntakeSchemaBuilder } from "./IntakeSchemaBuilder";

export interface TripCreatorStep6IntakeProps {
  /** All ticket tiers on the trip (from Trip.pricingTiers). */
  ticketTypes: TripPricingTier[];
  /** Current intake schemas keyed by ticket_type_id. Map.get may return undefined for tiers without a schema yet. */
  schemasByTier: Map<string, IntakeSchema>;
  /** Fires when planner edits a schema; null = clear that tier's schema. */
  onSchemaChange: (ticketTypeId: string, next: IntakeSchema | null) => void;
  disabled?: boolean;
}

const WIDE_BREAKPOINT_PT = 768;

function formatPriceLabel(tier: TripPricingTier): string {
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: tier.currency,
      maximumFractionDigits: 0,
    });
    return formatter.format(tier.priceCents / 100);
  } catch {
    return `${(tier.priceCents / 100).toFixed(0)} ${tier.currency}`;
  }
}

export const TripCreatorStep6Intake: React.FC<TripCreatorStep6IntakeProps> = ({
  ticketTypes,
  schemasByTier,
  onSchemaChange,
  disabled = false,
}) => {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT_PT;

  // Active tier defaults to the first tier with a schema, else the first tier.
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

  // Re-seed active tier if tiers change shape (e.g., planner went back to
  // Step 4 and edited pricing tiers).
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

  const isSingleTier = ticketTypes.length === 1;

  // Add-intake handler — seeds an empty schema for a tier that doesn't yet
  // have one, makes it active, and fires onSchemaChange so parent stores it.
  const handleAddIntakeForTier = (ticketTypeId: string): void => {
    const seeded = createEmptyIntakeSchema();
    onSchemaChange(ticketTypeId, seeded);
    setActiveTicketTypeId(ticketTypeId);
  };

  if (ticketTypes.length === 0) {
    return (
      <View style={styles.emptyTiersWrap}>
        <Text style={styles.emptyTiersText}>
          Add a ticket tier on Step 4 before configuring intake forms.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
              // Render as "Add intake for {tier}" CTA pill instead of an empty tab.
              return (
                <Pressable
                  key={t.ticketTypeId}
                  onPress={() => handleAddIntakeForTier(t.ticketTypeId)}
                  hitSlop={8}
                  disabled={disabled}
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
                    color={accent.warm}
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
                  disabled={disabled}
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
                    {t.tierName} ({formatPriceLabel(t)})
                  </Text>
                </Pressable>
                {active ? <View style={styles.tabUnderline} /> : null}
              </View>
            );
          })}
        </View>
      )}

      {/* Body — split or stacked depending on viewport width */}
      <View
        style={[
          styles.body,
          isWide ? styles.bodyWide : styles.bodyNarrow,
        ]}
      >
        <View style={[styles.pane, isWide ? styles.paneHalf : styles.paneFull]}>
          <GlassCard variant="base" padding={spacing.md} radius="lg">
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
              disabled={disabled}
            />
          </GlassCard>
        </View>
        <View style={[styles.pane, isWide ? styles.paneHalf : styles.paneFull]}>
          <GlassCard variant="base" padding={spacing.md} radius="lg">
            <IntakeQuestionPreview
              schema={activeSchema}
              activeTierName={activeTier?.tierName ?? "All travelers"}
            />
          </GlassCard>
        </View>
      </View>
    </View>
  );
};

// Suppress unused-import warning on platforms that don't surface shadows
// reference in current style table. shadows.glassChromeActive is part of
// the DESIGN §3.2 active-tab orange-glow contract; consumers can drop into
// it via tabUnderline style extension without re-importing.
void shadows;

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  emptyTiersWrap: {
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  emptyTiersText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  singleTierLabelWrap: {
    paddingVertical: spacing.xs,
  },
  singleTierLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
  },
  tabRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
  },
  tabWithUnderline: {
    alignItems: "stretch",
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 36,
    borderRadius: radius.full,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  tabActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    // META-ORCH-1002 Sub-1 (S5): zero the Android elevation so no hard rectangular
    // shadow draws under the rounded pill (mirrors androidSafeElevation). iOS glow kept.
    elevation: Platform.select({ ios: 8, android: 0, default: 8 }),
  },
  tabAdd: {
    borderColor: accent.border,
    backgroundColor: "transparent",
  },
  tabPressed: {
    opacity: 0.8,
  },
  tabLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  tabLabelActive: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  tabAddLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "500",
    color: accent.warm,
  },
  tabUnderline: {
    marginTop: spacing.xs,
    height: 2,
    width: "100%",
    backgroundColor: accent.warm,
    borderRadius: 1,
  },
  body: {
    gap: spacing.md,
  },
  bodyWide: {
    flexDirection: "row",
  },
  bodyNarrow: {
    flexDirection: "column",
  },
  pane: {
    // Per feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md:
    // when sibling scrollables share a row layout, set explicit growth so
    // one doesn't push the other's bounds. The builder pane is primary
    // (drives layout); preview pane sizes to its content.
  },
  paneHalf: {
    flexBasis: "48%",
    flexGrow: 1,
  },
  paneFull: {
    width: "100%",
  },
});

export default TripCreatorStep6Intake;
