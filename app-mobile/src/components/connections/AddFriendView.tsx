import { useState, useMemo, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Share,
  FlatList,
} from "react-native";
import { useTranslation } from 'react-i18next';
import { Icon } from "../ui/Icon";
import * as Haptics from "expo-haptics";
import { KeyboardAwareScrollView } from '../ui/KeyboardAwareScrollView';
import {
  getDefaultCountryCode,
  getCountryByCode,
} from "../../constants/countries";
import { CountryData } from "../../types/onboarding";
import { CountryPickerModal } from "../onboarding/CountryPickerModal";
import { PendingInvite } from "../../services/phoneLookupService";
import { FriendRequest } from "../../hooks/useFriends";
import { usePhoneLookup, useDebouncedValue } from "../../hooks/usePhoneLookup";
import { usePendingPhoneInvites, phoneInviteKeys } from "../../hooks/usePhoneInvite";
import {
  createPendingInvite,
  cancelPendingInvite,
} from "../../services/phoneLookupService";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../../store/appStore";
import { s, vs } from "../../utils/responsive";
import { getDisplayName as getDisplayNameUtil } from "../../utils/getDisplayName";

type Tab = "add" | "sent";

// Unified item type for the sent list
type SentItem =
  | { kind: "request"; data: FriendRequest }
  | { kind: "invite"; data: PendingInvite };

interface AddFriendViewProps {
  currentUserId: string;
  onRequestSent: () => void;
  /** Outgoing pending friend requests from useFriends() */
  outgoingRequests: FriendRequest[];
  outgoingRequestsLoading: boolean;
  /** Cancel a friend_request row */
  onCancelRequest: (requestId: string) => Promise<void>;
  /** Send a friend request to a Mingla user (useFriends().addFriend) */
  onAddFriend: (
    friendUserIdOrEmail: string,
    receiverEmail: string,
    receiverUsername?: string
  ) => Promise<void>;
}

