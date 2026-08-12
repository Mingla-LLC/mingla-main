import React, { useCallback, useMemo } from "react";
import { Text, View } from "react-native";

import {
  type ResolvedTheme,
  type RsvpPhoneFieldRenderArgs,
  type RsvpPhoneFieldRenderer,
  type ThemePalette,
} from "@mingla/offering-rendering";
import {
  COUNTRIES,
  PhoneInput,
  getCountryByCode,
  type PhoneInputIconName,
  type PhoneInputTheme,
} from "@mingla/phone-input";
import { resolveUserPhoneE164 } from "@mingla/card-identity/phone";

import { Icon } from "../ui/Icon";

const CURRENCY_DEFAULT_COUNTRY: Record<string, string> = {
  NGN: "NG",
  GBP: "GB",
  USD: "US",
  CAD: "CA",
  AUD: "AU",
  EUR: "IE",
  ZAR: "ZA",
  KES: "KE",
  GHS: "GH",
};

/** Preserve the pre-#1857 primary-RSVP default; new plus-one rows stay neutral. */
export const resolvePrimaryRsvpPhoneCountry = (
  currency?: string | null,
): string => {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = locale.split("-")[1]?.toUpperCase();
    if (region && COUNTRIES.some((country) => country.code === region)) {
      return region;
    }
  } catch {
    // Intl unavailable — fall through to the existing currency hint.
  }
  const currencyCountry = currency
    ? CURRENCY_DEFAULT_COUNTRY[currency.toUpperCase()]
    : undefined;
  if (
    currencyCountry &&
    COUNTRIES.some((country) => country.code === currencyCountry)
  ) {
    return currencyCountry;
  }
  return "US";
};

export const useBusinessRsvpPhoneField = (
  palette: ThemePalette,
  theme: ResolvedTheme,
): RsvpPhoneFieldRenderer => {
  const phoneFieldTheme = useMemo<PhoneInputTheme>(
    () => businessRsvpPhoneTheme(palette, theme),
    [palette, theme],
  );

  return useCallback<RsvpPhoneFieldRenderer>(
    (args) => (
      <BusinessRsvpPhoneField
        args={args}
        palette={palette}
        phoneFieldTheme={phoneFieldTheme}
      />
    ),
    [palette, phoneFieldTheme],
  );
};

export const BusinessRsvpPhoneField = ({
  args: {
      countryCode,
      rawValue,
      onChangeCountry,
      onChangeRawValue,
      onBlur,
      invalid,
      disabled,
      label,
      testID,
      required,
      emptyRequired,
  },
  palette,
  phoneFieldTheme,
}: {
  args: RsvpPhoneFieldRenderArgs;
  palette: ThemePalette;
  phoneFieldTheme: PhoneInputTheme;
}): React.ReactElement => (
      <View style={{ marginBottom: 12 }}>
        <Text
          style={{
            color: palette.tertiaryText,
            fontSize: 12,
            fontWeight: "700",
            marginBottom: 5,
          }}
        >
          {label}
        </Text>
        <PhoneInput
          pickerPresentation="overlay"
          value={rawValue}
          countryCode={countryCode}
          onChangePhone={(next: string) => {
            onChangeRawValue(next, resolveUserPhoneE164(next, countryCode));
          }}
          onChangeCountry={(nextIso: string) => {
            onChangeCountry(nextIso, resolveUserPhoneE164(rawValue, nextIso));
          }}
          error={
            emptyRequired
              ? "Required"
              : invalid
                ? "Select a country and enter a valid phone number."
                : null
          }
          disabled={disabled}
          required={required}
          maxLength={40}
          testID={testID}
          countryButtonAccessibilityLabel={
            countryCode === null
              ? "Select country"
              : `${label} country, ${getCountryByCode(countryCode)?.name ?? countryCode}, tap to change`
          }
          phoneInputAccessibilityLabel={`${label} phone number${required ? ", required" : ""}`}
          onBlur={onBlur}
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
            countryButtonAccessibilityLabel: (name: string) =>
              `Country code, ${name}, tap to change`,
            phoneInputAccessibilityLabel: "Phone number",
            doneButton: "Done",
            pickerTitle: "Select Country",
            pickerSearchPlaceholder: "Search country or dial code",
            pickerCloseAccessibilityLabel: "Close country picker",
            pickerNoResults: "No countries found",
          }}
          theme={phoneFieldTheme}
        />
      </View>
);

export const businessRsvpPhoneTheme = (
  palette: ThemePalette,
  theme: ResolvedTheme,
): PhoneInputTheme => ({
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
  errorText: theme.foregroundColor === "#ffffff" ? "#f87171" : "#b91c1c",
});
