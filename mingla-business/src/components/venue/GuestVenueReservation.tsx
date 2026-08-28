import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import {
  captureWeb,
  getStoredClickAttribution,
} from "../../analytics/webAnalytics";
import {
  PhoneInput,
  getCountryByCode,
  getDefaultCountryCode,
  type PhoneInputIconName,
  type PhoneInputTheme,
} from "@mingla/phone-input";
import type { ThemePalette } from "@mingla/offering-rendering";
import {
  radius,
  semantic,
  spacing,
  typography,
} from "../../constants/designSystem";
import { usePublicVenueAvailability } from "../../hooks/usePublicVenueAvailability";
import { createGuestVenueReservation } from "../../services/venueGuestReservationService";
import {
  captureVenueOrganicEvent,
  getVenueOrganicJourneyToken,
} from "../../services/venueOrganicCaptureService";
import { runBuyerVenueOrganicCapture } from "../../services/venueOrganicCapturePolicy";
import { composeE164 } from "../../utils/phone";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";

interface GuestVenueReservationProps {
  venueId: string;
  brandId: string;
  currency: string | null;
  analyticsSurface: "buyer_web" | "business_preview";
  /**
   * issue #1564 — the page's RESOLVED palette, handed down by the booking slot.
   *
   * THE BUG THIS CLOSES. Every other pixel of the public venue page is themed
   * from this palette, and the Stay booking body (`BuyerStayGuestExperience`)
   * has always received it — but the table-reservation body hardcoded Mingla
   * orange `#eb7825` and the near-black `#0c0e12`. Restaurants therefore got
   * the broken half of a themed page: a brand in blue opened a reservation
   * form with an orange focus ring. Once a VENUE can pick its own colours that
   * stops being a subtle mismatch and becomes a jarring one, so it is fixed
   * here rather than left to be discovered.
   *
   * The `table` branch of `PublicVenueBookingSlotContext` already carried
   * `palette` (via `PublicVenueThemedContext`) — nothing was plumbed, only
   * ignored.
   */
  palette: ThemePalette;
}
const INVALID_PHONE_COPY = "Enter a valid phone number.";
const INVALID_NAME_COPY = "Enter your name.";
const INVALID_EMAIL_COPY = "Enter a valid email address.";
const RESERVATION_FAILURE_COPY =
  "We couldn’t start your reservation. Check your details and try again.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const dateOptions = (): { value: string; label: string }[] => {
  const now = new Date();
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + index,
    );
    return {
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      label:
        index === 0
          ? "Today"
          : date.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            }),
    };
  });
};

