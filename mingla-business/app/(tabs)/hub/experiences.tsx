/**
 * /hub/experiences — Hub > Experiences sub-route.
 *
 * ORCH-1144 — venue-category-agnostic. Both experience parsers (Ve5 food menu,
 * Ve6 activities) reach EVERY brand via the in-sheet experience chooser
 * (UniversalCreatorSheet step "experience" → /experience/snap?mode=…). The
 * "New experience" empty-state CTA here opens that same sheet directly at the
 * experience step (initialStep="experience"). Do NOT reintroduce a
 * `venueCategory` branch or a `canGenerate*` predicate to gate reaching a
 * parser — see I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC. The snap/parse/review
 * machinery now lives on the dedicated /experience/snap route; this tab is a
 * plain drafts/live list at parity with the Trips & Events tabs (filter pills +
 * All/Upcoming/Past/Drafts buckets + per-filter empty states + multi-select).
 *
 * Mirrors trips.tsx (4 pills — experiences have no "live" pulse). Reuses the
 * shared ExperienceListCard / useDraftMultiSelect / useDiscardOfferingDrafts /
 * DraftSelectBar / OfferingManageSheet / useExperiencesByBrand stack.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ExperienceListCard } from "../../../src/components/experience/ExperienceListCard";
import { UniversalCreatorSheet } from "../../../src/components/ui/UniversalCreatorSheet";
import {
  OfferingManageSheet,
  buildOfferingManageActions,
} from "../../../src/components/offering/OfferingManageSheet";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Button } from "../../../src/components/ui/Button";
import { ConfirmDialog } from "../../../src/components/ui/ConfirmDialog";
import { ShareModal } from "../../../src/components/ui/ShareModal";
import { Toast } from "../../../src/components/ui/Toast";
import { DraftSelectBar } from "../../../src/components/offering/DraftSelectBar";
import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { DESKTOP_HUB_GRID_COLUMNS } from "../../../src/constants/desktopLayout";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import { useDraftMultiSelect } from "../../../src/hooks/useDraftMultiSelect";
import { useDiscardOfferingDrafts } from "../../../src/hooks/useDiscardOfferingDrafts";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
import { useExperiencesByBrand } from "../../../src/hooks/useExperiencesByBrand";
import { HapticFeedback } from "../../../src/utils/hapticFeedback";
import type { VenueExperience } from "../../../src/services/experiencesService";
import {
  routeForEventRow,
  type EventStatusForRouting,
} from "../../../src/utils/routeForEventRow";

// META-ORCH-1059 Sub-B — map the raw events.status string to the routing union.
function normalizeExperienceStatus(status: string): EventStatusForRouting {
  switch (status) {
    case "draft":
    case "scheduled":
    case "live":
    case "ended":
    case "cancelled":
      return status;
    default:
      return null;
  }
}

// ORCH-1123 — combined no-silent-failure toast tally (verbatim DESIGN §6.2).
const bulkToastMessage = (deleted: number, failed: number): string => {
  if (failed === 0) {
    return `Deleted ${deleted} draft${deleted === 1 ? "" : "s"}.`;
  }
  if (deleted > 0) {
    return `Deleted ${deleted}, ${failed} couldn't be deleted.`;
  }
  return `Couldn't delete ${failed} draft${failed === 1 ? "" : "s"}. You may not have permission.`;
};

const bulkDeleteErrorMessage = (error: unknown): string => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (message.includes("insufficient_event_permission")) {
    return "You do not have permission to delete these drafts for this brand.";
  }
  return "Could not delete these drafts. Try again.";
};

type ExperienceFilter = "all" | "upcoming" | "past" | "draft";

interface PillSpec {
  key: ExperienceFilter;
  label: string;
  count: number;
}

// ORCH-1144 — single UNIFIED (category-agnostic) empty-state hint. Replaces the
// old per-category RESTAURANT_COPY/PLAY_COPY emptyListHint fields; there is now
// exactly one experiences empty state for every brand. Do NOT reintroduce a
// venueCategory branch (see I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC).
const emptyListHint =
  "Tap + to create your first one. Snap a menu and Mingla drafts it for you, or build it yourself.";

// ORCH-1144 — experiences may lack a clean end date (the When draft can be
// unset / per-stop). Bucket on status, treating a dateSubline that resolves to
// "Ended" as past; everything non-draft/non-ended is upcoming. Mirrors
// deriveTripFilterBucket (trips.tsx).
function deriveExperienceFilterBucket(
  exp: VenueExperience,
): "upcoming" | "past" | "draft" {
  if (exp.status === "draft") return "draft";
  if (exp.status === "ended" || exp.status === "cancelled") return "past";
  if (exp.dateSubline.includes("Ended")) return "past";
  return "upcoming";
}

export default function HubExperiencesRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const currentBrand = useCurrentBrand();
  const experiencesQuery = useExperiencesByBrand(currentBrand?.id ?? null);

  const experiences = useMemo<VenueExperience[]>(
    () => experiencesQuery.data ?? [],
    [experiencesQuery.data],
  );

  const brandSlug = currentBrand?.slug ?? null;
  const hasBrandSlug = brandSlug !== null && brandSlug.length > 0;

  const buckets = useMemo<
    Record<"upcoming" | "past" | "draft", VenueExperience[]>
  >(() => {
    const upcoming: VenueExperience[] = [];
    const past: VenueExperience[] = [];
    const draft: VenueExperience[] = [];
    for (const e of experiences) {
      const b = deriveExperienceFilterBucket(e);
      if (b === "upcoming") upcoming.push(e);
      else if (b === "past") past.push(e);
      else draft.push(e);
    }
    // Stable, glanceable order: drafts newest-first by createdAt.
    draft.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    upcoming.sort((a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
    );
    past.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return { upcoming, past, draft };
  }, [experiences]);

  const counts = useMemo<Record<ExperienceFilter, number>>(
    () => ({
      all: experiences.length,
      upcoming: buckets.upcoming.length,
      past: buckets.past.length,
      draft: buckets.draft.length,
    }),
    [experiences.length, buckets],
  );

  const defaultFilter = useMemo<ExperienceFilter>((): ExperienceFilter => {
    if (counts.upcoming > 0) return "upcoming";
    if (counts.draft > 0) return "draft";
    if (counts.past > 0) return "past";
    return "all";
  }, [counts]);

  const [filter, setFilter] = useState<ExperienceFilter>(defaultFilter);
  const [manageExp, setManageExp] = useState<VenueExperience | null>(null);
  const [shareExp, setShareExp] = useState<VenueExperience | null>(null);
  // ORCH-1144 UX refinement — the "New experience" CTA opens the shared
  // UniversalCreatorSheet directly at its experience step (the 3-option chooser),
  // instead of pushing a separate /experience/choose route.
  const [creatorOpen, setCreatorOpen] = useState<boolean>(false);

  // ORCH-1123 [Hub multi-select draft delete] — long-press multi-select +
  // bulk soft-delete for DRAFT experiences only (server rank-gated).
  const selection = useDraftMultiSelect();
  const discardOfferings = useDiscardOfferingDrafts();
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState<boolean>(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handleBulkDeleteConfirm = useCallback(async (): Promise<void> => {
    if (currentBrand === null) return;
    const serverIds = experiences
      .filter((e) => e.status === "draft" && selection.isSelected(e.id))
      .map((e) => e.id);
    setBulkError(null);
    try {
      const result = await discardOfferings.mutateAsync({
        kind: "experience",
        brandId: currentBrand.id,
        serverEventIds: serverIds,
      });
      const deleted = result.rows.filter((r) => r.outcome === "deleted").length;
      const failed = result.rows.filter((r) => r.outcome !== "deleted").length;
      setBulkConfirmOpen(false);
      selection.exit();
      setToast(bulkToastMessage(deleted, failed));
    } catch (error) {
      setBulkError(bulkDeleteErrorMessage(error));
    }
  }, [currentBrand, experiences, selection, discardOfferings]);

  const filteredExperiences = useMemo<VenueExperience[]>(() => {
    if (filter === "all") {
      return [...buckets.upcoming, ...buckets.draft, ...buckets.past];
    }
    return buckets[filter];
  }, [filter, buckets]);

  const pillSpecs = useMemo<PillSpec[]>(
    () => [
      { key: "all", label: "All", count: counts.all },
      { key: "upcoming", label: "Upcoming", count: counts.upcoming },
      { key: "past", label: "Past", count: counts.past },
      { key: "draft", label: "Drafts", count: counts.draft },
    ],
    [counts],
  );

  // ----- States (brand-missing / loading / error) -----

  if (currentBrand === null) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.body}>Select a brand to see its experiences.</Text>
      </View>
    );
  }

  if (experiencesQuery.isLoading) {
    return (
      <View style={styles.stateHost}>
        <ActivityIndicator />
      </View>
    );
  }

  if (experiencesQuery.isError) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.title}>Couldn&rsquo;t load experiences</Text>
        <Text style={styles.body}>
          {experiencesQuery.error instanceof Error
            ? experiencesQuery.error.message
            : "Check your connection and try again."}
        </Text>
      </View>
    );
  }

  // ----- Render ----------------------------------------------------------

  return (
    <View style={styles.host}>
      {/* Filter pills row — sibling to the list ScrollView. flexGrow:0
          mandatory per the double-ScrollView footgun
          (feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillsRow}
        style={styles.pillsScroll}
      >
        {pillSpecs.map((p) => {
          const active = filter === p.key;
          return (
            <Pressable
              key={p.key}
              onPress={() => {
                if (p.key !== "draft") selection.exit();
                setFilter(p.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${p.label}, ${p.count}`}
              hitSlop={{ top: 5, bottom: 5, left: 0, right: 0 }}
              style={({ pressed }) => [
                styles.pill,
                active && styles.pillActive,
                pressed && styles.pillPressed,
              ]}
            >
              <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>
                {p.label}
              </Text>
              <Text style={[styles.pillCount, active && styles.pillCountActive]}>
                {p.count}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {filteredExperiences.length === 0 ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.emptyTitle}>
              {filter === "all" ? "No experiences yet" : "No experiences here"}
            </Text>
            <Text style={styles.emptyBody}>
              {filter === "all"
                ? emptyListHint
                : filter === "draft"
                  ? "No drafts in progress. Tap + to build one."
                  : `Tap "All" to see everything.`}
            </Text>
            {filter === "all" || filter === "draft" ? (
              <View style={styles.emptyCtaRow}>
                <Button
                  label="New experience"
                  onPress={() => setCreatorOpen(true)}
                  variant="primary"
                  size="md"
                  leadingIcon="sparkle"
                />
              </View>
            ) : null}
          </GlassCard>
        ) : (
          <>
            {!selection.selectionMode &&
            filteredExperiences.some((e) => e.status === "draft") ? (
              <Text style={styles.selectHint}>
                Press and hold a draft to select multiple
              </Text>
            ) : null}
            <View
              style={[styles.list, isWideDesktop && styles.desktopListGrid]}
            >
              {filteredExperiences.map((exp) => {
                const statusForRouting = normalizeExperienceStatus(exp.status);
                const isDraftRow = exp.status === "draft";
                return (
                  <View
                    key={exp.id}
                    style={isWideDesktop ? styles.desktopListCell : undefined}
                  >
                    <ExperienceListCard
                      experience={exp}
                      onOpen={
                        selection.selectionMode && isDraftRow
                          ? () => selection.toggle(exp.id)
                          : () =>
                              router.push(
                                routeForEventRow({
                                  id: exp.id,
                                  event_type: "experience",
                                  status: statusForRouting,
                                }) as never,
                              )
                      }
                      onManageOpen={() => setManageExp(exp)}
                      selectionMode={selection.selectionMode}
                      selectable={isDraftRow}
                      selected={selection.isSelected(exp.id)}
                      onLongPress={
                        isDraftRow
                          ? () => {
                              HapticFeedback.selectionEnter();
                              selection.enterWith(exp.id);
                            }
                          : undefined
                      }
                    />
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {/* ORCH-1123 — bulk-delete ConfirmDialog (simple destructive variant). */}
      <ConfirmDialog
        visible={bulkConfirmOpen}
        onClose={() => {
          if (!discardOfferings.isPending) {
            setBulkConfirmOpen(false);
            setBulkError(null);
          }
        }}
        onConfirm={handleBulkDeleteConfirm}
        title={
          selection.count === 1
            ? "Delete this draft?"
            : `Delete ${selection.count} drafts?`
        }
        description={
          selection.count === 1
            ? "This draft will be permanently removed. This can't be undone."
            : `These ${selection.count} drafts will be permanently removed. This can't be undone.`
        }
        variant="simple"
        confirmLabel={
          selection.count === 1 ? "Delete draft" : `Delete ${selection.count}`
        }
        cancelLabel="Keep"
        confirmLoading={discardOfferings.isPending}
        confirmDisabled={discardOfferings.isPending}
        closeDisabled={discardOfferings.isPending}
        errorMessage={bulkError}
        testID="bulk-delete-confirm"
        confirmTestID="bulk-delete-confirm-button"
        cancelTestID="bulk-delete-cancel-button"
        destructive
      />

      {/* ORCH-1123 — sticky bulk-select action bar (drafts only). */}
      {selection.selectionMode ? (
        <DraftSelectBar
          count={selection.count}
          deleting={discardOfferings.isPending}
          onCancel={selection.exit}
          onDelete={() => setBulkConfirmOpen(true)}
          bottomInset={insets.bottom}
        />
      ) : null}

      {/* META-ORCH-1059 Pass 1 — shared per-kind manage sheet opened from a
          list-card 3-dot. Edit · View public · Share · Cancel. */}
      {manageExp !== null ? (
        <OfferingManageSheet
          visible
          onClose={() => setManageExp(null)}
          kind="experience"
          actions={buildOfferingManageActions(
            "experience",
            {
              onEdit: () =>
                router.push(`/experience/${manageExp.id}/edit` as never),
              onViewPublic: hasBrandSlug
                ? () =>
                    router.push(`/exp/${brandSlug}/${manageExp.slug}` as never)
                : undefined,
              onShare: hasBrandSlug ? () => setShareExp(manageExp) : undefined,
              onCancel:
                manageExp.status !== "ended" &&
                manageExp.status !== "cancelled" &&
                manageExp.status !== "draft"
                  ? () => router.push(`/experience/${manageExp.id}` as never)
                  : undefined,
            },
            () => setManageExp(null),
          )}
        />
      ) : null}

      {shareExp !== null && hasBrandSlug ? (
        <ShareModal
          visible
          onClose={() => setShareExp(null)}
          url={`https://business.usemingla.com/exp/${brandSlug}/${shareExp.slug}`}
          title={`${shareExp.title} on Mingla`}
          description={
            shareExp.description !== null && shareExp.description.length > 0
              ? shareExp.description.slice(0, 200)
              : shareExp.title
          }
        />
      ) : null}

      <Toast
        visible={toast !== null}
        kind="info"
        message={toast ?? ""}
        onDismiss={() => setToast(null)}
      />

      {/* ORCH-1144 UX refinement — the "New experience" CTA opens the shared
          creator sheet straight at its experience chooser step. Mounted only
          while open; resets to the experience step on each open. The in-step
          back affordance is omitted in this mode (no root to return to). */}
      {creatorOpen ? (
        <UniversalCreatorSheet
          visible
          initialStep="experience"
          onClose={() => setCreatorOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
  // ORCH-1123 — long-press discoverability caption.
  selectHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.tertiary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
  desktopListGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 0,
    marginHorizontal: -spacing.xs,
  },
  desktopListCell: {
    width: `${100 / DESKTOP_HUB_GRID_COLUMNS}%`,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  pillsScroll: {
    paddingVertical: spacing.sm,
    // ORCH-0857 [Hub events list flush-with-pills] precedent — flexGrow:0
    // mandatory to avoid double-ScrollView vertical space split.
    flexGrow: 0,
    flexShrink: 0,
  },
  pillsRow: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  pill: {
    height: 34,
    paddingHorizontal: spacing.md - 2,
    borderRadius: radiusTokens.full,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.55)",
    backgroundColor: glass.tint.profileBase,
  },
  pillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  pillPressed: {
    opacity: 0.7,
  },
  pillLabel: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "500",
    color: textTokens.primary,
  },
  pillLabelActive: {
    color: textTokens.primary,
  },
  pillCount: {
    fontSize: 11,
    fontWeight: "600",
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  pillCountActive: {
    color: accent.warm,
  },
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  emptyCtaRow: {
    flexDirection: "row",
    marginTop: spacing.md,
  },
});
