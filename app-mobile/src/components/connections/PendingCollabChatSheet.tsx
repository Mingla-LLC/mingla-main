import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../ui/Icon";
import { colors, fontWeights } from "../../constants/designSystem";
import { s } from "../../utils/responsive";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { getDisplayName } from "../../utils/getDisplayName";
import { getCountryByCode, getDefaultCountryCode } from "../../constants/countries";
import { useDebouncedValue, usePhoneLookup } from "../../hooks/usePhoneLookup";
import { inviteByPhone } from "../../services/sessionInviteService";
import { PhoneInput } from "../onboarding/PhoneInput";
import {
  buildPendingCollabPhoneE164,
  canRevokePendingCollabInvite,
  isPendingCollabPhoneValid,
} from "./pendingCollabChatUtils";

export type PendingCollabChatPerson = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  status: "creator" | "pending" | "accepted";
  inviteKind?: "warm" | "cold" | null;
  inviteId?: string | null;
  phoneE164?: string | null;
};

export type PendingCollabChatDetails = {
  conversationId: string;
  sessionId: string;
  sessionName: string;
  people: PendingCollabChatPerson[];
  existingUserIds: string[];
};

interface PendingCollabChatSheetProps {
  visible: boolean;
  details: PendingCollabChatDetails | null;
  currentUserId: string | null;
  isWorking: boolean;
  onClose: () => void;
  onCancelChat: () => Promise<void>;
  onRevokeInvite: (person: PendingCollabChatPerson) => Promise<void>;
  onPhoneInviteSettled: () => Promise<void>;
  onAddFriendRequest?: (
    friendUserId: string,
    receiverEmail: string,
    receiverUsername?: string,
  ) => Promise<void>;
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";
}

