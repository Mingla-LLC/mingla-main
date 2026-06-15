/**
 * /experience/snap (ORCH-1144) — experience snap/parse/review flow.
 *
 * Reached from the experience-create chooser (/experience/choose) options 1 & 2.
 * The `mode` query param carries the EXPLICIT parseMode chosen by the user's
 * pick — never inferred from the brand's `venueCategory`:
 *   - ?mode=menu       → Ve5 restaurant/food-menu parser  (MenuSnapInput)
 *   - ?mode=activities → Ve6 play/activities parser        (ActivitiesSnapInput)
 *
 * Hosts the parse/review machinery relocated from the old
 * app/(tabs)/hub/experiences.tsx (ExperienceGenerationSurface): the snap sheet
 * (auto-opened on mount — the chooser already expressed intent), the parse
 * spinner, and ExperienceReviewCards (accept → draft / reject). The list,
 * multi-select, manage-sheet, and share halves stay on the Experiences tab.
 *
 * On a successful confirm (draft created) or back-tap, the brand returns to the
 * Experiences list to finish the draft (stops + date + price → publish).
 *
 * Copy = COPY §3 Recommended-primary set (food/play snap-screen headers +
 * loading/no-items/error microcopy), keyed by the explicit parseMode.
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-1144_UNIVERSAL_EXPERIENCE_PARSER_CHOOSER.md §4.2
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActivitiesSnapInput } from "../../src/components/experience/ActivitiesSnapInput";
import { ExperienceReviewCards } from "../../src/components/experience/ExperienceReviewCards";
import { MenuSnapInput } from "../../src/components/experience/MenuSnapInput";
import { TopBar } from "../../src/components/ui/TopBar";
import { Toast } from "../../src/components/ui/Toast";
import {
  accent,
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { useCurrentBrand } from "../../src/hooks/useCurrentBrand";
import {
  usePendingExperiences,
  type ExperienceParseMode,
} from "../../src/hooks/usePendingExperiences";
import type { ExperienceFilePayload } from "../../src/services/experienceGenerationService";

type SnapPhase = "idle" | "parsing" | "review";

interface SnapCopy {
  title: string;
  subtitle: string;
  loadingText: string;
  emptyParseToast: string;
  parseErrorFallback: string;
}

// COPY §3 Recommended-primary — keyed by the EXPLICIT parseMode (chooser pick).
const FOOD_COPY: SnapCopy = {
  title: "Snap your food menu",
  subtitle:
    "Photo or PDF works. Mingla reads it and suggests experiences you can accept, edit, or reject.",
  loadingText: "Reading your menu…",
  emptyParseToast:
    "We couldn't find menu items in that file. Try a clearer photo of your menu.",
  parseErrorFallback: "Couldn't read your menu. Try again.",
};

const PLAY_COPY: SnapCopy = {
  title: "Snap your activities menu",
  subtitle:
    "Photo or PDF works. Mingla reads it and suggests experiences you can accept, edit, or reject.",
  loadingText: "Reading your activities…",
  emptyParseToast:
    "We couldn't find activities in that file. Try a clearer photo of your activities list.",
  parseErrorFallback: "Couldn't read your activities list. Try again.",
};

export default function ExperienceSnapRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string }>();
  const currentBrand = useCurrentBrand();

  // Coerce the query param to the explicit parseMode. Anything other than
  // "activities" defaults to the menu (food) parser.
  const parseMode: ExperienceParseMode =
    params.mode === "activities" ? "activities" : "menu";
  const copy = parseMode === "activities" ? PLAY_COPY : FOOD_COPY;
  const SnapInput =
    parseMode === "activities" ? ActivitiesSnapInput : MenuSnapInput;

  const brandId = currentBrand?.id ?? null;
  const { pending, parseFiles, isParsing, confirm, reject, isConfirming } =
    usePendingExperiences(brandId, parseMode);

  // Auto-open the snap sheet on mount — the chooser already expressed intent,
  // so open the camera/upload immediately (no second banner tap). Re-opens only
  // when the user is back at idle with nothing under review.
  const [snapSheetVisible, setSnapSheetVisible] = useState(true);
  const [phase, setPhase] = useState<SnapPhase>("idle");
  const [toast, setToast] = useState<string | null>(null);

  const showReview = phase === "review" || pending.length > 0;

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/hub/experiences" as never);
  }, [router]);

  const handleFilesReady = useCallback(
    async (files: ExperienceFilePayload[]): Promise<void> => {
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
        setToast(e instanceof Error ? e.message : copy.parseErrorFallback);
        setPhase("idle");
      }
    },
    [copy.emptyParseToast, copy.parseErrorFallback, parseFiles],
  );

  // If the snap sheet is cancelled before any file is picked AND nothing is
  // under review, leave the flow (back to the chooser/origin) rather than
  // stranding the brand on an empty screen.
  const handleSnapCancel = useCallback((): void => {
    setSnapSheetVisible(false);
    if (phase === "idle" && pending.length === 0) {
      handleBack();
    }
  }, [handleBack, phase, pending.length]);

  // When the last pending proposal is resolved (accepted/rejected), route back
  // to the list so the brand finishes the draft there.
  const reviewResolvedToEmpty = useMemo(
    () => phase === "review" && pending.length === 0,
    [phase, pending.length],
  );
  useEffect(() => {
    if (reviewResolvedToEmpty) {
      const t = setTimeout(() => {
        router.replace("/(tabs)/hub/experiences" as never);
      }, 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [reviewResolvedToEmpty, router]);

  if (currentBrand === null) {
    return (
      <View style={[styles.host, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            onBack={handleBack}
            title={copy.title}
            rightSlot={null}
          />
        </View>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.body}>Loading brand…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.host, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          onBack={handleBack}
          title={copy.title}
          rightSlot={null}
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
      >
        <Text style={styles.subtitle}>{copy.subtitle}</Text>

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
              // The AI tool created a DRAFT shell (no stops/date/ticket). The
              // brand finishes it from the experiences list. Surface + nudge.
              if (pending.length <= 1) setPhase("idle");
              setToast(
                "Draft created — add stops, a date and price to publish it.",
              );
            }}
            onReject={async (id) => {
              const response = await reject(id);
              if (response.kind === "error") {
                setToast(response.message);
              }
            }}
          />
        )}
      </ScrollView>

      <SnapInput
        visible={snapSheetVisible}
        onCancel={handleSnapCancel}
        onFilesReady={(files) => void handleFilesReady(files)}
      />

      <Toast
        visible={toast !== null}
        kind="info"
        message={toast ?? ""}
        onDismiss={() => setToast(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  subtitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  body: {
    fontSize: typography.body.fontSize,
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
});
