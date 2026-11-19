/**
 * #4490 P5-3 — no table at that time is never a dead end (`pr-none`):
 *  - "Tell me if a table opens": a day and a time range (From / Until chips);
 *  - "Join tonight's waitlist": today, any time.
 * Name, a phone with a country picker (and/or an email), party size from the
 * booking above. No account. On success the guest goes to their waitlist page
 * (`/visit/waitlist/<id>#t=<token>`); the token stays on this device too.
 */
import React, { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  PhoneInput,
  getCountryByCode,
  type PhoneInputIconName,
  type PhoneInputTheme,
} from "@mingla/phone-input";
import { parsePhoneEntry, resolvePhoneStartCountry } from "@mingla/phone-input/phoneNumber";
import type { ThemePalette } from "@mingla/offering-rendering";
import { accentOutline } from "@mingla/offering-rendering/themeAccentStyle";
import { opaqueAccentWashColor } from "@mingla/offering-rendering/themePalette";

import { color, space, type } from "../../../constants/designSystem";
import { joinGuestWaitlist, GuestWaitlistError } from "../../../services/venueTableGuestService";
import { devicePhoneRegion } from "../../../utils/devicePhoneRegion";
import { phoneStartCountryForCurrency } from "../../../utils/phoneStartCountryForCurrency";
import { composeE164 } from "../../../utils/phone";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Input } from "../../ui/Input";
import { revealFocusedField } from "./revealFocusedField";
import { saveWaitlistToken } from "./tablePendingReturn";
import { defaultNotifyRange, tableGuestErrorCopy } from "./tablePickModel";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface GuestWaitlistFormProps {
  palette: ThemePalette;
  venueId: string;
  partySize: number;
  date: string;
  mode: "tonight" | "notify";
  /** "HH:MM" choices for the notify range (from the day's times). */
  times: readonly string[];
  /** Times that are full (the range starts around the first). */
  fullTimes?: readonly string[];
  currency: string | null;
  countryCode?: string | null;
  onCancel: () => void;
  testID?: string;
}

const known = (iso: string): boolean => {
  try {
    return getCountryByCode(iso) !== undefined;
  } catch {
    return false;
  }
};

