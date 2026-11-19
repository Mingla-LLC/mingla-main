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
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import {
  radius,
  color,
  space,
  type,
  shadow,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { IntakeSchema } from "../../services/intakeSchemaService";
import { createEmptyIntakeSchema } from "../../services/intakeSchemaService";
import type { TripPricingTier } from "../../services/tripsService";
import { IntakeQuestionPreview } from "./IntakeQuestionPreview";
// #4514 — one lazy owner for the builder (keeps it out of the eager Host web chunk).
import { LazyIntakeSchemaBuilder as IntakeSchemaBuilder } from "./LazyIntakeSchemaBuilder";
// #3372 — naira package prices show "₦", not "NGN" (#3341 rule).
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

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
    return withCurrencyGlyph(
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: tier.currency,
        maximumFractionDigits: 0,
      }).format(tier.priceCents / 100),
      tier.currency,
    );
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
              disabled={disabled}
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
