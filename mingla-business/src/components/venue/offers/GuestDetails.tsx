/**
 * #4490 — "Your details" for a venue offer checkout (entry and group
 * packages): name, email (checked on blur, the pass goes there) and an
 * optional phone with a country picker that starts from the venue's country,
 * then its currency, then the device. No account needed.
 *
 * `useGuestDetails` owns the fields and their checks; `GuestDetailsCard`
 * draws them in the venue's theme. Both checkouts use the pair, so the
 * details read and behave the same.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import {
  PhoneInput,
  getCountryByCode,
  type PhoneInputIconName,
  type PhoneInputTheme,
} from "@mingla/phone-input";
import { parsePhoneEntry, resolvePhoneStartCountry } from "@mingla/phone-input/phoneNumber";
import { ENTRY_EMAIL_PATTERN } from "@mingla/brand-rendering/venueOffers/entryModel";

import { color, space, type } from "../../../constants/designSystem";
import { devicePhoneRegion } from "../../../utils/devicePhoneRegion";
import { composeE164 } from "../../../utils/phone";
import { phoneStartCountryForCurrency } from "../../../utils/phoneStartCountryForCurrency";
import { Icon } from "../../ui/Icon";
import { Input } from "../../ui/Input";
import { EntrySectionLabel, entryStyles } from "./EntryUi";

const phoneCountryKnown = (iso: string): boolean => {
  try {
    return getCountryByCode(iso) !== undefined;
  } catch {
    return false;
  }
};

export interface GuestDetailsState {
  name: string;
  setName: React.Dispatch<React.SetStateAction<string>>;
  email: string;
  setEmail: React.Dispatch<React.SetStateAction<string>>;
  phoneLocal: string;
  setPhoneLocal: (v: string) => void;
  phoneCountry: string;
  setPhoneCountry: (v: string) => void;
  touched: { name: boolean; email: boolean; phone: boolean };
  setTouched: React.Dispatch<React.SetStateAction<{ name: boolean; email: boolean; phone: boolean }>>;
  emailServerInvalid: boolean;
  setEmailServerInvalid: (v: boolean) => void;
  countryChosen: React.MutableRefObject<boolean>;
  nameOk: boolean;
  emailOk: boolean;
  phoneOk: boolean;
  phoneDigits: string;
  dial: string;
  phoneCheck: ReturnType<typeof parsePhoneEntry>;
  /** The first missing or wrong field, in words; null when all are fine. */
  problem: string | null;
  /** The guest payload the server takes. */
  guest: () => { name: string; email: string; phone?: string; phoneCountryIso?: string };
}

export function useGuestDetails(input: { countryCode: string | null; currencyCode: string | null }): GuestDetailsState {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<string>(
    () => resolvePhoneStartCountry([phoneStartCountryForCurrency("NGN"), devicePhoneRegion()], phoneCountryKnown) ?? "NG",
  );
  const countryChosen = useRef(false);
  useEffect(() => {
    if (countryChosen.current || (input.countryCode === null && input.currencyCode === null)) return;
    const start = resolvePhoneStartCountry(
      [input.countryCode, input.currencyCode !== null ? phoneStartCountryForCurrency(input.currencyCode) : null, devicePhoneRegion()],
      phoneCountryKnown,
    );
    if (start !== null) setPhoneCountry(start);
  }, [input.countryCode, input.currencyCode]);
  const [touched, setTouched] = useState({ name: false, email: false, phone: false });
  const [emailServerInvalid, setEmailServerInvalid] = useState(false);

  const nameOk = name.trim().length >= 1 && name.trim().length <= 120;
  const emailOk = ENTRY_EMAIL_PATTERN.test(email.trim()) && !emailServerInvalid;
  const dial = getCountryByCode(phoneCountry)?.dialCode ?? "+234";
  const phoneDigits = phoneLocal.replace(/\D/g, "");
  const phoneCheck = parsePhoneEntry(phoneLocal, { countryIso: phoneCountry, dialCode: dial, mode: "mobile" });
  const phoneOk = phoneDigits.length === 0 || phoneCheck.ok;
  return {
    name,
    setName,
    email,
    setEmail,
    phoneLocal,
    setPhoneLocal,
    phoneCountry,
    setPhoneCountry,
    touched,
    setTouched,
    emailServerInvalid,
    setEmailServerInvalid,
    countryChosen,
    nameOk,
    emailOk,
    phoneOk,
    phoneDigits,
    dial,
    phoneCheck,
    problem: !nameOk
      ? "Add your name."
      : !emailOk
        ? "Add a valid email. Your pass is sent there."
        : !phoneOk
          ? "Check the phone number, or leave it empty."
          : null,
    guest: () => {
      const phone = phoneDigits.length > 0 ? composeE164(dial, phoneLocal) : null;
      return {
        name: name.trim(),
        email: email.trim(),
        ...(phone !== null ? { phone, phoneCountryIso: phoneCountry } : {}),
      };
    },
  };
}

