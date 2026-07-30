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

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import type { DraftVenueState } from "../../../store/draftVenueStore";
import { provenanceFor, useDraftVenueStore } from "../../../store/draftVenueStore";
import type { VenueCategory } from "../../../types/brand";
import { Button } from "../../ui/Button";
import { EventCoverMedia } from "../../ui/EventCoverMedia";
import { Icon } from "../../ui/Icon";
import { ProvenanceChip } from "../../ui/ProvenanceChip";
import type { ProvenanceChipState } from "../../ui/ProvenanceChip";
import { removedAdoptedUrls } from "./ClaimStepPhotos";
import { useBrandDiscoveryCurrency } from "../../../hooks/useBrandDiscoveryCurrency";

const CAT_LABEL: Record<VenueCategory, string> = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
};

// ─── Pure review-group builder (unit-tested — T-B7) ─────────────────────────

export type ClaimReviewGroup = "kept" | "changed" | "added";

export interface ClaimReviewRow {
  key: string;
  label: string;
  value: string;
  group: ClaimReviewGroup;
  /** Step to jump to when the row is pressed. */
  stepId: string;
  /** Cover row renders a 40×50 thumb beside the value. */
  thumbUrl?: string;
  thumbType?: "image" | "video" | "gif";
}

const groupFromProvenance = (
  p: "adopted" | "edited" | "new" | null,
  fallback: ClaimReviewGroup | null,
): ClaimReviewGroup | null => {
  if (p === "adopted") return "kept";
  if (p === "edited") return "changed";
  if (p === "new") return "added";
  return fallback;
};

export function buildClaimReviewRows(
  d: DraftVenueState,
  currencyCode: string | null = null,
): ClaimReviewRow[] {
  const rows: ClaimReviewRow[] = [];
  const claim = d.claim;
  const push = (
    row: Omit<ClaimReviewRow, "group"> & { group: ClaimReviewGroup | null },
  ): void => {
    if (row.group !== null) rows.push(row as ClaimReviewRow);
  };

  // Category — an unconfident pick is the operator's addition.
  if (d.venueCategory !== null) {
    push({
      key: "category",
      label: "Category",
      value: CAT_LABEL[d.venueCategory],
      group: groupFromProvenance(provenanceFor("category", d), "added"),
      stepId: "c0",
    });
  }
  push({
    key: "name",
    label: "Name",
    value: d.displayName.trim(),
    group: groupFromProvenance(provenanceFor("name", d), null),
    stepId: "c1",
  });
  push({
    key: "address",
    label: "Address",
    value: d.formattedAddress.trim(),
    group: groupFromProvenance(provenanceFor("address", d), null),
    stepId: "c1",
  });
  const openDays = d.hours.filter((h) => !h.isClosed).length;
  push({
    key: "hours",
    label: "Hours",
    value: `${openDays} open day${openDays === 1 ? "" : "s"}`,
    group: groupFromProvenance(provenanceFor("hours", d), "added"),
    stepId: "c2",
  });
  // Photos — one summary row.
  if (claim !== null) {
    const removed = removedAdoptedUrls(
      claim.adopted.galleryUrls,
      claim.keptGalleryUrls,
    ).length;
    const addedCount = claim.addedGalleryUrls.length;
    const keptCount = claim.keptGalleryUrls.filter((u) =>
      claim.adopted.galleryUrls.includes(u),
    ).length;
    if (keptCount + removed + addedCount > 0) {
      push({
        key: "photos",
        label: "Photos",
        value: `${keptCount} kept, ${removed} removed, ${addedCount} added`,
        group: removed > 0 || addedCount > 0
          ? removed > 0 || keptCount > 0 ? "changed" : "added"
          : "kept",
        stepId: "c3",
      });
    }
    if (claim.coverChoice !== null) {
      push({
        key: "cover",
        label: "Cover",
        value: claim.coverChoice.type === "video"
          ? "Video cover"
          : "Photo cover",
        group: "added",
        stepId: "c4",
        thumbUrl: claim.coverChoice.url,
        thumbType: claim.coverChoice.type,
      });
    }
  }
  if (d.description.trim().length > 0) {
    push({
      key: "pitch",
      label: "Pitch",
      value: d.description.trim(),
      group: groupFromProvenance(provenanceFor("pitch", d), null),
      stepId: "c5",
    });
  }
  if (d.contactPhone.trim().length > 0) {
    push({
      key: "phone",
      label: "Phone",
      value: d.contactPhone.trim(),
      group: groupFromProvenance(provenanceFor("phone", d), null),
      stepId: "c6",
    });
  }
  if (d.contactEmail.trim().length > 0) {
    push({
      key: "email",
      label: "Email",
      value: d.contactEmail.trim(),
      group: "added",
      stepId: "c6",
    });
  }
  if (d.website.trim().length > 0) {
    push({
      key: "website",
      label: "Website",
      value: d.website.trim(),
      group: groupFromProvenance(provenanceFor("website", d), null),
      stepId: "c6",
    });
  }
  const discoveryPriceMinInput = (d.discoveryPriceMinInput ?? "").trim();
  const discoveryPriceMaxInput = (d.discoveryPriceMaxInput ?? "").trim();
  if (discoveryPriceMinInput.length > 0 || d.priceTiers.length > 0) {
    push({
      key: "price",
      label: "Price range",
      value: discoveryPriceMinInput.length > 0
        ? `${discoveryPriceMinInput}${
          discoveryPriceMaxInput.length > 0
            ? `–${discoveryPriceMaxInput}`
            : "+"
        }${currencyCode ? ` ${currencyCode}` : ""}`
        : d.priceTiers
          .map((tier) => tier.charAt(0).toUpperCase() + tier.slice(1))
          .join(" · "),
      group: groupFromProvenance(provenanceFor("price", d), null),
      stepId: "c7",
    });
  }
  if (d.wantsReservations) {
    push({
      key: "reservations",
      label: "Reservations",
      value: "On — setup after approval",
      group: "added",
      stepId: "c8",
    });
  }
  return rows;
}

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