export function PendingCollabChatSheet({
  visible,
  details,
  currentUserId,
  isWorking,
  onClose,
  onCancelChat,
  onRevokeInvite,
  onPhoneInviteSettled,
  onAddFriendRequest,
}: PendingCollabChatSheetProps) {
  const insets = useSafeAreaInsets();
  const [phoneInput, setPhoneInput] = useState("");
  const [countryCode, setCountryCode] = useState(getDefaultCountryCode());
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [revokingPersonId, setRevokingPersonId] = useState<string | null>(null);
  const selectedCountry = useMemo(() => getCountryByCode(countryCode), [countryCode]);

  const phoneE164 = useMemo(
    () => buildPendingCollabPhoneE164(phoneInput, selectedCountry?.dialCode),
    [phoneInput, selectedCountry?.dialCode],
  );
  const isPhoneValid = useMemo(
    () => isPendingCollabPhoneValid(phoneInput),
    [phoneInput],
  );
  const debouncedPhoneE164 = useDebouncedValue(phoneE164, 500);
  const digitCount = phoneInput.replace(/\D/g, "").length;
  const debouncedDigitCount = useDebouncedValue(digitCount, 500);
  const { data: phoneLookupResult, isLoading: phoneLookupLoading } =
    usePhoneLookup(debouncedPhoneE164, debouncedDigitCount >= 7);
  const lookupDebouncing = isPhoneValid && phoneE164 !== debouncedPhoneE164;
  const lookupResolved =
    isPhoneValid && !lookupDebouncing && !phoneLookupLoading && !!phoneLookupResult;
  const lookupFound = lookupResolved && phoneLookupResult?.found === true;
  const canInvite =
    Boolean(details && currentUserId) &&
    isPhoneValid &&
    !isWorking &&
    !inviting &&
    !lookupDebouncing &&
    !phoneLookupLoading;

  const handlePhoneInvite = async () => {
    if (!details || !currentUserId || !canInvite) return;
    setInviting(true);
    setPhoneError(null);
    HapticFeedback.medium();
    try {
      if (
        phoneLookupResult?.found &&
        phoneLookupResult.user &&
        phoneLookupResult.friendship_status === "none" &&
        onAddFriendRequest
      ) {
        await onAddFriendRequest(
          phoneLookupResult.user.id,
          "",
          phoneLookupResult.user.username,
        );
      }
      const outcome = await inviteByPhone(
        details.sessionId,
        currentUserId,
        details.sessionName,
        phoneE164,
      );
      if (outcome.kind === "error") {
        setPhoneError(outcome.message);
        return;
      }
      setPhoneInput("");
      await onPhoneInviteSettled();
      Alert.alert(
        "Invite sent",
        outcome.kind === "warm" && outcome.displayName
          ? `${outcome.displayName} was invited to this session.`
          : "We sent an invite to this session.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send invite.";
      setPhoneError(message);
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvite = (person: PendingCollabChatPerson) => {
    if (!canRevokePendingCollabInvite(person) || isWorking || inviting || revokingPersonId) {
      return;
    }
    Alert.alert(
      "Revoke invite?",
      `Remove ${person.name} from this pending session invite?`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setRevokingPersonId(person.id);
              try {
                await onRevokeInvite(person);
              } finally {
                setRevokingPersonId(null);
              }
            })();
          },
        },
      ],
    );
  };

  if (!details) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      accessibilityViewIsModal
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel="Close pending chat"
        onPress={onClose}
      />
      <View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, s(16)) + s(16) },
        ]}
      >
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Icon name="time-outline" size={20} color="#fb923c" />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>
              {details.sessionName}
            </Text>
            <Text style={styles.subtitle}>
              Waiting for at least one person to accept.
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [
              styles.closeButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Icon name="close" size={20} color="rgba(255,255,255,0.82)" />
          </Pressable>
        </View>

        <View style={styles.phoneInviteSection}>
          <Text style={styles.sectionLabel}>Add someone by phone</Text>
          <PhoneInput
            value={phoneInput}
            countryCode={countryCode}
            onChangePhone={(value) => {
              setPhoneInput(value);
              setPhoneError(null);
            }}
            onChangeCountry={setCountryCode}
            error={phoneError}
            disabled={inviting || isWorking}
            showDoneAccessory={false}
          />
          {isPhoneValid && (lookupDebouncing || phoneLookupLoading) ? (
            <View style={styles.lookupRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.lookupTextMuted}>Checking number...</Text>
            </View>
          ) : null}
          {lookupResolved && lookupFound ? (
            <View style={styles.lookupRow}>
              <Icon name="checkmark-circle" size={14} color="#22c55e" />
              <Text style={styles.lookupTextGreen}>
                {getDisplayName(phoneLookupResult?.user, "This person")} is on Mingla
              </Text>
            </View>
          ) : null}
          {lookupResolved && !lookupFound ? (
            <View style={styles.lookupRow}>
              <Icon name="person-add-outline" size={14} color="rgba(255, 255, 255, 0.62)" />
              <Text style={styles.lookupTextMuted}>
                {"Not on Mingla yet. We'll send a text invite."}
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={handlePhoneInvite}
            disabled={!canInvite}
            accessibilityRole="button"
            accessibilityLabel="Send collaboration invite by phone"
            style={({ pressed }) => [
              styles.phoneInviteButton,
              !canInvite ? styles.buttonDisabled : null,
              pressed && canInvite ? styles.pressed : null,
            ]}
          >
            {inviting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Icon
                  name={
                    lookupResolved && lookupFound
                      ? "person-add"
                      : lookupResolved && !lookupFound
                        ? "chatbubble-ellipses-outline"
                        : "send"
                  }
                  size={16}
                  color="#FFFFFF"
                />
                <Text style={styles.phoneInviteButtonText}>
                  {lookupResolved && lookupFound
                    ? `Invite ${getDisplayName(phoneLookupResult?.user, "user")}`
                    : lookupResolved && !lookupFound
                      ? "Send text invite"
                      : "Send invite"}
                </Text>
              </>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={styles.peopleList}
          contentContainerStyle={styles.peopleContent}
          showsVerticalScrollIndicator={false}
        >
          {details.people.map((person) => (
            <View key={`${person.status}-${person.id}`} style={styles.personRow}>
              {person.avatarUrl ? (
                <Image source={{ uri: person.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarText}>{getInitials(person.name)}</Text>
                </View>
              )}
              <Text style={styles.personName} numberOfLines={1}>
                {person.name}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  person.status === "accepted" ? styles.statusAccepted : null,
                  person.status === "creator" ? styles.statusCreator : null,
                ]}
              >
                <Text style={styles.statusText}>
                  {person.status === "creator"
                    ? "Host"
                    : person.status === "accepted"
                      ? "Accepted"
                      : "Pending"}
                </Text>
              </View>
              {canRevokePendingCollabInvite(person) ? (
                <Pressable
                  onPress={() => handleRevokeInvite(person)}
                  disabled={isWorking || inviting || revokingPersonId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Revoke invite for ${person.name}`}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.revokeButton,
                    pressed ? styles.pressed : null,
                    revokingPersonId === person.id ? styles.buttonDisabled : null,
                  ]}
                >
                  {revokingPersonId === person.id ? (
                    <ActivityIndicator size="small" color="#fca5a5" />
                  ) : (
                    <Icon name="close" size={16} color="#fca5a5" />
                  )}
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>

        <Pressable
          onPress={onCancelChat}
          disabled={isWorking || inviting}
          style={({ pressed }) => [
            styles.cancelButton,
            (isWorking || inviting) ? styles.buttonDisabled : null,
            pressed && !isWorking && !inviting ? styles.pressed : null,
          ]}
        >
          {isWorking ? (
            <ActivityIndicator size="small" color="#fca5a5" />
          ) : (
            <Text style={styles.cancelButtonText}>Cancel chat</Text>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.42)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "88%",
    borderTopLeftRadius: s(28),
    borderTopRightRadius: s(28),
    paddingTop: s(12),
    paddingHorizontal: s(18),
    backgroundColor: "rgba(18, 20, 24, 0.98)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  handle: {
    width: s(42),
    height: s(4),
    borderRadius: s(2),
    backgroundColor: "rgba(255, 255, 255, 0.20)",
    alignSelf: "center",
    marginBottom: s(18),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(12),
  },
  headerIcon: {
    width: s(42),
    height: s(42),
    borderRadius: s(21),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(249, 115, 22, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(249, 115, 22, 0.32)",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: "#FFFFFF",
    fontSize: s(18),
    fontWeight: fontWeights.bold,
  },
  subtitle: {
    color: "rgba(255, 255, 255, 0.66)",
    fontSize: s(13),
    marginTop: s(3),
  },
  closeButton: {
    width: s(38),
    height: s(38),
    borderRadius: s(19),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.07)",
  },
  phoneInviteSection: {
    marginTop: s(18),
    gap: s(10),
    padding: s(12),
    borderRadius: s(18),
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  sectionLabel: {
    color: "rgba(255, 255, 255, 0.62)",
    fontSize: s(12),
    fontWeight: fontWeights.bold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  lookupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(7),
    paddingHorizontal: s(2),
  },
  lookupTextGreen: {
    flex: 1,
    minWidth: 0,
    color: "#22c55e",
    fontSize: s(13),
    fontWeight: fontWeights.medium,
  },
  lookupTextMuted: {
    flex: 1,
    minWidth: 0,
    color: "rgba(255, 255, 255, 0.62)",
    fontSize: s(13),
  },
  phoneInviteButton: {
    minHeight: s(46),
    borderRadius: s(15),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(8),
    backgroundColor: colors.accent,
  },
  phoneInviteButtonText: {
    color: "#FFFFFF",
    fontSize: s(15),
    fontWeight: fontWeights.bold,
  },
  peopleList: {
    maxHeight: s(190),
    marginTop: s(18),
  },
  peopleContent: {
    gap: s(8),
  },
  personRow: {
    minHeight: s(56),
    borderRadius: s(16),
    flexDirection: "row",
    alignItems: "center",
    gap: s(12),
    paddingHorizontal: s(12),
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  avatar: {
    width: s(36),
    height: s(36),
    borderRadius: s(18),
  },
  avatarFallback: {
    width: s(36),
    height: s(36),
    borderRadius: s(18),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: s(12),
    fontWeight: fontWeights.bold,
  },
  personName: {
    flex: 1,
    minWidth: 0,
    color: "#FFFFFF",
    fontSize: s(15),
    fontWeight: fontWeights.semibold,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: s(9),
    paddingVertical: s(4),
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  statusAccepted: {
    backgroundColor: "rgba(16, 185, 129, 0.18)",
  },
  statusCreator: {
    backgroundColor: "rgba(249, 115, 22, 0.18)",
  },
  statusText: {
    color: "rgba(255, 255, 255, 0.78)",
    fontSize: s(11),
    fontWeight: fontWeights.bold,
  },
  revokeButton: {
    width: s(32),
    height: s(32),
    borderRadius: s(16),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(127, 29, 29, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(248, 113, 113, 0.26)",
  },
  cancelButton: {
    minHeight: s(46),
    borderRadius: s(16),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(248, 113, 113, 0.34)",
    backgroundColor: "rgba(127, 29, 29, 0.14)",
    marginTop: s(18),
  },
  cancelButtonText: {
    color: "#fca5a5",
    fontSize: s(15),
    fontWeight: fontWeights.bold,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
});
