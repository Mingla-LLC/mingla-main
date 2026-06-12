/**
 * /hub/experiences — Ve5 Restaurant menu + Ve6 Play activities AI parsers.
 */

import React, { useCallback, useState } from "react";
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

import { ActivitiesSnapInput } from "../../../src/components/experience/ActivitiesSnapInput";
import { ExperienceListCard } from "../../../src/components/experience/ExperienceListCard";
import { ExperienceReviewCards } from "../../../src/components/experience/ExperienceReviewCards";
import { MenuSnapInput } from "../../../src/components/experience/MenuSnapInput";
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
  radius,
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
import {
  usePendingExperiences,
  type ExperienceParseMode,
} from "../../../src/hooks/usePendingExperiences";
import type { ExperienceFilePayload } from "../../../src/services/experienceGenerationService";
import type { VenueExperience } from "../../../src/services/experiencesService";
import { canGenerateExperiencesFromActivities } from "../../../src/utils/canGenerateExperiencesFromActivities";
import { canGenerateExperiencesFromMenu } from "../../../src/utils/canGenerateExperiencesFromMenu";
import {
  routeForEventRow,
  type EventStatusForRouting,
} from "../../../src/utils/routeForEventRow";

type HubPhase = "idle" | "parsing" | "review";

interface GenerationCopy {
  ctaTitle: string;
  ctaBody: string;
  ctaA11y: string;
  loadingText: string;
  emptyParseToast: string;
  parseErrorFallback: string;
  emptyListHint: string;
  unverifiedHint: string;
}

const RESTAURANT_COPY: GenerationCopy = {
  ctaTitle: "Snap your menu to generate experiences",
  ctaBody:
    "AI reads your menu and suggests offerings you can accept, edit, or reject.",
  ctaA11y: "Snap your menu to generate experiences",
  loadingText: "Reading your menu\u2026",
  emptyParseToast:
    "We couldn't find menu items in that file. Try a clearer photo of your menu.",
  parseErrorFallback: "Couldn't read your menu. Try again.",
  emptyListHint: "No experiences yet",
  unverifiedHint:
    "Once Mingla verifies your venue claim, you can generate experiences from your menu here.",
};

const PLAY_COPY: GenerationCopy = {
  ctaTitle: "Generate from your activities",
  ctaBody:
    "AI reads your activities or packages list and suggests experiences you can accept, edit, or reject.",
  ctaA11y: "Generate experiences from your activities list",
  loadingText: "Reading your activities\u2026",
  emptyParseToast:
    "We couldn't find activities in that file. Try a clearer photo of your activities list.",
  parseErrorFallback: "Couldn't read your activities list. Try again.",
  emptyListHint: "No experiences yet",
  unverifiedHint:
    "Once Mingla verifies your venue claim, you can generate experiences from your activities list here.",
};

// META-ORCH-1059 Sub-B \u2014 map the raw events.status string to the routing union.
// (The list card derives its own status chip from exp.status; routing for
// experiences ignores status, but we still pass the normalized value through.)
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

interface ExperienceGenerationSurfaceProps {
  brandId: string;
  /** META-ORCH-1059 — current brand slug, for the manage-sheet public/share routes. */
  brandSlug: string | null;
  parseMode: ExperienceParseMode;
  copy: GenerationCopy;
  canSnap: boolean;
  SnapInput: React.ComponentType<{
    visible: boolean;
    onCancel: () => void;
    onFilesReady: (files: ExperienceFilePayload[]) => void;
  }>;
}