export function AddFriendView({
  currentUserId,
  onRequestSent,
  outgoingRequests,
  outgoingRequestsLoading,
  onCancelRequest,
  onAddFriend,
}: AddFriendViewProps) {
  const { t } = useTranslation(['social', 'common']);
  const { user } = useAppStore();
  const queryClient = useQueryClient();
  // Tab state removed — sent requests now in separate tab (ORCH-0435)

  // Pending phone invites (non-Mingla users)
  const { data: pendingInvites = [], isLoading: invitesLoading } =
    usePendingPhoneInvites();

  // Merge outgoing requests + phone invites into a single sorted list
  const sentItems = useMemo<SentItem[]>(() => {
    const items: SentItem[] = [
      ...outgoingRequests.map((r) => ({ kind: "request" as const, data: r })),
      ...pendingInvites.map((i) => ({ kind: "invite" as const, data: i })),
    ];
    const getDate = (item: SentItem): number => {
      if (item.kind === "request") return new Date(item.data.created_at).getTime();
      return new Date(item.data.createdAt).getTime();
    };
    items.sort((a, b) => getDate(b) - getDate(a));
    return items;
  }, [outgoingRequests, pendingInvites]);

  const sentTabLoading = outgoingRequestsLoading || invitesLoading;
  const sentTabCount = sentItems.length;

  // Phone input state
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<CountryData>(
    () =>
      getCountryByCode(getDefaultCountryCode()) ?? {
        code: "US",
        name: "United States",
        dialCode: "+1",
        flag: "\u{1F1FA}\u{1F1F8}",
      }
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [actionStatus, setActionStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [actionError, setActionError] = useState("");

  // Build E.164 phone
  const phoneRawDigits = phoneNumber.replace(/\D/g, "");
  const phoneE164 = useMemo(() => {
    if (!phoneRawDigits) return "";
    return `${selectedCountry.dialCode}${phoneRawDigits}`;
  }, [phoneRawDigits, selectedCountry]);

  const debouncedPhoneE164 = useDebouncedValue(phoneE164, 500);
  const debouncedDigitCount = useDebouncedValue(phoneRawDigits.length, 500);

  const { data: phoneLookupResult, isLoading: phoneLookupLoading } =
    usePhoneLookup(debouncedPhoneE164, debouncedDigitCount >= 7);

  const isPhoneValid = useMemo(() => {
    return phoneRawDigits.length >= 7 && phoneRawDigits.length <= 15;
  }, [phoneRawDigits]);

  const handlePhoneAction = useCallback(async () => {
    if (!isPhoneValid || !debouncedPhoneE164) return;
    if (!user) {
      setActionError(t('social:notSignedIn'));
      setActionStatus("error");
      return;
    }

    setActionStatus("sending");
    setActionError("");

    try {
      if (phoneLookupResult?.found && phoneLookupResult.user) {
        // Self-lookup guard
        if (phoneLookupResult.user.id === currentUserId) {
          Alert.alert(t('social:thatsYou'), t('social:cantSendToSelf'));
          setActionStatus("idle");
          return;
        }
        if (phoneLookupResult.friendship_status === "none") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          await onAddFriend(
            phoneLookupResult.user.id,
            "", // no email needed when we have the user ID
            phoneLookupResult.user.username
          );
          setActionStatus("sent");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onRequestSent();
          setTimeout(() => {
            setPhoneNumber("");
            setActionStatus("idle");
          }, 2000);
        } else if (phoneLookupResult.friendship_status === "friends") {
          Alert.alert(
            t('social:alreadyFriendsTitle'),
            t('social:alreadyFriendsMessage')
          );
          setActionStatus("idle");
        } else {
          Alert.alert(
            t('social:requestPendingTitle'),
            t('social:requestPendingMessage')
          );
          setActionStatus("idle");
        }
      } else {
        // Not on Mingla — create pending invite + share
        if (user) {
          await createPendingInvite(user.id, debouncedPhoneE164);
          queryClient.invalidateQueries({ queryKey: phoneInviteKeys.all });
        }
        // Share in its own try/catch — dismissal is not an error
        try {
          await Share.share({
            message: t('social:shareInviteMessage'),
          });
        } catch {
          // User dismissed share sheet — not an error
        }
        setActionStatus("sent");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => {
          setPhoneNumber("");
          setActionStatus("idle");
        }, 2000);
      }
    } catch (err) {
      console.error("[AddFriendView] Action error:", err);
      setActionError(
        err instanceof Error ? err.message : t('social:somethingWentWrong')
      );
      setActionStatus("error");
    }
  }, [
    isPhoneValid,
    debouncedPhoneE164,
    phoneLookupResult,
    onAddFriend,
    user,
    currentUserId,
    queryClient,
    onRequestSent,
  ]);

  // True when phone input has changed but debounced lookup hasn't fired yet
  const isDebouncing = isPhoneValid && phoneE164 !== debouncedPhoneE164;

  const getActionLabel = (): string => {
    if (phoneLookupLoading || isDebouncing) return t('social:lookingUp');
    if (!isPhoneValid) return t('social:enterPhoneNumber');
    if (phoneLookupResult?.found) {
      if (phoneLookupResult.friendship_status === "friends")
        return t('social:alreadyFriends');
      if (phoneLookupResult.friendship_status === "none") return t('social:sendRequest');
      return t('social:requestPending');
    }
    return t('social:inviteToMingla');
  };

  const isActionDisabled =
    !isPhoneValid ||
    phoneLookupLoading ||
    isDebouncing ||
    actionStatus === "sending" ||
    actionStatus === "sent" ||
    (phoneLookupResult?.found &&
      phoneLookupResult.friendship_status !== "none");

  const handleCountrySelect = useCallback((code: string) => {
    const country = getCountryByCode(code);
    if (country) {
      setSelectedCountry(country);
    }
  }, []);

  const handleCancelRequest = useCallback(
    (requestId: string, displayName: string) => {
      Alert.alert(
        t('social:cancelRequest'),
        t('social:cancelRequestConfirm', { name: displayName }),
        [
          { text: t('social:keep'), style: "cancel" },
          {
            text: t('social:cancelRequestButton'),
            style: "destructive",
            onPress: async () => {
              try {
                await onCancelRequest(requestId);
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success
                );
              } catch {
                Alert.alert(
                  t('social:error'),
                  t('social:errorCancelRequest')
                );
              }
            },
          },
        ]
      );
    },
    [onCancelRequest]
  );

  const handleCancelInvite = useCallback(
    (inviteId: string, phone: string) => {
      Alert.alert(t('social:cancelInvite'), t('social:cancelInviteConfirm', { phone }), [
        { text: t('social:keep'), style: "cancel" },
        {
          text: t('social:cancelInviteButton'),
          style: "destructive",
          onPress: async () => {
            try {
              await cancelPendingInvite(inviteId);
              queryClient.invalidateQueries({ queryKey: phoneInviteKeys.all });
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
              );
            } catch {
              Alert.alert(
                t('social:error'),
                t('social:errorCancelInvite')
              );
            }
          },
        },
      ]);
    },
    [queryClient]
  );

  const getDisplayName = (request: FriendRequest): string => {
    if (!request.sender) return "Unknown";
    return getDisplayNameUtil(request.sender);
  };

  const getInitials = (name: string): string => {
    if (!name || name === "Unknown") return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  const formatTimeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const renderSentItem = ({ item }: { item: SentItem }) => {
    if (item.kind === "request") {
      const request = item.data;
      const displayName = getDisplayName(request);
      return (
        <View style={styles.sentRow}>
          <View style={styles.sentAvatar}>
            <Text style={styles.sentAvatarText}>
              {getInitials(displayName)}
            </Text>
          </View>
          <View style={styles.sentInfo}>
            <Text style={styles.sentName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.sentTime}>
              {formatTimeAgo(request.created_at)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => handleCancelRequest(request.id, displayName)}
            style={styles.cancelButton}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelText}>{t('social:cancel')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Phone invite
    const invite = item.data;
    return (
      <View style={styles.sentRow}>
        <View style={styles.inviteAvatar}>
          <Icon name="call-outline" size={16} color="#ffffff" />
        </View>
        <View style={styles.sentInfo}>
          <Text style={styles.sentName} numberOfLines={1}>
            {invite.phoneE164}
          </Text>
          <Text style={styles.sentTime}>
            {t('social:invited', { time: formatTimeAgo(invite.createdAt) })}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => handleCancelInvite(invite.id, invite.phoneE164)}
          style={styles.cancelButton}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelText}>{t('social:cancel')}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Add Friend — glassmorphism card (ORCH-0435) */}
      <View style={styles.glassCard}>
          {/* Compact single-line phone input */}
          <View style={styles.phoneRow}>
            <TouchableOpacity
              style={styles.countryPicker}
              onPress={() => setShowCountryPicker(true)}
              activeOpacity={0.6}
            >
              <Text style={styles.countryPickerFlag}>
                {selectedCountry.flag}
              </Text>
              <Text style={styles.countryPickerDial}>
                {selectedCountry.dialCode}
              </Text>
              <Icon name="chevron-down" size={14} color="#9ca3af" />
            </TouchableOpacity>

            <View style={styles.phoneDivider} />

            <TextInput
              style={styles.phoneInput}
              value={phoneNumber}
              onChangeText={(text) => {
                setPhoneNumber(text);
                if (
                  actionStatus !== "idle" &&
                  actionStatus !== "sending"
                ) {
                  setActionStatus("idle");
                  setActionError("");
                }
              }}
              placeholder={t('social:phoneNumber')}
              placeholderTextColor="#9ca3af"
              keyboardType="phone-pad"
              autoCorrect={false}
              maxLength={15}
            />

            {phoneLookupLoading && (
              <ActivityIndicator
                size="small"
                color="#eb7825"
                style={styles.spinner}
              />
            )}
          </View>

          {/* Lookup result */}
          {isPhoneValid && !phoneLookupLoading && phoneLookupResult && (
            <View style={styles.lookupResult}>
              {phoneLookupResult.found ? (
                <View style={styles.lookupRow}>
                  <Icon
                    name="checkmark-circle"
                    size={s(14)}
                    color="#22c55e"
                  />
                  <Text style={styles.lookupTextGreen}>
                    {t('social:isOnMingla', { name: getDisplayNameUtil(phoneLookupResult.user, "User") })}
                  </Text>
                </View>
              ) : (
                <View style={styles.lookupRow}>
                  <Icon
                    name="person-add-outline"
                    size={s(14)}
                    color="#6b7280"
                  />
                  <Text style={styles.lookupTextMuted}>
                    {t('social:notOnMinglaYet')}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Status */}
          {actionStatus === "sent" && (
            <View style={styles.statusRow}>
              <Icon
                name="checkmark-circle"
                size={s(16)}
                color="#22c55e"
              />
              <Text style={styles.statusSuccess}>
                {phoneLookupResult?.found ? t('social:requestSent') : t('social:inviteSent')}
              </Text>
            </View>
          )}
          {actionStatus === "error" && (
            <View style={styles.statusRow}>
              <Icon name="alert-circle" size={s(16)} color="#ef4444" />
              <Text style={styles.statusError}>{actionError}</Text>
            </View>
          )}

          {/* Action button */}
          <TouchableOpacity
            style={[
              styles.actionButton,
              isActionDisabled && styles.actionButtonDisabled,
            ]}
            onPress={handlePhoneAction}
            activeOpacity={0.7}
            disabled={!!isActionDisabled}
          >
            {actionStatus === "sending" ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <>
                <Icon
                  name={
                    phoneLookupResult?.found
                      ? "person-add"
                      : "paper-plane-outline"
                  }
                  size={s(14)}
                  color="#ffffff"
                  style={styles.actionButtonIcon}
                />
                <Text style={styles.actionButtonText}>
                  {getActionLabel()}
                </Text>
              </>
            )}
          </TouchableOpacity>
      </View>

      {/* Country picker modal */}
      <CountryPickerModal
        visible={showCountryPicker}
        selectedCode={selectedCountry.code}
        onSelect={handleCountrySelect}
        onClose={() => setShowCountryPicker(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: s(16),
    paddingVertical: vs(8),
  },
  glassCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.70)',
    borderWidth: 1,
    borderTopWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: 24,
    padding: 16,
    shadowColor: 'rgba(0, 0, 0, 0.08)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 6,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#e5e7eb",
    borderRadius: s(8),
    padding: 3,
    marginBottom: vs(12),
  },
  tab: {
    flex: 1,
    paddingVertical: vs(7),
    alignItems: "center",
    borderRadius: s(6),
  },
  tabActive: {
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: s(13),
    fontWeight: "600",
    color: "#6b7280",
  },
  tabTextActive: {
    color: "#111827",
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: s(10),
    height: 46,
    overflow: "hidden",
  },
  countryPicker: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: s(10),
    paddingRight: s(6),
    height: "100%",
  },
  countryPickerFlag: {
    fontSize: 16,
    marginRight: 3,
  },
  countryPickerDial: {
    fontSize: s(13),
    fontWeight: "600",
    color: "#374151",
    marginRight: 3,
  },
  phoneDivider: {
    width: 1,
    height: 22,
    backgroundColor: "#d1d5db",
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: s(10),
    fontSize: s(15),
    color: "#111827",
    height: "100%",
  },
  spinner: {
    marginRight: s(10),
  },
  lookupResult: {
    marginTop: vs(6),
  },
  lookupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  lookupTextGreen: {
    fontSize: s(12),
    color: "#16a34a",
    fontWeight: "500",
  },
  lookupTextMuted: {
    fontSize: s(12),
    color: "#6b7280",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: vs(6),
  },
  statusSuccess: {
    fontSize: s(13),
    color: "#16a34a",
    fontWeight: "500",
  },
  statusError: {
    fontSize: s(13),
    color: "#dc2626",
  },
  actionButton: {
    flexDirection: "row",
    backgroundColor: "#eb7825",
    borderRadius: s(8),
    paddingVertical: vs(10),
    alignItems: "center",
    justifyContent: "center",
    marginTop: vs(10),
  },
  actionButtonDisabled: {
    opacity: 0.45,
  },
  actionButtonIcon: {
    marginRight: 5,
  },
  actionButtonText: {
    color: "#ffffff",
    fontSize: s(14),
    fontWeight: "600",
  },
  sentLoadingState: {
    paddingVertical: 24,
    alignItems: "center",
  },
  sentEmptyState: {
    paddingVertical: 24,
    alignItems: "center",
  },
  sentEmptyText: {
    fontSize: s(14),
    color: "#6b7280",
    marginTop: 8,
  },
  sentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  sentAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f59e0b",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  inviteAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#8b5cf6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  sentAvatarText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  sentInfo: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  sentName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  sentTime: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 1,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  cancelText: {
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "600",
  },
});
