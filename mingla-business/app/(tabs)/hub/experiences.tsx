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

import { ActivitiesSnapInput } from "../../../src/components/experience/ActivitiesSnapInput";
import { ExperienceReviewCards } from "../../../src/components/experience/ExperienceReviewCards";
import { MenuSnapInput } from "../../../src/components/experience/MenuSnapInput";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Toast } from "../../../src/components/ui/Toast";
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
  emptyListHint: "No experiences yet. Snap your menu to generate your first ones.",
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
  emptyListHint:
    "No experiences yet. Generate from your activities list to create your first ones.",
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

  const handleAcceptAll = useCallback(async () => {
    for (const row of pending) {
      const response = await confirm({ id: row.id });
      if (response.kind === "error") {
        setToast(response.message);
        return;
      }
    }
    setPhase("idle");
    setToast("Experiences published to your venue.");
  }, [confirm, pending]);

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
              if (pending.length <= 1) setPhase("idle");
            }}
            onReject={async (id) => {
              const response = await reject(id);
              if (response.kind === "error") {
                setToast(response.message);
              }
            }}
            onAcceptAll={handleAcceptAll}
          />
        )}

        <Text style={styles.sectionTitle}>Your experiences</Text>
        {experiencesQuery.isLoading ? (
          <ActivityIndicator style={styles.listLoader} />
        ) : experiences.length === 0 ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.emptyBody}>{copy.emptyListHint}</Text>
          </GlassCard>
        ) : (
          <View style={[styles.expList, isWideDesktop && styles.desktopListGrid]}>
            {experiences.map((exp) => {
              const meta = formatExperienceMeta(exp);
              return (
                <View
                  key={exp.id}
                  style={[
                    styles.expCard,
                    isWideDesktop && styles.desktopListCell,
                  ]}
                >
                  <GlassCard variant="elevated" padding={spacing.md}>
                    <Text style={styles.expTitle}>{exp.title}</Text>
                    {exp.description !== null && (
                      <Text style={styles.expBody} numberOfLines={3}>
                        {exp.description}
                      </Text>
                    )}
                    {meta !== null && (
                      <Text style={styles.expTags}>{meta}</Text>
                    )}
                  </GlassCard>
                </View>
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
          <Text style={styles.emptyTitle}>Schedule snap coming soon</Text>
          <Text style={styles.emptyBody}>
            Creative &amp; Arts venues will get schedule-based AI experience generation in an
            upcoming release.
          </Text>
        </GlassCard>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <GlassCard variant="elevated" padding={spacing.lg}>
        <Text style={styles.emptyTitle}>Experiences unavailable for this venue</Text>
        <Text style={styles.emptyBody}>
          This venue category does not support AI experience generation yet.
        </Text>
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
  expTitle: {
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
});
