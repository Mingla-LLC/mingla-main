import React, { useEffect, useMemo, useState } from "react";
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
import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { usePublicVenueAvailability } from "../../hooks/usePublicVenueAvailability";
import { createGuestVenueReservation } from "../../services/venueGuestReservationService";
import { composeE164 } from "../../utils/phone";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";

interface GuestVenueReservationProps {
  venueId: string;
  brandId: string;
  currency: string | null;
}

const RESERVATION_PHONE_THEME: PhoneInputTheme = {
  backgroundPrimary: "#0c0e12",
  textPrimary: "rgba(255, 255, 255, 0.96)",
  textTertiary: "rgba(255, 255, 255, 0.52)",
  borderDefault: "rgba(255, 255, 255, 0.14)",
  borderFocused: "#eb7825",
  borderError: "#ef4444",
  searchBackground: "rgba(255, 255, 255, 0.06)",
  rowPressedBackground: "rgba(255, 255, 255, 0.04)",
  divider: "rgba(255, 255, 255, 0.08)",
  accessoryBackground: "rgba(12, 14, 18, 0.95)",
  accessoryBorder: "rgba(255, 255, 255, 0.08)",
  accent: "#eb7825",
  errorText: "#ef4444",
};
const INVALID_PHONE_COPY = "Enter a valid phone number.";
const RESERVATION_FAILURE_COPY =
  "We couldn’t start your reservation. Check your details and try again.";

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
}: GuestVenueReservationProps): React.ReactElement {
  const dates = useMemo(dateOptions, []);
  const [partySize, setPartySize] = useState(2);
  const [date, setDate] = useState<string | null>(dates[0]?.value ?? null);
  const [selectedUtc, setSelectedUtc] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
  const selectedSlot = slots.find((slot) => slot.slotStartUtc === selectedUtc);
  const phoneDialCode = getCountryByCode(phoneCountry)?.dialCode ?? "+1";
  const normalizedPhone = composeE164(phoneDialCode, phoneLocal);

  useEffect(() => {
    if (availability.data === undefined) return;
    captureWeb("venue_availability_result_viewed", {
      surface: "buyer_web",
      brand_id: brandId,
      venue_id: venueId,
    });
  }, [availability.data, brandId, venueId]);

  const submit = async (): Promise<void> => {
    if (
      selectedUtc === null ||
      name.trim().length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      normalizedPhone === null
    ) {
      setPhoneTouched(true);
      setError(
        normalizedPhone === null
          ? INVALID_PHONE_COPY
          : "Choose a time and enter a valid name and email.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    captureWeb("public_venue_reservation_started", {
      surface: "buyer_web",
      brand_id: brandId,
      venue_id: venueId,
      currency,
    });
    try {
      const result = await createGuestVenueReservation({
        venueId,
        brandId,
        reservedForUtc: selectedUtc,
        partySize,
        buyer: {
          name: name.trim(),
          email: email.trim(),
          phone: normalizedPhone,
          marketingOptIn,
        },
        occasion: occasion.trim() || null,
        guestNotes: notes.trim() || null,
        attributionClickId: getStoredClickAttribution().clickId,
      });
      if (result.kind === "free_completed") {
        setCompletedId(result.reservationId);
        captureWeb("venue_reservation_completed", {
          surface: "buyer_web",
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
    } catch {
      setError(RESERVATION_FAILURE_COPY);
      captureWeb("venue_reservation_failed", {
        surface: "buyer_web",
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
      <View style={styles.stateCard}>
        <Text style={styles.title}>Your table is reserved</Text>
        <Text style={styles.body}>
          Confirmation has been sent to your email.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Find a table</Text>
      <Text style={styles.label}>PARTY SIZE</Text>
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
        <Text style={styles.party}>{partySize}</Text>
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
      <Text style={styles.label}>DATE</Text>
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
            style={[styles.chip, date === option.value && styles.chipSelected]}
          >
            <Text style={styles.chipText}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>AVAILABLE TIMES</Text>
      {availability.isLoading || availability.isFetching ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={styles.body}>Finding open tables…</Text>
        </View>
      ) : availability.isError ? (
        <View style={styles.stateCard}>
          <Text style={styles.body}>We couldn’t load times.</Text>
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => {
              void availability.refetch();
            }}
          />
        </View>
      ) : slots.filter((slot) => !slot.isFull).length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.body}>No tables for this day.</Text>
          <Text style={styles.body}>Try another date.</Text>
        </View>
      ) : (
        <View style={styles.chips}>
          {slots.map((slot) => (
            <Pressable
              key={slot.slotStartUtc}
              disabled={slot.isFull}
              onPress={() => {
                setSelectedUtc(slot.slotStartUtc);
                captureWeb("venue_reservation_slot_selected", {
                  surface: "buyer_web",
                  brand_id: brandId,
                  venue_id: venueId,
                });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Select ${slot.slotLocalLabel}${
                slot.isFull ? ", full" : ""
              }`}
              accessibilityState={{
                disabled: slot.isFull,
                selected: selectedUtc === slot.slotStartUtc,
              }}
              style={[
                styles.chip,
                selectedUtc === slot.slotStartUtc && styles.chipSelected,
                slot.isFull && styles.disabled,
              ]}
            >
              <Text style={styles.chipText}>
                {slot.slotLocalLabel}
                {slot.isFull ? " · Full" : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {selectedSlot !== undefined ? (
        <View style={styles.form}>
          <Input
            value={name}
            onChangeText={setName}
            placeholder="Name"
            accessibilityLabel="Name"
          />
          <Input
            value={email}
            onChangeText={setEmail}
            variant="email"
            placeholder="Email"
            accessibilityLabel="Email"
          />
          <PhoneInput
            value={phoneLocal}
            countryCode={phoneCountry}
            onChangePhone={(next) => {
              setPhoneLocal(next);
              setPhoneTouched(true);
            }}
            onChangeCountry={(next) => {
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
              countryButtonAccessibilityLabel: (countryName) =>
                `Country code, ${countryName}, tap to change`,
              phoneInputAccessibilityLabel: "Phone number, required",
              doneButton: "Done",
              pickerTitle: "Select Country",
              pickerSearchPlaceholder: "Search country or dial code",
              pickerCloseAccessibilityLabel: "Close country picker",
            }}
            theme={RESERVATION_PHONE_THEME}
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
            <Text style={styles.body}>Send me occasional Mingla updates</Text>
            <Switch value={marketingOptIn} onValueChange={setMarketingOptIn} />
          </View>
          {error !== null ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button
            label="Confirm reservation"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={submitting}
            onPress={() => void submit()}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: spacing.sm },
  title: { ...typography.h3, color: textTokens.primary },
  body: { ...typography.bodySm, color: textTokens.secondary },
  label: {
    ...typography.caption,
    color: textTokens.tertiary,
    letterSpacing: 1.2,
    marginTop: spacing.sm,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  party: {
    ...typography.h2,
    color: textTokens.primary,
    minWidth: 36,
    textAlign: "center",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: spacing.md,
  },
  chipSelected: {
    borderColor: "#eb7825",
    backgroundColor: "rgba(235,120,37,0.16)",
  },
  chipText: { ...typography.bodySm, color: textTokens.primary },
  loading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stateCard: {
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    padding: spacing.md,
  },
  disabled: { opacity: 0.4 },
  form: { gap: spacing.sm, marginTop: spacing.md },
  optIn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  error: { ...typography.bodySm, color: semantic.error },
});
