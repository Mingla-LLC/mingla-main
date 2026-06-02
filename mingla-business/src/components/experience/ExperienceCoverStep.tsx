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

import React, { useState } from "react";
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

export const ExperienceCoverStep: React.FC<ExperienceCoverStepProps> = ({
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
          showAudioControl={cover.coverMediaType === "video"}
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

      {ready ? (
        <CoverPickerSheet
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          target={{
            kind: "experience",
            brandId,
            eventRowId: experienceId,
            // Drafts auto-apply the cover patch in the webhook (same as event
            // create-mode). The publish step re-saves the row regardless.
            coverMediaApplyMode: "draft_auto",
          }}
          initial={cover}
          initialCoverHue={0}
          onCoverChange={onCoverChange}
          onShowToast={onShowToast}
        />
      ) : null}
    </View>
  );
};

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
