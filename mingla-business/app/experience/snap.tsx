/**
 * /experience/snap (ORCH-1144 · ORCH-1154) — experience snap/parse/auto-draft flow.
 *
 * Reached from the in-sheet experience chooser (UniversalCreatorSheet step
 * "experience") options 1 & 2.
 * The `mode` query param carries the EXPLICIT parseMode chosen by the user's
 * pick — never inferred from the brand's `venueCategory`:
 *   - ?mode=menu       → Ve5 restaurant/food-menu parser  (MenuSnapInput)
 *   - ?mode=activities → Ve6 play/activities parser        (ActivitiesSnapInput)
 *
 * ORCH-1154 — the moment the parser returns N≥1 suggestions, EVERY suggestion
 * is auto-confirmed into a DRAFT experience (client-side loop over the parser's
 * returned proposal ids → the existing per-proposal confirm path), the screen
 * shows an honest "Creating your experiences…" state, the drafts-list cache is
 * invalidated, and the brand is navigated to the Hub Experiences (Drafts) tab
 * where curation happens (edit / publish / DELETE = the new "reject"). There is
 * NO ephemeral per-card Accept/Reject/Edit review surface any more — the
 * transient AI-proposal review components were deleted (SPEC §9).
 *
 * Zero suggestions stay on the snap screen (honest empty toast, no nav).
 * All-failed stays on the snap screen to retry (no nav). Partial-failure lands
 * the drafts that succeeded and navigates with an honest count.
 *
 * Copy = COPY §3 Recommended-primary set (food/play snap-screen headers +
 * loading/no-items/error microcopy), keyed by the explicit parseMode.
 *
 * Mingla_Artifacts/specs/SPEC_ORCH-1154_SNAP_AUTODRAFT_NAVIGATE.md
 */

import React, { useCallback, useState } from "react";
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
import { resolveSnapOutcome, type SnapPhase } from "./snapOutcome";

const DRAFTS_ROUTE = "/(tabs)/hub/experiences";

interface SnapCopy {
  title: string;
  subtitle: string;
  loadingText: string;
  draftingText: string;
  emptyParseToast: string;
  parseErrorFallback: string;
  allFailedToast: string;
}

// COPY §3 Recommended-primary — keyed by the EXPLICIT parseMode (chooser pick).
const FOOD_COPY: SnapCopy = {
  title: "Snap your food menu",
  subtitle:
    "Photo or PDF works. Mingla reads it and turns each item into a draft experience you can finish and publish.",
  loadingText: "Reading your menu…",
  draftingText: "Creating your experiences…",
  emptyParseToast:
    "We couldn't find menu items in that file. Try a clearer photo of your menu.",
  parseErrorFallback: "Couldn't read your menu. Try again.",
  allFailedToast: "We couldn't create your experiences. Try snapping again.",
};

const PLAY_COPY: SnapCopy = {
  title: "Snap your activities menu",
  subtitle:
    "Photo or PDF works. Mingla reads it and turns each activity into a draft experience you can finish and publish.",
  loadingText: "Reading your activities…",
  draftingText: "Creating your experiences…",
  emptyParseToast:
    "We couldn't find activities in that file. Try a clearer photo of your activities list.",
  parseErrorFallback: "Couldn't read your activities list. Try again.",
  allFailedToast: "We couldn't create your experiences. Try snapping again.",
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
  const { parseFiles, isParsing, confirmAll, invalidateExperienceList } =
    usePendingExperiences(brandId, parseMode);

  // Auto-open the snap sheet on mount — the chooser already expressed intent,
  // so open the camera/upload immediately (no second banner tap).
  const [snapSheetVisible, setSnapSheetVisible] = useState(true);
  const [phase, setPhase] = useState<SnapPhase>("idle");
  const [toast, setToast] = useState<string | null>(null);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace(DRAFTS_ROUTE as never);
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
        // SC-4 — zero suggestions never enters the auto-draft path; stay put.
        if (result.experiences_count === 0) {
          setToast(copy.emptyParseToast);
          setPhase("idle");
          return;
        }

        // ORCH-1154 — auto-draft-all: confirm EVERY returned proposal id into a
        // draft experience, then navigate to the drafts tab.
        setPhase("drafting");
        const ids = result.pending_actions.map((p) => p.id);
        const tally = await confirmAll(ids);
        const outcome = resolveSnapOutcome(tally, copy.allFailedToast);

        if (outcome.navigate) {
          // §4.6 — make the destination refetch BEFORE we land on it, so the
          // new drafts are present on arrival (no stale-empty list).
          await invalidateExperienceList();
          setToast(outcome.toast);
          // Brief honest dwell so the created-N toast is seen, then replace.
          setTimeout(() => {
            router.replace(DRAFTS_ROUTE as never);
          }, 700);
          return;
        }

        // SC-6 all-failed — stay on the snap screen to re-snap.
        setToast(outcome.toast);
        setPhase(outcome.nextPhase);
      } catch (e) {
        setToast(e instanceof Error ? e.message : copy.parseErrorFallback);
        setPhase("idle");
      }
    },
    [
      copy.emptyParseToast,
      copy.parseErrorFallback,
      copy.allFailedToast,
      parseFiles,
      confirmAll,
      invalidateExperienceList,
      router,
    ],
  );

  // If the snap sheet is cancelled before any file is picked AND we are idle,
  // leave the flow rather than stranding the brand on an empty screen.
  const handleSnapCancel = useCallback((): void => {
    setSnapSheetVisible(false);
    if (phase === "idle") {
      handleBack();
    }
  }, [handleBack, phase]);

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

  const isDrafting = phase === "drafting";

  return (
    <View style={[styles.host, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          // SC-2 — disable back during the auto-create loop for a clean honest
          // state (in-flight confirms still complete server-side regardless).
          onBack={isDrafting ? undefined : handleBack}
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

        {isDrafting && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={accent.warm} />
            <Text style={styles.loadingText}>{copy.draftingText}</Text>
          </View>
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
