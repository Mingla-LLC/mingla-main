/**
 * /hub/experiences — ORCH-0881 Ve5 Menu AI Parser → Restaurant Experiences.
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
import { usePendingExperiences } from "../../../src/hooks/usePendingExperiences";
import type { MenuFilePayload } from "../../../src/services/experienceGenerationService";
import { canGenerateExperiencesFromMenu } from "../../../src/utils/canGenerateExperiencesFromMenu";

type HubPhase = "idle" | "parsing" | "review";

export default function HubExperiencesRoute(): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const currentBrand = useCurrentBrand();
  const brandId = currentBrand?.id ?? null;
  const canSnap = canGenerateExperiencesFromMenu(currentBrand);

  const experiencesQuery = useExperiencesByBrand(brandId);
  const {
    pending,
    parseMenu,
    isParsing,
    confirm,
    reject,
    isConfirming,
  } = usePendingExperiences(brandId);

  const [snapSheetVisible, setSnapSheetVisible] = useState(false);
  const [phase, setPhase] = useState<HubPhase>("idle");
  const [toast, setToast] = useState<string | null>(null);

  const experiences = experiencesQuery.data ?? [];
  const showReview = phase === "review" || pending.length > 0;

  const handleFilesReady = useCallback(
    async (files: MenuFilePayload[]) => {
      setSnapSheetVisible(false);
      setPhase("parsing");
      try {
        const result = await parseMenu(files);
        if (result.kind === "error") {
          setToast(result.message);
          setPhase("idle");
          return;
        }
        if (result.experiences_count === 0) {
          setToast(
            "We couldn't find menu items in that file. Try a clearer photo of your menu.",
          );
          setPhase("idle");
          return;
        }
        setPhase("review");
      } catch (e) {
        setToast(
          e instanceof Error ? e.message : "Couldn't read your menu. Try again.",
        );
        setPhase("idle");
      }
    },
    [parseMenu],
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

  if (currentBrand === null) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.body}>Select a brand to see its experiences.</Text>
      </View>
    );
  }

  if (currentBrand.kind === "physical" && currentBrand.claimStatus !== "verified") {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.emptyTitle}>Experiences are for verified physical venues</Text>
          <Text style={styles.emptyBody}>
            Once Mingla verifies your venue claim, you can generate experiences from your
            menu here.
          </Text>
        </GlassCard>
      </ScrollView>
    );
  }

  if (currentBrand.kind === "physical" && currentBrand.venueCategory !== "restaurant") {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.emptyTitle}>Restaurant menu snap coming for your category</Text>
          <Text style={styles.emptyBody}>
            Play and Creative &amp; Arts venues get their own AI parsers in upcoming
            releases. For now, experiences for restaurants use menu photography.
          </Text>
        </GlassCard>
      </ScrollView>
    );
  }

  if (currentBrand.kind !== "physical") {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.emptyTitle}>Experiences are for verified physical venues</Text>
          <Text style={styles.emptyBody}>
            Switch to a verified restaurant venue to generate single-intent experiences.
          </Text>
        </GlassCard>
      </ScrollView>
    );
  }

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
            accessibilityLabel="Snap your menu to generate experiences"
          >
            <Text style={styles.ctaTitle}>Snap your menu to generate experiences</Text>
            <Text style={styles.ctaBody}>
              AI reads your menu and suggests offerings you can accept, edit, or reject.
            </Text>
          </Pressable>
        )}

        {(phase === "parsing" || isParsing) && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={accent.warm} />
            <Text style={styles.loadingText}>Reading your menu&hellip;</Text>
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
            <Text style={styles.emptyBody}>
              No experiences yet. Snap your menu to generate your first ones.
            </Text>
          </GlassCard>
        ) : (
          <View style={[styles.expList, isWideDesktop && styles.desktopListGrid]}>
            {experiences.map((exp) => (
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
                  {exp.intentTags.length > 0 && (
                    <Text style={styles.expTags}>{exp.intentTags.join(" · ")}</Text>
                  )}
                </GlassCard>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <MenuSnapInput
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
