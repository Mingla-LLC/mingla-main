/**
 * TicketClaimConfirmModal — confirmation step before a business-event
 * ticket claim or paid purchase. Per ORCH-0829-A spec §3.8.
 *
 * Replaces the pre-rework silent-claim path where tapping "Get Free"
 * went straight to `runNativeCheckout` with only a toast confirming.
 * Operator UX requirement: every transactional action gets at least
 * one confirmation step with buyer info preview.
 *
 * Invariant: I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED.
 *
 * ORCH-0834-rescoped (2026-05-14): migrated from React Native `Modal` to
 * inline `@gorhom/bottom-sheet` per spec §3.4. Matches the event-detail
 * sheet pattern at ExpandedBusinessEventSheet.tsx:120 + the proven TM
 * pattern at ExpandedCardModal.tsx:1602-2066. Free + paid both render
 * with the same bottom-sheet UX for visual consistency. Props + behavior
 * (visible / onCancel / onConfirm / isSubmitting) preserved verbatim so
 * the ExpandedBusinessEventSheet consumer is unchanged.
 *
 * New invariant established at CLOSE:
 * I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM — confirmation surfaces
 * (paid + free) MUST use @gorhom/bottom-sheet inline pattern, NOT
 * React Native `Modal`. CI gate via orch-0834-rescoped-regression-check.
 */

import React, { useCallback, useMemo, useRef, useEffect } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

import { Icon } from "../ui/Icon";

interface TicketClaimConfirmModalProps {
  visible: boolean;
  ticketName: string;
  ticketPriceCents: number | null; // null = free
  ticketCurrency: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  isFreeTicket: boolean;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const SNAP_POINTS = ["60%"];

const formatPrice = (cents: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "GBP",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
};

export const TicketClaimConfirmModal: React.FC<TicketClaimConfirmModalProps> = ({
  visible,
  ticketName,
  ticketPriceCents,
  ticketCurrency,
  buyerName,
  buyerEmail,
  buyerPhone,
  isFreeTicket,
  isSubmitting = false,
  onCancel,
  onConfirm,
}) => {
  const sheetRef = useRef<BottomSheet>(null);

  const handleConfirm = useCallback((): void => {
    if (isSubmitting) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onConfirm();
  }, [isSubmitting, onConfirm]);

  const handleCancel = useCallback((): void => {
    if (isSubmitting) return;
    onCancel();
  }, [isSubmitting, onCancel]);

  // ORCH-0834-rescoped: drive the sheet via the declarative `index` prop —
  // matches the inline pattern in ExpandedBusinessEventSheet.tsx. Index 0
  // = visible (snap to first snap point); -1 = closed.
  const sheetIndex = visible ? 0 : -1;

  // Forward backdrop tap + swipe-down to onCancel. Submission-in-flight
  // is guarded inside handleCancel so the user can't dismiss mid-charge.
  const handleSheetChange = useCallback(
    (index: number): void => {
      if (index === -1 && visible) {
        handleCancel();
      }
    },
    [handleCancel, visible],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  const priceLabel = isFreeTicket
    ? "Free"
    : ticketPriceCents !== null
      ? formatPrice(ticketPriceCents, ticketCurrency)
      : "Price unavailable";

  const disclosure = isFreeTicket
    ? `By confirming, you'll get a ticket QR for ${ticketName}.`
    : `By confirming, you'll be charged ${priceLabel}. You can review and complete payment in the next step.`;

  const confirmLabel = isFreeTicket ? "Claim Free Ticket" : "Continue to Payment";

  // Defensive: ensure the sheet ref animates when visible changes after mount.
  // The declarative `index` prop should handle this, but some `@gorhom/bottom-sheet`
  // versions are more reliable with an explicit snap call when the parent
  // re-renders with a state change.
  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={sheetIndex}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle} numberOfLines={2} allowFontScaling>
            {ticketName}
          </Text>
          <Pressable
            style={styles.closeIcon}
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={12}
            onPress={handleCancel}
            disabled={isSubmitting}
          >
            <Icon name="close" size={20} color="rgba(255,255,255,0.65)" />
          </Pressable>
        </View>

        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>Price</Text>
          <Text style={styles.priceValue}>{priceLabel}</Text>
        </View>

        <View style={styles.divider} />

        <Text style={styles.sectionLabel}>Your ticket goes to</Text>
        <View style={styles.buyerBlock}>
          <BuyerRow label="Name" value={buyerName} />
          <BuyerRow label="Email" value={buyerEmail} />
          <BuyerRow label="Phone" value={buyerPhone} />
        </View>

        <Text style={styles.disclosure} allowFontScaling>
          {disclosure}
        </Text>

        <View style={styles.ctaRow}>
          <Pressable
            style={[styles.ctaCancel, isSubmitting && styles.ctaDisabled]}
            accessibilityLabel="Cancel"
            accessibilityRole="button"
            onPress={handleCancel}
            disabled={isSubmitting}
          >
            <Text style={styles.ctaCancelLabel}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.ctaConfirm, isSubmitting && styles.ctaDisabled]}
            accessibilityLabel={confirmLabel}
            accessibilityRole="button"
            onPress={handleConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaConfirmLabel}>{confirmLabel}</Text>
            )}
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
};

interface BuyerRowProps {
  label: string;
  value: string;
}

const BuyerRow: React.FC<BuyerRowProps> = ({ label, value }) => (
  <View style={styles.buyerRow}>
    <Text style={styles.buyerLabel}>{label}</Text>
    <Text style={styles.buyerValue} numberOfLines={1}>
      {value || "—"}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  // ORCH-0834-rescoped: backgroundStyle replaces the prior card backdrop +
  // card pattern (Modal → BottomSheet swap). Matches the dark-glass feel
  // of the event-detail sheet at ExpandedBusinessEventSheet.tsx.
  sheetBackground: {
    backgroundColor: "#15181f",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handleIndicator: {
    backgroundColor: "rgba(255,255,255,0.35)",
    width: 44,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
  closeIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 18,
  },
  priceLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontWeight: "500",
  },
  priceValue: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.10)",
    marginTop: 18,
    marginBottom: 18,
  },
  sectionLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  buyerBlock: {
    gap: 8,
  },
  buyerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  buyerLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
  },
  buyerValue: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
    textAlign: "right",
  },
  disclosure: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 18,
    marginBottom: 22,
  },
  ctaRow: {
    flexDirection: "row",
    gap: 12,
  },
  ctaCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaCancelLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    fontWeight: "600",
  },
  ctaConfirm: {
    flex: 1.6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaConfirmLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  ctaDisabled: {
    opacity: 0.5,
  },
});

export default TicketClaimConfirmModal;
