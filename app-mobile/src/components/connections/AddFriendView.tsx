/**
 * Issue #4114 Wave 2b — the one Add a friend flow (add = pair), the body of the
 * dark AddFriendSheet. Opened from the New message sheet, the friends sheet's
 * Add, and (as its own inline copy of the server path) onboarding.
 *
 * Phone + country → the existing 500ms lookup (7+ digits) → an inline card:
 * found (Add), already friends (Message), pending, "That's you", or not on
 * Mingla (Invite). Add and Invite both call send-pair-request; there is no
 * second invite record and no alert. After sending, the sheet confirms in
 * place with Add another / Done. "Invite texted" shows only when the server
 * says the text went; otherwise the share sheet carries the same OneLink.
 *
 * ORCH-1371 [add-friend-country-picker-hidden]: the country/dial-code picker is
 * HOISTED to ConnectionsPage and rendered as a SIBLING of this sheet; the typed
 * number and the country live in ConnectionsPage too. iOS presents only ONE RN
 * <Modal> at a time, so this sheet drops while the picker is up, and a sheet
 * that drops unmounts its children — so nothing the user typed may live here.
 * Proven pattern: AccountSettings.tsx:638-683.
 */
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { CountryData } from "../../types/onboarding";
import { usePhoneLookup, useDebouncedValue } from "../../hooks/usePhoneLookup";
import { useSendPairRequest } from "../../hooks/usePairings";
import { COUNTRIES } from "../../constants/countries";
import { glass } from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { ChatAvatar } from "./ChatAvatar";
import {
  addFriendCard,
  addFriendOutcome,
  addFriendRequestBody,
  maskPhone,
  type AddFriendCard,
  type AddFriendOutcome,
} from "./friendsSheetModel";

const ink = glass.discover.chatList;
const fs = glass.discover.friendsSheet;
const DIAL_CODES = COUNTRIES.map((country) => country.dialCode);

interface AddFriendViewProps {
  currentUserId: string;
  /** ORCH-1371: hoisted country picker state (owned by ConnectionsPage). */
  selectedCountry: CountryData;
  /** ORCH-1371: hoisted phone-field value (survives the sheet drop). */
  phoneNumber: string;
  /** ORCH-1371: replaces the local setter. */
  onPhoneNumberChange: (text: string) => void;
  /** ORCH-1371: opens the hoisted country picker (sibling of the sheet). */
  onOpenCountryPicker: () => void;
  /** People I already have a pending request with (pills). */
  pendingUserIds?: ReadonlySet<string>;
  /** Free plan with its pairing used: show the Mingla+ card before sending. */
  pairingAtLimit: boolean;
  onMessageFriend: (userId: string) => void;
  onSeePlus: () => void;
  onDone: () => void;
  /** A request or invite went out — refresh Requests. */
  onRequestSent?: () => void;
}

type Sent = { outcome: AddFriendOutcome; name: string; phoneE164: string };

