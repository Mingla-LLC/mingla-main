/**
 * VenueClaimFeedbackSheet — the business owner's punch-list for an admin
 * feedback round. DESIGN_ORCH-1064 §3-4 (binding visuals) + SPEC §6.2.
 *
 * Surface 2 of ORCH-1064: a full-height sheet listing the active round's items
 * grouped by category, each with an Open/Fixed pill toggle (optimistic, wired to
 * biz_mark_feedback_item_fixed), an optional overall-message banner, a progress
 * meter, and a pinned always-enabled "Re-submit for review" CTA (wired to
 * biz_resubmit_venue_claim). All 9 states handled (DESIGN §4).
 *
 * Tokens only. Android opaque-glass is satisfied by the Sheet primitive's
 * FALLBACK_BACKGROUND (≥0.92) — this component fills children only.
 */

import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";
import { HapticFeedback } from "../../utils/hapticFeedback";
import {
  useVenueClaimFeedback,
  type MarkFixedVars,
} from "../../hooks/useVenueClaimFeedback";
import type {
  FeedbackCategory,
  VenueClaimFeedbackItem,
} from "../../services/venueClaimService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { Skeleton } from "../ui/Skeleton";

export interface VenueClaimFeedbackSheetProps {
  visible: boolean;
  brand: Brand | null;
  accountId?: string | null;
  onClose: () => void;
  /** Parent fires the success Toast + lands the user on the Hub. */
  onResubmitted?: (brandId: string) => void;
  /** Parent raises an action-error toast (offline toggle / re-submit). */
  onActionError?: (message: string) => void;
}

// DESIGN §3.5 — fixed group order + label + icon map.
const CATEGORY_ORDER: FeedbackCategory[] = [
  "photos",
  "address",
  "hours",
  "category",
  "description",
  "quality",
  "other",
];

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  photos: "Photos",
  address: "Address",
  hours: "Hours",
  category: "Category",
  description: "Description",
  quality: "Listing quality",
  other: "Other",
};

const CATEGORY_ICON: Record<FeedbackCategory, IconName> = {
  photos: "eye",
  address: "location",
  hours: "clock",
  category: "tag",
  description: "notebook",
  quality: "sparkle",
  other: "flag",
};

