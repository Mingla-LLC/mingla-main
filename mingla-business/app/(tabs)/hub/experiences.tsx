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

import { ActivitiesSnapInput } from "../../../src/components/experience/ActivitiesSnapInput";
import { ExperienceReviewCards } from "../../../src/components/experience/ExperienceReviewCards";
import { MenuSnapInput } from "../../../src/components/experience/MenuSnapInput";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Button } from "../../../src/components/ui/Button";
import { Toast } from "../../../src/components/ui/Toast";
import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { DESKTOP_HUB_GRID_COLUMNS } from "../../../src/constants/desktopLayout";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
import { useExperiencesByBrand } from "../../../src/hooks/useExperiencesByBrand";
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

function formatExperienceMeta(exp: VenueExperience): string | null {
  const parts: string[] = [];
  if (exp.capacityMin !== null && exp.capacityMax !== null) {
    parts.push(
      exp.capacityMin === exp.capacityMax
        ? `Up to ${exp.capacityMax} people`
        : `${exp.capacityMin}\u2013${exp.capacityMax} people`,
    );
  } else if (exp.capacityMax !== null) {
    parts.push(`Up to ${exp.capacityMax} people`);
  }
  if (exp.suggestedTimeOfDay) {
    parts.push(exp.suggestedTimeOfDay);
  }
  if (exp.intentTags.length > 0) {
    parts.push(exp.intentTags.join(" \u00b7 "));
  }
  return parts.length > 0 ? parts.join(" \u00b7 ") : null;
}

// META-ORCH-1059 Sub-B \u2014 map the raw events.status string to the routing union
// + a status chip so brands see lifecycle at a glance and taps land correctly.
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

function experienceStatusChip(status: string): {
  label: string;
  style: { backgroundColor: string };
  textStyle: { color: string };
} {
  if (status === "live" || status === "scheduled") {
    return {
      label: status === "live" ? "Live" : "Scheduled",
      style: { backgroundColor: semantic.successTint },
      textStyle: { color: semantic.success },
    };
  }
  if (status === "ended" || status === "cancelled") {
    return {
      label: status === "ended" ? "Ended" : "Cancelled",
      style: { backgroundColor: glass.tint.profileBase },
      textStyle: { color: textTokens.tertiary },
    };
  }
  return {
    label: "Draft",
    style: { backgroundColor: glass.tint.profileBase },
    textStyle: { color: textTokens.tertiary },
  };
}

interface ExperienceGenerationSurfaceProps {
  brandId: string;
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
  parseMode,
  copy,
  canSnap,
  SnapInput,
}: ExperienceGenerationSurfaceProps): React.ReactElement {
  const router = useRouter();
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

  const experiences = experiencesQuery.data ?? [];
  const showReview = phase === "review" || pending.length > 0;

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
      <ScrollView contentContainerStyle={styles.scrollContent}>
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
          <View style={[styles.expList, isWideDesktop && styles.desktopListGrid]}>
            {experiences.map((exp) => {
              const meta = formatExperienceMeta(exp);
              const statusForRouting = normalizeExperienceStatus(exp.status);
              const chip = experienceStatusChip(exp.status);
              return (
                <Pressable
                  key={exp.id}
                  onPress={() =>
                    router.push(
                      routeForEventRow({
                        id: exp.id,
                        event_type: "experience",
                        status: statusForRouting,
                      }) as never,
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Open experience ${exp.title}`}
                  style={({ pressed }) => [
                    styles.expCard,
                    isWideDesktop && styles.desktopListCell,
                    pressed && styles.expCardPressed,
                  ]}
                >
                  <GlassCard variant="elevated" padding={spacing.md}>
                    <View style={styles.expHeaderRow}>
                      <Text style={styles.expTitle} numberOfLines={1}>
                        {exp.title}
                      </Text>
                      <View style={[styles.statusChip, chip.style]}>
                        <Text style={[styles.statusChipText, chip.textStyle]}>
                          {chip.label}
                        </Text>
                      </View>
                    </View>
                    {exp.description !== null && (
                      <Text style={styles.expBody} numberOfLines={3}>
                        {exp.description}
                      </Text>
                    )}
                    {meta !== null && (
                      <Text style={styles.expTags}>{meta}</Text>
                    )}
                  </GlassCard>
                </Pressable>
              );
            })}
          </View>
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
    </>
  );
}

export default function HubExperiencesRoute(): React.ReactElement {
  const router = useRouter();
  const currentBrand = useCurrentBrand();

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
        parseMode="activities"
        copy={PLAY_COPY}
        canSnap={canGenerateExperiencesFromActivities(currentBrand)}
        SnapInput={ActivitiesSnapInput}
      />
    );
  }

  if (currentBrand.venueCategory === "creative_and_arts") {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
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
    <ScrollView contentContainerStyle={styles.scrollContent}>
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
  expCard: { marginBottom: spacing.sm },
  expCardPressed: { opacity: 0.9 },
  expHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  statusChipText: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: "700",
  },
  expTitle: {
    flex: 1,
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  expBody: {
    marginTop: spacing.xs,
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
  },
  expTags: {
    marginTop: spacing.xs,
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
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
