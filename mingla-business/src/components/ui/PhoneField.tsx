/**
 * Issue #3380 — THE Business phone field.
 *
 * Every place the Business app or the public venue page asks for a phone number
 * renders this: the shared `@mingla/phone-input` country picker (flag, dial
 * code, search by name or code) in its smart-entry mode, with the ONE rule set
 * (`@mingla/phone-input/phoneNumber`) deciding what the number means and what
 * to say when it is wrong.
 *
 * What a person gets:
 *   - the picker starts on the venue's or brand's country, then the device's;
 *   - the number is grouped the way that country writes it as they type, and
 *     their cursor stays put;
 *   - a typed or pasted "+234 …" switches the picker by itself;
 *   - the device's phone autofill is offered;
 *   - a specific message ("Nigerian mobile numbers have 10 digits after the
 *     0 — you entered 8."), and when the digits belong to another country, a
 *     one-tap "Switch to Nigeria (+234)".
 *
 * The rules are imported by DEEP specifier on purpose: many suites mock the
 * `@mingla/phone-input` barrel with partial shapes, and a real rule set must
 * never be replaced by one of them.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  PhoneInput,
  getCountryByCode,
  type PhoneInputIconName,
  type PhoneInputPickerPresentation,
  type PhoneInputTheme,
} from "@mingla/phone-input";
import {
  parsePhoneEntry,
  resolvePhoneStartCountry,
  type PhoneEntryMode,
  type PhoneEntryResult,
} from "@mingla/phone-input/phoneNumber";

import {
  accent,
  canvas,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { devicePhoneRegion } from "../../utils/devicePhoneRegion";
import { Icon } from "./Icon";

const isKnownCountry = (iso: string): boolean => {
  try {
    return getCountryByCode(iso) !== undefined;
  } catch {
    return false;
  }
};

export interface PhoneEntry {
  countryIso: string | null;
  /** Exactly what is in the field (formatted). */
  text: string;
  touched: boolean;
  result: PhoneEntryResult;
  /** The canonical number, or null while it is empty or not yet valid. */
  e164: string | null;
  isEmpty: boolean;
  setCountryIso: (iso: string) => void;
  setText: (text: string) => void;
  markTouched: () => void;
  reset: () => void;
}

export interface UsePhoneEntryOptions {
  /**
   * Where the picker should start, best first: the venue's country, then the
   * brand's. The device region is always appended as the last resort. Values
   * may arrive late (a query resolving) — the picker follows them until the
   * person has typed or chosen a country themselves.
   */
  startCountries: ReadonlyArray<string | null | undefined>;
  /** `mobile` (default) for a number we will text; `any` for a contact line. */
  mode?: PhoneEntryMode;
}

export function usePhoneEntry({
  startCountries,
  mode = "mobile",
}: UsePhoneEntryOptions): PhoneEntry {
  const startKey = startCountries.map((c) => c ?? "").join("|");
  const start = useMemo(
    () =>
      resolvePhoneStartCountry([...startCountries, devicePhoneRegion()], isKnownCountry),
    // startKey captures the candidate list by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startKey],
  );
  const [countryIso, setCountry] = useState<string | null>(start);
  const [text, setTextState] = useState("");
  const [touched, setTouched] = useState(false);
  const personChose = useRef(false);
  const latestStart = useRef(start);

  useEffect(() => {
    latestStart.current = start;
    if (!personChose.current) setCountry(start);
  }, [start]);

  const setCountryIso = useCallback((iso: string): void => {
    personChose.current = true;
    setCountry(iso);
  }, []);
  const setText = useCallback((next: string): void => {
    if (next.length > 0) personChose.current = true;
    setTextState(next);
  }, []);
  const markTouched = useCallback((): void => setTouched(true), []);
  // #3396: callers reset entire forms when opening. A late venue query must
  // not change this callback's identity and accidentally reopen/reset them.
  const reset = useCallback((): void => {
    personChose.current = false;
    setTextState("");
    setTouched(false);
    setCountry(latestStart.current);
  }, []);

  const result = useMemo(
    () =>
      parsePhoneEntry(text, {
        countryIso,
        dialCode: countryIso === null ? null : getCountryByCode(countryIso)?.dialCode ?? null,
        mode,
      }),
    [countryIso, mode, text],
  );

  return {
    countryIso,
    text,
    touched,
    result,
    e164: result.ok ? result.e164 : null,
    isEmpty: text.trim().length === 0,
    setCountryIso,
    setText,
    markTouched,
    reset,
  };
}