export function VenueClaimFeedbackSheet({
  visible,
  brand,
  accountId,
  onClose,
  onResubmitted,
  onActionError,
}: VenueClaimFeedbackSheetProps): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  const brandId = brand?.id ?? null;

  const {
    query,
    items,
    openCount,
    fixedCount,
    totalCount,
    overallMessage,
    markFixed,
    resubmit,
  } = useVenueClaimFeedback({
    brandId,
    followUpAt: brand?.claimFollowUpAt ?? null,
    accountId,
  });

  const handleToggle = useCallback(
    (item: VenueClaimFeedbackItem): void => {
      const next = item.status !== "fixed";
      if (next) HapticFeedback.success();
      else HapticFeedback.buttonPress();
      const vars: MarkFixedVars = { feedbackId: item.id, fixed: next };
      markFixed.mutate(vars, {
        onError: (err) => {
          onActionError?.(
            err instanceof Error && err.message
              ? "You're offline — that change didn't save. Try again when you're back."
              : "Couldn't update that item. Try again.",
          );
        },
      });
    },
    [markFixed, onActionError],
  );

  const handleResubmit = useCallback((): void => {
    if (brandId === null) return;
    resubmit.mutate(undefined, {
      onSuccess: () => {
        HapticFeedback.success();
        onResubmitted?.(brandId);
        onClose();
      },
      onError: () => {
        onActionError?.(
          "Couldn't re-submit — you're offline. We'll keep your fixes; try again when you're back.",
        );
      },
    });
  }, [brandId, resubmit, onResubmitted, onActionError, onClose]);

  if (brand === null) return null;

  // Group items by category, preserving the fixed order; omit empty groups.
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    rows: items.filter((i) => i.category === category),
  })).filter((g) => g.rows.length > 0);

  const isLoading = query.isLoading && visible;
  const isError = query.isError;
  const isEmpty = !isLoading && !isError && totalCount === 0;
  const allFixed = totalCount > 0 && openCount === 0;
  const isResubmitting = resubmit.isPending;

  const ctaBottomPad = insets.bottom + spacing.md;

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Text style={styles.headerTitle}>Updates requested</Text>
        <Text style={styles.headerSubtitle}>{brand.displayName}</Text>

        {/* Loading */}
        {isLoading ? (
          <View accessibilityLabel="Loading feedback">
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.itemCard}>
                <Skeleton width="80%" height={14} />
                <View style={styles.skeletonGap} />
                <Skeleton width="55%" height={14} />
              </View>
            ))}
          </View>
        ) : null}

        {/* Error */}
        {isError ? (
          <View style={[styles.itemCard, styles.errorCard]}>
            <View style={styles.errorRow}>
              <Icon name="flag" size={18} color={semantic.error} />
              <Text style={styles.errorTitle}>Couldn&apos;t load your feedback</Text>
            </View>
            <Text style={styles.errorBody}>
              Something hiccuped on our end. Tap to try again.
            </Text>
            <Button
              label="Try again"
              variant="secondary"
              size="md"
              onPress={() => void query.refetch()}
            />
          </View>
        ) : null}

        {/* Empty (defensive) */}
        {isEmpty ? (
          <View style={styles.emptyWrap}>
            <Icon name="sparkle" size={28} color={textTokens.tertiary} />
            <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
            <Text style={styles.emptyBody}>
              No open items right now. If you just fixed everything, re-submit
              below to get another review.
            </Text>
          </View>
        ) : null}

        {/* Populated */}
        {!isLoading && !isError && totalCount > 0 ? (
          <>
            {overallMessage ? (
              <View style={styles.messageCard}>
                <Icon name="chat" size={18} color={accent.warm} />
                <View style={styles.messageCol}>
                  <Text style={styles.messageEyebrow}>
                    A note from the Mingla team
                  </Text>
                  <Text style={styles.messageBody}>{overallMessage}</Text>
                </View>
              </View>
            ) : null}

            {/* Progress meter */}
            <View
              style={styles.progressRow}
              accessibilityRole="progressbar"
              accessibilityLabel="Feedback progress"
              accessibilityValue={{ min: 0, max: totalCount, now: fixedCount }}
            >
              <Text style={styles.progressLabel}>
                {allFixed
                  ? `All ${totalCount} addressed — ready to re-submit`
                  : `${fixedCount} of ${totalCount} addressed`}
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${
                        totalCount > 0 ? (fixedCount / totalCount) * 100 : 0
                      }%`,
                    },
                  ]}
                />
              </View>
            </View>

            {/* Category groups */}
            {grouped.map((group, gi) => (
              <View key={group.category}>
                <View
                  style={[
                    styles.groupHeaderRow,
                    gi === 0 && styles.groupHeaderFirst,
                  ]}
                >
                  <Icon
                    name={CATEGORY_ICON[group.category]}
                    size={16}
                    color={textTokens.tertiary}
                  />
                  <Text style={styles.groupHeader}>
                    {CATEGORY_LABEL[group.category]}
                  </Text>
                </View>
                {group.rows.map((item) => {
                  const fixed = item.status === "fixed";
                  return (
                    <View
                      key={item.id}
                      style={[styles.itemCard, fixed && styles.itemCardFixed]}
                    >
                      <Text
                        style={[
                          styles.itemNote,
                          fixed && styles.itemNoteFixed,
                        ]}
                      >
                        {item.note}
                      </Text>
                      <Pressable
                        onPress={() => handleToggle(item)}
                        disabled={isResubmitting}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: fixed }}
                        accessibilityLabel={
                          fixed
                            ? "Marked fixed, tap to reopen"
                            : "Mark this item fixed"
                        }
                        hitSlop={{
                          top: spacing.sm,
                          bottom: spacing.sm,
                          left: spacing.sm,
                          right: spacing.sm,
                        }}
                        style={({ pressed }) => [
                          styles.toggle,
                          fixed ? styles.toggleFixed : styles.toggleOpen,
                          pressed && styles.togglePressed,
                        ]}
                      >
                        <Icon
                          name="check"
                          size={18}
                          color={fixed ? semantic.success : accent.warm}
                        />
                        <Text
                          style={[
                            styles.toggleLabel,
                            { color: fixed ? semantic.success : accent.warm },
                          ]}
                        >
                          {fixed ? "Fixed" : "Mark fixed"}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>

      {/* Pinned CTA (outside the scroller, thumb zone) — visible whenever there
          is something to re-submit against (populated or empty recovery). */}
      {!isLoading && !isError ? (
        <View style={[styles.ctaWrap, { paddingBottom: ctaBottomPad }]}>
          {totalCount > 0 ? (
            <Text
              style={[
                styles.helperLine,
                allFixed ? styles.helperLineDone : styles.helperLineOpen,
              ]}
            >
              {allFixed
                ? "All set. Send it back for review."
                : `${openCount} item${
                    openCount === 1 ? "" : "s"
                  } still open. You can re-submit now, or fix them first.`}
            </Text>
          ) : null}
          <Button
            label="Re-submit for review"
            variant="primary"
            size="lg"
            fullWidth
            loading={isResubmitting}
            onPress={handleResubmit}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  headerTitle: {
    ...typography.h3,
    color: textTokens.primary,
    marginBottom: spacing.xxs,
  },
  headerSubtitle: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    marginBottom: spacing.md,
  },
  skeletonGap: {
    height: spacing.sm,
  },
  // Overall-message banner
  messageCard: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.md,
    padding: spacing.md,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  messageCol: {
    flex: 1,
  },
  messageEyebrow: {
    ...typography.caption,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  messageBody: {
    ...typography.bodySm,
    lineHeight: 20,
    color: textTokens.primary,
    marginTop: spacing.xxs,
  },
  // Progress meter
  progressRow: {
    marginBottom: spacing.md,
  },
  progressLabel: {
    ...typography.caption,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  progressTrack: {
    height: 4,
    borderRadius: radius.full,
    backgroundColor: glass.border.profileBase,
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
    borderRadius: radius.full,
    backgroundColor: semantic.success,
  },
  // Category group
  groupHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  groupHeaderFirst: {
    marginTop: 0,
  },
  groupHeader: {
    ...typography.labelCap,
    textTransform: "uppercase",
    color: textTokens.tertiary,
  },
  // Item card
  itemCard: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.md,
    padding: spacing.md,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  itemCardFixed: {
    backgroundColor: "rgba(34, 197, 94, 0.08)",
    borderColor: "rgba(34, 197, 94, 0.32)",
  },
  itemNote: {
    ...typography.bodySm,
    lineHeight: 20,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  itemNoteFixed: {
    color: textTokens.tertiary,
  },
  // Open/Fixed pill toggle
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-end",
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  toggleOpen: {
    backgroundColor: "transparent",
    borderColor: accent.border,
  },
  toggleFixed: {
    backgroundColor: semantic.successTint,
    borderColor: "rgba(34, 197, 94, 0.45)",
  },
  togglePressed: {
    opacity: 0.7,
  },
  toggleLabel: {
    ...typography.caption,
    fontWeight: "600",
  },
  // Error
  errorCard: {
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    borderColor: "rgba(239, 68, 68, 0.32)",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  errorTitle: {
    ...typography.bodySm,
    fontWeight: "600",
    color: semantic.error,
  },
  errorBody: {
    ...typography.caption,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  // Empty
  emptyWrap: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.h3,
    color: textTokens.primary,
  },
  emptyBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  // Pinned CTA
  ctaWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  helperLine: {
    ...typography.caption,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  helperLineOpen: {
    color: textTokens.tertiary,
  },
  helperLineDone: {
    color: semantic.success,
  },
});
