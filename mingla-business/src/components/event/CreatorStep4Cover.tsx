/**
 * Wizard Step 4 - Cover.
 *
 * ORCH-0783 makes new cover creation image/provider-first. Legacy video
 * covers still render elsewhere through EventCoverMedia, but this step no
 * longer exposes the active phone-video workflow or visible hue picker.
 *
 * ORCH-0876 [Trip CRUD + Purchase Flow Completion]: refactored to consume
 * the shared `<CoverPicker>` component at `../ui/CoverPicker.tsx`. The
 * picker's behaviour is byte-equivalent to the previous inline picker —
 * same upload service (`uploadEventCoverMedia`), same GIPHY/Pexels search
 * services, same provider-tab UX, same upload-limit copy. The wizard's
 * `draft` + `updateDraft` contract is unchanged. Trip-side surfaces
 * (`TripCreatorStep1Basics` + `EditPublishedTripScreen` Cover section)
 * consume the same `<CoverPicker>` for parity.
 */

import React, { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { CoverPicker, type CoverPatch } from "../ui/CoverPicker";

import { type StepBodyProps } from "./types";

export const CreatorStep4Cover: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  onShowToast,
  coverMediaEventId,
  coverMediaApplyMode,
  onCoverVideoProcessingChange,
}) => {
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

  return (
    <View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Cover</Text>
        <CoverPicker
          brandId={draft.brandId}
          eventRowId={coverMediaEventId ?? draft.id}
          initialCoverHue={draft.coverHue}
          initialMediaUrl={draft.coverMediaUrl ?? null}
          initialMediaType={draft.coverMediaType ?? null}
          initialProvider={draft.coverMediaProvider ?? null}
          initialSourceUrl={draft.coverMediaSourceUrl ?? null}
          initialCredit={draft.coverMediaCredit ?? null}
          initialCreditUrl={draft.coverMediaCreditUrl ?? null}
          initialAlt={draft.coverMediaAlt ?? null}
          onCoverChange={handleCoverChange}
          onShowToast={onShowToast}
          providers={["upload", "giphy", "pexels"]}
          coverMediaApplyMode={coverMediaApplyMode ?? "draft_auto"}
          onCoverVideoProcessingChange={onCoverVideoProcessingChange}
        />
      </View>
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
});
