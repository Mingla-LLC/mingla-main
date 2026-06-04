/**
 * Wizard Step 4 - Cover.
 *
 * ORCH-0783 makes new cover creation image/provider-first. Legacy video
 * covers still render elsewhere through EventCoverMedia.
 *
 * ORCH-0989 [Unified cover picker sheet]: the inline CoverPicker is replaced
 * by an "Add cover"/"Change cover" button + inline preview that opens the
 * shared `CoverPickerSheet` (the canonical surface for all 6 cover mounts).
 * The picker UI moves into the sheet; the wizard's draft + updateDraft
 * contract is unchanged (still consumes the same 7-field CoverPatch). Video
 * stays enabled. Mounts M1 (create, draft_auto) + M2 (edit, published_manual)
 * both flow through this step.
 */

import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  radius as radiusTokens,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { CoverPickerSheet } from "../ui/CoverPickerSheet";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { eventCoverProviderCreditLabel } from "../../types/eventCoverProvider";
import type { CoverPatch } from "../ui/CoverPicker";
import type { CoverTarget } from "../ui/coverTarget";

import { type StepBodyProps } from "./types";

export const CreatorStep4Cover: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  onShowToast,
  coverMediaEventId,
  coverMediaApplyMode,
  onCoverVideoProcessingChange,
}) => {
  const [pickerVisible, setPickerVisible] = useState(false);

  const handleCoverChange = useCallback(
    (patch: CoverPatch): void => {
      updateDraft({
        coverMediaUrl: patch.coverMediaUrl,
        coverMediaType: patch.coverMediaType,
        coverMediaProvider: patch.coverMediaProvider,
        coverMediaSourceUrl: patch.coverMediaSourceUrl,
        coverMediaCredit: patch.coverMediaCredit,
        coverMediaCreditUrl: patch.coverMediaCreditUrl,
        coverMediaAlt: patch.coverMediaAlt,
      });
    },
    [updateDraft],
  );

  const hasCover =
    typeof draft.coverMediaUrl === "string" && draft.coverMediaUrl.length > 0;
  const credit = eventCoverProviderCreditLabel({
    provider: draft.coverMediaProvider ?? null,
    credit: draft.coverMediaCredit ?? null,
  });

  // META-ORCH-1059 [cover freeze parity] — Stabilize the discriminated target
  // so it keeps a constant reference across cover-selection re-renders (mirrors
  // the ExperienceCoverStep fix; the CoverPicker is shared). Only depends on the
  // event row id + brand + apply mode.
  const coverRowId = coverMediaEventId ?? draft.id;
  const target = useMemo<CoverTarget>(
    () => ({
      kind: "event",
      brandId: draft.brandId,
      eventRowId: coverRowId,
      coverMediaApplyMode: coverMediaApplyMode ?? "draft_auto",
    }),
    [draft.brandId, coverRowId, coverMediaApplyMode],
  );

  return (
    <View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Cover</Text>
        <View style={styles.preview}>
          <EventCoverMedia
            hue={draft.coverHue}
            mediaUrl={draft.coverMediaUrl ?? null}
            mediaType={draft.coverMediaType ?? null}
            radius={radiusTokens.md}
            label={draft.coverMediaAlt ?? "cover"}
            height={180}
            muted={true}
            // META-ORCH-1059 [cover freeze parity] — pause this inline preview's
            // expo-video player while the picker sheet (which renders its own
            // live preview) is open, to avoid two video surfaces for one URL.
            autoplay={!pickerVisible}
            playbackActive={!pickerVisible}
            showAudioControl={draft.coverMediaType === "video" && !pickerVisible}
          />
        </View>
        {credit !== null ? <Text style={styles.creditText}>{credit}</Text> : null}
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
      </View>

      {/* ORCH-0989 — unified cover sheet, mounted as a JSX child of this host
          View per I-SUB-SHEET-INSIDE-PARENT. */}
      <CoverPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        target={target}
        initial={{
          coverMediaUrl: draft.coverMediaUrl ?? null,
          coverMediaType: draft.coverMediaType ?? null,
          coverMediaProvider: draft.coverMediaProvider ?? null,
          coverMediaSourceUrl: draft.coverMediaSourceUrl ?? null,
          coverMediaCredit: draft.coverMediaCredit ?? null,
          coverMediaCreditUrl: draft.coverMediaCreditUrl ?? null,
          coverMediaAlt: draft.coverMediaAlt ?? null,
        }}
        initialCoverHue={draft.coverHue}
        onCoverChange={handleCoverChange}
        onShowToast={onShowToast}
        onCoverVideoProcessingChange={onCoverVideoProcessingChange}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  preview: {
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  creditText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
});
