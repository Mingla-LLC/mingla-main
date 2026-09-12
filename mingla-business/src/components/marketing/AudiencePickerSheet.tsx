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
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  BookOpen,
  Check,
  Network,
  Radio,
  ShoppingBag,
  UsersRound,
} from "lucide-react-native";

import { Sheet } from "../ui/Sheet";
import { Skeleton } from "../ui/Skeleton";
import { supabase } from "../../services/supabase";
import { getOrCreateMarketingBookAudience } from "../../services/marketing/marketingCampaignService";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type AudienceOptionKind =
  | "brand_buyers"
  | "event_buyers"
  | "all_brand_people"
  | "manual_group"
  | "brand_followers"
  | "brand_circle_extended";

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
  disabled?: boolean;
  status_label?: string;
  privacy_label?: string;
}

export interface CircleAudiencePickerState {
  followers: {
    count: number | null;
    state: "loading" | "ready" | "unavailable";
    enabled: boolean;
    reason?: string | null;
  };
  extended: {
    count: number | null;
    state: "loading" | "ready" | "unavailable";
    enabled: boolean;
    reason?: string | null;
  };
}

export interface AudiencePickerSheetProps {
  visible: boolean;
  brandId: string | null;
  brandName: string | null;
  selectedAudienceId: string | null;
  onClose: () => void;
  onSelect: (option: AudienceOption) => void;
  actorId?: string | null;
  bookBlastEnabled?: boolean;
  manualGroupsEnabled?: boolean;
  circleAudienceEnabled?: boolean;
  circleReach?: CircleAudiencePickerState;
  onRetryCircleReach?: () => void;
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
  actorId,
  bookBlastEnabled,
  manualGroupsEnabled,
  circleAudienceEnabled,
  circleReach,
  onRetryCircleReach,
}) => {
  const [options, setOptions] = useState<AudienceOption[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || brandId === null) return;
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);
    (async () => {
      try {
        let book: null | { audienceId: string; activeBookTotal: number } = null;
        const manualGroups = manualGroupsEnabled === true
          ? await import("../../services/marketing/manualGroupService").then((service) => service.listManualGroups(brandId))
          : [];
        if (bookBlastEnabled === true && actorId != null) {
          try {
            book = await getOrCreateMarketingBookAudience({
              actor_id: actorId,
              brand_id: brandId,
            });
            setBookError(null);
          } catch {
            setBookError(
              "Your Book is unavailable. Retry to load its people count.",
            );
          }
        }
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
        const audiences = (existingAudiences ??
          []) as unknown as ExistingAudienceRow[];

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

        const existingCircleAudienceIds = new Map<string, string>();
        for (const a of audiences) {
          if (
            (a.query_definition.kind === "brand_followers" ||
              a.query_definition.kind === "brand_circle_extended") &&
            a.query_definition.brand_id === brandId
          ) {
            existingCircleAudienceIds.set(a.query_definition.kind, a.id);
          }
        }

        const built: AudienceOption[] =
          book === null
            ? []
            : [
                {
                  key: `book:${brandId}`,
                  name: "Your Book",
                  kind: "all_brand_people",
                  target_id: brandId,
                  buyer_count: book.activeBookTotal,
                  existing_audience_id: book.audienceId,
                },
              ];
        if (circleAudienceEnabled === true) {
          const followerReady = circleReach?.followers.state === "ready";
          const extendedReady = circleReach?.extended.state === "ready";
          built.push(
            {
              key: `followers:${brandId}`,
              name: "Followers",
              kind: "brand_followers",
              target_id: brandId,
              buyer_count: circleReach?.followers.count ?? 0,
              existing_audience_id:
                existingCircleAudienceIds.get("brand_followers") ?? null,
              disabled:
                !followerReady || circleReach?.followers.enabled !== true ||
                (circleReach?.followers.count ?? 0) === 0,
              status_label: followerReady
                ? (circleReach?.followers.count ?? 0) === 0
                  ? "No followers yet"
                  : circleReach?.followers.enabled === true
                    ? undefined
                  : "Messaging is not available for this channel yet."
                : circleReach?.followers.reason ?? "Checking current reach…",
              privacy_label: "Names only",
            },
            {
              key: `extended:${brandId}`,
              name: "Extended circle",
              kind: "brand_circle_extended",
              target_id: brandId,
              buyer_count: circleReach?.extended.count ?? 0,
              existing_audience_id:
                existingCircleAudienceIds.get("brand_circle_extended") ?? null,
              disabled: !extendedReady || circleReach?.extended.enabled !== true,
              status_label: extendedReady
                ? circleReach?.extended.enabled === true
                  ? undefined
                  : "Messaging is not available for this channel yet."
                : circleReach?.extended.reason ??
                  "Not available until people can control extended brand reach in Mingla.",
              privacy_label: "Consent controlled",
            },
          );
        }
        built.push(...manualGroups.map((group) => ({
          key: `manual:${group.groupId}`,
          name: group.name,
          kind: "manual_group" as const,
          target_id: group.groupId,
          buyer_count: group.memberCount,
          existing_audience_id: group.groupId,
        })));

        // Brand-buyers option (only when the brand has ≥1 paid order).
        if (brandBuyerCount > 0) {
          built.push({
            key: `brand:${brandId}`,
            name:
              brandName !== null
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
          if (b.buyer_count !== a.buyer_count)
            return b.buyer_count - a.buyer_count;
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
  }, [
    visible,
    brandId,
    brandName,
    actorId,
    bookBlastEnabled,
    manualGroupsEnabled,
    circleAudienceEnabled,
    circleReach,
  ]);

  const renderOption = (option: AudienceOption): React.ReactElement => {
    const isSelected = option.existing_audience_id !== null && option.existing_audience_id === selectedAudienceId;
    const peopleAudience = option.kind === "manual_group" || option.kind === "all_brand_people" || option.kind === "brand_followers" || option.kind === "brand_circle_extended";
    const Icon = option.kind === "all_brand_people"
      ? BookOpen
      : option.kind === "brand_followers"
        ? Radio
        : option.kind === "brand_circle_extended"
          ? Network
          : option.kind === "manual_group"
            ? UsersRound
            : ShoppingBag;
    const audienceMeaning = option.kind === "all_brand_people"
      ? "Owned by your brand"
      : option.kind === "brand_followers" || option.kind === "brand_circle_extended"
        ? "Mingla reach"
        : option.kind === "manual_group"
          ? "Saved group"
          : "Automatic buyer group";
    const countLabel = option.status_label ?? `${option.buyer_count} ${peopleAudience ? (option.buyer_count === 1 ? "person" : "people") : (option.buyer_count === 1 ? "buyer" : "buyers")}`;
    return <Pressable key={option.key} disabled={option.disabled} onPress={() => { onSelect(option); onClose(); }} accessibilityRole="button"
      accessibilityLabel={`Pick audience ${option.name}. ${countLabel}. ${audienceMeaning}.${option.privacy_label ? ` ${option.privacy_label}.` : ""}${option.disabled ? " Unavailable." : ""}`}
      accessibilityState={{ selected: isSelected, disabled: option.disabled === true }} style={({ pressed }) => [styles.row, isSelected ? styles.rowSelected : null, option.disabled ? styles.rowDisabled : null, pressed ? styles.rowPressed : null]}>
      <View style={styles.rowIcon}><Icon size={20} color={isSelected ? accent.warm : textTokens.secondary} strokeWidth={2} /></View>
      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowName} numberOfLines={1}>{option.name}</Text>
          {option.privacy_label ? <Text style={styles.privacyPill}>{option.privacy_label}</Text> : null}
        </View>
        <Text style={styles.rowMeta}>{option.kind === "all_brand_people" && option.buyer_count === 0 ? "No saved people yet" : countLabel}</Text>
      </View>
      {isSelected ? <Check size={20} color={accent.warm} strokeWidth={2.5} /> : null}
    </Pressable>;
  };

  const renderLegacyOption = (option: AudienceOption): React.ReactElement => {
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
          {option.buyer_count}{" "}
          {option.buyer_count === 1 ? "buyer" : "buyers"}
          {" · "}
          {option.kind === "brand_buyers"
            ? "Brand rollup"
            : "Event buyers"}
        </Text>
      </Pressable>
    );
  };

  // SC-13 deliberately does not render the intermediate rework copy
  // "Choose Your Book or an Automatic buyer group." while the feature is OFF;
  // OFF preserves the exact origin/main copy and row semantics below.

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <View style={styles.host}>
        <Text style={styles.title}>{circleAudienceEnabled === true ? "Choose who gets this" : "Pick an audience"}</Text>
        <Text style={styles.subtitle}>
          {circleAudienceEnabled === true
            ? "Choose from your brand’s Book, its Mingla reach, or a saved group. Private contact details stay private."
            : manualGroupsEnabled === true
            ? "Choose Your Book, a Manual group, or an Automatic buyer group."
            : "Your Book shows active saved people; buyer lists come from paid orders."}
        </Text>
        {bookError !== null ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {bookError}
          </Text>
        ) : null}
        {isLoading ? (
          <View accessibilityLabel="Loading audiences" style={styles.skeletonList}>
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} width="100%" height={64} radius="lg" />
            ))}
          </View>
        ) : errorMessage !== null ? (
          <Text style={styles.errorText}>{errorMessage}</Text>
        ) : options === null || options.length === 0 ? (
          <View style={styles.emptyHost}>
            <Text style={styles.emptyText}>
              No audiences yet. Add people to Your Book or receive a paid order.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {circleAudienceEnabled === true ? [
              { title: "Your brand", data: options.filter((option) => option.kind === "all_brand_people") },
              { title: "Mingla reach", data: options.filter((option) => option.kind === "brand_followers" || option.kind === "brand_circle_extended") },
              { title: "Groups", data: options.filter((option) => option.kind === "manual_group") },
              { title: "Automatic", data: options.filter((option) => option.kind === "brand_buyers" || option.kind === "event_buyers") },
            ].map((section) => (
              <View key={section.title} style={styles.section}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>
                {section.data.length === 0 ? <Text style={styles.sectionEmpty}>None yet</Text> : section.data.map(renderOption)}
                {section.title === "Mingla reach" &&
                    circleReach?.followers.state === "unavailable" &&
                    onRetryCircleReach !== undefined ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry follower reach"
                    onPress={onRetryCircleReach}
                    style={({ pressed }) => [styles.retryButton, pressed ? styles.rowPressed : null]}
                  >
                    <Text style={styles.retryLabel}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            )) : manualGroupsEnabled === true ? [
              { title: "Your Book", data: options.filter((option) => option.kind === "all_brand_people") },
              { title: "Manual groups", data: options.filter((option) => option.kind === "manual_group") },
              { title: "Automatic groups", data: options.filter((option) => option.kind === "brand_buyers" || option.kind === "event_buyers") },
            ].map((section) => (
              <View key={section.title} style={styles.section}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>
                {section.data.length === 0 ? <Text style={styles.sectionEmpty}>None yet</Text> : section.data.map(renderOption)}
              </View>
            )) : options.map(renderLegacyOption)}
          </ScrollView>
        )}
        {circleAudienceEnabled === true ? (
          <Text style={styles.privacyNote}>
            Mingla keeps follower contact details hidden. You see names and reach totals only.
          </Text>
        ) : null}
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
  skeletonList: { flex: 1, gap: spacing.sm, paddingTop: spacing.md },
  emptyHost: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    overflow: "hidden",
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
  section: { gap: spacing.sm, marginBottom: spacing.lg },
  sectionTitle: { ...typography.labelCap, color: textTokens.secondary },
  sectionEmpty: { ...typography.bodySm, color: textTokens.tertiary, paddingVertical: spacing.xs },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Platform.OS === "android" ? "#1F2125" : glass.border.profileBase,
    backgroundColor: Platform.OS === "android" ? "#16181B" : glass.tint.profileBase,
    gap: spacing.sm,
  },
  rowSelected: {
    borderColor: accent.border,
    backgroundColor: Platform.OS === "android" ? "#2B1D15" : "rgba(235, 120, 37, 0.12)",
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowDisabled: { opacity: 0.52 },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Platform.OS === "android" ? "#1F2125" : "rgba(255,255,255,0.06)",
  },
  rowCopy: { flex: 1, gap: 3 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rowName: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  rowMeta: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  privacyPill: {
    ...typography.labelCap,
    color: textTokens.secondary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  privacyNote: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  retryButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
  },
  retryLabel: { ...typography.bodySm, color: accent.warm, fontWeight: "700" },
});
