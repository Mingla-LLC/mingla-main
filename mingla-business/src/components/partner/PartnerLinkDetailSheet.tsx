/**
 * PartnerLinkDetailSheet — ORCH-1384 partner brand-link detail + verbs.
 *
 * One stepped sheet (BrandDeleteSheet pattern — confirms render INSIDE the
 * parent sheet per `feedback_rn_sub_sheet_must_render_inside_parent`):
 *
 *   step "detail"            — identity header + facts card + per-status verbs
 *                              (optional inline correct-email expansion)
 *   step "confirmCancel"     — destructive confirm w/ the BINDING deletion
 *                              disclosure (DESIGN §9.2, verbatim)
 *   step "confirmDisconnect" — destructive confirm w/ the BINDING money truth
 *   step "rejected"          — Decision-11 has_upcoming_events reject state
 *
 * submitting = a flag on the ACTING button (Button `loading`); every other
 * button disables simultaneously. Errors render INLINE in the current step
 * (§5.6 typed copy) — never a toast, never dismissal. Success = sheet dismiss
 * → parent shows the canonical Toast → React-Query invalidation (the
 * mutations own it).
 *
 * Custom in-app confirms on BOTH platforms — native `Alert` is NOT used
 * (DESIGN §8.3: one codepath, identical iOS/Android behavior, dark-glass
 * visual continuity).
 *
 * The `link` prop is a SNAPSHOT taken at row-tap time (parent state), so the
 * open status — and the snap point derived from it — never changes mid-open
 * (DESIGN §2.2).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, {
  FadeIn,
  FadeInDown,
  useReducedMotion,
} from "react-native-reanimated";
// ORCH-0892-B: ScrollView via the SmartScrollView wrapper (keyboard-aware on
// native; the Sheet mounts KeyboardRoot + KeyboardToolbarRoot inside its
// Modal window per ORCH-1165/1170 — the focused email input scrolls above
// the keyboard within the sheet).
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  accent,
  durations,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  isInviteExpired,
  type PartnerBrandLinkStatus,
  type PartnerBrandLinkWithStatus,
} from "../../services/partnerBrandLinksService";
import { useDisconnectLink } from "../../hooks/usePartnerBrandLinkMutations";
// ORCH-1384 bundle-budget split: the PENDING-invite verb hooks live in a
// sheet-only module so their bulk stays out of the shared web boot __common
// chunk (this sheet is lazy-loaded; the Team screen only pulls useDisconnectLink).
import {
  useCancelPendingLink,
  useReissueInvitation,
} from "../../hooks/usePartnerLinkInviteMutations";
// ORCH-1384 web eager-bundle budget fix: the pure label/error maps live in a
// zero-dependency module so the eager list surfaces (brands rows, team
// MemberDetailSheet) can import them WITHOUT dragging this heavy native-first
// sheet into the web boot `__common` chunk. See partnerLinkLabels.ts.
import {
  errorCopyFor,
  reasonLabelFor,
  terminalEventNameFor,
} from "./partnerLinkLabels";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";

// ---------------------------------------------------------------------------
// Pure contract helpers (exported for tests — T-11)
// ---------------------------------------------------------------------------

export type PartnerLinkSheetStep =
  | "detail"
  | "confirmCancel"
  | "confirmDisconnect"
  | "rejected";

// reasonLabelFor (§9.1), terminalEventNameFor (§2.2 Group C), and errorCopyFor
// (§5.6) moved to ./partnerLinkLabels — imported above — so the eager list
// surfaces can consume them without pulling this heavy sheet into the web boot
// `__common` chunk (ORCH-1384 bundle-budget fix). Their executed-value
// contract tests now slice the labels module.

/**
 * §4.6 verb-set contract by status (expired shares the awaiting_owner set —
 * Resend IS the revival path, SC-12). Exported so T-11 pins it.
 */
