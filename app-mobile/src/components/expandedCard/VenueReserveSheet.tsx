/**
 * VenueReserveSheet — META-ORCH-1148 sub-ORCH 2.2b (SPEC §4.E.1).
 * ---------------------------------------------------------------------------
 * The consumer 3-step reserve flow, in ONE BaseBottomSheet (theme "dark",
 * opaque Android fill via the BaseBottomSheet system / Android-glass policy):
 *
 *   Step 1 — party size + date.  CTA "See times".
 *   Step 2 — live slot grid from the engine (VenueSlotPicker). CTA "Continue".
 *   Step 3 — confirm / review (ALWAYS, even FREE — locked decision 3): venue ·
 *            day · time · party. Collect a phone if the signed-in user has none
 *            (the venue contacts the guest). FREE → "Confirm reservation";
 *            FEE → all-in WYSIWYP total + "Confirm & pay" (native PaymentSheet).
 *
 * NO sign-in step (2.2b CORRECTION 2026-06-17): the consumer app is root-auth-
 * gated, so the user is ALREADY signed in; the reservation attaches to the
 * signed-in user server-side. Slots come ONLY from the engine (never fabricated).
 */

import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { BOTTOM_NAV_CONTENT_HEIGHT } from "../../hooks/useAppLayout";
import { PhoneInput } from "../onboarding/PhoneInput";
import type { PhoneInputTheme } from "@mingla/phone-input";
import {
  getCountryByCode,
  getDefaultCountryCode,
} from "../../constants/countries";
import {
  buildPendingCollabPhoneE164,
  isPendingCollabPhoneValid,
} from "../connections/pendingCollabChatUtils";
import { useAppStore } from "../../store/appStore";
import { useVenueAvailability, type VenueSlot } from "../../hooks/useVenueAvailability";
import { useReserveTable } from "../../hooks/useReserveTable";
import { VenueSlotPicker } from "./VenueSlotPicker";

export interface VenueReserveSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The reservable venue's brand id (from useVenueReservable). */
  brandId: string;
  /** Venue display name for the review/confirm summary. */
  venueName: string;
  /** Display currency (WYSIWYP), e.g. "USD". */
  currency: string | null;
  /** Fires after a successful booking with the new reservation id. */
  onReserved: (reservationId: string) => void;
}

type Step = "party" | "slots" | "confirm";

const SHEET_SNAP_POINTS = ["82%"];
const MAX_PARTY = 12;
const ADVANCE_DAYS = 30;

// Dark PhoneInput theme for the reserve sheet (mirrors the public buyer form's
// PUBLIC_BUYER_PHONE_THEME so contrast reads on the dark sheet surface).
const RESERVE_PHONE_THEME: PhoneInputTheme = {
  backgroundPrimary: "#15181f",
  textPrimary: "rgba(255, 255, 255, 0.96)",
  textTertiary: "rgba(255, 255, 255, 0.52)",
  borderDefault: "rgba(255, 255, 255, 0.14)",
  borderFocused: "#f59e0b",
  borderError: "#ef4444",
  searchBackground: "rgba(255, 255, 255, 0.06)",
  rowPressedBackground: "rgba(255, 255, 255, 0.04)",
  divider: "rgba(255, 255, 255, 0.08)",
  accessoryBackground: "rgba(21, 24, 31, 0.95)",
  accessoryBorder: "rgba(255, 255, 255, 0.08)",
  accent: "#f59e0b",
  errorText: "#ef4444",
};

/** Build the next N selectable local calendar days (YYYY-MM-DD + label). */
function buildDateOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < ADVANCE_DAYS; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const label =
      i === 0
        ? "Today"
        : i === 1
          ? "Tomorrow"
          : d.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
    out.push({ value, label });
  }
  return out;
}