/**
 * The message a field shows, or null. An empty optional field is never an
 * error; an empty required one is only an error once the person has moved on.
 */
export const phoneFieldError = (
  entry: Pick<PhoneEntry, "isEmpty" | "result" | "touched">,
  options: { required: boolean; showErrors?: boolean },
): string | null => {
  const visible = entry.touched || options.showErrors === true;
  if (!visible) return null;
  if (entry.isEmpty) return options.required ? "Enter a phone number." : null;
  return entry.result.ok ? null : entry.result.message;
};

/** The dark Business sheet palette (matches the People "Add a person" field). */
export const BUSINESS_SHEET_PHONE_THEME: PhoneInputTheme = {
  backgroundPrimary: canvas.depth,
  textPrimary: textTokens.primary,
  textTertiary: textTokens.tertiary,
  borderDefault: glass.border.profileElevated,
  borderFocused: accent.warm,
  borderError: semantic.error,
  searchBackground: canvas.profile,
  rowPressedBackground: glass.tint.profileBase,
  divider: glass.border.profileBase,
  accessoryBackground: canvas.depth,
  accessoryBorder: glass.border.profileElevated,
  accent: accent.warm,
  errorText: semantic.error,
};

const iconRenderer = (
  name: PhoneInputIconName,
  props: { size: number; color: string },
): React.ReactElement => (
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
    size={props.size}
    color={props.color}
  />
);

export interface PhoneFieldProps {
  entry: PhoneEntry;
  /** What the number is for, read by screen readers ("Guest's phone number"). */
  accessibilityLabel: string;
  required?: boolean;
  /** Show the error even before the field has been left (e.g. after Save). */
  showErrors?: boolean;
  disabled?: boolean;
  placeholder?: string;
  theme?: PhoneInputTheme;
  /** Pass `overlay` when this field is itself inside a <Modal> on the web. */
  pickerPresentation?: PhoneInputPickerPresentation;
  /** Colour of the "Switch to …" action; defaults to the theme accent. */
  actionColor?: string;
  testID?: string;
}

export function PhoneField({
  entry,
  accessibilityLabel,
  required = false,
  showErrors = false,
  disabled = false,
  placeholder = "Phone number",
  theme = BUSINESS_SHEET_PHONE_THEME,
  pickerPresentation = "overlay",
  actionColor,
  testID,
}: PhoneFieldProps): React.ReactElement {
  const error = phoneFieldError(entry, { required, showErrors });
  const suggested =
    error !== null && !entry.result.ok ? entry.result.suggestedCountryIso : null;
  const suggestedCountry = suggested === null ? undefined : getCountryByCode(suggested);
  const country = entry.countryIso === null ? undefined : getCountryByCode(entry.countryIso);

  return (
    <View>
      <PhoneInput
        smartEntry
        pickerPresentation={pickerPresentation}
        value={entry.text}
        countryCode={entry.countryIso}
        onChangePhone={entry.setText}
        onChangeCountry={entry.setCountryIso}
        onBlur={entry.markTouched}
        error={error}
        disabled={disabled}
        required={required}
        testID={testID}
        countryButtonAccessibilityLabel={
          country === undefined
            ? "Select country code"
            : `Country code, ${country.name} ${country.dialCode}, tap to change`
        }
        phoneInputAccessibilityLabel={accessibilityLabel}
        iconRenderer={iconRenderer}
        theme={theme}
        labels={{
          phonePlaceholder: placeholder,
          countryButtonAccessibilityLabel: (name: string) =>
            `Country code, ${name}, tap to change`,
          phoneInputAccessibilityLabel: accessibilityLabel,
          doneButton: "Done",
          pickerTitle: "Select country",
          pickerSearchPlaceholder: "Search country or dial code",
          pickerCloseAccessibilityLabel: "Close country picker",
          pickerNoResults: "No countries found",
        }}
      />
      {suggestedCountry !== undefined ? (
        <Pressable
          onPress={() => entry.setCountryIso(suggestedCountry.code)}
          accessibilityRole="button"
          accessibilityLabel={`Switch the country code to ${suggestedCountry.name} ${suggestedCountry.dialCode}`}
          hitSlop={8}
          style={styles.switch}
          testID={testID ? `${testID}-switch-country` : undefined}
        >
          <Text style={[styles.switchText, { color: actionColor ?? theme.accent ?? accent.warm }]}>
            {`Switch to ${suggestedCountry.flag} ${suggestedCountry.name} (${suggestedCountry.dialCode})`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  switch: {
    alignSelf: "flex-start",
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  switchText: {
    ...typography.bodySm,
    fontWeight: "600",
  },
});
