/**
 * #4389 Door mode — "Add buyer", behind the header menu so it never slows the
 * line (design DM note). Optional name, mobile (for a texted receipt) and email,
 * used on the next cash, manual or card sale, then cleared: the next guest is
 * someone else. A pay code guest types their own details on their phone.
 *
 * The fields live in the door screen (the phone entry is passed in), so closing
 * the sheet keeps what was typed.
 */
import React from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
// ORCH-0892-B v2: keyboard-aware body scroll via the SmartScrollView wrapper.
import { SheetScrollLayout } from "../ui/SheetScrollLayout";

import { glass, radius as radiusTokens, semantic, spacing, text as textTokens } from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { IconChrome } from "../ui/IconChrome";
import { PhoneField, type PhoneEntry } from "../ui/PhoneField";
import { Sheet } from "../ui/Sheet";
import { DOOR_MODE_COPY } from "./doorModeCopy";

const NAME_MAX = 120;
const EMAIL_MAX = 200;

export const isValidDoorEmail = (value: string): boolean => {
  const t = value.trim();
  if (t.length === 0) return true;
  return t.length <= EMAIL_MAX && t.includes("@") && t.includes(".");
};

export interface DoorModeBuyerSheetProps {
  visible: boolean;
  name: string;
  email: string;
  phone: PhoneEntry;
  onChangeName: (value: string) => void;
  onChangeEmail: (value: string) => void;
  onClear: () => void;
  onClose: () => void;
  onDismissed?: () => void;
}

export const DoorModeBuyerSheet = ({
  visible,
  name,
  email,
  phone,
  onChangeName,
  onChangeEmail,
  onClear,
  onClose,
  onDismissed,
}: DoorModeBuyerSheetProps): React.ReactElement => {
  const emailValid = isValidDoorEmail(email);
  const phoneValid = phone.isEmpty || phone.e164 !== null;
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full" onDismissed={onDismissed} testID="door-mode-buyer-sheet">
      <View style={styles.body}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {DOOR_MODE_COPY.buyerTitle}
          </Text>
          <IconChrome icon="close" size={44} onPress={onClose} accessibilityLabel="Close add buyer" />
        </View>
        {/* #4389 — the fields scroll inside the sheet; Save stays pinned and,
            with the keyboard up, above it (SheetScrollLayout keyboardAware). */}
        <SheetScrollLayout
          keyboardAware
          testID="door-mode-buyer-body"
          contentStyle={styles.scrollContent}
          footer={
            <View style={styles.actions}>
              <Button
              label={DOOR_MODE_COPY.buyerSave}
              onPress={onClose}
              variant="primary"
              size="lg"
              fullWidth
              disabled={!emailValid || !phoneValid}
              testID="door-mode-buyer-save"
            />
            <Button label={DOOR_MODE_COPY.buyerClear} onPress={onClear} variant="ghost" size="md" fullWidth />
          </View>
          }
        >
          <Text style={styles.sub}>{DOOR_MODE_COPY.buyerBody}</Text>
          <Text style={styles.label}>{DOOR_MODE_COPY.buyerName}</Text>
          <View style={styles.inputWrap}>
            <TextInput
              value={name}
              onChangeText={onChangeName}
              maxLength={NAME_MAX}
              placeholder="Walk-up"
              placeholderTextColor={textTokens.quaternary}
              style={styles.input}
              accessibilityLabel="Buyer name"
            />
          </View>
          <Text style={styles.label}>{DOOR_MODE_COPY.buyerPhone}</Text>
          <PhoneField
            entry={phone}
            accessibilityLabel="Buyer's mobile number, optional, for their receipt"
            placeholder="Mobile number"
            testID="door-mode-buyer-phone"
          />
          {!phoneValid ? <Text style={styles.error}>{DOOR_MODE_COPY.buyerPhoneInvalid}</Text> : null}
          <Text style={styles.label}>{DOOR_MODE_COPY.buyerEmail}</Text>
          <View style={[styles.inputWrap, !emailValid && styles.inputError]}>
            <TextInput
              value={email}
              onChangeText={onChangeEmail}
              maxLength={EMAIL_MAX}
              placeholder="optional"
              placeholderTextColor={textTokens.quaternary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel="Buyer email"
            />
          </View>
          {!emailValid ? <Text style={styles.error}>{DOOR_MODE_COPY.buyerEmailInvalid}</Text> : null}
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  body: { flex: 1, paddingTop: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg },
  title: { flex: 1, fontSize: 20, fontWeight: "700", color: textTokens.primary },
  scrollContent: { paddingBottom: spacing.lg, gap: spacing.xs },
  sub: { fontSize: 14, lineHeight: 20, color: textTokens.secondary, marginBottom: spacing.sm },
  label: { fontSize: 13, fontWeight: "600", color: textTokens.secondary, marginTop: spacing.sm },
  inputWrap: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  inputError: { borderColor: semantic.error },
  input: {
    fontSize: 15,
    color: textTokens.primary,
    minHeight: 40,
    paddingVertical: 6,
    ...(Platform.OS === "web" ? ({ outlineWidth: 0 } as Record<string, number>) : null),
  },
  error: { fontSize: 12, color: semantic.errorText },
  actions: { gap: spacing.xs },
});
