/**
 * Issue #4435 (design v4 flow 2): "Invite by phone number" in Add people, for
 * someone not on Mingla yet (or not a friend). The same invite path the board
 * settings and the retired pending sheet used: live lookup, inviteByPhone, and
 * the #4114 QA rule that a cold invite whose text did not go out says so and
 * offers Share (showInviteNotTextedAlert) instead of claiming it was sent.
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { PhoneInputTheme } from "@mingla/phone-input";
import { Icon } from "../ui/Icon";
import { PhoneInput } from "../onboarding/PhoneInput";
import { chatTokens } from "../../constants/chatTokens";
import { getCountryByCode, getDefaultCountryCode } from "../../constants/countries";
import { useDebouncedValue, usePhoneLookup } from "../../hooks/usePhoneLookup";
import { inviteByPhone } from "../../services/sessionInviteService";
import { showInviteNotTextedAlert, showInviteTextedAlert } from "../../utils/inviteNotTextedAlert";
import { getDisplayName } from "../../utils/getDisplayName";
import { buildPendingCollabPhoneE164, isPendingCollabPhoneValid } from "../connections/pendingCollabChatUtils";

const PHONE_THEME: PhoneInputTheme = {
  backgroundPrimary: chatTokens.surfaceRaised,
  textPrimary: chatTokens.textPrimary,
  textTertiary: chatTokens.textSoft,
  borderDefault: chatTokens.hairline,
  borderFocused: chatTokens.accent,
  borderError: chatTokens.danger,
  searchBackground: chatTokens.strip,
  rowPressedBackground: chatTokens.strip,
  divider: chatTokens.hairline,
  accessoryBackground: chatTokens.surface,
  accessoryBorder: chatTokens.hairline,
  accent: chatTokens.accent,
  errorText: chatTokens.danger,
};

interface GroupPhoneInviteProps {
  sessionId: string;
  sessionName: string;
  currentUserId: string;
  onInvited?: () => void;
}

export function GroupPhoneInvite({
  sessionId,
  sessionName,
  currentUserId,
  onInvited,
}: GroupPhoneInviteProps): React.ReactElement {
  const { t } = useTranslation(["chat", "board", "social", "common"]);
  const [open, setOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [countryCode, setCountryCode] = useState(getDefaultCountryCode());
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);
  const phoneE164 = useMemo(
    () => buildPendingCollabPhoneE164(phoneInput, selectedCountry?.dialCode),
    [phoneInput, selectedCountry?.dialCode],
  );
  const isPhoneValid = isPendingCollabPhoneValid(phoneInput);
  const debouncedPhoneE164 = useDebouncedValue(phoneE164, 500);
  const digitCount = phoneInput.replace(/\D/g, "").length;
  const debouncedDigitCount = useDebouncedValue(digitCount, 500);
  const { data: lookup, isLoading: lookupLoading } = usePhoneLookup(debouncedPhoneE164, debouncedDigitCount >= 7);
  const debouncing = isPhoneValid && phoneE164 !== debouncedPhoneE164;
  const resolved = isPhoneValid && !debouncing && !lookupLoading && !!lookup;
  const found = resolved && lookup?.found === true;
  const canInvite = isPhoneValid && !inviting && !debouncing && !lookupLoading;

  const send = async () => {
    if (!canInvite) return;
    setInviting(true);
    setPhoneError(null);
    try {
      const outcome = await inviteByPhone(sessionId, currentUserId, sessionName, phoneE164);
      if (outcome.kind === "error") {
        setPhoneError(outcome.message);
        return;
      }
      setPhoneInput("");
      setOpen(false);
      onInvited?.();
      // Issue #4114 QA run 2: a cold invite whose text did not go out says so.
      if (outcome.kind === "cold" && !outcome.texted) {
        showInviteNotTextedAlert(t, outcome.phoneE164, outcome.inviteLink, sessionName);
        return;
      }
      // #4508 2.2 — texted: offer Copy message / Share with this plan's link.
      if (outcome.kind === "cold") {
        showInviteTextedAlert(t, outcome.phoneE164, outcome.inviteLink, sessionName);
        return;
      }
      // A person already on Mingla: invited in the app.
      Alert.alert(
        t("board:boardSettingsDropdown.invited"),
        outcome.displayName
          ? t("board:boardSettingsDropdown.invitedUser", { name: outcome.displayName })
          : t("board:boardSettingsDropdown.inviteSent"),
      );
    } catch (error) {
      setPhoneError(error instanceof Error ? error.message : t("chat:group_action_failed"));
    } finally {
      setInviting(false);
    }
  };

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("chat:group_invite_phone")}
        style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      >
        <View style={styles.tile}>
          <Icon name="call-outline" size={18} color={chatTokens.tagDeck} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>{t("chat:group_invite_phone")}</Text>
          <Text style={styles.sub}>{t("chat:group_invite_phone_sub")}</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={chatTokens.textMuted} />
      </Pressable>
    );
  }

  return (
    <View style={styles.open}>
      <PhoneInput
        value={phoneInput}
        countryCode={countryCode}
        onChangePhone={(value) => {
          setPhoneInput(value);
          setPhoneError(null);
        }}
        onChangeCountry={setCountryCode}
        error={phoneError}
        disabled={inviting}
        theme={PHONE_THEME}
        showDoneAccessory={false}
      />
      {isPhoneValid && (debouncing || lookupLoading) ? (
        <View style={styles.lookup}>
          <ActivityIndicator size="small" color={chatTokens.accent} />
          <Text style={styles.sub}>{t("board:boardSettingsDropdown.checkingNumber")}</Text>
        </View>
      ) : resolved ? (
        <View style={styles.lookup}>
          <Icon
            name={found ? "checkmark-circle" : "person-add-outline"}
            size={14}
            color={found ? chatTokens.success : chatTokens.textSoft}
          />
          <Text style={styles.sub}>
            {found
              ? t("social:isOnMingla", { name: getDisplayName(lookup?.user, "") })
              : t("social:notOnMinglaYet")}
          </Text>
        </View>
      ) : null}
      <Pressable
        onPress={() => void send()}
        disabled={!canInvite}
        accessibilityRole="button"
        accessibilityLabel={t("board:boardSettingsDropdown.sendInviteByPhone")}
        accessibilityState={{ disabled: !canInvite, busy: inviting }}
        style={({ pressed }) => [styles.send, !canInvite ? styles.sendOff : null, pressed ? styles.pressed : null]}
      >
        {inviting ? (
          <ActivityIndicator size="small" color={chatTokens.textPrimary} />
        ) : (
          <Text style={styles.sendText}>
            {found
              ? t("board:boardSettingsDropdown.inviteUser", { name: getDisplayName(lookup?.user, "") })
              : resolved
                ? t("board:boardSettingsDropdown.sendSmsInvite")
                : t("board:boardSettingsDropdown.invite")}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 4,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: chatTokens.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  sub: {
    fontSize: 13,
    color: chatTokens.textSoft,
  },
  open: {
    gap: 8,
    paddingVertical: 6,
  },
  lookup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  send: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: chatTokens.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendOff: {
    opacity: 0.45,
  },
  sendText: {
    fontSize: 15,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  pressed: {
    opacity: 0.7,
  },
});
