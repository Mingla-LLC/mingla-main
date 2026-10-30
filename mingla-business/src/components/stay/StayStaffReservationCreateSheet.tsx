import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StayGuestBooking } from "@mingla/brand-rendering/StayGuestBooking";
import type {
  StayGuestCheckoutInput,
  StayQuote,
} from "@mingla/brand-rendering/stayGuest";
import {
  createThemePalette,
  offeringSurfaceStyles,
  resolveTheme,
} from "@mingla/offering-rendering";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useStaffStayDetail } from "../../hooks/useStaffStayDetail";
import {
  StayReservationError,
  stayReservationService,
} from "../../services/stayReservationService";
import type {
  StayBookingSource,
  StayStaffReservationGroup,
} from "../../types/stayReservation";
import { randomId } from "../../utils/randomId";
import { copyAddressText } from "../../utils/copyAddressText";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

type StaffSource = Exclude<StayBookingSource, "guest">;

const SOURCES: readonly { id: StaffSource; label: string }[] = [
  { id: "phone", label: "Phone" },
  { id: "walk_in", label: "Walk-in" },
  { id: "website", label: "Website" },
  { id: "instagram", label: "Instagram" },
  { id: "mingla", label: "Mingla" },
];

function createErrorCopy(caught: unknown): string {
  const code = caught instanceof StayReservationError
    ? caught.code
    : caught instanceof Error
      ? caught.message
      : "";
  if (code.includes("stay_inventory_changed")) {
    return "Availability changed while you were working. Edit the selection and quote it again.";
  }
  if (code.includes("stay_quote_expired")) {
    return "This quote expired. Edit the selection and check availability again.";
  }
  if (code.includes("stay_bank_not_ready")) {
    return "Stay reservations are not ready for this brand yet.";
  }
  if (code.includes("forbidden")) {
    return "Your role does not allow creating Stay reservations.";
  }
  return "The reservation could not be created. Nothing was charged; try again.";
}

function deliveryStatusLabel(status?: string): string {
  return (status ?? "not requested").replaceAll("_", " ");
}

export interface StayStaffReservationCreateSheetProps {
  visible: boolean;
  venueId: string;
  onClose: () => void;
  onCreated: (group: StayStaffReservationGroup) => void;
}

