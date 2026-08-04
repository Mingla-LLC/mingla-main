/**
 * ClaimStepReview (c9) — ORCH-1263 DESIGN §6.10: adopted vs edited vs added,
 * then the same machine. Three group cards (KEPT / YOU CHANGED / YOU ADDED),
 * rendered only when non-empty; every row jumps back to its step. Dense rows —
 * the operator's last question is "what did I just agree to".
 *
 * Also the face of the two submit edge states:
 *   §8.2 — foreign 23505 backstop (warm warning card, draft NOT cleared);
 *   §8.3 — half-claim retry (resume-not-recreate; "Try again" re-runs the
 *          submit, which now finds the own row and resumes).
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { useDraftVenueStore } from "../../../store/draftVenueStore";
import { ThemeControlRow } from "../../theme/ThemeControlRow";
import { ThemeSheet } from "../../theme/ThemeSheet";
import { useVenueThemeControl } from "../useVenueThemeControl";
import { Button } from "../../ui/Button";
import { EventCoverMedia } from "../../ui/EventCoverMedia";
import { Icon } from "../../ui/Icon";
import { ProvenanceChip } from "../../ui/ProvenanceChip";
import type { ProvenanceChipState } from "../../ui/ProvenanceChip";
import { useBrandDiscoveryCurrency } from "../../../hooks/useBrandDiscoveryCurrency";
import { buildClaimReviewRows } from "./claimReviewRows";
import type { ClaimReviewGroup } from "./claimReviewRows";

// ─── The pure review-group builder now lives in `claimReviewRows.ts` ────────
// issue #1564 — this file mounts the shared theme control, which pulls
// gesture-handler / reanimated / linear-gradient into its import graph, and a
// node-env test that wants ONLY the builder should not have to carry them. The
// three symbols are re-exported unchanged, so every existing importer is
// untouched.
export {
  buildClaimReviewRows,
  type ClaimReviewGroup,
  type ClaimReviewRow,
} from "./claimReviewRows";

// ─── Component ──────────────────────────────────────────────────────────────

export type ClaimSubmitBlock =
  | { kind: "foreign" }
  | { kind: "retry" };

export interface ClaimStepReviewProps {
  submitting: boolean;
  submitError: string | null;
  claimBlock: ClaimSubmitBlock | null;
  onSubmit: () => void;
  onJump: (stepId: string) => void;
  onMessageSupport: () => void;
  onBackToVenues: () => void;
}

const CHIP_FOR_GROUP: Record<ClaimReviewGroup, ProvenanceChipState> = {
  kept: "adopted",
  changed: "edited",
  added: "new",
};

const GROUP_META: Array<{ id: ClaimReviewGroup; title: string }> = [
  { id: "kept", title: "KEPT FROM YOUR LISTING" },
  { id: "changed", title: "YOU CHANGED" },
  { id: "added", title: "YOU ADDED" },
];

export const ClaimStepReview: React.FC<ClaimStepReviewProps> = ({
  submitting,
  submitError,
  claimBlock,
  onSubmit,
  onJump,
  onMessageSupport,
  onBackToVenues,
}) => {
  const draft = useDraftVenueStore();
  // issue #1564 — MOUNT 4 of 4, the claim twin of VenueStep7Review.
  const theme = useVenueThemeControl();
  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const currencyState = useBrandDiscoveryCurrency(draft.activeBrandId);
  const rows = buildClaimReviewRows(
    draft,
    currencyState.data?.currencyCode ?? null,
  );

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Review &amp; submit</Text>
      <Text style={styles.helper}>
        Your listing stays live while we check this — approval usually lands
        within 4 business hours.
      </Text>

      {GROUP_META.map((g) => {
        const groupRows = rows.filter((r) => r.group === g.id);
        if (groupRows.length === 0) return null;
        return (
          <View key={g.id} style={styles.groupCard}>
            <Text style={styles.groupTitle}>
              {g.title} · {groupRows.length}
            </Text>
            {groupRows.map((r, i) => (
              <Pressable
                key={r.key}
                onPress={() => onJump(r.stepId)}
                accessibilityRole="button"
                accessibilityLabel={`${r.label}: ${r.value}, ${CHIP_FOR_GROUP[r.group] === "adopted" ? "On Mingla" : CHIP_FOR_GROUP[r.group] === "edited" ? "Edited" : "New"}. Tap to change.`}
                style={[styles.row, i > 0 && styles.rowBorder]}
                testID={`claim-review-row-${r.key}`}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.rowK}>{r.label}</Text>
                  <View style={styles.rowValueRow}>
                    {r.thumbUrl !== undefined ? (
                      <View style={styles.thumb}>
                        <EventCoverMedia
                          hue={25}
                          mediaUrl={r.thumbUrl}
                          mediaType={r.thumbType ?? "image"}
                          radius={6}
                          label=""
                          height={50}
                          width={40}
                          muted
                        />
                      </View>
                    ) : null}
                    <Text style={styles.rowV} numberOfLines={2}>
                      {r.value}
                    </Text>
                  </View>
                </View>
                <ProvenanceChip state={CHIP_FOR_GROUP[r.group]} />
                <Icon name="chevR" size={16} color={textTokens.tertiary} />
              </Pressable>
            ))}
          </View>
        );
      })}

      {/* issue #1564 — after the provenance groups, before the submit edge
          states: the last place the operator can change how the page looks. */}
      <ThemeControlRow
        value={theme.value}
        onChange={theme.onChange}
        scope="venue"
        brandTheme={theme.brandTheme}
        brandThemeStatus={theme.brandThemeStatus}
        variant="review"
        disabled={submitting}
        onPress={() => setThemeSheetOpen(true)}
        testID="claim-review-theme-control-row"
      />

      {claimBlock?.kind === "foreign" ? (
        <View style={styles.warnCard}>
          <Text style={styles.warnTitle}>
            Someone&apos;s already claiming this place
          </Text>
          <Text style={styles.warnBody}>
            A claim for this place is already in review. If that&apos;s you on
            another account — or it shouldn&apos;t be — message support and
            we&apos;ll sort it out.
          </Text>
          <View style={styles.warnActions}>
            <Button
              label="Message support"
              variant="primary"
              size="md"
              onPress={onMessageSupport}
              testID="claim-review-support"
            />
            <Button
              label="Back to my venues"
              variant="ghost"
              size="md"
              onPress={onBackToVenues}
            />
          </View>
        </View>
      ) : null}

      {claimBlock?.kind === "retry" ? (
        <View style={styles.warnCard}>
          <Text style={styles.warnTitle}>
            Saved — but the last step hiccuped
          </Text>
          <Text style={styles.warnBody}>
            Your claim is safe. Try again and we&apos;ll pick up exactly where
            it stopped.
          </Text>
          <View style={styles.warnActions}>
            <Button
              label="Try again"
              variant="primary"
              size="md"
              loading={submitting}
              disabled={submitting}
              onPress={onSubmit}
              testID="claim-review-retry"
            />
          </View>
        </View>
      ) : null}

      {submitError !== null ? (
        <Text style={styles.err}>{submitError}</Text>
      ) : null}

      {claimBlock === null ? (
        <Button
          label={submitting ? "Submitting…" : "Submit for review"}
          onPress={onSubmit}
          variant="primary"
          size="lg"
          loading={submitting}
          disabled={submitting}
          testID="claim-review-submit"
        />
      ) : null}

      {/* I-SUB-SHEET-INSIDE-PARENT — last JSX child of the root View. */}
      <ThemeSheet
        visible={themeSheetOpen}
        onClose={() => setThemeSheetOpen(false)}
        value={theme.value}
        onChange={theme.onChange}
        scope="venue"
        brandTheme={theme.brandTheme}
        testID="claim-review-theme-sheet"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  groupCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  groupTitle: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  rowMain: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowK: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  rowValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  thumb: {
    width: 40,
    height: 50,
    borderRadius: 6,
    overflow: "hidden",
  },
  rowV: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
  },
  warnCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: semantic.warning,
    backgroundColor: semantic.warningTint,
  },
  warnTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  warnBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  warnActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
});

export default ClaimStepReview;
