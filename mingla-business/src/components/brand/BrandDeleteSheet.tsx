/**
 * BrandDeleteSheet — 4-step state machine for soft-deleting a brand.
 *
 * Per SPEC §3.7.4 verbatim. Mirrors Cycle 14 J-A4 account-delete pattern
 * (`app/account/delete.tsx`) — adapted for Sheet primitive instead of route.
 *
 * 4 steps:
 *   1. Warn       — full-bleed warning + soft-delete-not-permanent assurance
 *   2. Preview    — itemized cascade counts (events / team members / Stripe)
 *   3. Confirm    — type-to-confirm brand name (case-insensitive trim match)
 *   4. Submitting — pessimistic mutation in flight (per Decision 10)
 *
 * On rejection (upcoming events > 0): renders inline reject content within
 * the sheet (NOT a separate ConfirmDialog modal — keeps focus inside the
 * 4-step flow and lets operator back out cleanly to fix events first).
 *
 * Pre-flight design verification (per `feedback_implementor_uses_ui_ux_pro_max`):
 * - UX Pro Max searched 2026-05-05 — confirmed industry-standard pattern:
 *   confirmation dialogs for destructive actions (Severity High); type-to-confirm
 *   gating for high-blast-radius operations.
 * - React Native stack: `automaticallyAdjustKeyboardInsets` on the ScrollView
 *   keeps type-to-confirm input visible above keyboard per
 *   `feedback_keyboard_never_blocks_input` global rule.
 *
 * Rejection-modal alternative (SPEC §3.7.4) preserved as IMPL-time discovery:
 * SPEC suggested using ConfirmDialog as a sub-modal for rejection. Implementor
 * chose inline rendering to avoid sub-Sheet positioning complexity (per
 * `feedback_rn_sub_sheet_must_render_inside_parent`) and to keep operator
 * focus inside the single Sheet boundary. ConfirmDialog still available
 * for parent-level wiring if operator preference shifts.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  useBrandCascadePreview,
  useSoftDeleteBrand,
  type BrandCascadePreviewCounts,
  type SoftDeleteResult,
} from "../../hooks/useBrands";
import type { Brand } from "../../store/currentBrandStore";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

type DeleteStep = "warn" | "preview" | "confirm" | "submitting" | "rejected";

export interface BrandDeleteSheetProps {
  visible: boolean;
  brand: Brand | null;
  /**
   * Account ID for cache invalidation. Pass user.id from useAuth() at the
   * call site.
   */
  accountId: string | null;
  onClose: () => void;
  /** Fires after successful soft-delete. Parent navigates / clears currentBrand. */
  onDeleted?: (brandId: string) => void;
}

