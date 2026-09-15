/**
 * Issue #3380 — Explorer "Who's ordering?" phone field with the country picker.
 * Its own module so the ordering sheet requires it only when the review renders.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";
import type { PhoneInputTheme } from "@mingla/phone-input";
import type { VenueOrderPhoneFieldArgs } from "@mingla/brand-rendering/venueOrdering";

import { PhoneInput } from "../onboarding/PhoneInput";
import { getCountryByCode } from "../../constants/countries";
import {
  consumerOrderPhoneFailure,
  consumerOrderPhoneStartCountry,
} from "./consumerOrderPhone";

const orderPhoneTheme = (palette: ThemePalette): PhoneInputTheme => ({
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
  errorText: "#f87171",
});

/**
 * issue #3380 — "Who's ordering?" phone, with the country picker. Replaces the
 * free-text "Phone, with country code" box and writes the country into the
 * draft straight away, so the order carries it even if the flag is untouched.
 */
export const ConsumerVenueOrderPhoneField: React.FC<{
  args: VenueOrderPhoneFieldArgs;
  palette: ThemePalette;
  countryCode: string | null;
}> = ({ args, palette, countryCode }) => {
  const { onChange, phone, phoneCountryIso } = args;
  const [touched, setTouched] = React.useState(false);
  const start = consumerOrderPhoneStartCountry(countryCode);
  const chosen = React.useRef(false);
  React.useEffect(() => {
    if (chosen.current || start === null) return;
    if (phoneCountryIso !== start && phone.replace(/\D/g, "").length === 0) {
      onChange({ phoneCountryIso: start });
    }
  }, [onChange, phone, phoneCountryIso, start]);
  const countryIso = phoneCountryIso ?? start;
  const failure = consumerOrderPhoneFailure(phone, countryIso);
  const suggested =
    touched && failure?.suggestedCountryIso != null
      ? getCountryByCode(failure.suggestedCountryIso)
      : undefined;
  const theme = React.useMemo(() => orderPhoneTheme(palette), [palette]);
  return (
    <View>
      <PhoneInput
        smartEntry
        required
        value={phone}
        countryCode={countryIso}
        onChangePhone={(next: string) => {
          if (next.length > 0) chosen.current = true;
          onChange({ phone: next });
        }}
        onChangeCountry={(iso: string) => {
          chosen.current = true;
          onChange({ phoneCountryIso: iso });
        }}
        onBlur={() => setTouched(true)}
        error={touched && failure !== null ? failure.message : null}
        disabled={args.disabled}
        theme={theme}
        testID="venue-order-buyer-phone"
        phoneInputAccessibilityLabel="Mobile number for order updates"
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
