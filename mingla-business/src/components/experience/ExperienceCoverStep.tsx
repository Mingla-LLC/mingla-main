/**
 * ExperienceCoverStep — META-ORCH-1059 Sub-B.
 *
 * Wizard Step 5 cover authoring. Mirrors the event wizard's CreatorStep4Cover:
 * an inline preview + "Add cover"/"Change cover" button that opens the shared
 * CoverPickerSheet with a `kind: "experience"` target. The full picker is
 * available (Library / GIFs / Photos / video) because experiences are
 * events-table rows that use the same events.cover_media_* columns — the
 * picker's uploadEventCoverMedia + event-scoped video pipeline persist directly
 * to the draft row keyed on its events-row id.
 *
 * Until the up-front draft row resolves (experienceId === null) the step shows
 * a brief "preparing" state — the picker needs a real id to upload against.
 */

import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { CoverPickerSheet } from "../ui/CoverPickerSheet";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { eventCoverProviderCreditLabel } from "../../types/eventCoverProvider";
import type { CoverPatch } from "../ui/CoverPicker";
import type { CoverTarget } from "../ui/coverTarget";

export interface ExperienceCoverStepProps {
  brandId: string;
  /** events-row id of the draft; null while the up-front draft is being created. */
  experienceId: string | null;
  /** true while the up-front draft RPC is in flight. */
  preparingDraft: boolean;
  cover: CoverPatch;
  onCoverChange: (patch: CoverPatch) => void;
  onShowToast: (msg: string) => void;
}

const ExperienceCoverStepImpl: React.FC<ExperienceCoverStepProps> = ({
  brandId,
  experienceId,
  preparingDraft,
  cover,
  onCoverChange,
  onShowToast,
}) => {
  const [pickerVisible, setPickerVisible] = useState(false);

  const hasCover =
    typeof cover.coverMediaUrl === "string" && cover.coverMediaUrl.length > 0;
  const credit = eventCoverProviderCreditLabel({
    provider: cover.coverMediaProvider ?? null,
    credit: cover.coverMediaCredit ?? null,
  });
  const ready = experienceId !== null;

  // META-ORCH-1059 [cover freeze] — Stabilize the discriminated target so it
  // keeps a constant reference across cover-selection re-renders. Previously
  // this object was rebuilt inline on EVERY render; each new ref forced the
  // CoverPickerSheet → CoverPicker subtree (two expo-video previews + provider
  // grids) to re-reconcile on every cover change, compounding the jank that
  // froze the wizard on image/GIF/video pick. It only depends on the draft id.
  const target = useMemo<CoverTarget | null>(
    () =>
      experienceId === null
        ? null
        : {
            kind: "experience",
            brandId,
            eventRowId: experienceId,
            // Drafts auto-apply the cover patch in the webhook (same as event
            // create-mode). The publish step re-saves the row regardless.
            coverMediaApplyMode: "draft_auto",
          },
    [brandId, experienceId],
  );

  return (
    <View style={styles.stepBody}>
      <Text style={styles.title}>Cover</Text>
      <Text style={styles.help}>
        Add a photo, GIF, or short video. You can publish now to make this
        experience bookable, or save it as a draft and finish later.
      </Text>

      <View style={styles.preview}>
        <EventCoverMedia
          hue={0}
          mediaUrl={cover.coverMediaUrl ?? null}
          mediaType={cover.coverMediaType ?? null}
          radius={radiusTokens.md}
          label={cover.coverMediaAlt ?? "cover"}
          height={180}
          muted={true}
          // META-ORCH-1059 [cover freeze] — While the picker sheet is open it
          // renders its OWN live preview of the same cover. Mounting a SECOND
          // autoplaying expo-video player here for the identical URL doubled the
          // native video surfaces on Android and contributed to the freeze on
          // video selection. Pause this inline player whenever the sheet is open;
          // it resumes the moment the sheet closes.
          autoplay={!pickerVisible}
          playbackActive={!pickerVisible}
          showAudioControl={cover.coverMediaType === "video" && !pickerVisible}
        />
      </View>
      {credit !== null ? <Text style={styles.creditText}>{credit}</Text> : null}

      {ready ? (
        <Button
          label={hasCover ? "Change cover" : "Add cover"}
          leadingIcon="upload"
          variant="secondary"
          size="md"
          shape="square"
          onPress={() => setPickerVisible(true)}
          accessibilityLabel={
            hasCover ? "Change cover" : "Add cover photo, GIF, or video"
          }
        />
      ) : (
        <View style={styles.preparingRow}>
          <ActivityIndicator size="small" />
          <Text style={styles.preparingText}>
            {preparingDraft ? "Preparing your draft…" : "Setting up cover…"}
          </Text>
        </View>
      )}

      {target !== null ? (
        <CoverPickerSheet
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          target={target}
          initial={cover}
          initialCoverHue={0}
          onCoverChange={onCoverChange}
          onShowToast={onShowToast}
        />
      ) : null}
    </View>
  );
};

// META-ORCH-1059 [cover freeze] — Memoize the whole step so a cover selection
// (which updates the wizard's `cover` state and re-renders the entire wizard
// tree) only re-renders this step when ITS props actually change. The wizard
// passes a stable `setCover`/`onShowToast`; the step then re-renders solely on
// real cover/experienceId/preparing changes instead of on every wizard render.
export const ExperienceCoverStep = React.memo(ExperienceCoverStepImpl);
ExperienceCoverStep.displayName = "ExperienceCoverStep";

const styles = StyleSheet.create({
  stepBody: { gap: spacing.md },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
  },
  help: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  preview: {
    borderRadius: radiusTokens.md,
    overflow: "hidden",
  },
  creditText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  preparingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  preparingText: {
    fontSize: typography.body.fontSize,
    color: textTokens.secondary,
  },
});
