/**
 * Issue #3380 — "Who's ordering?" phone field for the venue menu on the web.
 *
 * Its own module so the ordering surface can require it only when the review
 * step renders (BuyerVenueOrderingSlots.renderPhoneField): the shared picker
 * brings a native keyboard stack the menu itself never needs.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type {
  ResolvedTheme,
  ThemePalette,
} from "@mingla/offering-rendering";
import type { VenueOrderPhoneFieldArgs } from "@mingla/brand-rendering/venueOrdering";
import {
  PhoneInput,
  getCountryByCode,
  type PhoneInputIconName,
} from "@mingla/phone-input";

import { businessRsvpPhoneTheme } from "../event/useBusinessRsvpPhoneField";
import { Icon } from "../ui/Icon";
import {
  buyerOrderPhoneFailure,
  buyerOrderPhoneStartCountry,
} from "./buyerOrderPhone";

/**
 * issue #3380 — "Who's ordering?" phone, with the country picker.
 *
 * Replaces the free-text "Phone, with country code" box. Starts on the venue's
 * country and writes that country into the draft straight away, so the order
 * carries it even if the guest never touches the flag.
 */
export const BuyerVenueOrderPhoneField: React.FC<{
  args: VenueOrderPhoneFieldArgs;
  palette: ThemePalette;
  theme: ResolvedTheme;
  countryCode: string | null;
}> = ({ args, palette, theme, countryCode }) => {
  const { onChange, phone, phoneCountryIso } = args;
  const [touched, setTouched] = React.useState(false);
  const start = buyerOrderPhoneStartCountry(countryCode);
  const chosen = React.useRef(false);
  React.useEffect(() => {
    if (chosen.current || start === null) return;
    if (phoneCountryIso !== start && phone.replace(/\D/g, "").length === 0) {
      onChange({ phoneCountryIso: start });
    }
  }, [onChange, phone, phoneCountryIso, start]);
  const countryIso = phoneCountryIso ?? start;
  const failure = buyerOrderPhoneFailure(phone, countryIso);
  const suggested =
    touched && failure?.suggestedCountryIso != null
      ? getCountryByCode(failure.suggestedCountryIso)
      : undefined;
  const phoneTheme = React.useMemo(
    () => businessRsvpPhoneTheme(palette, theme),
    [palette, theme],
  );
  return (
    <View>
      <PhoneInput
        smartEntry
        required
        pickerPresentation="overlay"
        value={phone}
        countryCode={countryIso}
        onChangePhone={(next: string) => {
          if (next.length > 0) chosen.current = true;
          // The country is NOT re-sent here: a pasted "+44 …" has just switched
          // it through onChangeCountry, and this closure still holds the old one.
          onChange({ phone: next });
        }}
        onChangeCountry={(iso: string) => {
          chosen.current = true;
          onChange({ phoneCountryIso: iso });
        }}
        onBlur={() => setTouched(true)}
        error={touched && failure !== null ? failure.message : null}
        disabled={args.disabled}
        testID="venue-order-buyer-phone"
        iconRenderer={(
          name: PhoneInputIconName,
          iconProps: { size: number; color: string },
        ) => (
          <Icon
            name={
              name === "chevronDown"
                ? "chevD"
                : name === "checkmark"
                  ? "check"
                  : name === "close"
                    ? "close"
                    : "search"
            }
            size={iconProps.size}
            color={iconProps.color}
          />
        )}
        labels={{
          phonePlaceholder: "Mobile number",
          countryButtonAccessibilityLabel: (name: string) =>
            `Country code, ${name}, tap to change`,
          phoneInputAccessibilityLabel: "Mobile number for order updates",
          doneButton: "Done",
          pickerTitle: "Select country",
          pickerSearchPlaceholder: "Search country or dial code",
          pickerCloseAccessibilityLabel: "Close country picker",
          pickerNoResults: "No countries found",
        }}
        theme={phoneTheme}
      />
      {suggested !== undefined ? (
        <Pressable
          onPress={() => {
            chosen.current = true;
            onChange({ phoneCountryIso: suggested.code });
          }}
          accessibilityRole="button"
          accessibilityLabel={`Switch the country code to ${suggested.name} ${suggested.dialCode}`}
          hitSlop={8}
          style={styles.phoneSwitch}
        >
          <Text style={[styles.phoneSwitchText, { color: palette.accent }]}>
            {`Switch to ${suggested.flag} ${suggested.name} (${suggested.dialCode})`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  phoneSwitch: { alignSelf: "flex-start", paddingVertical: 4, marginTop: 4 },
  phoneSwitchText: { fontSize: 14, fontWeight: "600" },
});
