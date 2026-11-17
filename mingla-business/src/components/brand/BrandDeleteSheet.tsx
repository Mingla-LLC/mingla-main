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
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: the body scrolls in SheetScrollLayout (SmartScrollView +
// the library KeyboardAvoidingView on the type-to-confirm step). Per SPEC §7.F.

import {
  color,
  radius,
  space,
  type,
} from "../../constants/designSystem";
import {
  useBrandCascadePreview,
  useSoftDeleteBrand,
  type BrandCascadePreviewCounts,
  type SoftDeleteResult,
} from "../../hooks/useBrands";
import type { Brand } from "../../store/currentBrandStore";
// Issue #1835 — owner-only deletion + honest failure copy.
import { canDeleteBrand } from "../../utils/brandDeletePermission";
import {
  BRAND_DELETE_OWNER_ONLY_MESSAGE,
  brandDeleteErrorMessage,
} from "../../utils/brandDeleteError";
import { captureException } from "../../diagnostics/sentry";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { BRAND_DELETE_COPY } from "./brandDeleteCopy";

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

/** #4389 D2 — one plain line per blocker (host copy names no provider). */
export function brandDeleteBlockerCopy(
  blockers: Array<{ code: string; count?: number }>,
): string {
  const lines = blockers.map((b) => {
    switch (b.code) {
      case "payment_account_balance":
        return BRAND_DELETE_COPY.delete.blockedBalance;
      case "upcoming_events":
        return BRAND_DELETE_COPY.delete.blockedEvents;
      case "checkout_in_progress":
        return BRAND_DELETE_COPY.delete.blockedPaying;
      case "partner_payment_in_progress":
        return BRAND_DELETE_COPY.delete.blockedPartner;
      default:
        return BRAND_DELETE_COPY.delete.blockedPayout;
    }
  });
  return [...new Set(lines)].join(" ") ||
    BRAND_DELETE_COPY.delete.blockedPayout;
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
  // #4389 — why the delete stopped (D2 blocked / D3 refused / upcoming events).
  const [rejection, setRejection] = useState<SoftDeleteResult | null>(null);

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
      setRejection(null);
    }
  }, [visible, brand?.id]);

  // Issue #1835 — owner-only deletion. `accountId` is the SIGNED-IN user's id
  // (every call site passes `user?.id ?? null`); `brand.accountId` is the deed.
  // Same predicate the `brands` RLS policy uses, so the button and the database
  // can never disagree.
  const isOwner = useMemo(
    () => canDeleteBrand(brand, accountId),
    [brand, accountId],
  );

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
    // Issue #1835 — belt-and-braces. The affordance is already hidden for
    // non-owners; if one still reaches here, say why instead of firing a
    // request the database will refuse.
    if (!isOwner) {
      setSubmitError(BRAND_DELETE_OWNER_ONLY_MESSAGE);
      return;
    }
    setStep("submitting");
    setSubmitError(null);
    try {
      const result: SoftDeleteResult =
        await softDeleteMutation.mutateAsync({
          brandId: brand.id,
          accountId,
          confirmName: confirmInput,
        });
      if (result.rejected) {
        setRejectionCount(result.upcomingEventCount);
        setRejection(result);
        setStep("rejected");
        return;
      }
      // Success — fire callback + close sheet
      onDeleted?.(result.brandId);
      onClose();
    } catch (error) {
      setStep("confirm");
      // Issue #1835 — was `error instanceof Error ? error.message : "<generic>"`.
      // That test is FALSE for every PostgREST error (they arrive as plain
      // objects), so the real reason was discarded and replaced with a retry
      // prompt the code had no basis for. `brandDeleteErrorMessage` names the
      // reason when the server gave one and never invents retryability.
      captureException(error, {
        tags: { feature: "brand-delete", issue: "1835" },
        extra: { brandId: brand.id },
      });
      setSubmitError(brandDeleteErrorMessage(error));
    }
  }, [canConfirm, brand, accountId, softDeleteMutation, onDeleted, onClose, step, isOwner, confirmInput]);

  if (brand === null) return null;

  // Issue #1835 — a non-owner should never have been offered this sheet. If one
  // opens it anyway (deep link, stale cache, a caller that forgot to gate), say
  // plainly why it can't proceed rather than walking them through three steps
  // into a 403.
  if (!isOwner) {
    return (
      <Sheet visible={visible} onClose={onClose} snapPoint="full">
        <SheetScrollLayout
          contentStyle={styles.scrollContent}
          testID="brand-delete-not-owner"
          footer={
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
          }
        >
          <Text style={styles.title}>Only the owner can delete this brand</Text>
          <Text style={styles.brandLabel}>{brand.displayName}</Text>
          <View style={[styles.warnCard, styles.warnCardDanger]}>
            <Icon name="flag" size={18} color={color.errorText} />
            <View style={styles.warnTextCol}>
              <Text style={styles.warnTitleDanger}>You&apos;re not the owner</Text>
              <Text style={styles.warnBody}>
                {BRAND_DELETE_OWNER_ONLY_MESSAGE}
              </Text>
            </View>
          </View>
        </SheetScrollLayout>
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full">
      {/* #4389 — every step scrolls inside the bounded sheet; its buttons are
          pinned under it (and above the keyboard on the type-to-confirm step). */}
      <SheetScrollLayout
        contentStyle={styles.scrollContent}
        keyboardAware={step === "confirm"}
        testID="brand-delete-sheet-body"
        footer={
          step === "warn" ? (
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
          ) : step === "preview" ? (
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
          ) : step === "confirm" ? (
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
          ) : step === "rejected" && rejection !== null && rejection.rejected &&
            rejection.reason !== "upcoming_events" ? (
            <View style={styles.actionRow}>
              <View style={styles.actionCell}>
                <Button label={BRAND_DELETE_COPY.delete.close} variant="primary" size="md" onPress={onClose} fullWidth />
              </View>
            </View>
          ) : step === "rejected" ? (
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
          ) : null
        }
      >
        {step === "warn" ? (
          <View>
            <Text style={styles.title}>Delete this brand?</Text>
            <Text style={styles.brandLabel}>{brand.displayName}</Text>
            <View style={styles.warnCard}>
              <Icon name="flag" size={18} color={color.text1} />
              <View style={styles.warnTextCol}>
                {/* #4389 — host words (no internal terms), through i18n. */}
                <Text style={styles.warnTitle}>{BRAND_DELETE_COPY.delete.restoreTitle}</Text>
                <Text style={styles.warnBody}>{BRAND_DELETE_COPY.delete.restoreBody}</Text>
              </View>
            </View>
            <View style={styles.warnCard}>
              <Icon name="flag" size={18} color={color.text3} />
              <View style={styles.warnTextCol}>
                <Text style={styles.warnTitle}>{BRAND_DELETE_COPY.delete.undoTitle}</Text>
                <Text style={styles.warnBody}>{BRAND_DELETE_COPY.delete.undoBody}</Text>
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
                <Icon name="flag" size={18} color={color.errorText} />
                <View style={styles.warnTextCol}>
                  <Text style={styles.warnTitle}>{BRAND_DELETE_COPY.delete.previewErrorTitle}</Text>
                  <Text style={styles.warnBody}>{BRAND_DELETE_COPY.delete.previewErrorBody}</Text>
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
                <PaymentAccountPreviewRow hasAccount={counts.hasStripeConnect} />
                {counts.isPaystackBrand ? (
                  <BankPayoutsPreviewRow hasBankPayouts={counts.hasBankPayouts} />
                ) : null}
                {counts.upcomingEventCount > 0 || counts.liveEventCount > 0 ? (
                  <View style={[styles.warnCard, styles.warnCardDanger]}>
                    <Icon name="flag" size={18} color={color.errorText} />
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
                placeholderTextColor={color.text4}
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

        {step === "rejected" && rejection !== null && rejection.rejected &&
          rejection.reason !== "upcoming_events" ? (
          <View>
            <Text style={styles.title}>
              {rejection.reason === "delete_blocked"
                ? BRAND_DELETE_COPY.delete.cantDeleteYet
                : BRAND_DELETE_COPY.delete.nothingDeleted}
            </Text>
            <View style={[styles.warnCard, styles.warnCardDanger]}>
              <Icon name="flag" size={18} color={color.errorText} />
              <View style={styles.warnTextCol}>
                <Text style={styles.warnBody}>
                  {rejection.reason === "delete_blocked"
                    ? brandDeleteBlockerCopy(rejection.blockers)
                    : BRAND_DELETE_COPY.delete.closeRefused}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {step === "rejected" && (rejection === null || !rejection.rejected ||
          rejection.reason === "upcoming_events") ? (
          <View>
            <Text style={styles.title}>Cannot delete this brand</Text>
            <View style={[styles.warnCard, styles.warnCardDanger]}>
              <Icon name="flag" size={18} color={color.errorText} />
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
          </View>
        ) : null}
      </SheetScrollLayout>
    </Sheet>
  );
};

/**
 * #4389 D1 — the payment account row of the delete preview. The value is a
 * sentence ("Will be closed when you delete"), so the row stacks: label on
 * line 1, value on line 2 with a gap, wrapping, never truncated (#4389 P2 on
 * SE: in one row the two ran together and the value was clipped).
 * #3645 — host-facing copy never names a payment provider.
 */
export const PaymentAccountPreviewRow: React.FC<{ hasAccount: boolean }> = ({ hasAccount }) => (
  <View style={[styles.previewRow, styles.previewRowStacked]} testID="brand-delete-payment-account-row">
    <Text style={styles.previewLabel}>Payment account</Text>
    <Text style={[styles.previewValue, styles.previewValueWrap]}>
      {hasAccount ? BRAND_DELETE_COPY.delete.closedOnDelete : BRAND_DELETE_COPY.delete.none}
    </Text>
  </View>
);

/**
 * #4389 D1 — a Nigerian-bank (Paystack) brand's preview: "Bank payouts ·
 * Will be switched off", or "None" when no bank is connected. Same stacked
 * layout as the payment account row.
 */
export const BankPayoutsPreviewRow: React.FC<{ hasBankPayouts: boolean }> = ({ hasBankPayouts }) => (
  <View style={[styles.previewRow, styles.previewRowStacked]} testID="brand-delete-bank-payouts-row">
    <Text style={styles.previewLabel}>{BRAND_DELETE_COPY.delete.bankPayouts}</Text>
    <Text style={[styles.previewValue, styles.previewValueWrap]}>
      {hasBankPayouts ? BRAND_DELETE_COPY.delete.bankPayoutsSwitchedOff : BRAND_DELETE_COPY.delete.none}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  scrollContent: {
    paddingTop: space[6],
    paddingBottom: space[7],
    // #4420: the Sheet owns the 20pt side padding; no second inset here.
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    letterSpacing: type.h1.letterSpacing,
    color: color.text1,
    marginBottom: space[2],
  },
  brandLabel: {
    fontSize: type.small.fontSize,
    color: color.text3,
    marginBottom: space[6],
  },
  brandLabelLarge: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
    marginVertical: space[4],
  },
  warnCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    padding: space[4],
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    marginBottom: space[2],
  },
  warnCardDanger: {
    backgroundColor: color.errorTint,
    borderColor: color.errorLine,
  },
  warnTextCol: {
    flex: 1,
    gap: 4,
  },
  warnTitle: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  warnTitleDanger: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.errorText,
  },
  warnBody: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text2,
  },
  actionRow: {
    flexDirection: "row",
    gap: space[2],
  },
  actionCell: {
    flex: 1,
  },
  previewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    marginBottom: space[1],
  },
  previewRowStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    gap: space[1],
  },
  previewValueWrap: {
    flexShrink: 1,
    alignSelf: "stretch",
  },
  previewRowDanger: {
    borderColor: color.errorLine,
  },
  previewLabel: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  previewLabelDanger: {
    fontSize: type.small.fontSize,
    color: color.errorText,
    fontWeight: "600",
  },
  previewValue: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  previewValueDanger: {
    fontSize: type.small.fontSize,
    fontWeight: "700",
    color: color.errorText,
  },
  previewFooter: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: space[2],
  },
  previewLoading: {
    paddingVertical: space[6],
    alignItems: "center",
  },
  previewLoadingText: {
    fontSize: type.small.fontSize,
    color: color.text3,
  },
  confirmHelper: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
    marginBottom: space[2],
  },
  inputWrap: {
    paddingHorizontal: space[4],
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.sm,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  inputWrapError: {
    borderColor: color.danger,
  },
  input: {
    flex: 1,
    fontSize: type.body.fontSize,
    color: color.text1,
    padding: 0,
    margin: 0,
  },
  errorText: {
    fontSize: type.caption.fontSize,
    color: color.errorText,
    marginTop: space[1],
  },
  submittingWrap: {
    paddingVertical: space[7],
  },
});