export function AddFriendView({
  currentUserId,
  selectedCountry,
  phoneNumber,
  onPhoneNumberChange,
  onOpenCountryPicker,
  pendingUserIds,
  pairingAtLimit,
  onMessageFriend,
  onSeePlus,
  onDone,
  onRequestSent,
}: AddFriendViewProps): React.ReactElement {
  const { t } = useTranslation(["connections", "common"]);
  const sendPairRequest = useSendPairRequest();
  const [sent, setSent] = useState<Sent | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const digits = phoneNumber.replace(/\D/g, "");
  const phoneE164 = digits ? `${selectedCountry.dialCode}${digits}` : "";
  const debouncedPhoneE164 = useDebouncedValue(phoneE164, 500);
  const debouncedDigitCount = useDebouncedValue(digits.length, 500);
  const lookup = usePhoneLookup(debouncedPhoneE164, debouncedDigitCount >= 7);

  const card = useMemo<AddFriendCard>(
    () =>
      addFriendCard({
        digitCount: digits.length,
        debouncing: digits.length >= 7 && phoneE164 !== debouncedPhoneE164,
        loading: lookup.isLoading,
        failed: lookup.isError,
        lookup: lookup.data,
        currentUserId,
        pendingUserIds,
      }),
    [digits.length, phoneE164, debouncedPhoneE164, lookup.isLoading, lookup.isError, lookup.data, currentUserId, pendingUserIds],
  );

  const shareInvite = useCallback(
    async (link: string | null) => {
      try {
        // SHARE-NON-CONTENT:invite
        await Share.share({
          message: t("connections:af_share_message", { link: link ?? "https://go.usemingla.com/w36m" }),
        });
      } catch (error) {
        // The share sheet being dismissed is not an error; anything else is logged.
        console.warn("[AddFriendView] share failed:", error);
      }
    },
    [t],
  );

  const handleSend = useCallback(async () => {
    const body = addFriendRequestBody(card, debouncedPhoneE164);
    if (!body || sendPairRequest.isPending) return;
    setSendError(null);
    HapticFeedback.medium();
    try {
      const response = await sendPairRequest.mutateAsync(body);
      HapticFeedback.success();
      setSent({
        outcome: addFriendOutcome(response),
        name: card.kind === "found" ? card.name : "",
        phoneE164: debouncedPhoneE164,
      });
      onRequestSent?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setSendError(message && message !== "pairing_limit_reached" ? message : t("connections:af_send_failed"));
    }
  }, [card, debouncedPhoneE164, sendPairRequest, onRequestSent, t]);

  const handleAddAnother = useCallback(() => {
    setSent(null);
    setSendError(null);
    onPhoneNumberChange("");
  }, [onPhoneNumberChange]);

  // ── After sending: the confirmation, in place ──────────────────────────────
  if (sent) {
    const masked = maskPhone(sent.phoneE164, DIAL_CODES);
    const { outcome } = sent;
    return (
      <View style={styles.container}>
        {outcome.kind === "invite_not_texted" ? (
          <View style={[styles.statusCard, styles.failCard]} accessibilityLiveRegion="polite">
            <View style={[styles.statusDot, { backgroundColor: fs.failDot }]}>
              <Text style={styles.statusDotText}>!</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.statusTitle}>{t("connections:af_not_texted_title")}</Text>
              <Text style={styles.statusBody}>{t("connections:af_not_texted_body")}</Text>
            </View>
            <Pressable
              onPress={() => void shareInvite(outcome.inviteLink)}
              accessibilityRole="button"
              accessibilityLabel={t("connections:af_share")}
              style={styles.shareButton}
            >
              <Text style={styles.shareButtonText}>{t("connections:af_share")}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.statusCard, styles.successCard]} accessibilityLiveRegion="polite">
            <View style={[styles.statusDot, { backgroundColor: fs.successDot }]}>
              <Icon name="checkmark" size={18} color="#ffffff" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.statusTitle}>
                {outcome.kind === "invite_texted"
                  ? t("connections:af_texted_title", { phone: masked })
                  : t("connections:af_sent_title", { name: sent.name })}
              </Text>
              <Text style={styles.statusBody}>
                {outcome.kind === "invite_texted"
                  ? t("connections:af_texted_body")
                  : outcome.pairingLimitReached
                    ? t("connections:af_sent_body_friend_only")
                    : t("connections:af_sent_body")}
              </Text>
            </View>
          </View>
        )}
        {outcome.pairingLimitReached && outcome.kind === "request_sent" ? (
          <LimitCard name={sent.name} onSeePlus={onSeePlus} />
        ) : null}
        <View style={styles.footerRow}>
          <Pressable
            onPress={handleAddAnother}
            accessibilityRole="button"
            accessibilityLabel={t("connections:af_add_another")}
            style={[styles.footerButton, styles.footerGhost]}
          >
            <Text style={styles.footerText}>{t("connections:af_add_another")}</Text>
          </Pressable>
          <Pressable
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel={t("connections:af_done")}
            style={[styles.footerButton, styles.footerPrimary]}
          >
            <Text style={styles.footerText}>{t("connections:af_done")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Lookup ──────────────────────────────────────────────────────────────
  const sending = sendPairRequest.isPending;
  return (
    <View style={styles.container}>
      <Text style={styles.hint}>{t("connections:af_hint")}</Text>
      <View style={styles.phoneRow}>
        <Pressable
          style={styles.countryChip}
          onPress={onOpenCountryPicker}
          accessibilityRole="button"
          accessibilityLabel={t("connections:af_country_a11y", { dial: selectedCountry.dialCode })}
        >
          <Text style={styles.countryText}>
            {selectedCountry.flag} {selectedCountry.dialCode}
          </Text>
          <Icon name="chevron-down" size={14} color={ink.dim} />
        </Pressable>
        <BottomSheetTextInput
          style={styles.phoneInput}
          value={phoneNumber}
          onChangeText={(text) => {
            onPhoneNumberChange(text);
            if (sendError) setSendError(null);
          }}
          placeholder={t("connections:af_phone_placeholder")}
          placeholderTextColor={ink.faint}
          keyboardType="phone-pad"
          autoCorrect={false}
          maxLength={15}
          accessibilityLabel={t("connections:af_phone_placeholder")}
        />
      </View>

      <ResultCard
        card={card}
        sending={sending}
        onAdd={() => void handleSend()}
        onMessage={(userId) => onMessageFriend(userId)}
      />
      {sendError ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {sendError}
        </Text>
      ) : null}
      {pairingAtLimit && card.kind === "found" ? <LimitCard name={card.name} onSeePlus={onSeePlus} /> : null}

      <Text style={styles.label}>{t("connections:af_or")}</Text>
      <Pressable
        onPress={() => void shareInvite(null)}
        accessibilityRole="button"
        accessibilityLabel={`${t("connections:af_share_invite")}, ${t("connections:af_share_invite_sub")}`}
        style={({ pressed }) => [styles.shareRow, pressed ? styles.pressed : null]}
      >
        <View style={styles.shareIcon}>
          <Icon name="share-outline" size={19} color={ink.accent} />
        </View>
        <Text style={styles.shareTitle}>{t("connections:af_share_invite")}</Text>
        <Text style={styles.shareSub}>{t("connections:af_share_invite_sub")}</Text>
      </Pressable>
    </View>
  );
}