export function verbSetFor(
  status: PartnerBrandLinkStatus,
): readonly string[] {
  switch (status) {
    case "awaiting_owner":
      return ["resend", "correctEmail", "openDashboard", "cancel", "close"];
    case "awaiting_stripe":
    case "active":
      return ["openDashboard", "disconnect", "close"];
    case "cancelled":
      return ["close"];
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/** Absolute locale date — "Jul 16, 2026" (DESIGN §2.2 Group C). */
export function formatAbsoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Client-side mirror of the edge fn's EMAIL_RE / EMAIL_MAX semantics
// (supabase/functions/_shared/brandInviteEmail.ts) — format + non-empty +
// length cap. Belt-and-braces: the edge fn + RPC re-validate.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SubmittingVerb =
  | null
  | "resend"
  | "correctSend"
  | "cancel"
  | "disconnect";

export interface PartnerLinkDetailSheetProps {
  visible: boolean;
  /** Row SNAPSHOT captured at tap time (status/snap fixed at open). */
  link: PartnerBrandLinkWithStatus | null;
  /** Caller's account id — cache surgery target for the cancel verb. */
  accountId: string | null;
  onClose: () => void;
  /** Fires AFTER dismissal on verb success; parent shows the canonical Toast. */
  onVerbSuccess: (message: string) => void;
}

export const PartnerLinkDetailSheet: React.FC<PartnerLinkDetailSheetProps> = ({
  visible,
  link,
  accountId,
  onClose,
  onVerbSuccess,
}) => {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [step, setStep] = useState<PartnerLinkSheetStep>("detail");
  const [submittingVerb, setSubmittingVerb] = useState<SubmittingVerb>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [correctingEmail, setCorrectingEmail] = useState<boolean>(false);
  const [emailInput, setEmailInput] = useState<string>("");
  const [emailFormatError, setEmailFormatError] = useState<boolean>(false);
  const [rejectCount, setRejectCount] = useState<number>(0);

  const cancelMutation = useCancelPendingLink();
  const disconnectMutation = useDisconnectLink();
  const reissueMutation = useReissueInvitation();

  // Reset the whole machine when the sheet opens for a (new) row.
  useEffect(() => {
    if (visible) {
      setStep("detail");
      setSubmittingVerb(null);
      setInlineError(null);
      setCorrectingEmail(false);
      setEmailInput("");
      setEmailFormatError(false);
      setRejectCount(0);
    }
  }, [visible, link?.id]);

  const expired = useMemo(
    () => (link !== null ? isInviteExpired(link) : false),
    [link],
  );

  const brandName = link?.brand?.name ?? "Brand";
  const anySubmitting = submittingVerb !== null;

  // -------------------------------------------------------------------------
  // Verb handlers
  // -------------------------------------------------------------------------

  const handleOpenDashboard = useCallback((): void => {
    if (link === null || anySubmitting) return;
    onClose();
    router.push(`/brand/${link.brand_id}` as never);
  }, [link, anySubmitting, onClose, router]);

  const handleResend = useCallback(async (): Promise<void> => {
    if (link === null || anySubmitting) return;
    setSubmittingVerb("resend");
    setInlineError(null);
    try {
      await reissueMutation.mutateAsync({ linkId: link.id });
      setSubmittingVerb(null);
      onClose();
      onVerbSuccess(`Invite sent to ${link.invited_owner_email}`);
    } catch (error) {
      setSubmittingVerb(null);
      setInlineError(
        errorCopyFor(error instanceof Error ? error.message : "server"),
      );
    }
  }, [link, anySubmitting, reissueMutation, onClose, onVerbSuccess]);

  const handleCorrectSend = useCallback(async (): Promise<void> => {
    if (link === null || anySubmitting) return;
    const candidate = emailInput.trim().toLowerCase();
    if (
      candidate.length === 0 ||
      candidate.length > EMAIL_MAX ||
      !EMAIL_RE.test(candidate)
    ) {
      setEmailFormatError(true);
      return;
    }
    setEmailFormatError(false);
    setSubmittingVerb("correctSend");
    setInlineError(null);
    try {
      await reissueMutation.mutateAsync({
        linkId: link.id,
        newEmail: candidate,
      });
      setSubmittingVerb(null);
      onClose();
      onVerbSuccess(`Invite sent to ${candidate}`);
    } catch (error) {
      setSubmittingVerb(null);
      setInlineError(
        errorCopyFor(error instanceof Error ? error.message : "server"),
      );
    }
  }, [
    link,
    anySubmitting,
    emailInput,
    reissueMutation,
    onClose,
    onVerbSuccess,
  ]);

  const handleConfirmCancel = useCallback(async (): Promise<void> => {
    if (link === null || accountId === null || anySubmitting) return;
    setSubmittingVerb("cancel");
    setInlineError(null);
    try {
      const result = await cancelMutation.mutateAsync({
        linkId: link.id,
        brandId: link.brand_id,
        accountId,
      });
      setSubmittingVerb(null);
      if (result.rejected) {
        // Decision-11 workflow rejection — ZERO writes happened (SC-7).
        setRejectCount(result.upcomingEventCount);
        setStep("rejected");
        return;
      }
      onClose();
      onVerbSuccess(`Invite cancelled. ${brandName} was deleted.`);
    } catch (error) {
      setSubmittingVerb(null);
      setInlineError(
        errorCopyFor(error instanceof Error ? error.message : "server"),
      );
    }
  }, [
    link,
    accountId,
    anySubmitting,
    cancelMutation,
    brandName,
    onClose,
    onVerbSuccess,
  ]);

  const handleConfirmDisconnect = useCallback(async (): Promise<void> => {
    if (link === null || anySubmitting) return;
    setSubmittingVerb("disconnect");
    setInlineError(null);
    try {
      await disconnectMutation.mutateAsync({ linkId: link.id });
      setSubmittingVerb(null);
      onClose();
      onVerbSuccess(`Disconnected from ${brandName}`);
    } catch (error) {
      setSubmittingVerb(null);
      setInlineError(
        errorCopyFor(error instanceof Error ? error.message : "server"),
      );
    }
  }, [
    link,
    anySubmitting,
    disconnectMutation,
    brandName,
    onClose,
    onVerbSuccess,
  ]);

  const backToDetail = useCallback((): void => {
    if (anySubmitting) return;
    setStep("detail");
    setInlineError(null);
  }, [anySubmitting]);

  if (link === null) return null;

  // Snap: "full" for the 4-verb awaiting_owner set (incl. expired); "half"
  // for awaiting_stripe / active / cancelled (DESIGN §2.2).
  const snapPoint = link.status === "awaiting_owner" ? "full" : "half";

  const statusLabel = statusLabelForSheet(link, expired);
  const dotColor = dotColorFor(link, expired);

  const stepEntering = reduceMotion
    ? undefined
    : FadeIn.duration(durations.normal);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={snapPoint}
      testID="partner-link-detail-sheet"
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {step === "detail" ? (
          <Animated.View key="detail" entering={stepEntering}>
            {/* Identity header — one accessible unit ("{brand}, {status}"). */}
            <View
              style={styles.identityRow}
              accessible
              accessibilityLabel={`${brandName}, ${statusLabel}`}
            >
              <LinkThumb link={link} brandName={brandName} />
              <View style={styles.identityCol}>
                <Text style={styles.brandName} numberOfLines={2}>
                  {brandName}
                </Text>
                <View style={styles.statusRow}>
                  <View style={[styles.dot, { backgroundColor: dotColor }]} />
                  <Text style={styles.statusLabel}>{statusLabel}</Text>
                </View>
              </View>
            </View>

            {/* Facts card */}
            <View style={styles.factsCard}>
              <View>
                <Text style={styles.factsLabel}>Invited owner</Text>
                <Text style={styles.factsValuePrimary} selectable>
                  {link.invited_owner_email}
                </Text>
              </View>

              {link.personal_note !== null &&
              link.personal_note.length > 0 ? (
                <View style={styles.factsGroupGap}>
                  <Text style={styles.factsLabel}>Your note</Text>
                  <Text style={styles.factsValueSecondary}>
                    {"“"}
                    {link.personal_note}
                    {"”"}
                  </Text>
                </View>
              ) : null}

              <View style={styles.factsGroupGap}>
                <Text style={styles.factsLabel}>Timeline</Text>
                <TimelineRows link={link} />
              </View>

              {link.status === "cancelled" ? (
                <View style={styles.factsGroupGap}>
                  <Text style={styles.factsLabel}>Status</Text>
                  <Text style={styles.factsValueSecondary}>
                    {reasonLabelFor(link.cancelled_reason)}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Inline error (detail-step verbs: resend / correct-send) */}
            {inlineError !== null ? (
              <ErrorCard message={inlineError} />
            ) : null}

            {/* Verb stack */}
            {link.status === "awaiting_owner" ? (
              <View style={styles.verbStack}>
                <Button
                  label="Resend invite"
                  variant="primary"
                  size="lg"
                  fullWidth
                  leadingIcon="send"
                  onPress={handleResend}
                  loading={submittingVerb === "resend"}
                  disabled={anySubmitting && submittingVerb !== "resend"}
                  testID="partner-link-resend"
                  accessibilityLabel="Resend invite"
                />
                {correctingEmail ? (
                  <Animated.View
                    entering={
                      reduceMotion
                        ? undefined
                        : FadeInDown.duration(durations.normal).withInitialValues({
                            opacity: 0,
                            transform: [{ translateY: -4 }],
                          })
                    }
                  >
                    <Text style={styles.factsLabel}>New owner email</Text>
                    <Input
                      value={emailInput}
                      onChangeText={(next) => {
                        setEmailInput(next);
                        if (emailFormatError) setEmailFormatError(false);
                      }}
                      variant="email"
                      placeholder={link.invited_owner_email}
                      accessibilityLabel="New owner email"
                      accessibilityHint="Sends a fresh invite to this address"
                      testID="partner-link-correct-email-input"
                      editable={submittingVerb !== "correctSend"}
                      style={
                        emailFormatError
                          ? { borderColor: semantic.error }
                          : undefined
                      }
                    />
                    <Text style={styles.inputHelper}>
                      The old invite link stops working. We'll send a fresh
                      one here.
                    </Text>
                    {emailFormatError ? (
                      <Text
                        style={styles.inputError}
                        accessibilityRole="alert"
                      >
                        Enter a valid email address.
                      </Text>
                    ) : null}
                    <View style={styles.actionRow}>
                      <View style={styles.actionCell}>
                        <Button
                          label="Never mind"
                          variant="ghost"
                          size="md"
                          fullWidth
                          onPress={() => {
                            if (anySubmitting) return;
                            setCorrectingEmail(false);
                            setEmailInput("");
                            setEmailFormatError(false);
                          }}
                          disabled={anySubmitting}
                          accessibilityLabel="Never mind, keep the current email"
                        />
                      </View>
                      <View style={styles.actionCell}>
                        <Button
                          label="Send new invite"
                          variant="primary"
                          size="md"
                          fullWidth
                          onPress={handleCorrectSend}
                          loading={submittingVerb === "correctSend"}
                          disabled={
                            emailInput.trim().length === 0 ||
                            (anySubmitting && submittingVerb !== "correctSend")
                          }
                          testID="partner-link-correct-email-send"
                          accessibilityLabel="Send new invite"
                        />
                      </View>
                    </View>
                  </Animated.View>
                ) : (
                  <Button
                    label="Correct email & resend"
                    variant="secondary"
                    size="md"
                    fullWidth
                    leadingIcon="mail"
                    onPress={() => {
                      if (anySubmitting) return;
                      setCorrectingEmail(true);
                    }}
                    disabled={anySubmitting}
                    testID="partner-link-correct-email"
                    accessibilityLabel="Correct email and resend"
                  />
                )}
                <Button
                  label="Open brand dashboard"
                  variant="secondary"
                  size="md"
                  fullWidth
                  trailingIcon="chevR"
                  onPress={handleOpenDashboard}
                  disabled={anySubmitting}
                  testID="partner-link-open-dashboard"
                  accessibilityLabel="Open brand dashboard"
                />
                <View style={styles.destructiveZone}>
                  <Button
                    label="Cancel invite"
                    variant="destructive"
                    size="md"
                    fullWidth
                    onPress={() => {
                      if (anySubmitting) return;
                      setInlineError(null);
                      setStep("confirmCancel");
                    }}
                    disabled={anySubmitting}
                    testID="partner-link-cancel"
                    accessibilityLabel="Cancel invite"
                  />
                </View>
                <View style={styles.closeGap}>
                  <Button
                    label="Close"
                    variant="ghost"
                    size="md"
                    fullWidth
                    onPress={onClose}
                    disabled={anySubmitting}
                    testID="partner-link-close"
                    accessibilityLabel="Close link details"
                  />
                </View>
              </View>
            ) : null}

            {link.status === "awaiting_stripe" || link.status === "active" ? (
              <View style={styles.verbStack}>
                <Button
                  label="Open brand dashboard"
                  variant="primary"
                  size="lg"
                  fullWidth
                  trailingIcon="chevR"
                  onPress={handleOpenDashboard}
                  disabled={anySubmitting}
                  testID="partner-link-open-dashboard"
                  accessibilityLabel="Open brand dashboard"
                />
                <View style={styles.destructiveZone}>
                  <Button
                    label="Disconnect"
                    variant="destructive"
                    size="md"
                    fullWidth
                    onPress={() => {
                      if (anySubmitting) return;
                      setInlineError(null);
                      setStep("confirmDisconnect");
                    }}
                    disabled={anySubmitting}
                    testID="partner-link-disconnect"
                    accessibilityLabel="Disconnect from this brand"
                  />
                </View>
                <View style={styles.closeGap}>
                  <Button
                    label="Close"
                    variant="ghost"
                    size="md"
                    fullWidth
                    onPress={onClose}
                    disabled={anySubmitting}
                    testID="partner-link-close"
                    accessibilityLabel="Close link details"
                  />
                </View>
              </View>
            ) : null}

            {link.status === "cancelled" ? (
              // Terminal read-only (SC-14): NO dashboard verb for ANY
              // cancelled reason — the brand may be soft-deleted.
              <View style={styles.destructiveZone}>
                <Button
                  label="Close"
                  variant="ghost"
                  size="md"
                  fullWidth
                  onPress={onClose}
                  testID="partner-link-close"
                  accessibilityLabel="Close link details"
                />
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        {step === "confirmCancel" ? (
          <Animated.View key="confirmCancel" entering={stepEntering}>
            <Text style={styles.stepTitle}>Cancel this invite?</Text>
            <Text style={styles.stepBrandLine}>{brandName}</Text>
            <View style={styles.dangerCard}>
              <Icon name="trash" size={18} color={semantic.error} />
              <View style={styles.dangerTextCol}>
                {/* Title in text.primary, NOT semantic.error — 3.86:1 fails AA
                    on this surface; the icon + border carry the danger hue
                    (DESIGN §4.3 / decision-of-record 3). */}
                <Text style={styles.dangerTitle}>
                  This deletes the draft brand
                </Text>
                {/* NON-NEGOTIABLE deletion disclosure — verbatim (DESIGN §9.2). */}
                <Text style={styles.dangerBody}>
                  This cancels the invite and deletes the draft brand you
                  built. This can't be undone.
                </Text>
              </View>
            </View>
            {inlineError !== null ? <ErrorCard message={inlineError} /> : null}
            <View style={styles.actionRowLg}>
              <View style={styles.actionCell}>
                <Button
                  label="Keep invite"
                  variant="ghost"
                  size="md"
                  fullWidth
                  onPress={backToDetail}
                  disabled={anySubmitting}
                  testID="partner-link-confirm-back"
                  accessibilityLabel="Keep invite, go back"
                />
              </View>
              <View style={styles.actionCell}>
                <Button
                  label="Cancel invite"
                  variant="destructive"
                  size="md"
                  fullWidth
                  onPress={handleConfirmCancel}
                  loading={submittingVerb === "cancel"}
                  disabled={anySubmitting && submittingVerb !== "cancel"}
                  testID="partner-link-confirm-cancel"
                  accessibilityLabel="Confirm cancel invite"
                />
              </View>
            </View>
          </Animated.View>
        ) : null}

        {step === "confirmDisconnect" ? (
          <Animated.View key="confirmDisconnect" entering={stepEntering}>
            <Text style={styles.stepTitle}>
              Disconnect from {brandName}?
            </Text>
            <View style={styles.dangerCard}>
              <Icon name="link" size={18} color={semantic.error} />
              <View style={styles.dangerTextCol}>
                <Text style={styles.dangerTitle}>
                  Future sales stop paying you
                </Text>
                {/* Money truth — verbatim-required semantics (DESIGN §9.2). */}
                <Text style={styles.dangerBody}>
                  You'll stop earning from future sales for this brand. Money
                  already earned still pays out.
                </Text>
              </View>
            </View>
            {inlineError !== null ? <ErrorCard message={inlineError} /> : null}
            <View style={styles.actionRowLg}>
              <View style={styles.actionCell}>
                <Button
                  label="Keep connection"
                  variant="ghost"
                  size="md"
                  fullWidth
                  onPress={backToDetail}
                  disabled={anySubmitting}
                  testID="partner-link-confirm-back"
                  accessibilityLabel="Keep connection, go back"
                />
              </View>
              <View style={styles.actionCell}>
                <Button
                  label="Disconnect"
                  variant="destructive"
                  size="md"
                  fullWidth
                  onPress={handleConfirmDisconnect}
                  loading={submittingVerb === "disconnect"}
                  disabled={anySubmitting && submittingVerb !== "disconnect"}
                  testID="partner-link-confirm-disconnect"
                  accessibilityLabel="Confirm disconnect"
                />
              </View>
            </View>
          </Animated.View>
        ) : null}

        {step === "rejected" ? (
          <Animated.View key="rejected" entering={stepEntering}>
            <Text style={styles.stepTitle}>Can't cancel yet</Text>
            <View style={styles.dangerCard} accessibilityRole="alert">
              <Icon name="calendar" size={18} color={semantic.error} />
              <View style={styles.dangerTextCol}>
                <Text style={styles.dangerTitle}>
                  {rejectCount} upcoming event{rejectCount === 1 ? "" : "s"}
                </Text>
                <Text style={styles.dangerBody}>
                  This brand has {rejectCount} upcoming event
                  {rejectCount === 1 ? "" : "s"}. Cancel{" "}
                  {rejectCount === 1 ? "it" : "them"} first, then come back
                  and cancel the invite.
                </Text>
              </View>
            </View>
            <View style={styles.rejectActions}>
              <Button
                label="Open brand dashboard"
                variant="primary"
                size="md"
                fullWidth
                trailingIcon="chevR"
                onPress={handleOpenDashboard}
                testID="partner-link-reject-dashboard"
                accessibilityLabel="Open brand dashboard to fix events"
              />
              <Button
                label="Close"
                variant="ghost"
                size="md"
                fullWidth
                onPress={backToDetail}
                testID="partner-link-reject-close"
                accessibilityLabel="Close, back to link details"
              />
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function statusLabelForSheet(
  link: PartnerBrandLinkWithStatus,
  expired: boolean,
): string {
  switch (link.status) {
    case "awaiting_owner":
      return expired ? "Invite expired" : "Awaiting Owner";
    case "awaiting_stripe":
      return "Awaiting payouts";
    case "active":
      return "Active";
    case "cancelled":
      return reasonLabelFor(link.cancelled_reason);
    default:
      return link.status;
  }
}

function dotColorFor(
  link: PartnerBrandLinkWithStatus,
  expired: boolean,
): string {
  switch (link.status) {
    case "awaiting_owner":
      return expired ? semantic.error : accent.warm;
    case "awaiting_stripe":
      return semantic.warning;
    case "active":
      return semantic.success;
    case "cancelled":
    default:
      return textTokens.tertiary;
  }
}

const LinkThumb: React.FC<{
  link: PartnerBrandLinkWithStatus;
  brandName: string;
}> = ({ link, brandName }) => {
  const coverUrl = link.brand?.cover_media_url ?? null;
  const coverType = link.brand?.cover_media_type ?? null;
  // Stills only (same rule as the list rows) — skip video covers.
  const hasStillCover =
    coverUrl !== null && coverUrl.length > 0 && coverType !== "video";
  if (hasStillCover) {
    return (
      <Image
        source={{ uri: coverUrl as string }}
        style={styles.thumb}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[styles.thumb, styles.thumbFallback]}>
      <Text style={styles.thumbFallbackText}>
        {brandName.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
};

/** §2.2 Group C — one two-column row per SET timestamp, lifecycle order. */
const TimelineRows: React.FC<{ link: PartnerBrandLinkWithStatus }> = ({
  link,
}) => {
  const rows: Array<{ label: string; iso: string }> = [];
  rows.push({ label: "Invited", iso: link.invited_at });
  if (link.accepted_at !== null) {
    rows.push({ label: "Accepted", iso: link.accepted_at });
  }
  if (link.owner_stripe_connected_at !== null) {
    rows.push({
      label: "Payouts connected",
      iso: link.owner_stripe_connected_at,
    });
  }
  if (link.first_split_at !== null) {
    rows.push({ label: "First split", iso: link.first_split_at });
  }
  if (link.cancelled_at !== null) {
    rows.push({
      label: terminalEventNameFor(link.cancelled_reason),
      iso: link.cancelled_at,
    });
  }
  return (
    <View style={styles.timelineCol}>
      {rows.map((row) => (
        <View key={`${row.label}-${row.iso}`} style={styles.timelineRow}>
          <Text style={styles.timelineLabel}>{row.label}</Text>
          <Text style={styles.timelineDate}>
            {formatAbsoluteDate(row.iso)}
          </Text>
        </View>
      ))}
    </View>
  );
};

/** Inline danger-grammar error card (§5.3 — never a toast, never dismissal). */
const ErrorCard: React.FC<{ message: string }> = ({ message }) => (
  <View
    style={[styles.dangerCard, styles.errorCardGap]}
    accessibilityRole="alert"
  >
    <Icon name="flag" size={18} color={semantic.error} />
    <View style={styles.dangerTextCol}>
      <Text style={styles.dangerBody}>{message}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  identityCol: {
    flex: 1,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: "hidden",
  },
  thumbFallback: {
    backgroundColor: accent.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbFallbackText: {
    fontSize: 18,
    fontWeight: "800",
    color: accent.warm,
  },
  brandName: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: typography.micro.fontWeight,
    letterSpacing: 0.5,
    color: textTokens.secondary,
  },
  factsCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  factsGroupGap: {
    marginTop: spacing.md,
  },
  factsLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  factsValuePrimary: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.primary,
  },
  factsValueSecondary: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  timelineCol: {
    gap: 6,
  },
  timelineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timelineLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.secondary,
  },
  timelineDate: {
    fontSize: 12,
    fontWeight: "600",
    color: textTokens.primary,
  },
  verbStack: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  destructiveZone: {
    marginTop: spacing.lg,
  },
  closeGap: {
    marginTop: spacing.sm,
  },
  inputHelper: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  inputError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionRowLg: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  actionCell: {
    flex: 1,
  },
  stepTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  stepBrandLine: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
    marginBottom: spacing.lg,
  },
  dangerCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    // BrandDeleteSheet `warnCardDanger` literals reused verbatim (candidate
    // future tokens per DESIGN §10.5 — NOT created here).
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    borderColor: "rgba(239, 68, 68, 0.32)",
    borderWidth: 1,
  },
  dangerTextCol: {
    flex: 1,
    gap: 4,
  },
  dangerTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  dangerBody: {
    fontSize: typography.caption.fontSize,
    lineHeight: 16,
    color: textTokens.secondary,
  },
  errorCardGap: {
    marginTop: spacing.sm,
  },
  rejectActions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
});

export default PartnerLinkDetailSheet;
