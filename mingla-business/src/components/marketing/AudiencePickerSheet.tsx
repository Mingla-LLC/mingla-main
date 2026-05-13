/**
 * AudiencePickerSheet — sub-sheet that lists pickable audiences and reports
 * the operator's choice back via onSelect.
 *
 * Phase B sources audiences from REAL buyer data (not from
 * `marketing_audiences`, which is initially empty for any brand and only
 * fills lazily when the operator navigates via Brand/Event Blasts CTAs).
 *
 * What the picker shows:
 *   - "All buyers of {brand}" — always shown when the brand has ≥1 paid order
 *   - "Buyers of {event}" — one row per event that has ≥1 paid order
 *
 * On select:
 *   - If a `marketing_audiences` row already exists for the chosen kind +
 *     target_id, return its id directly.
 *   - Otherwise return existing_audience_id=null and let the parent
 *     (`compose.tsx`) lazy-seed via ensureBrandBuyersAudience /
 *     ensureEventBuyersAudience.
 *
 * MUST be rendered INSIDE the parent composer KAV — never as a Fragment
 * sibling. The composer route does this. See
 * `feedback_rn_sub_sheet_must_render_inside_parent.md`.
 */

import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Sheet } from "../ui/Sheet";
import { supabase } from "../../services/supabase";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type AudienceOptionKind = "brand_buyers" | "event_buyers";

export interface AudienceOption {
  /** Stable client-side key. NOT the marketing_audiences row id. */
  key: string;
  /** Human label for the row. */
  name: string;
  /** Discriminator + target. The composer ensures a marketing_audiences row exists with this shape. */
  kind: AudienceOptionKind;
  target_id: string;
  /** Buyer count (paid + partial_refund) — surfaces honesty to the operator. */
  buyer_count: number;
  /** If a marketing_audiences row already exists for this kind+target, its id; else null. */
  existing_audience_id: string | null;
}

export interface AudiencePickerSheetProps {
  visible: boolean;
  brandId: string | null;
  brandName: string | null;
  selectedAudienceId: string | null;
  onClose: () => void;
  onSelect: (option: AudienceOption) => void;
}

interface OrderJoinRow {
  event_id: string;
  events: { id: string; title: string | null; brand_id: string } | null;
}

interface ExistingAudienceRow {
  id: string;
  query_definition: {
    kind?: string;
    brand_id?: string;
    event_id?: string;
  };
}