export function GuestVenueReservation({
  venueId,
  brandId,
  currency,
  analyticsSurface,
  palette,
}: GuestVenueReservationProps): React.ReactElement {
  const dates = useMemo(dateOptions, []);
  // issue #1564 — derived from the page's palette, byte-for-byte the mapping
  // `PublicEventPage.phoneFieldTheme` already uses, so the two themed phone
  // fields in this app cannot drift. `#ef4444` stays literal on both error
  // tokens: an error is a SEMANTIC colour, not a brand one, and tinting it
  // with a red-accented venue's own hue would make an error indistinguishable
  // from the rest of the form.
  const phoneFieldTheme = useMemo<PhoneInputTheme>(
    () => ({
      backgroundPrimary: palette.page,
      textPrimary: palette.primaryText,
      textTertiary: palette.tertiaryText,
      borderDefault: palette.panelBorder,
      borderFocused: palette.accent,
      borderError: "#ef4444",
      searchBackground: palette.card,
      rowPressedBackground: palette.accentWash,
      divider: palette.panelBorder,
      accessoryBackground: palette.page,
      accessoryBorder: palette.panelBorder,
      accent: palette.accent,
      errorText: "#ef4444",
    }),
    [palette],
  );
  // The date/time chips. `chipSelected` was `borderColor:"#eb7825"` +
  // `backgroundColor:"rgba(235,120,37,0.16)"` — the same orange, spelled twice.
  // `accentWash` IS that 0.16-ish tint, derived from the resolved accent.
  const chipTheme = useMemo(
    () => ({
      chip: { borderColor: palette.panelBorder },
      chipSelected: {
        borderColor: palette.accent,
        backgroundColor: palette.accentWash,
      },
    }),
    [palette],
  );
  const [partySize, setPartySize] = useState(2);
  const [date, setDate] = useState<string | null>(dates[0]?.value ?? null);
  const [selectedUtc, setSelectedUtc] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [nameServerInvalid, setNameServerInvalid] = useState(false);
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailServerInvalid, setEmailServerInvalid] = useState(false);
  const [phoneCountry, setPhoneCountry] = useState(getDefaultCountryCode());
  const [phoneLocal, setPhoneLocal] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [occasion, setOccasion] = useState("");
  const [notes, setNotes] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedId, setCompletedId] = useState<string | null>(null);

  const availability = usePublicVenueAvailability(venueId, date, partySize);
  const slots = availability.data ?? [];
  const availabilitySettled =
    !availability.isLoading &&
    !availability.isFetching &&
    !availability.isError;
  const currentSelectedSlot = slots.find(
    (slot) => slot.slotStartUtc === selectedUtc,
  );
  const selectedSlot =
    !availability.isError && currentSelectedSlot?.isFull === false
      ? currentSelectedSlot
      : undefined;
  const submissionTruthRef = useRef<{
    canSubmit: boolean;
    reservedForUtc: string | null;
    selectableSlotUtcValues: readonly string[];
  }>({ canSubmit: false, reservedForUtc: null, selectableSlotUtcValues: [] });
  submissionTruthRef.current = {
    canSubmit: availabilitySettled && selectedSlot !== undefined && !submitting,
    reservedForUtc: selectedSlot?.slotStartUtc ?? null,
    selectableSlotUtcValues: availabilitySettled
      ? slots
          .filter((slot) => !slot.isFull)
          .map((slot) => slot.slotStartUtc)
      : [],
  };
  const phoneDialCode = getCountryByCode(phoneCountry)?.dialCode ?? "+1";
  const normalizedPhone = composeE164(phoneDialCode, phoneLocal);
  const normalizedName = name.trim();
  const normalizedEmail = email.trim();
  const nameInvalid = normalizedName.length < 2;
  const emailInvalid = !EMAIL_PATTERN.test(normalizedEmail);
  const contactInvalid = nameInvalid || emailInvalid;

  useEffect(() => {
    if (!availabilitySettled || selectedUtc === null) return;
    if (currentSelectedSlot?.isFull !== false) setSelectedUtc(null);
  }, [availabilitySettled, currentSelectedSlot?.isFull, selectedUtc]);

  useEffect(() => {
    if (availability.data === undefined) return;
    captureWeb("venue_availability_result_viewed", {
      surface: analyticsSurface,
      brand_id: brandId,
      venue_id: venueId,
    });
    runBuyerVenueOrganicCapture(analyticsSurface, () => {
      void captureVenueOrganicEvent({ brandId, venueId }, "availability_shown");
    });
  }, [analyticsSurface, availability.data, brandId, venueId]);

  const submit = async (): Promise<void> => {
    const submissionTruth = submissionTruthRef.current;
    if (!submissionTruth.canSubmit || submissionTruth.reservedForUtc === null) {
      return;
    }
    if (nameInvalid) setNameTouched(true);
    if (emailInvalid) setEmailTouched(true);
    if (selectedUtc === null || contactInvalid || normalizedPhone === null) {
      setPhoneTouched(true);
      setError(normalizedPhone === null ? INVALID_PHONE_COPY : null);
      return;
    }
    submissionTruthRef.current = {
      canSubmit: false,
      reservedForUtc: submissionTruth.reservedForUtc,
      selectableSlotUtcValues: submissionTruth.selectableSlotUtcValues,
    };
    setSubmitting(true);
    setError(null);
    captureWeb("public_venue_reservation_submitted", {
      surface: analyticsSurface,
      brand_id: brandId,
      venue_id: venueId,
      currency,
    });
    try {
      const result = await createGuestVenueReservation({
        venueId,
        brandId,
        reservedForUtc: submissionTruth.reservedForUtc,
        partySize,
        buyer: {
          name: normalizedName,
          email: normalizedEmail,
          phone: normalizedPhone,
          phoneCountryIso: phoneCountry,
          marketingOptIn,
        },
        occasion: occasion.trim() || null,
        guestNotes: notes.trim() || null,
        attributionClickId: getStoredClickAttribution().clickId,
        organicJourneyToken: getVenueOrganicJourneyToken({ brandId, venueId }),
      });
      if (result.kind === "free_completed") {
        setCompletedId(result.reservationId);
        captureWeb("venue_reservation_completed", {
          surface: analyticsSurface,
          brand_id: brandId,
          venue_id: venueId,
          free_paid: "free",
          currency,
        });
        return;
      }
      const redirect =
        result.kind === "requires_web_redirect"
          ? result.hostedCheckoutUrl
          : result.authorizationUrl;
      if (redirect === null || redirect.length === 0) {
        throw new Error("The payment page could not open. Try again.");
      }
      await Linking.openURL(redirect);
    } catch (caught) {
      const errorCode =
        caught instanceof Error ? caught.message : RESERVATION_FAILURE_COPY;
      if (errorCode === "buyer_name_required") {
        setNameTouched(true);
        setNameServerInvalid(true);
        setError(null);
      } else if (errorCode === "buyer_email_invalid") {
        setEmailTouched(true);
        setEmailServerInvalid(true);
        setError(null);
      } else {
        setError(RESERVATION_FAILURE_COPY);
      }
      captureWeb("venue_reservation_failed", {
        surface: analyticsSurface,
        brand_id: brandId,
        venue_id: venueId,
        result_class: "create_failed",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (completedId !== null) {
    return (
      <View style={[styles.stateCard, { borderColor: palette.panelBorder }]}>
        <Text style={[styles.title, { color: palette.primaryText }]}>
          Your table is reserved
        </Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          Confirmation has been sent to your email.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <Text style={[styles.title, { color: palette.primaryText }]}>
        Find a table
      </Text>
      <Text style={[styles.label, { color: palette.tertiaryText }]}>
        PARTY SIZE
      </Text>
      <View style={styles.stepper}>
        <Button
          label="−"
          variant="secondary"
          size="md"
          disabled={partySize <= 1}
          onPress={() => {
            setPartySize((value) => Math.max(1, value - 1));
            setSelectedUtc(null);
          }}
          accessibilityLabel="Decrease party size"
        />
        <Text style={[styles.party, { color: palette.primaryText }]}>
          {partySize}
        </Text>
        <Button
          label="+"
          variant="secondary"
          size="md"
          disabled={partySize >= 12}
          onPress={() => {
            setPartySize((value) => Math.min(12, value + 1));
            setSelectedUtc(null);
          }}
          accessibilityLabel="Increase party size"
        />
      </View>
      <Text style={[styles.label, { color: palette.tertiaryText }]}>DATE</Text>
      <View style={styles.chips}>
        {dates.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => {
              setDate(option.value);
              setSelectedUtc(null);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Select ${option.label}`}
            accessibilityState={{ selected: date === option.value }}
            style={[
              styles.chip,
              chipTheme.chip,
              date === option.value && chipTheme.chipSelected,
            ]}
          >
            <Text style={[styles.chipText, { color: palette.primaryText }]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.label, { color: palette.tertiaryText }]}>
        AVAILABLE TIMES
      </Text>
      {availability.isLoading || availability.isFetching ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.accent} />
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            Finding open tables…
          </Text>
        </View>
      ) : availability.isError ? (
        <View style={[styles.stateCard, { borderColor: palette.panelBorder }]}>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            We couldn’t load times.
          </Text>
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => {
              void availability.refetch();
            }}
          />
        </View>
      ) : slots.length === 0 ? (
        <View style={[styles.stateCard, { borderColor: palette.panelBorder }]}>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            No tables for this day.
          </Text>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            Try another date.
          </Text>
        </View>
      ) : (
        <View style={styles.chips}>
          {slots.map((slot) => (
            <Pressable
              key={slot.slotStartUtc}
              disabled={slot.isFull}
              onPress={() => {
                if (
                  !submissionTruthRef.current.selectableSlotUtcValues.includes(
                    slot.slotStartUtc,
                  )
                ) {
                  return;
                }
                setSelectedUtc(slot.slotStartUtc);
                captureWeb("venue_reservation_slot_selected", {
                  surface: analyticsSurface,
                  brand_id: brandId,
                  venue_id: venueId,
                });
              }}
              accessibilityRole="button"
              accessibilityLabel={
                slot.isFull
                  ? `${slot.slotLocalLabel}, full`
                  : `Select ${slot.slotLocalLabel}`
              }
              accessibilityState={{
                disabled: slot.isFull,
                selected:
                  !slot.isFull &&
                  selectedSlot?.slotStartUtc === slot.slotStartUtc,
              }}
              style={[
                styles.chip,
                chipTheme.chip,
                !slot.isFull &&
                  selectedSlot?.slotStartUtc === slot.slotStartUtc &&
                  chipTheme.chipSelected,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: slot.isFull
                      ? palette.secondaryText
                      : palette.primaryText,
                  },
                ]}
              >
                {slot.slotLocalLabel}
                {slot.isFull ? " · Full" : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {selectedSlot !== undefined ? (
        <View style={styles.form}>
          <Text style={[styles.label, { color: palette.tertiaryText }]}>
            NAME · REQUIRED
          </Text>
          <Input
            value={name}
            onChangeText={(next: string) => {
              setName(next);
              setNameServerInvalid(false);
            }}
            onBlur={() => setNameTouched(true)}
            placeholder="Name"
            aria-label="Name, required"
            accessibilityLabel="Name, required"
          />
          {nameTouched && (nameInvalid || nameServerInvalid) ? (
            <Text
              style={styles.fieldError}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {INVALID_NAME_COPY}
            </Text>
          ) : null}
          <Text style={[styles.label, { color: palette.tertiaryText }]}>
            EMAIL · REQUIRED
          </Text>
          <Input
            value={email}
            onChangeText={(next: string) => {
              setEmail(next);
              setEmailServerInvalid(false);
            }}
            onBlur={() => setEmailTouched(true)}
            variant="email"
            placeholder="Email"
            aria-label="Email, required"
            accessibilityLabel="Email, required"
          />
          {emailTouched && (emailInvalid || emailServerInvalid) ? (
            <Text
              style={styles.fieldError}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {INVALID_EMAIL_COPY}
            </Text>
          ) : null}
          <PhoneInput
            value={phoneLocal}
            countryCode={phoneCountry}
            onChangePhone={(next: string) => {
              setPhoneLocal(next);
              setPhoneTouched(true);
            }}
            onChangeCountry={(next: string) => {
              setPhoneCountry(next);
              setPhoneTouched(true);
            }}
            error={
              phoneTouched && normalizedPhone === null
                ? INVALID_PHONE_COPY
                : null
            }
            disabled={submitting}
            iconRenderer={(
              name: PhoneInputIconName,
              iconProps: { size: number; color: string },
            ) => {
              const iconName =
                name === "chevronDown"
                  ? "chevD"
                  : name === "checkmark"
                    ? "check"
                    : name === "close"
                      ? "close"
                      : "search";
              return (
                <Icon
                  name={iconName}
                  size={iconProps.size}
                  color={iconProps.color}
                />
              );
            }}
            labels={{
              phonePlaceholder: "Phone number",
              countryButtonAccessibilityLabel: (countryName: string) =>
                `Country code, ${countryName}, tap to change`,
              phoneInputAccessibilityLabel: "Phone number, required",
              doneButton: "Done",
              pickerTitle: "Select Country",
              pickerSearchPlaceholder: "Search country or dial code",
              pickerCloseAccessibilityLabel: "Close country picker",
            }}
            theme={phoneFieldTheme}
          />
          <Input
            value={occasion}
            onChangeText={setOccasion}
            placeholder="Occasion (optional)"
            accessibilityLabel="Occasion"
          />
          <Input
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes for the venue (optional)"
            accessibilityLabel="Notes for the venue"
          />
          <View style={styles.optIn}>
            <Text style={[styles.body, { color: palette.secondaryText }]}>
              Send me occasional Mingla updates
            </Text>
            <Switch value={marketingOptIn} onValueChange={setMarketingOptIn} />
          </View>
          {error !== null ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button
            label="Confirm reservation"
            // ORCH-1162 Bug 3 — the primary fill takes the venue's accent, and
            // Button's own WCAG helpers pick the readable label colour for it.
            accentColor={palette.accent}
            size="lg"
            fullWidth
            loading={submitting}
            disabled={submitting || contactInvalid || !availabilitySettled}
            onPress={() => void submit()}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: spacing.sm },
  title: { ...typography.h3 },
  body: { ...typography.bodySm },
  label: {
    ...typography.caption,
    letterSpacing: 1.2,
    marginTop: spacing.sm,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  party: {
    ...typography.h2,
    minWidth: 36,
    textAlign: "center",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  // issue #1564 — geometry only. Every colour on the chips now arrives from the
  // page's resolved palette (`chipTheme` above); the two orange literals that
  // used to live here are gone, and nothing in this StyleSheet may name a
  // brand colour again.
  chip: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  chipText: { ...typography.bodySm },
  loading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stateCard: {
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  form: { gap: spacing.sm, marginTop: spacing.md },
  fieldError: { ...typography.bodySm, color: semantic.error },
  optIn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  error: { ...typography.bodySm, color: semantic.error },
});