function ExperienceGenerationSurface({
  brandId,
  brandSlug,
  parseMode,
  copy,
  canSnap,
  SnapInput,
}: ExperienceGenerationSurfaceProps): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isWideDesktop } = useResponsiveLayout();
  const experiencesQuery = useExperiencesByBrand(brandId);
  const {
    pending,
    parseFiles,
    isParsing,
    confirm,
    reject,
    isConfirming,
  } = usePendingExperiences(brandId, parseMode);

  const [snapSheetVisible, setSnapSheetVisible] = useState(false);
  const [phase, setPhase] = useState<HubPhase>("idle");
  const [toast, setToast] = useState<string | null>(null);
  // META-ORCH-1059 Pass 1 — Hub list-card 3-dot opens the shared manage sheet.
  const [manageExp, setManageExp] = useState<VenueExperience | null>(null);
  const [shareExp, setShareExp] = useState<VenueExperience | null>(null);
  const hasBrandSlug = brandSlug !== null && brandSlug.length > 0;

  const experiences = experiencesQuery.data ?? [];
  const showReview = phase === "review" || pending.length > 0;

  // ORCH-1123 [Hub multi-select draft delete] — long-press multi-select +
  // bulk soft-delete for DRAFT experiences only (first-ever experience delete,
  // server rank-gated). No filter pills here → selection auto-scopes via the
  // per-row `selectable` flag.
  const selection = useDraftMultiSelect();
  const discardOfferings = useDiscardOfferingDrafts();
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState<boolean>(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const handleBulkDeleteConfirm = useCallback(async (): Promise<void> => {
    const serverIds = experiences
      .filter((e) => e.status === "draft" && selection.isSelected(e.id))
      .map((e) => e.id);
    setBulkError(null);
    try {
      const result = await discardOfferings.mutateAsync({
        kind: "experience",
        brandId,
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
  }, [experiences, selection, discardOfferings, brandId]);

  const handleFilesReady = useCallback(
    async (files: ExperienceFilePayload[]) => {
      setSnapSheetVisible(false);
      setPhase("parsing");
      try {
        const result = await parseFiles(files);
        if (result.kind === "error") {
          setToast(result.message);
          setPhase("idle");
          return;
        }
        if (result.experiences_count === 0) {
          setToast(copy.emptyParseToast);
          setPhase("idle");
          return;
        }
        setPhase("review");
      } catch (e) {
        setToast(
          e instanceof Error ? e.message : copy.parseErrorFallback,
        );
        setPhase("idle");
      }
    },
    [copy.emptyParseToast, copy.parseErrorFallback, parseFiles],
  );

  // META-ORCH-1059 Sub-A (Layer 6): "Accept all" removed — AI proposals are
  // now DRAFT shells the brand finishes (stops + date + price) before publish;
  // bulk-publishing dated/stopped experiences is impossible. Each proposal is
  // set up individually via "Set up & publish".

  return (
    <>
      {/* META-ORCH-1059 fold-in fix: the floating absolute BottomNav tab bar
          (app/(tabs)/_layout.tsx) overlays the bottom of this ScrollView. The
          flat `paddingBottom: 120` left the last/only experience card UNDER the
          tab bar on devices with a gesture-nav inset (e.g. Samsung A72), so the
          card's Pressable could never receive the tap — it read as a dead tap
          that "freezes" the nav. Mirror the events-hub pattern
          (app/(tabs)/hub/events.tsx:553): pad by `insets.bottom + 120`. */}
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
      >
        {canSnap && (
          <Pressable
            onPress={() => setSnapSheetVisible(true)}
            disabled={isParsing}
            style={({ pressed }) => [
              styles.cta,
              pressed && styles.ctaPressed,
              isParsing && styles.ctaDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={copy.ctaA11y}
          >
            <Text style={styles.ctaTitle}>{copy.ctaTitle}</Text>
            <Text style={styles.ctaBody}>{copy.ctaBody}</Text>
          </Pressable>
        )}

        {(phase === "parsing" || isParsing) && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={accent.warm} />
            <Text style={styles.loadingText}>{copy.loadingText}</Text>
          </View>
        )}

        {showReview && (
          <ExperienceReviewCards
            pending={pending}
            isExecuting={isConfirming}
            onAccept={async (id, editedArgs) => {
              const response = await confirm({ id, edited_args: editedArgs });
              if (response.kind === "error") {
                setToast(response.message);
                return;
              }
              // META-ORCH-1059 Sub-A: the AI tool created a DRAFT shell (no
              // stops/date/ticket). The brand finishes it from the experiences
              // list (Sub-B wires the tap-to-edit). Surface the draft + nudge.
              if (pending.length <= 1) setPhase("idle");
              setToast("Draft created — add stops, a date and price to publish it.");
            }}
            onReject={async (id) => {
              const response = await reject(id);
              if (response.kind === "error") {
                setToast(response.message);
              }
            }}
          />
        )}

        <Text style={styles.sectionTitle}>Your experiences</Text>
        {experiencesQuery.isLoading ? (
          <ActivityIndicator style={styles.listLoader} />
        ) : experiences.length === 0 ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.emptyBody}>{copy.emptyListHint}</Text>
            <View style={styles.emptyCtaRow}>
              <Button
                label="Create experience"
                onPress={() => router.push("/experience/create" as never)}
                variant="primary"
                size="md"
                leadingIcon="sparkle"
              />
            </View>
          </GlassCard>
        ) : (
          <>
            {!selection.selectionMode &&
            experiences.some((e) => e.status === "draft") ? (
              <Text style={styles.selectHint}>
                Press and hold a draft to select multiple
              </Text>
            ) : null}
            <View style={[styles.expList, isWideDesktop && styles.desktopListGrid]}>
              {experiences.map((exp) => {
                const statusForRouting = normalizeExperienceStatus(exp.status);
                const isDraftRow = exp.status === "draft";
                return (
                  <View
                    key={exp.id}
                    style={isWideDesktop ? styles.desktopListCell : undefined}
                  >
                    {/* META-ORCH-1059 — proper offering-card row (cover thumb +
                        status pill + title + date·venue subline + price), matching
                        the events + trips lists. Tap opens the DASHBOARD via
                        routeForEventRow (experiences always resolve to
                        /experience/{id}); the dashboard owns the edit action. */}
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

      <SnapInput
        visible={snapSheetVisible}
        onCancel={() => setSnapSheetVisible(false)}
        onFilesReady={(files) => void handleFilesReady(files)}
      />

      <Toast
        visible={toast !== null}
        kind="info"
        message={toast ?? ""}
        onDismiss={() => setToast(null)}
      />

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
          list-card 3-dot. Edit · View public · Share · Cancel (Orders +
          Duplicate omitted — no experience orders/duplicate route yet). Cancel
          routes to the experience dashboard's typeToConfirm flow. */}
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
                    router.push(
                      `/exp/${brandSlug}/${manageExp.slug}` as never,
                    )
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
    </>
  );
}

export default function HubExperiencesRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentBrand = useCurrentBrand();
  // META-ORCH-1059 fold-in: clear the floating tab bar so empty-state CTAs
  // are never tappable-blocked (mirror the surface ScrollView fix).
  const emptyContentStyle = [
    styles.scrollContent,
    { paddingBottom: insets.bottom + 120 },
  ];

  if (currentBrand === null) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.body}>Select a brand to see its experiences.</Text>
      </View>
    );
  }

  if (currentBrand.venueCategory === "restaurant") {
    return (
      <ExperienceGenerationSurface
        brandId={currentBrand.id}
        brandSlug={currentBrand.slug}
        parseMode="menu"
        copy={RESTAURANT_COPY}
        canSnap={canGenerateExperiencesFromMenu(currentBrand)}
        SnapInput={MenuSnapInput}
      />
    );
  }

  if (currentBrand.venueCategory === "play") {
    return (
      <ExperienceGenerationSurface
        brandId={currentBrand.id}
        brandSlug={currentBrand.slug}
        parseMode="activities"
        copy={PLAY_COPY}
        canSnap={canGenerateExperiencesFromActivities(currentBrand)}
        SnapInput={ActivitiesSnapInput}
      />
    );
  }

  if (currentBrand.venueCategory === "creative_and_arts") {
    return (
      <ScrollView contentContainerStyle={emptyContentStyle}>
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.emptyTitle}>No experiences yet</Text>
          <Text style={styles.emptyBody}>Create experience</Text>
          <View style={styles.emptyCtaRow}>
            <Button
              label="Create experience"
              onPress={() => router.push("/experience/create" as never)}
              variant="primary"
              size="md"
              leadingIcon="sparkle"
            />
          </View>
        </GlassCard>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={emptyContentStyle}>
      <GlassCard variant="elevated" padding={spacing.lg}>
        <Text style={styles.emptyTitle}>No experiences yet</Text>
        <Text style={styles.emptyBody}>Create experience</Text>
        <View style={styles.emptyCtaRow}>
          <Button
            label="Create experience"
            onPress={() => router.push("/experience/create" as never)}
            variant="primary"
            size="md"
            leadingIcon="sparkle"
          />
        </View>
      </GlassCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing.md,
    paddingBottom: 120,
    gap: spacing.md,
  },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  body: {
    fontSize: typography.body.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
  },
  cta: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: glass.tint.profileElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
  },
  ctaPressed: { opacity: 0.9 },
  ctaDisabled: { opacity: 0.5 },
  ctaTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  ctaBody: {
    marginTop: spacing.xs,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  loadingText: {
    color: textTokens.secondary,
    fontSize: typography.body.fontSize,
  },
  sectionTitle: {
    marginTop: spacing.md,
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  listLoader: { marginVertical: spacing.lg },
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
  expList: {
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
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  emptyBody: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  emptyCtaRow: {
    flexDirection: "row",
    marginTop: spacing.md,
  },
});