export const VenueReserveSheet: React.FC<VenueReserveSheetProps> = ({
  visible,
  onClose,
  brandId,
  venueName,
  currency,
  onReserved,
}) => {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAppStore();
  const reserve = useReserveTable(user?.id);

  const [step, setStep] = useState<Step>("party");
  const [partySize, setPartySize] = useState(2);
  const dateOptions = useMemo(buildDateOptions, []);
  const [date, setDate] = useState(dateOptions[0]?.value ?? "");
  const [selectedSlot, setSelectedSlot] = useState<VenueSlot | null>(null);

  // Phone collection (only when the signed-in user has none on file).
  const [phoneInput, setPhoneInput] = useState("");
  const [countryCode, setCountryCode] = useState(getDefaultCountryCode());
  const selectedCountry = useMemo(
    () => getCountryByCode(countryCode),
    [countryCode],
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The engine query — only fires on the slots step with all params set.
  const slotsQuery = useVenueAvailability(
    step === "slots" || step === "confirm" ? brandId : null,
    step === "slots" || step === "confirm" ? date : null,
    step === "slots" || step === "confirm" ? partySize : null,
  );

  // ORCH-1148 [consumer phone blocker] — the signed-in user's phone is sourced
  // from their profile / auth user. The store `user` now mirrors `profiles.phone`
  // (see appStore.setProfile); we also read `profile.phone` directly as a
  // belt-and-suspenders fallback in case the store `user` merge hasn't landed
  // yet (profile loads asynchronously, possibly after this sheet first reads).
  // A user WITH a phone gets needsPhone=false (no prompt, books automatically);
  // a user with NONE gets the contact-phone input.
  //
  // ORCH-1148b [non-US phone blocker] — Supabase Auth stores the onboarding phone
  // in E.164 WITHOUT the leading '+' (e.g. "32466178389"), while the profile /
  // public buyer form store it WITH '+'. The server `normalizePhoneE164` only
  // re-prefixes US numbers (10-digit → +1, 11-digit "1…" → +…), so a bare
  // international number ("32466178389") normalized to null → buyer_phone_required
  // for EVERY non-US consumer. Coerce a bare all-digits stored phone to '+digits'
  // here so the server accepts it. (Already-'+'-prefixed values pass through.)
  const rawStoredPhone = (profile?.phone ?? user?.phone ?? "").trim();
  const profilePhone = rawStoredPhone.startsWith("+")
    ? rawStoredPhone // already E.164 (profile / public buyer form)
    : /^\d{10}$/.test(rawStoredPhone) || /^1\d{10}$/.test(rawStoredPhone)
    ? rawStoredPhone // US national (10) / US E.164 "1…" (11) — let the server add +1
    : /^\d{6,15}$/.test(rawStoredPhone)
    ? `+${rawStoredPhone}` // full international E.164 missing its '+' (Supabase Auth)
    : rawStoredPhone;
  const needsPhone = profilePhone.length === 0;
  const composedPhoneE164 = needsPhone
    ? buildPendingCollabPhoneE164(phoneInput, selectedCountry?.dialCode)
    : profilePhone;
  const phoneOk = needsPhone
    ? isPendingCollabPhoneValid(phoneInput)
    : profilePhone.length > 0;

  const buyerName =
    (user?.display_name || user?.first_name || "Guest").trim() || "Guest";
  const buyerEmail = (user?.email ?? "").trim();

  const resetAndClose = (): void => {
    setStep("party");
    setSelectedSlot(null);
    setError(null);
    setSubmitting(false);
    onClose();
  };

  const handleConfirm = async (): Promise<void> => {
    if (!selectedSlot || submitting) return;
    if (!phoneOk) {
      setError("Add a phone number so the venue can reach you.");
      return;
    }
    setError(null);
    setSubmitting(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const outcome = await reserve({
      brandId,
      reservedForUtc: selectedSlot.slotStartUtc,
      partySize,
      buyer: {
        name: buyerName,
        email: buyerEmail,
        phone: composedPhoneE164,
      },
    });
    setSubmitting(false);
    if (outcome.outcome === "succeeded") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onReserved(outcome.reservationId);
      resetAndClose();
      return;
    }
    if (outcome.outcome === "canceled") {
      // Stay on the confirm step silently (no booking).
      return;
    }
    setError(outcome.message);
  };

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={resetAndClose}
      theme="dark"
      snapPoints={SHEET_SNAP_POINTS}
      backgroundStyle={styles.sheetBackground}
      handleStyle={styles.handleIndicator}
      accessibilityLabel="Reserve a table"
      scrollMode="scroll"
      hidesBottomNav
      scrollProps={{
        contentContainerStyle: [
          styles.scrollContent,
          { paddingBottom: BOTTOM_NAV_CONTENT_HEIGHT + Math.max(insets.bottom, 16) },
        ],
        showsVerticalScrollIndicator: false,
      }}
    >
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Reserve a table
        </Text>
        <Pressable
          style={styles.closeIcon}
          accessibilityLabel="Close"
          accessibilityRole="button"
          hitSlop={12}
          onPress={resetAndClose}
        >
          <Icon name="close" size={20} color="rgba(255,255,255,0.65)" />
        </Pressable>
      </View>
      <Text style={styles.venueName} numberOfLines={1}>
        {venueName}
      </Text>

      {/* ── Step 1 — party + date ─────────────────────────────────────────── */}
      {step === "party" && (
        <View style={styles.stepBody}>
          <Text style={styles.sectionLabel}>PARTY SIZE</Text>
          <View style={styles.stepperRow}>
            <Pressable
              onPress={() => setPartySize((p) => Math.max(1, p - 1))}
              disabled={partySize <= 1}
              accessibilityRole="button"
              accessibilityLabel="Decrease party size"
              style={({ pressed }) => [
                styles.stepperBtn,
                partySize <= 1 && styles.stepperBtnDisabled,
                pressed && styles.stepperBtnPressed,
              ]}
            >
              <Icon name="remove" size={22} color="rgba(255,255,255,0.92)" />
            </Pressable>
            <Text style={styles.stepperValue} accessibilityLabel={`Party of ${partySize}`}>
              {partySize}
            </Text>
            <Pressable
              onPress={() => setPartySize((p) => Math.min(MAX_PARTY, p + 1))}
              disabled={partySize >= MAX_PARTY}
              accessibilityRole="button"
              accessibilityLabel="Increase party size"
              style={({ pressed }) => [
                styles.stepperBtn,
                partySize >= MAX_PARTY && styles.stepperBtnDisabled,
                pressed && styles.stepperBtnPressed,
              ]}
            >
              <Icon name="add" size={22} color="rgba(255,255,255,0.92)" />
            </Pressable>
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>DATE</Text>
          <View style={styles.dateGrid}>
            {dateOptions.map((opt) => {
              const sel = opt.value === date;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setDate(opt.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sel }}
                  accessibilityLabel={opt.label}
                  style={({ pressed }) => [
                    styles.dateChip,
                    sel && styles.dateChipSelected,
                    pressed && !sel && styles.dateChipPressed,
                  ]}
                >
                  <Text
                    style={[styles.dateChipText, sel && styles.dateChipTextSelected]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => {
              setSelectedSlot(null);
              setStep("slots");
            }}
            accessibilityRole="button"
            accessibilityLabel="See times"
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          >
            <Text style={styles.ctaText}>See times</Text>
          </Pressable>
        </View>
      )}

      {/* ── Step 2 — slot grid ────────────────────────────────────────────── */}
      {step === "slots" && (
        <View style={styles.stepBody}>
          <Text style={styles.sectionLabel}>
            {`PARTY OF ${partySize} · ${dateOptions.find((d) => d.value === date)?.label ?? date}`}
          </Text>
          <VenueSlotPicker
            slots={slotsQuery.data ?? []}
            isLoading={slotsQuery.isLoading}
            isError={slotsQuery.isError}
            onRetry={() => void slotsQuery.refetch()}
            selectedSlotUtc={selectedSlot?.slotStartUtc ?? null}
            onSelect={(slot) => {
              setSelectedSlot(slot);
              setStep("confirm");
            }}
          />
          <Pressable
            onPress={() => setStep("party")}
            accessibilityRole="button"
            accessibilityLabel="Back to party and date"
            style={styles.backLink}
          >
            <Icon name="chevron-back" size={16} color="rgba(255,255,255,0.6)" />
            <Text style={styles.backLinkText}>Party &amp; date</Text>
          </Pressable>
        </View>
      )}

      {/* ── Step 3 — confirm / review (ALWAYS, even FREE) ─────────────────── */}
      {step === "confirm" && selectedSlot && (
        <View style={styles.stepBody}>
          <Text style={styles.sectionLabel}>REVIEW</Text>
          <View style={styles.summaryCard}>
            <SummaryRow icon="business-outline" text={venueName} />
            <SummaryRow
              icon="calendar-outline"
              text={`${dateOptions.find((d) => d.value === date)?.label ?? date} · ${selectedSlot.label}`}
            />
            <SummaryRow icon="people-outline" text={`Party of ${partySize}`} />
          </View>

          {needsPhone && (
            <View style={styles.phoneBlock}>
              <Text style={styles.sectionLabel}>CONTACT PHONE</Text>
              <PhoneInput
                value={phoneInput}
                countryCode={countryCode}
                onChangePhone={setPhoneInput}
                onChangeCountry={setCountryCode}
                error={null}
                disabled={submitting}
                theme={RESERVE_PHONE_THEME}
              />
            </View>
          )}

          {error ? (
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={() => void handleConfirm()}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Confirm reservation"
            style={({ pressed }) => [
              styles.cta,
              submitting && styles.ctaDisabled,
              pressed && !submitting && styles.ctaPressed,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#1a1305" />
            ) : (
              <Text style={styles.ctaText}>Confirm reservation</Text>
            )}
          </Pressable>
          <Text style={styles.confirmNote}>
            We&apos;ll hold your table for the time you picked. If this venue
            requires a deposit{currency ? ` (in ${currency.toUpperCase()})` : ""},
            you&apos;ll review the exact all-in amount on the next screen before
            you pay.
          </Text>

          <Pressable
            onPress={() => setStep("slots")}
            accessibilityRole="button"
            accessibilityLabel="Back to times"
            style={styles.backLink}
            disabled={submitting}
          >
            <Icon name="chevron-back" size={16} color="rgba(255,255,255,0.6)" />
            <Text style={styles.backLinkText}>Times</Text>
          </Pressable>
        </View>
      )}
    </BaseBottomSheet>
  );
};

const SummaryRow: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <View style={styles.summaryRow}>
    <Icon name={icon} size={18} color="rgba(255,255,255,0.6)" />
    <Text style={styles.summaryText} numberOfLines={1}>
      {text}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#15181f",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handleIndicator: {
    backgroundColor: "rgba(255, 255, 255, 0.35)",
    width: 44,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    color: "rgba(255, 255, 255, 0.96)",
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
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  venueName: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    marginTop: 2,
    marginBottom: 18,
  },
  stepBody: {
    gap: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.52)",
    letterSpacing: 1.4,
    marginBottom: 10,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    alignSelf: "flex-start",
  },
  stepperBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  stepperBtnPressed: {
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  stepperValue: {
    minWidth: 36,
    textAlign: "center",
    fontSize: 28,
    fontWeight: "700",
    color: "rgba(255,255,255,0.95)",
  },
  dateGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dateChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  dateChipSelected: {
    borderColor: "#f59e0b",
    backgroundColor: "rgba(245,158,11,0.16)",
  },
  dateChipPressed: {
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  dateChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.85)",
  },
  dateChipTextSelected: {
    color: "#fbbf24",
  },
  cta: {
    marginTop: 24,
    backgroundColor: "#f59e0b",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaPressed: {
    backgroundColor: "#d97706",
  },
  ctaDisabled: {
    opacity: 0.7,
  },
  ctaText: {
    color: "#1a1305",
    fontSize: 16,
    fontWeight: "700",
  },
  confirmNote: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
  },
  summaryCard: {
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  summaryText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255,255,255,0.92)",
  },
  phoneBlock: {
    marginTop: 18,
  },
  errorText: {
    marginTop: 14,
    color: "#fca5a5",
    fontSize: 14,
  },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "center",
    marginTop: 18,
    paddingVertical: 8,
  },
  backLinkText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: "600",
  },
});

export default VenueReserveSheet;