export const BrandDeleteSheet: React.FC<BrandDeleteSheetProps> = ({
  visible,
  brand,
  accountId,
  onClose,
  onDeleted,
}) => {
  const [step, setStep] = useState<DeleteStep>("warn");
  const [confirmInput, setConfirmInput] = useState<string>("");
  const [rejectionCount, setRejectionCount] = useState<number>(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Cascade preview query — fires only when sheet visible AND brand non-null
  const previewQuery = useBrandCascadePreview(
    visible && brand !== null ? brand.id : null,
  );
  const counts: BrandCascadePreviewCounts | null = previewQuery.data ?? null;

  const softDeleteMutation = useSoftDeleteBrand();

  // Reset state when sheet opens for a new brand
  useEffect(() => {
    if (visible) {
      setStep("warn");
      setConfirmInput("");
      setRejectionCount(0);
      setSubmitError(null);
    }
  }, [visible, brand?.id]);

  // Type-to-confirm gating: case-insensitive trim match
  const canConfirm = useMemo(() => {
    if (brand === null) return false;
    return (
      confirmInput.trim().toLowerCase() ===
      brand.displayName.trim().toLowerCase()
    );
  }, [confirmInput, brand]);

  const handleNextFromWarn = useCallback((): void => {
    setStep("preview");
  }, []);

  const handleNextFromPreview = useCallback((): void => {
    setStep("confirm");
  }, []);

  const handleBackToPreview = useCallback((): void => {
    setStep("preview");
    setConfirmInput("");
  }, []);

  const handleBackToWarn = useCallback((): void => {
    setStep("warn");
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (
      !canConfirm ||
      brand === null ||
      accountId === null ||
      step === "submitting"
    ) {
      return;
    }
    setStep("submitting");
    setSubmitError(null);
    try {
      const result: SoftDeleteResult =
        await softDeleteMutation.mutateAsync({
          brandId: brand.id,
          accountId,
        });
      if (result.rejected) {
        setRejectionCount(result.upcomingEventCount);
        setStep("rejected");
        return;
      }
      // Success — fire callback + close sheet
      onDeleted?.(result.brandId);
      onClose();
    } catch (error) {
      setStep("confirm");
      setSubmitError(
        error instanceof Error
          ? `Couldn't delete: ${error.message}`
          : "Couldn't delete. Tap Delete to try again.",
      );
    }
  }, [canConfirm, brand, accountId, softDeleteMutation, onDeleted, onClose, step]);

  if (brand === null) return null;

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        // Per `feedback_keyboard_never_blocks_input` — iOS native auto-inset
        // keeps the type-to-confirm input visible above keyboard.
        automaticallyAdjustKeyboardInsets
      >
        {step === "warn" ? (
          <View>
            <Text style={styles.title}>Delete this brand?</Text>
            <Text style={styles.brandLabel}>{brand.displayName}</Text>
            <View style={styles.warnCard}>
              <Icon name="flag" size={18} color={accent.warm} />
              <View style={styles.warnTextCol}>
                <Text style={styles.warnTitle}>Recoverable for 30 days</Text>
                <Text style={styles.warnBody}>
                  Deleting hides this brand from your list. Your data
                  (events, orders, refunds, audit logs) is preserved. Recovery
                  within 30 days requires support intervention.
                </Text>
              </View>
            </View>
            <View style={styles.warnCard}>
              <Icon name="flag" size={18} color={textTokens.tertiary} />
              <View style={styles.warnTextCol}>
                <Text style={styles.warnTitle}>One-way action in-app</Text>
                <Text style={styles.warnBody}>
                  Once you delete, you can&apos;t undo from inside the app.
                  Future cycles may add a recovery UI.
                </Text>
              </View>
            </View>
            <View style={styles.actionRow}>
              <View style={styles.actionCell}>
                <Button
                  label="Cancel"
                  variant="ghost"
                  size="md"
                  onPress={onClose}
                  fullWidth
                />
              </View>
              <View style={styles.actionCell}>
                <Button
                  label="Continue"
                  variant="primary"
                  size="md"
                  onPress={handleNextFromWarn}
                  fullWidth
                />
              </View>
            </View>
          </View>
        ) : null}

        {step === "preview" ? (
          <View>
            <Text style={styles.title}>What gets deleted</Text>
            <Text style={styles.brandLabel}>{brand.displayName}</Text>
            {previewQuery.isLoading ? (
              <View style={styles.previewLoading}>
                <Text style={styles.previewLoadingText}>Loading details…</Text>
              </View>
            ) : previewQuery.isError ? (
              <View style={[styles.warnCard, styles.warnCardDanger]}>
                <Icon name="flag" size={18} color={semantic.error} />
                <View style={styles.warnTextCol}>
                  <Text style={styles.warnTitle}>Couldn&apos;t load details</Text>
                  <Text style={styles.warnBody}>
                    The cascade preview failed to load. You can still
                    continue, but you won&apos;t see exact counts.
                  </Text>
                </View>
              </View>
            ) : counts !== null ? (
              <View>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Past events</Text>
                  <Text style={styles.previewValue}>
                    {counts.pastEventCount}
                  </Text>
                </View>
                {counts.liveEventCount > 0 ? (
                  <View style={[styles.previewRow, styles.previewRowDanger]}>
                    <Text style={styles.previewLabelDanger}>Live events</Text>
                    <Text style={styles.previewValueDanger}>
                      {counts.liveEventCount}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Upcoming events</Text>
                  <Text
                    style={
                      counts.upcomingEventCount > 0
                        ? styles.previewValueDanger
                        : styles.previewValue
                    }
                  >
                    {counts.upcomingEventCount}
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Team members</Text>
                  <Text style={styles.previewValue}>
                    {counts.teamMemberCount}
                  </Text>
                </View>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Stripe Connect</Text>
                  <Text style={styles.previewValue}>
                    {counts.hasStripeConnect ? "Linked (will unlink)" : "None"}
                  </Text>
                </View>
                {counts.upcomingEventCount > 0 || counts.liveEventCount > 0 ? (
                  <View style={[styles.warnCard, styles.warnCardDanger]}>
                    <Icon name="flag" size={18} color={semantic.error} />
                    <View style={styles.warnTextCol}>
                      <Text style={styles.warnTitleDanger}>
                        Active events block delete
                      </Text>
                      <Text style={styles.warnBody}>
                        Cancel or transfer your live and upcoming events
                        before deleting this brand. Tickets and orders stay
                        in your records either way.
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.previewFooter}>
                    Tickets, orders, refunds, and audit logs stay in your
                    records.
                  </Text>
                )}
              </View>
            ) : null}
            <View style={styles.actionRow}>
              <View style={styles.actionCell}>
                <Button
                  label="Back"
                  variant="ghost"
                  size="md"
                  onPress={handleBackToWarn}
                  fullWidth
                />
              </View>
              <View style={styles.actionCell}>
                <Button
                  label="Type to confirm"
                  variant="primary"
                  size="md"
                  onPress={handleNextFromPreview}
                  disabled={previewQuery.isLoading}
                  fullWidth
                />
              </View>
            </View>
          </View>
        ) : null}

        {step === "confirm" ? (
          <View>
            <Text style={styles.title}>Type to confirm</Text>
            <Text style={styles.confirmHelper}>
              Type the brand name exactly to delete it.
            </Text>
            <Text style={styles.brandLabelLarge}>{brand.displayName}</Text>
            <View
              style={[
                styles.inputWrap,
                submitError !== null && styles.inputWrapError,
              ]}
            >
              <TextInput
                value={confirmInput}
                onChangeText={setConfirmInput}
                placeholder={brand.displayName}
                placeholderTextColor={textTokens.quaternary}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                accessibilityLabel="Confirmation brand name"
                accessibilityHint="Type the brand name exactly to confirm deletion"
              />
            </View>
            {submitError !== null ? (
              <Text style={styles.errorText}>{submitError}</Text>
            ) : null}
            <View style={styles.actionRow}>
              <View style={styles.actionCell}>
                <Button
                  label="Back"
                  variant="ghost"
                  size="md"
                  onPress={handleBackToPreview}
                  fullWidth
                />
              </View>
              <View style={styles.actionCell}>
                <Button
                  label="Delete brand"
                  variant="primary"
                  size="md"
                  onPress={handleSubmit}
                  disabled={!canConfirm}
                  fullWidth
                />
              </View>
            </View>
          </View>
        ) : null}

        {step === "submitting" ? (
          <View style={styles.submittingWrap}>
            <Text style={styles.title}>Deleting…</Text>
            <Text style={styles.confirmHelper}>
              Removing {brand.displayName} from your brand list.
            </Text>
          </View>
        ) : null}

        {step === "rejected" ? (
          <View>
            <Text style={styles.title}>Cannot delete this brand</Text>
            <View style={[styles.warnCard, styles.warnCardDanger]}>
              <Icon name="flag" size={18} color={semantic.error} />
              <View style={styles.warnTextCol}>
                <Text style={styles.warnTitleDanger}>
                  {rejectionCount} upcoming event
                  {rejectionCount === 1 ? "" : "s"}
                </Text>
                <Text style={styles.warnBody}>
                  You have {rejectionCount} upcoming event
                  {rejectionCount === 1 ? "" : "s"} on this brand. Cancel
                  or transfer {rejectionCount === 1 ? "it" : "them"} first,
                  then come back to delete the brand.
                </Text>
              </View>
            </View>
            <View style={styles.actionRow}>
              <View style={styles.actionCell}>
                <Button
                  label="Close"
                  variant="primary"
                  size="md"
                  onPress={onClose}
                  fullWidth
                />
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  brandLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
    marginBottom: spacing.lg,
  },
  brandLabelLarge: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    marginVertical: spacing.md,
  },
  warnCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.sm,
  },
  warnCardDanger: {
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    borderColor: "rgba(239, 68, 68, 0.32)",
  },
  warnTextCol: {
    flex: 1,
    gap: 4,
  },
  warnTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  warnTitleDanger: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: semantic.error,
  },
  warnBody: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  actionCell: {
    flex: 1,
  },
  previewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.xs,
  },
  previewRowDanger: {
    borderColor: "rgba(239, 68, 68, 0.32)",
  },
  previewLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  previewLabelDanger: {
    fontSize: typography.bodySm.fontSize,
    color: semantic.error,
    fontWeight: "600",
  },
  previewValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  previewValueDanger: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: semantic.error,
  },
  previewFooter: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  previewLoading: {
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  previewLoadingText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
  },
  confirmHelper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.sm,
  },
  inputWrap: {
    paddingHorizontal: spacing.md,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  inputWrapError: {
    borderColor: semantic.error,
  },
  input: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    padding: 0,
    margin: 0,
  },
  errorText: {
    fontSize: typography.caption.fontSize,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  submittingWrap: {
    paddingVertical: spacing.xl,
  },
});
