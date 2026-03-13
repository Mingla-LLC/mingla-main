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
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  getDefaultCountryCode,
  getCountryByCode,
} from "../../constants/countries";
import { CountryData } from "../../types/onboarding";
import { CountryPickerModal } from "../onboarding/CountryPickerModal";
import { PendingInvite } from "../../services/phoneLookupService";
import { FriendRequest } from "../../hooks/useFriends";
import { usePhoneLookup, useDebouncedValue } from "../../hooks/usePhoneLookup";
import { usePendingPhoneInvites } from "../../hooks/usePhoneInvite";
import {
  createPendingInvite,
  cancelPendingInvite,
} from "../../services/phoneLookupService";
import { useAppStore } from "../../store/appStore";
import { s, vs } from "../../utils/responsive";

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
  const { user } = useAppStore();
  const [activeTab, setActiveTab] = useState<Tab>("add");

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

    setActionStatus("sending");
    setActionError("");

    try {
      if (phoneLookupResult?.found && phoneLookupResult.user) {
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
            "Already Friends",
            "You're already connected with this person."
          );
          setActionStatus("idle");
        } else {
          Alert.alert(
            "Request Pending",
            "A friend request is already pending with this person."
          );
          setActionStatus("idle");
        }
      } else {
        // Not on Mingla — create pending invite + share
        if (user) {
          await createPendingInvite(user.id, debouncedPhoneE164);
        }
        await Share.share({
          message:
            "Hey! Join me on Mingla and let's find amazing experiences together. https://usemingla.com",
        });
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
        err instanceof Error ? err.message : "Something went wrong"
      );
      setActionStatus("error");
    }
  }, [
    isPhoneValid,
    debouncedPhoneE164,
    phoneLookupResult,
    onAddFriend,
    user,
    onRequestSent,
  ]);

  const getActionLabel = (): string => {
    if (phoneLookupLoading) return "Looking up...";
    if (!isPhoneValid) return "Enter phone number";
    if (phoneLookupResult?.found) {
      if (phoneLookupResult.friendship_status === "friends")
        return "Already friends";
      if (phoneLookupResult.friendship_status === "none") return "Send request";
      return "Request pending";
    }
    return "Invite to Mingla";
  };

  const isActionDisabled =
    !isPhoneValid ||
    phoneLookupLoading ||
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
        "Cancel Request",
        `Cancel your friend request to ${displayName}?`,
        [
          { text: "Keep", style: "cancel" },
          {
            text: "Cancel Request",
            style: "destructive",
            onPress: async () => {
              try {
                await onCancelRequest(requestId);
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success
                );
              } catch {
                Alert.alert(
                  "Error",
                  "Failed to cancel request. Please try again."
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
      Alert.alert("Cancel Invite", `Cancel your invite to ${phone}?`, [
        { text: "Keep", style: "cancel" },
        {
          text: "Cancel Invite",
          style: "destructive",
          onPress: async () => {
            try {
              await cancelPendingInvite(inviteId);
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
              );
            } catch {
              Alert.alert(
                "Error",
                "Failed to cancel invite. Please try again."
              );
            }
          },
        },
      ]);
    },
    []
  );

  const getDisplayName = (request: FriendRequest): string => {
    if (!request.sender) return "Unknown";
    return (
      request.sender.display_name ||
      (request.sender.first_name && request.sender.last_name
        ? `${request.sender.first_name} ${request.sender.last_name}`
        : request.sender.username) ||
      "Unknown"
    );
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
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Phone invite
    const invite = item.data;
    return (
      <View style={styles.sentRow}>
        <View style={styles.inviteAvatar}>
          <Ionicons name="call-outline" size={16} color="#ffffff" />
        </View>
        <View style={styles.sentInfo}>
          <Text style={styles.sentName} numberOfLines={1}>
            {invite.phoneE164}
          </Text>
          <Text style={styles.sentTime}>
            Invited {formatTimeAgo(invite.createdAt)}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => handleCancelInvite(invite.id, invite.phoneE164)}
          style={styles.cancelButton}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "add" && styles.tabActive]}
          onPress={() => setActiveTab("add")}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "add" && styles.tabTextActive,
            ]}
          >
            Add Friend
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "sent" && styles.tabActive]}
          onPress={() => setActiveTab("sent")}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "sent" && styles.tabTextActive,
            ]}
          >
            Sent{sentTabCount > 0 ? ` (${sentTabCount})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Add Friend tab */}
      {activeTab === "add" && (
        <>
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
              <Ionicons name="chevron-down" size={14} color="#9ca3af" />
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
              placeholder="Phone number"
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
                  <Ionicons
                    name="checkmark-circle"
                    size={s(14)}
                    color="#22c55e"
                  />
                  <Text style={styles.lookupTextGreen}>
                    {phoneLookupResult.user?.display_name ||
                      phoneLookupResult.user?.username ||
                      "User"}{" "}
                    is on Mingla
                  </Text>
                </View>
              ) : (
                <View style={styles.lookupRow}>
                  <Ionicons
                    name="person-add-outline"
                    size={s(14)}
                    color="#6b7280"
                  />
                  <Text style={styles.lookupTextMuted}>
                    Not on Mingla yet
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Status */}
          {actionStatus === "sent" && (
            <View style={styles.statusRow}>
              <Ionicons
                name="checkmark-circle"
                size={s(16)}
                color="#22c55e"
              />
              <Text style={styles.statusSuccess}>
                {phoneLookupResult?.found ? "Request sent!" : "Invite sent!"}
              </Text>
            </View>
          )}
          {actionStatus === "error" && (
            <View style={styles.statusRow}>
              <Ionicons name="alert-circle" size={s(16)} color="#ef4444" />
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
                <Ionicons
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
        </>
      )}

      {/* Sent Requests + Invites tab */}
      {activeTab === "sent" && (
        <>
          {sentTabLoading ? (
            <View style={styles.sentLoadingState}>
              <ActivityIndicator size="small" color="#eb7825" />
            </View>
          ) : sentItems.length === 0 ? (
            <View style={styles.sentEmptyState}>
              <Ionicons
                name="paper-plane-outline"
                size={32}
                color="#d1d5db"
              />
              <Text style={styles.sentEmptyText}>
                No pending requests or invites
              </Text>
            </View>
          ) : (
            <FlatList
              data={sentItems}
              keyExtractor={(item) =>
                item.kind === "request"
                  ? `req-${item.data.id}`
                  : `inv-${item.data.id}`
              }
              renderItem={renderSentItem}
              scrollEnabled={false}
            />
          )}
        </>
      )}

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
    paddingVertical: vs(12),
    backgroundColor: "#f9fafb",
    borderRadius: s(12),
    marginHorizontal: s(16),
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