function LimitCard({ name, onSeePlus }: { name: string; onSeePlus: () => void }): React.ReactElement {
  const { t } = useTranslation(["connections"]);
  return (
    <LinearGradient
      colors={[fs.goldCardFrom, fs.goldCardTo]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.limitCard}
    >
      <Text style={styles.limitTitle}>{t("connections:af_limit_title")}</Text>
      <Text style={styles.limitBody}>{t("connections:af_limit_body", { name: name || t("connections:af_this_friend") })}</Text>
      <Pressable
        onPress={onSeePlus}
        accessibilityRole="button"
        accessibilityLabel={t("connections:af_limit_cta")}
        style={styles.limitButton}
      >
        <Text style={styles.limitButtonText}>{t("connections:af_limit_cta")}</Text>
      </Pressable>
    </LinearGradient>
  );
}

function ResultCard({
  card,
  sending,
  onAdd,
  onMessage,
}: {
  card: AddFriendCard;
  sending: boolean;
  onAdd: () => void;
  onMessage: (userId: string) => void;
}): React.ReactElement | null {
  const { t } = useTranslation(["connections"]);
  if (card.kind === "idle") return null;
  if (card.kind === "searching") {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={ink.accent} />
        <Text style={styles.cardSub}>{t("connections:af_searching")}</Text>
      </View>
    );
  }
  if (card.kind === "error") {
    return (
      <View style={styles.card}>
        <Text style={[styles.cardSub, styles.flex]}>{t("connections:af_lookup_failed")}</Text>
      </View>
    );
  }
  if (card.kind === "self") {
    return (
      <View style={styles.card}>
        <View style={[styles.cardAvatarBlank]}>
          <Icon name="person-outline" size={22} color={ink.dim} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{t("connections:af_self_title")}</Text>
          <Text style={styles.cardSub}>{t("connections:af_self_body")}</Text>
        </View>
      </View>
    );
  }
  if (card.kind === "not_on_mingla") {
    return (
      <View style={styles.card}>
        <View style={styles.cardAvatarBlank}>
          <Text style={styles.cardHash}>#</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{t("connections:af_not_on_mingla")}</Text>
          <Text style={styles.cardSub}>{t("connections:af_will_text")}</Text>
        </View>
        <Pressable
          onPress={onAdd}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel={t("connections:af_invite")}
          accessibilityState={{ disabled: sending, busy: sending }}
          style={[styles.cardButton, sending ? styles.dim : null]}
        >
          {sending ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.cardButtonText}>{t("connections:af_invite")}</Text>}
        </Pressable>
      </View>
    );
  }
  const sub = card.username
    ? t("connections:af_on_mingla", { username: card.username })
    : t("connections:af_on_mingla_no_username");
  return (
    <View style={styles.card}>
      <ChatAvatar people={[{ id: card.userId, name: card.name, avatarUrl: card.avatarUrl }]} shape="circle" label={card.name} size={48} />
      <View style={styles.flex}>
        <Text style={styles.cardTitle} numberOfLines={1}>{card.name}</Text>
        <Text style={[styles.cardSub, styles.onMingla]} numberOfLines={1}>
          {card.kind === "friends" ? t("connections:af_already_friends") : card.kind === "pending" ? t("connections:af_request_pending") : sub}
        </Text>
      </View>
      {card.kind === "found" ? (
        <Pressable
          onPress={onAdd}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel={`${t("connections:af_add")} ${card.name}`}
          accessibilityState={{ disabled: sending, busy: sending }}
          style={[styles.cardButton, sending ? styles.dim : null]}
        >
          {sending ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.cardButtonText}>{t("connections:af_add")}</Text>}
        </Pressable>
      ) : card.kind === "friends" ? (
        <Pressable
          onPress={() => onMessage(card.userId)}
          accessibilityRole="button"
          accessibilityLabel={`${t("connections:af_message")} ${card.name}`}
          style={[styles.cardButton, styles.cardButtonGhost]}
        >
          <Text style={styles.cardButtonText}>{t("connections:af_message")}</Text>
        </Pressable>
      ) : (
        <View style={[styles.cardButton, styles.cardButtonGhost]}>
          <Text style={[styles.cardButtonText, { color: ink.dim }]}>{t("connections:af_pending")}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingBottom: 24,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  dim: {
    opacity: 0.6,
  },
  pressed: {
    backgroundColor: ink.rowPressed,
  },
  hint: {
    marginHorizontal: 4,
    marginBottom: 12,
    fontSize: 13.5,
    lineHeight: 18,
    color: ink.dim,
  },
  phoneRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  countryChip: {
    height: 48,
    borderRadius: 12,
    backgroundColor: fs.fieldBg,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  countryText: {
    color: ink.ink,
    fontSize: 15,
    fontWeight: "600",
  },
  phoneInput: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: fs.fieldBg,
    borderWidth: 1.5,
    borderColor: ink.accent,
    paddingHorizontal: 12,
    color: ink.ink,
    fontSize: 16,
    letterSpacing: 0.3,
  },
  card: {
    borderRadius: 16,
    backgroundColor: fs.cardBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: fs.cardBorder,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 72,
  },
  cardAvatarBlank: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: fs.fieldBg,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHash: {
    color: ink.dim,
    fontSize: 18,
    fontWeight: "700",
  },
  cardTitle: {
    color: ink.ink,
    fontSize: 15.5,
    fontWeight: "700",
  },
  cardSub: {
    color: ink.faint,
    fontSize: 12.5,
    marginTop: 2,
  },
  onMingla: {
    color: fs.onMingla,
  },
  cardButton: {
    minWidth: 64,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: ink.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  cardButtonGhost: {
    backgroundColor: fs.ghostButtonBg,
  },
  cardButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    color: ink.errorLabel,
    fontSize: 13,
    marginTop: 8,
    marginHorizontal: 4,
  },
  label: {
    color: ink.faint,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingTop: 20,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  shareRow: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  shareIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: fs.shareIconBg,
    alignItems: "center",
    justifyContent: "center",
  },
  shareTitle: {
    flex: 1,
    color: ink.ink,
    fontSize: 15.5,
    fontWeight: "600",
  },
  shareSub: {
    color: ink.faint,
    fontSize: 12,
  },
  statusCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
  },
  successCard: {
    backgroundColor: fs.successBg,
    borderColor: fs.successBorder,
  },
  failCard: {
    backgroundColor: fs.failBg,
    borderColor: fs.failBorder,
  },
  statusDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDotText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  statusTitle: {
    color: ink.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  statusBody: {
    color: ink.dim,
    fontSize: 12.5,
    marginTop: 2,
    lineHeight: 17,
  },
  shareButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    minHeight: 36,
    justifyContent: "center",
  },
  shareButtonText: {
    color: ink.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  footerRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  footerButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  footerGhost: {
    backgroundColor: fs.ghostButtonBg,
  },
  footerPrimary: {
    backgroundColor: ink.accent,
  },
  footerText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  limitCard: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: fs.goldCardBorder,
    padding: 14,
    gap: 8,
  },
  limitTitle: {
    color: fs.goldTitle,
    fontSize: 14.5,
    fontWeight: "700",
  },
  limitBody: {
    color: ink.dim,
    fontSize: 13,
    lineHeight: 18,
  },
  limitButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 12,
    backgroundColor: fs.gold,
    minHeight: 36,
    justifyContent: "center",
  },
  limitButtonText: {
    color: fs.goldInk,
    fontSize: 13,
    fontWeight: "700",
  },
});