export function StayStaffReservationCreateSheet({
  visible,
  venueId,
  onClose,
  onCreated,
}: StayStaffReservationCreateSheetProps): React.ReactElement {
  const detailQuery = useStaffStayDetail(visible ? venueId : null);
  const [source, setSource] = useState<StaffSource>("phone");
  const [checkout, setCheckout] = useState<StayGuestCheckoutInput | null>(null);
  const [quote, setQuote] = useState<StayQuote | null>(null);
  const [createKey, setCreateKey] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"link" | "property">("link");
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(false);
  const [created, setCreated] = useState<StayStaffReservationGroup | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const theme = useMemo(() => resolveTheme(null, null), []);
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const surface = useMemo(() => offeringSurfaceStyles(palette), [palette]);

  useEffect(() => {
    if (visible) return;
    setSource("phone");
    setCheckout(null);
    setQuote(null);
    setCreateKey(null);
    setPaymentMethod("link");
    setSendEmail(true);
    setSendSms(false);
    setCreated(null);
    setCopied(false);
    setSubmitting(false);
    setError(null);
  }, [visible]);

  const detailState = detailQuery.isLoading
    ? "loading"
    : detailQuery.isError
      ? "error"
      : detailQuery.data === null
        ? "unavailable"
        : "ready";

  const prepareQuote = async (input: StayGuestCheckoutInput): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const nextQuote = await stayReservationService.quote({
        venueId,
        idempotencyKey: `stay:staff:quote:${randomId()}`,
        lines: input.lines,
      });
      setCheckout(input);
      setQuote(nextQuote);
      setCreateKey(`stay:staff:create:${randomId()}`);
    } catch (caught) {
      setError(createErrorCopy(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async (): Promise<void> => {
    if (quote === null || checkout === null || createKey === null) return;
    setSubmitting(true);
    setError(null);
    if (paymentMethod === "link") {
      if (!sendEmail && !sendSms) {
        setError("Choose email, text, or both for the secure payment link.");
        setSubmitting(false);
        return;
      }
      if (sendEmail && !checkout.guest.email) {
        setError("Add the guest's email or turn off email delivery.");
        setSubmitting(false);
        return;
      }
      if (sendSms && !checkout.guest.phone) {
        setError("Add the guest's mobile number or turn off text delivery.");
        setSubmitting(false);
        return;
      }
    }
    try {
      const group = await stayReservationService.createStaffGroup({
        quoteId: quote.quoteId,
        idempotencyKey: createKey,
        guest: checkout.guest,
        source,
        paymentMethod,
        sendEmail,
        sendSms,
        expectedQuoteVersion: quote.version,
      });
      setCreated(group);
    } catch (caught) {
      setError(createErrorCopy(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (created !== null) {
    const isLink = Boolean(
      created.paymentCollection === "mingla" && created.paymentLinkUrl,
    );
    return (
      <Sheet visible={visible} onClose={() => onCreated(created)} snapPoint="full">
        <View style={styles.successPage} testID="stay-staff-create-success">
          <Text style={styles.title}>Reservation added</Text>
          <Text style={styles.helper}>
            {isLink
              ? "Inventory is held for 24 hours while the guest pays through the secure link."
              : "The reservation is confirmed. Payment will be handled by the property."}
          </Text>
          {isLink ? (
            <View style={styles.sourceBlock}>
              <Text style={styles.fieldLabel}>Secure guest payment link</Text>
              <Text style={styles.linkText} numberOfLines={2}>
                {created.paymentLinkUrl}
              </Text>
              <Text style={styles.helper}>
                Email: {deliveryStatusLabel(
                  created.paymentLinkDelivery?.emailStatus ??
                    created.paymentLink?.emailStatus,
                )} · Text: {deliveryStatusLabel(
                  created.paymentLinkDelivery?.smsStatus ??
                    created.paymentLink?.smsStatus,
                )}
              </Text>
              <Button
                label={copied ? "Copied" : "Copy payment link"}
                onPress={() => {
                  if (!created.paymentLinkUrl) return;
                  void copyAddressText(created.paymentLinkUrl)
                    .then(() => setCopied(true))
                    .catch(() => setError("The link could not be copied. Select and copy it manually."));
                }}
                variant="secondary"
                size="md"
                fullWidth
                testID="stay-staff-copy-payment-link"
              />
            </View>
          ) : null}
          <Button
            label="Done"
            onPress={() => onCreated(created)}
            variant="primary"
            size="lg"
            fullWidth
          />
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint="full"
      verticalAlign="top"
      dismissDisabled={submitting}
      testID="stay-staff-create-sheet"
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.flexOne}>
            <Text style={styles.title}>Add Stay reservation</Text>
            <Text style={styles.helper}>
              Reserve a Room or Place for a phone, walk-in or direct guest.
            </Text>
          </View>
          <Button
            label="Close"
            onPress={onClose}
            variant="ghost"
            size="sm"
            disabled={submitting}
          />
        </View>

        <View style={styles.sourceBlock}>
          <Text style={styles.fieldLabel}>Booking source</Text>
          <View style={styles.sourceRow}>
            {SOURCES.map((candidate) => {
              const selected = candidate.id === source;
              return (
                <Pressable
                  key={candidate.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Booking source ${candidate.label}`}
                  disabled={quote !== null || submitting}
                  onPress={() => setSource(candidate.id)}
                  style={[
                    styles.sourceChip,
                    selected && styles.sourceChipSelected,
                  ]}
                  testID={`stay-staff-source-${candidate.id}`}
                >
                  <Text
                    style={[
                      styles.sourceLabel,
                      selected && styles.sourceLabelSelected,
                    ]}
                  >
                    {candidate.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.sourceBlock}>
          <Text style={styles.fieldLabel}>Payment</Text>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: paymentMethod === "link" }}
            onPress={() => setPaymentMethod("link")}
            disabled={quote !== null || submitting}
            style={[styles.paymentOption, paymentMethod === "link" && styles.paymentOptionSelected]}
            testID="stay-staff-payment-link"
          >
            <Text style={styles.paymentTitle}>Send a secure payment link</Text>
            <Text style={styles.helper}>Hold the Room or Place for 24 hours while the guest pays online.</Text>
          </Pressable>
          {paymentMethod === "link" ? (
            <View style={styles.channelRow}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: sendEmail }}
                onPress={() => setSendEmail((value) => !value)}
                disabled={submitting}
                style={[styles.sourceChip, sendEmail && styles.sourceChipSelected]}
              >
                <Text style={[styles.sourceLabel, sendEmail && styles.sourceLabelSelected]}>Email</Text>
              </Pressable>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: sendSms }}
                onPress={() => setSendSms((value) => !value)}
                disabled={submitting}
                style={[styles.sourceChip, sendSms && styles.sourceChipSelected]}
              >
                <Text style={[styles.sourceLabel, sendSms && styles.sourceLabelSelected]}>Text message</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: paymentMethod === "property" }}
            onPress={() => setPaymentMethod("property")}
            disabled={quote !== null || submitting}
            style={[styles.paymentOption, paymentMethod === "property" && styles.paymentOptionSelected]}
            testID="stay-staff-payment-property"
          >
            <Text style={styles.paymentTitle}>Pay at property</Text>
            <Text style={styles.helper}>Confirm now. Mingla will not charge or refund the guest.</Text>
          </Pressable>
        </View>

        <StayGuestBooking
          detail={detailQuery.data ?? null}
          state={detailState}
          palette={palette}
          surface={surface}
          theme={theme}
          checkoutContext="staff"
          staffPaymentMethod={paymentMethod}
          submitting={submitting}
          errorMessage={error}
          quote={quote}
          onRetry={() => void detailQuery.refetch()}
          onSubmit={prepareQuote}
          onConfirmQuote={confirm}
          onEditQuote={() => {
            setQuote(null);
            setCheckout(null);
            setCreateKey(null);
            setError(null);
          }}
        />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  flexOne: { flex: 1, minWidth: 0 },
  title: { ...typography.h2, color: textTokens.primary },
  helper: { ...typography.bodySm, color: textTokens.secondary },
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  sourceBlock: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sourceRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  sourceChip: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    paddingHorizontal: spacing.md,
  },
  sourceChipSelected: { borderColor: accent.warm, backgroundColor: accent.warm },
  sourceLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  sourceLabelSelected: { color: "#0c0e12", fontWeight: "700" },
  paymentOption: { borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border.profileBase, borderRadius: radius.md, padding: spacing.md, gap: 3 },
  paymentOptionSelected: { borderColor: accent.warm, backgroundColor: "rgba(235, 120, 37, 0.08)" },
  paymentTitle: { ...typography.body, color: textTokens.primary, fontWeight: "700" },
  channelRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  successPage: { flex: 1, padding: spacing.xl, gap: spacing.lg },
  linkText: { ...typography.bodySm, color: accent.warm },
});

export default StayStaffReservationCreateSheet;