export function GuestWaitlistForm({
  palette,
  venueId,
  partySize,
  date,
  mode,
  times,
  fullTimes = [],
  currency,
  countryCode = null,
  onCancel,
  testID = "guest-waitlist-form",
}: GuestWaitlistFormProps): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState(
    () => resolvePhoneStartCountry([countryCode, phoneStartCountryForCurrency(currency), devicePhoneRegion()], known) ?? "NG",
  );
  const [phone, setPhone] = useState("");
  const [from, setFrom] = useState<string | null>(() => defaultNotifyRange(times, fullTimes).from);
  const [to, setTo] = useState<string | null>(() => defaultNotifyRange(times, fullTimes).to);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const dial = getCountryByCode(country)?.dialCode ?? "+234";
  const phoneDigits = phone.replace(/\D/g, "");
  const phoneCheck = parsePhoneEntry(phone, { countryIso: country, dialCode: dial, mode: "mobile" });
  const phoneOk = phoneDigits.length > 0 && phoneCheck.ok;
  const emailOk = EMAIL.test(email.trim());
  const nameOk = name.trim().length >= 2;
  const contactOk = phoneOk || emailOk;
  const rangeOk = mode === "tonight" || (from !== null && to !== null && to > from);
  const problem = !nameOk
    ? "Add your name."
    : phoneDigits.length > 0 && !phoneCheck.ok
      ? phoneCheck.message ?? "Enter a valid mobile number."
      : email.trim().length > 0 && !emailOk
        ? "Enter a valid email address."
        : !contactOk
          ? "Add a mobile number or an email so they can reach you."
          : !rangeOk
            ? "Pick a time range: Until must be after From."
            : null;

  const theme = useMemo<PhoneInputTheme>(
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

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (problem !== null || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await joinGuestWaitlist({
        venueId,
        partySize,
        date,
        from: mode === "notify" ? from : null,
        to: mode === "notify" ? to : null,
        guest: {
          name: name.trim(),
          email: emailOk ? email.trim() : null,
          phone: phoneOk ? composeE164(dial, phone) : null,
          phoneCountryIso: phoneOk ? country : null,
        },
      });
      if (result.token !== null) saveWaitlistToken(result.entry.waitlistId, result.token);
      router.push(`/visit/waitlist/${result.entry.waitlistId}${result.token !== null ? `#t=${result.token}` : ""}` as never);
    } catch (e) {
      const code = e instanceof GuestWaitlistError ? e.code : "waitlist_request_failed";
      setError(tableGuestErrorCopy(code) ?? "We couldn't add you. Check your details and try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const chip = (t: string, on: boolean, onPress: () => void, label: string): React.ReactElement => (
    <Pressable
      key={`${label}-${t}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label} ${t}`}
      style={[styles.chip, on ? accentOutline(palette, { background: palette.accentWash, opaqueBackground: opaqueAccentWashColor(palette) }) : { borderColor: palette.panelBorder, backgroundColor: "transparent" }]}
    >
      <Text style={[styles.chipText, { color: palette.primaryText }]}>{t}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.host, { borderColor: palette.panelBorder, backgroundColor: palette.card }]} testID={testID}>
      <Text style={[styles.title, { color: palette.primaryText }]}>
        {mode === "notify" ? "Tell me if a table opens" : "Join tonight's waitlist"}
      </Text>
      <Text style={[styles.body, { color: palette.secondaryText }]}>
        {mode === "notify"
          ? `For ${partySize} ${partySize === 1 ? "guest" : "guests"}. We'll tell you if a table opens in your time range. No account needed.`
          : `For ${partySize} ${partySize === 1 ? "guest" : "guests"} today. We'll tell you when a table is ready. No account needed.`}
      </Text>
      {mode === "notify" && times.length > 1 ? (
        <>
          <Text style={[styles.label, { color: palette.tertiaryText }]}>FROM</Text>
          <View style={styles.chips}>{times.slice(0, -1).map((t) => chip(t, from === t, () => setFrom(t), "From"))}</View>
          <Text style={[styles.label, { color: palette.tertiaryText }]}>UNTIL</Text>
          <View style={styles.chips}>{times.slice(1).map((t) => chip(t, to === t, () => setTo(t), "Until"))}</View>
        </>
      ) : null}
      <Text style={[styles.label, { color: palette.tertiaryText }]}>NAME · REQUIRED</Text>
      <Input value={name} onChangeText={setName} placeholder="Name" accessibilityLabel="Name, required" onFocus={revealFocusedField} testID={`${testID}-name`} />
      <PhoneInput
        smartEntry
        value={phone}
        countryCode={country}
        onChangePhone={setPhone}
        onChangeCountry={setCountry}
        error={touched && phoneDigits.length > 0 && !phoneCheck.ok ? (phoneCheck.message ?? "Enter a valid mobile number.") : null}
        disabled={busy}
        iconRenderer={(n: PhoneInputIconName, p: { size: number; color: string }) => (
          <Icon name={n === "chevronDown" ? "chevD" : n === "checkmark" ? "check" : n === "close" ? "close" : "search"} size={p.size} color={p.color} />
        )}
        labels={{
          phonePlaceholder: "Mobile number",
          countryButtonAccessibilityLabel: (c: string) => `Country code, ${c}, tap to change`,
          phoneInputAccessibilityLabel: "Mobile number",
          doneButton: "Done",
          pickerTitle: "Select Country",
          pickerSearchPlaceholder: "Search country or dial code",
          pickerCloseAccessibilityLabel: "Close country picker",
        }}
        theme={theme}
      />
      <Input value={email} onChangeText={setEmail} variant="email" placeholder="Email (optional if you add a phone)" accessibilityLabel="Email" onFocus={revealFocusedField} testID={`${testID}-email`} />
      {touched && problem !== null ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
      {error !== null ? <Text style={styles.error} accessibilityRole="alert" testID={`${testID}-error`}>{error}</Text> : null}
      <View style={styles.actions}>
        <Button label="Not now" variant="secondary" size="md" onPress={onCancel} testID={`${testID}-cancel`} />
        <Button
          label={busy ? "Adding you…" : mode === "notify" ? "Tell me" : "Join the waitlist"}
          variant="primary"
          size="md"
          accentColor={palette.accent}
          onPress={() => void submit()}
          loading={busy}
          disabled={busy}
          testID={`${testID}-submit`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[2], padding: space[4], borderRadius: 20, borderWidth: 1 },
  title: { ...type.h2 },
  body: { ...type.small },
  label: { ...type.caption, letterSpacing: 1.2, marginTop: space[2] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  chip: { minHeight: 44, minWidth: 64, paddingHorizontal: space[3], borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chipText: { ...type.small, fontWeight: "600" },
  error: { ...type.small, color: color.errorText },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2], justifyContent: "flex-end", marginTop: space[2] },
});