export const AudiencePickerSheet: React.FC<AudiencePickerSheetProps> = ({
  visible,
  brandId,
  brandName,
  selectedAudienceId,
  onClose,
  onSelect,
}) => {
  const [options, setOptions] = useState<AudienceOption[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || brandId === null) return;
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);
    (async () => {
      try {
        // 1) Pull paid orders for this brand. Same join shape as the
        //    audience service uses — RLS-gated to the caller.
        const { data: orderData, error: orderErr } = await supabase
          .from("orders")
          .select("event_id, events!inner ( id, title, brand_id )")
          .in("payment_status", ["paid", "partial_refund"])
          .eq("events.brand_id", brandId);
        if (orderErr) throw orderErr;

        // 2) Pull any pre-existing marketing_audiences rows for this brand
        //    so we can attach existing_audience_id to options the operator
        //    has used before.
        const { data: existingAudiences, error: audErr } = await supabase
          .from("marketing_audiences")
          .select("id, query_definition")
          .eq("brand_id", brandId);
        if (audErr) throw audErr;

        if (cancelled) return;

        const orders = (orderData ?? []) as unknown as OrderJoinRow[];
        const audiences = (existingAudiences ?? []) as unknown as ExistingAudienceRow[];

        // Aggregate: total brand buyers + per-event buyer counts.
        let brandBuyerCount = 0;
        const perEvent = new Map<string, { title: string; count: number }>();
        for (const o of orders) {
          brandBuyerCount += 1;
          const eventId = o.events?.id ?? o.event_id;
          const title = o.events?.title ?? "Untitled event";
          const existing = perEvent.get(eventId);
          if (existing === undefined) {
            perEvent.set(eventId, { title, count: 1 });
          } else {
            existing.count += 1;
          }
        }

        // Look up existing audience ids by kind+target.
        let existingBrandAudienceId: string | null = null;
        const existingEventAudienceIds = new Map<string, string>();
        for (const a of audiences) {
          if (
            a.query_definition.kind === "brand_buyers" &&
            a.query_definition.brand_id === brandId
          ) {
            existingBrandAudienceId = a.id;
          } else if (
            a.query_definition.kind === "event_buyers" &&
            typeof a.query_definition.event_id === "string"
          ) {
            existingEventAudienceIds.set(a.query_definition.event_id, a.id);
          }
        }

        const built: AudienceOption[] = [];

        // Brand-buyers option (only when the brand has ≥1 paid order).
        if (brandBuyerCount > 0) {
          built.push({
            key: `brand:${brandId}`,
            name: brandName !== null
              ? `All buyers of ${brandName}`
              : "All brand buyers",
            kind: "brand_buyers",
            target_id: brandId,
            buyer_count: brandBuyerCount,
            existing_audience_id: existingBrandAudienceId,
          });
        }

        // Per-event buyers options, sorted by buyer count desc then title.
        const eventOptions: AudienceOption[] = [];
        for (const [eventId, info] of perEvent.entries()) {
          eventOptions.push({
            key: `event:${eventId}`,
            name: `Buyers of ${info.title}`,
            kind: "event_buyers",
            target_id: eventId,
            buyer_count: info.count,
            existing_audience_id: existingEventAudienceIds.get(eventId) ?? null,
          });
        }
        eventOptions.sort((a, b) => {
          if (b.buyer_count !== a.buyer_count) return b.buyer_count - a.buyer_count;
          return a.name.localeCompare(b.name);
        });

        setOptions([...built, ...eventOptions]);
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(
          err instanceof Error ? err.message : "Couldn't load audiences",
        );
        setOptions([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, brandId, brandName]);

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <View style={styles.host}>
        <Text style={styles.title}>Pick an audience</Text>
        <Text style={styles.subtitle}>
          Pulled live from your paid orders.
        </Text>
        {isLoading ? (
          <View style={styles.centerHost}>
            <ActivityIndicator size="small" color={textTokens.secondary} />
          </View>
        ) : errorMessage !== null ? (
          <Text style={styles.errorText}>{errorMessage}</Text>
        ) : options === null || options.length === 0 ? (
          <View style={styles.emptyHost}>
            <Text style={styles.emptyText}>
              No buyers yet. Audiences appear here as people purchase tickets to your events.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {options.map((option) => {
              const isSelected =
                option.existing_audience_id !== null &&
                option.existing_audience_id === selectedAudienceId;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => {
                    onSelect(option);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Pick audience ${option.name} with ${option.buyer_count} buyers`}
                  accessibilityState={{ selected: isSelected }}
                  style={({ pressed }) => [
                    styles.row,
                    isSelected ? styles.rowSelected : null,
                    pressed ? styles.rowPressed : null,
                  ]}
                >
                  <Text style={styles.rowName} numberOfLines={1}>
                    {option.name}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {option.buyer_count} {option.buyer_count === 1 ? "buyer" : "buyers"}
                    {" · "}
                    {option.kind === "brand_buyers" ? "Brand rollup" : "Event buyers"}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
  },
  subtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  emptyHost: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  emptyText: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
  errorText: {
    ...typography.bodySm,
    color: textTokens.secondary,
    paddingVertical: spacing.md,
  },
  list: {
    flex: 1,
    marginTop: spacing.sm,
  },
  listContent: {
    gap: spacing.xs,
    paddingBottom: spacing.lg,
  },
  row: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: 2,
  },
  rowSelected: {
    borderColor: accent.border,
    backgroundColor: "rgba(235, 120, 37, 0.12)",
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowName: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  rowMeta: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
});