export interface GuestDetailsCardProps {
  details: GuestDetailsState;
  palette: ThemePalette;
  theme: ResolvedTheme;
  disabled: boolean;
  onFieldFocus: () => void;
  onFieldBlur: () => void;
  /** "Your pass and receipt go to this email." */
  footnote?: string;
  testID?: string;
}

export function GuestDetailsCard({
  details: d,
  palette,
  disabled,
  onFieldFocus,
  onFieldBlur,
  footnote = "No account needed. Your pass and receipt go to this email.",
  testID = "issue-4490-checkout-details",
}: GuestDetailsCardProps): React.ReactElement {
  const suggestedCountry =
    !d.phoneCheck.ok && d.phoneCheck.suggestedCountryIso != null ? getCountryByCode(d.phoneCheck.suggestedCountryIso) : undefined;
  const phoneTheme = useMemo<PhoneInputTheme>(
    () => ({
      backgroundPrimary: palette.page,
      textPrimary: palette.primaryText,
      textTertiary: palette.tertiaryText,
      borderDefault: palette.panelBorder,
      borderFocused: palette.accent,
      borderError: color.danger,
      searchBackground: palette.card,
      rowPressedBackground: palette.accentWash,
      divider: palette.panelBorder,
      accessoryBackground: palette.page,
      accessoryBorder: palette.panelBorder,
      accent: palette.accent,
      errorText: color.errorText,
    }),
    [palette],
  );
  return (
    <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID={testID}>
      <EntrySectionLabel palette={palette}>Your details</EntrySectionLabel>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: palette.secondaryText }]}>Name</Text>
        <Input
          value={d.name}
          onChangeText={d.setName}
          onFocus={onFieldFocus}
          onBlur={() => {
            onFieldBlur();
            d.setTouched((t) => ({ ...t, name: true }));
          }}
          placeholder="Your name"
          accessibilityLabel="Name, required"
          editable={!disabled}
          testID="issue-4490-checkout-name"
        />
        {d.touched.name && !d.nameOk ? <Text style={styles.fieldError}>Add your name.</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: palette.secondaryText }]}>Email</Text>
        <Input
          value={d.email}
          onChangeText={(next: string) => {
            d.setEmail(next);
            d.setEmailServerInvalid(false);
          }}
          onFocus={onFieldFocus}
          onBlur={() => {
            onFieldBlur();
            d.setTouched((t) => ({ ...t, email: true }));
          }}
          variant="email"
          placeholder="you@example.com"
          accessibilityLabel="Email, required"
          editable={!disabled}
          testID="issue-4490-checkout-email"
        />
        {d.touched.email && !d.emailOk ? (
          <Text style={styles.fieldError} accessibilityRole="alert">
            {d.emailServerInvalid
              ? "The payment page didn't accept this email. Check it and try again."
              : "That email looks unfinished. Your pass is sent there."}
          </Text>
        ) : null}
      </View>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: palette.secondaryText }]}>Phone (optional)</Text>
        <PhoneInput
          smartEntry
          value={d.phoneLocal}
          countryCode={d.phoneCountry}
          onChangePhone={(next: string) => {
            if (next.length > 0) d.countryChosen.current = true;
            d.setPhoneLocal(next);
          }}
          onChangeCountry={(next: string) => {
            d.countryChosen.current = true;
            d.setPhoneCountry(next);
          }}
          onBlur={() => d.setTouched((t) => ({ ...t, phone: true }))}
          error={d.touched.phone && !d.phoneOk ? (!d.phoneCheck.ok ? d.phoneCheck.message : null) ?? "Check the phone number." : null}
          disabled={disabled}
          iconRenderer={(iconName: PhoneInputIconName, iconProps: { size: number; color: string }) => (
            <Icon
              name={iconName === "chevronDown" ? "chevD" : iconName === "checkmark" ? "check" : iconName === "close" ? "close" : "search"}
              size={iconProps.size}
              color={iconProps.color}
            />
          )}
          labels={{
            phonePlaceholder: "Phone number",
            countryButtonAccessibilityLabel: (countryName: string) => `Country code, ${countryName}, tap to change`,
            phoneInputAccessibilityLabel: "Phone number, optional",
            doneButton: "Done",
            pickerTitle: "Select country",
            pickerSearchPlaceholder: "Search country or dial code",
            pickerCloseAccessibilityLabel: "Close country picker",
          }}
          theme={phoneTheme}
        />
        {d.touched.phone && suggestedCountry !== undefined ? (
          <Pressable
            onPress={() => {
              d.countryChosen.current = true;
              d.setPhoneCountry(suggestedCountry.code);
            }}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={[styles.small, { color: palette.accent }]}>{`Switch to ${suggestedCountry.name} (${suggestedCountry.dialCode})`}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.caption, { color: palette.tertiaryText }]}>{footnote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1] },
  fieldLabel: { ...type.caption },
  fieldError: { ...type.caption, color: color.errorText },
  small: { ...type.small },
  caption: { ...type.caption, textAlign: "center" },
});
