import { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Share,
  Alert,
} from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  COUNTRIES,
  getDefaultCountryCode,
  getCountryByCode,
} from "../constants/countries";
import { CountryData } from "../types/onboarding";
import { useSendFriendLink } from "../hooks/useFriendLinks";
import { usePhoneLookup, useDebouncedValue } from "../hooks/usePhoneLookup";
import { createPendingInvite } from "../services/phoneLookupService";
import { useFriends, Friend } from "../hooks/useFriends";
import { useAppStore } from "../store/appStore";
import { generateInitials } from "../utils/stringUtils";
import { s } from "../utils/responsive";

interface LinkFriendSheetProps {
  visible: boolean;
  onClose: () => void;
  onLinkSent: (linkId: string) => void;
}

export default function LinkFriendSheet({
  visible,
  onClose,
  onLinkSent,
}: LinkFriendSheetProps) {
  const insets = useSafeAreaInsets();
  const sendLinkMutation = useSendFriendLink();
  const { friends, fetchFriends } = useFriends();
  const { user } = useAppStore();

  // Phone input state
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<CountryData>(
    () => getCountryByCode(getDefaultCountryCode()) ?? COUNTRIES[0]
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [actionStatus, setActionStatus] = useState<
    "idle" | "sending" | "sent" | "already_invited" | "error"
  >("idle");
  const [actionError, setActionError] = useState("");

  // Friend link state — tracks per-friend status
  const [linkingFriendId, setLinkingFriendId] = useState<string | null>(null);
  const [linkedFriendIds, setLinkedFriendIds] = useState<Set<string>>(
    new Set()
  );

  // Build E.164 phone
  const phoneRawDigits = phoneNumber.replace(/\D/g, "");
  const phoneE164 = useMemo(() => {
    if (!phoneRawDigits) return "";
    return `${selectedCountry.dialCode}${phoneRawDigits}`;
  }, [phoneRawDigits, selectedCountry]);

  const debouncedPhoneE164 = useDebouncedValue(phoneE164, 500);
  const debouncedDigitCount = useDebouncedValue(phoneRawDigits.length, 500);

  const {
    data: phoneLookupResult,
    isLoading: phoneLookupLoading,
  } = usePhoneLookup(debouncedPhoneE164, debouncedDigitCount >= 7);

  const isPhoneValid = useMemo(() => {
    return phoneRawDigits.length >= 7 && phoneRawDigits.length <= 15;
  }, [phoneRawDigits]);

  // Fetch friends when sheet opens
  useEffect(() => {
    if (visible) {
      fetchFriends().catch(console.error);
      // Reset link states when sheet opens
      setLinkingFriendId(null);
      setLinkedFriendIds(new Set());
    }
  }, [visible, fetchFriends]);

  const resetState = useCallback(() => {
    setPhoneNumber("");
    setActionStatus("idle");
    setActionError("");
    setShowCountryPicker(false);
    setCountrySearch("");
    setLinkingFriendId(null);
    setLinkedFriendIds(new Set());
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // Handle the phone action button
  const handlePhoneAction = useCallback(async () => {
    if (!isPhoneValid || !debouncedPhoneE164) return;

    setActionStatus("sending");
    setActionError("");

    try {
      if (phoneLookupResult?.found && phoneLookupResult.user) {
        // User exists on Mingla
        if (phoneLookupResult.friendship_status === "none") {
          // Not friends — send link request
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const result = await sendLinkMutation.mutateAsync({
            targetUserId: phoneLookupResult.user.id,
          });
          setActionStatus("sent");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setTimeout(() => {
            onLinkSent(result.linkId);
            handleClose();
          }, 2000);
        } else if (phoneLookupResult.friendship_status === "friends") {
          Alert.alert("Already Friends", "You're already connected with this person.");
          setActionStatus("idle");
        } else {
          // pending_sent or pending_received
          Alert.alert("Request Pending", "A friend request is already pending with this person.");
          setActionStatus("idle");
        }
      } else {
        // User not on Mingla — save invite + open native share
        if (user) {
          await createPendingInvite(user.id, debouncedPhoneE164);
        }

        const inviteLink = "https://usemingla.com";
        await Share.share({
          message: `Hey! Join me on Mingla and let's find amazing experiences together. ${inviteLink}`,
        });

        setActionStatus("sent");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => {
          handleClose();
        }, 2000);
      }
    } catch (err) {
      console.error("[LinkFriendSheet] Action error:", err);
      setActionError(
        err instanceof Error ? err.message : "Something went wrong"
      );
      setActionStatus("error");
    }
  }, [
    isPhoneValid,
    debouncedPhoneE164,
    phoneLookupResult,
    sendLinkMutation,
    user,
    onLinkSent,
    handleClose,
  ]);

  // Handle tapping a friend to send them a link request
  const handleFriendLink = useCallback(
    async (friend: Friend) => {
      const friendUserId = friend.friend_user_id;

      // Already linking or already linked
      if (linkingFriendId || linkedFriendIds.has(friendUserId)) return;

      setLinkingFriendId(friendUserId);

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const result = await sendLinkMutation.mutateAsync({
          targetUserId: friendUserId,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setLinkedFriendIds((prev) => new Set(prev).add(friendUserId));
        setLinkingFriendId(null);

        // Brief delay then close
        setTimeout(() => {
          onLinkSent(result.linkId);
          handleClose();
        }, 1500);
      } catch (err) {
        console.error("[LinkFriendSheet] Friend link error:", err);
        setLinkingFriendId(null);
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        // If already linked/pending, mark as linked visually
        if (
          message.toLowerCase().includes("already") ||
          message.toLowerCase().includes("pending") ||
          message.toLowerCase().includes("active")
        ) {
          setLinkedFriendIds((prev) => new Set(prev).add(friendUserId));
          Alert.alert(
            "Already Linked",
            "A link request is already pending or active with this person."
          );
        } else {
          Alert.alert("Error", message);
        }
      }
    },
    [linkingFriendId, linkedFriendIds, sendLinkMutation, onLinkSent, handleClose]
  );

  // Get action button label
  const getActionLabel = (): string => {
    if (phoneLookupLoading) return "Looking up...";
    if (!isPhoneValid) return "Enter phone number";
    if (phoneLookupResult?.found) {
      if (phoneLookupResult.friendship_status === "friends") return "Already friends";
      if (phoneLookupResult.friendship_status === "none") return "Send friend request";
      return "Request pending";
    }
    return "Invite to Mingla";
  };

  const isActionDisabled =
    !isPhoneValid ||
    phoneLookupLoading ||
    actionStatus === "sending" ||
    actionStatus === "sent" ||
    (phoneLookupResult?.found && phoneLookupResult.friendship_status !== "none");

  // Country picker filtering
  const filteredCountries = useMemo(() => {
    if (!countrySearch.trim()) return COUNTRIES;
    const q = countrySearch.toLowerCase();
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [countrySearch]);

  // Friend list helpers
  const getFriendDisplayName = (friend: Friend): string => {
    return (
      friend.display_name ||
      (friend.first_name && friend.last_name
        ? `${friend.first_name} ${friend.last_name}`
        : friend.username) ||
      "Unknown"
    );
  };

  const getFriendInitials = (friend: Friend): string => {
    const name = getFriendDisplayName(friend);
    return generateInitials(name);
  };

  // Render friend row — now tappable with link status
  const renderFriendRow = useCallback(
    ({ item }: { item: Friend }) => {
      const displayName = getFriendDisplayName(item);
      const friendUserId = item.friend_user_id;
      const isLinking = linkingFriendId === friendUserId;
      const isLinked = linkedFriendIds.has(friendUserId);
      const isDisabled = isLinking || !!linkingFriendId;

      return (
        <TouchableOpacity
          style={[styles.friendRow, isLinked && styles.friendRowLinked]}
          onPress={() => handleFriendLink(item)}
          activeOpacity={0.6}
          disabled={isDisabled || isLinked}
        >
          {item.avatar_url ? (
            <Image
              source={{ uri: item.avatar_url }}
              style={styles.friendAvatar}
            />
          ) : (
            <View style={styles.friendAvatarFallback}>
              <Text style={styles.friendAvatarInitials}>
                {getFriendInitials(item)}
              </Text>
            </View>
          )}
          <View style={styles.friendInfo}>
            <Text style={styles.friendName} numberOfLines={1}>
              {displayName}
            </Text>
          </View>

          {/* Link status indicator */}
          {isLinking ? (
            <ActivityIndicator size="small" color="#eb7825" />
          ) : isLinked ? (
            <View style={styles.linkedBadge}>
              <Ionicons name="checkmark-circle" size={s(18)} color="#22c55e" />
              <Text style={styles.linkedBadgeText}>Sent</Text>
            </View>
          ) : (
            <View style={styles.linkButton}>
              <Ionicons name="link-outline" size={s(16)} color="#eb7825" />
              <Text style={styles.linkButtonText}>Link</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [linkingFriendId, linkedFriendIds, handleFriendLink]
  );

  // Header component for the FlatList — contains phone section
  const renderListHeader = useCallback(
    () => (
      <>
        {/* Phone input section */}
        <View style={styles.phoneSection}>
          <Text style={styles.phoneSectionLabel}>
            Invite by phone number
          </Text>

          {/* Compact single-line: country picker + phone input */}
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
                if (actionStatus !== "idle" && actionStatus !== "sending") {
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
                style={styles.phoneLookupSpinner}
              />
            )}
          </View>

          {/* Lookup result indicator */}
          {isPhoneValid && !phoneLookupLoading && phoneLookupResult && (
            <View style={styles.lookupResult}>
              {phoneLookupResult.found ? (
                <View style={styles.lookupResultRow}>
                  <Ionicons
                    name="checkmark-circle"
                    size={s(16)}
                    color="#22c55e"
                  />
                  <Text style={styles.lookupResultText}>
                    {phoneLookupResult.user?.display_name ||
                      phoneLookupResult.user?.username ||
                      "User"}{" "}
                    is on Mingla
                  </Text>
                </View>
              ) : (
                <View style={styles.lookupResultRow}>
                  <Ionicons
                    name="person-add-outline"
                    size={s(16)}
                    color="#6b7280"
                  />
                  <Text style={styles.lookupResultTextMuted}>
                    Not on Mingla yet — invite them
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Status messages */}
          {actionStatus === "sent" && (
            <View style={styles.statusBox}>
              <Ionicons
                name="checkmark-circle"
                size={s(18)}
                color="#22c55e"
              />
              <Text style={styles.statusTextSuccess}>
                {phoneLookupResult?.found
                  ? "Friend request sent!"
                  : "Invite sent! They'll be linked when they join."}
              </Text>
            </View>
          )}

          {actionStatus === "error" && (
            <View style={styles.statusBox}>
              <Ionicons name="alert-circle" size={s(18)} color="#ef4444" />
              <Text style={styles.statusTextError}>{actionError}</Text>
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
                  size={s(16)}
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

        {/* Friends list section label */}
        <View style={styles.friendsSection}>
          <Text style={styles.friendsSectionLabel}>
            Your Friends ({friends.length})
          </Text>
          {friends.length > 0 && (
            <Text style={styles.friendsSectionHint}>
              Tap to send a link request
            </Text>
          )}
        </View>
      </>
    ),
    [
      selectedCountry,
      phoneNumber,
      phoneLookupLoading,
      isPhoneValid,
      phoneLookupResult,
      actionStatus,
      actionError,
      isActionDisabled,
      handlePhoneAction,
      friends.length,
    ]
  );

  // Empty state for friends list
  const renderListEmpty = useCallback(
    () => (
      <View style={styles.emptyFriends}>
        <Ionicons
          name="people-outline"
          size={s(40)}
          color="#d1d5db"
        />
        <Text style={styles.emptyFriendsText}>
          No friends yet. Invite someone above!
        </Text>
      </View>
    ),
    []
  );

  // Country picker modal
  const renderCountryPicker = () => (
    <Modal
      visible={showCountryPicker}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setShowCountryPicker(false)}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setShowCountryPicker(false)}
        />
        <View style={styles.sheetOuter}>
          <BlurView
            intensity={60}
            tint="light"
            style={[
              styles.sheetContent,
              styles.sheetContentTall,
              { paddingBottom: Math.max(insets.bottom, 16) + 16 },
            ]}
          >
            <View style={styles.glassOverlay}>
              <View style={styles.handleContainer}>
                <View style={styles.handle} />
              </View>
              <View style={styles.countryPickerHeader}>
                <Text style={styles.headerTitle}>Select Country</Text>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setShowCountryPicker(false)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={s(18)} color="#6b7280" />
                </TouchableOpacity>
              </View>
              <View style={styles.countrySearchContainer}>
                <Ionicons
                  name="search-outline"
                  size={s(18)}
                  color="#9ca3af"
                  style={styles.countrySearchIcon}
                />
                <TextInput
                  style={styles.countrySearchInput}
                  value={countrySearch}
                  onChangeText={setCountrySearch}
                  placeholder="Search countries"
                  placeholderTextColor="#9ca3af"
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <FlatList
                data={filteredCountries}
                keyExtractor={(item) => item.code}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.countryRow,
                      item.code === selectedCountry.code &&
                        styles.countryRowSelected,
                    ]}
                    onPress={() => {
                      setSelectedCountry(item);
                      setShowCountryPicker(false);
                      setCountrySearch("");
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.countryFlag}>{item.flag}</Text>
                    <Text style={styles.countryName}>{item.name}</Text>
                    <Text style={styles.countryDial}>{item.dialCode}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </BlurView>
        </View>
      </View>
    </Modal>
  );

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View style={styles.sheetOuter}>
          <BlurView
            intensity={60}
            tint="light"
            style={[
              styles.sheetContent,
              styles.sheetContentTall,
              { paddingBottom: Math.max(insets.bottom, 16) + 16 },
            ]}
          >
            <View style={styles.glassOverlay}>
              <View style={styles.handleContainer}>
                <View style={styles.handle} />
              </View>

              {/* Header */}
              <View style={styles.header}>
                <View style={styles.headerPlaceholder} />
                <View style={styles.headerCenter}>
                  <Text style={styles.headerTitle}>Add Friend</Text>
                </View>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={handleClose}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={s(18)} color="#6b7280" />
                </TouchableOpacity>
              </View>

              {/* Single scrollable list: phone section as header, friends as items */}
              <FlatList
                data={friends}
                keyExtractor={(item) => item.id}
                renderItem={renderFriendRow}
                ListHeaderComponent={renderListHeader}
                ListEmptyComponent={renderListEmpty}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.friendsList}
                keyboardShouldPersistTaps="handled"
                style={styles.listContainer}
              />
            </View>
          </BlurView>
        </View>
      </KeyboardAvoidingView>

      {/* Country picker modal */}
      {renderCountryPicker()}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetOuter: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    maxHeight: "90%",
  },
  sheetContent: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    width: "100%",
    maxHeight: "100%",
  },
  sheetContentTall: {
    minHeight: "60%",
  },
  glassOverlay: {
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    paddingHorizontal: 20,
    paddingTop: 12,
    flex: 1,
  },
  handleContainer: {
    alignItems: "center",
    marginBottom: 14,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(0, 0, 0, 0.12)",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingTop: 2,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0, 0, 0, 0.08)",
  },
  headerPlaceholder: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1a1a1a",
    letterSpacing: -0.3,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0, 0, 0, 0.06)",
    justifyContent: "center",
    alignItems: "center",
  },

  // Scrollable list container
  listContainer: {
    flex: 1,
  },

  // Phone section
  phoneSection: {
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0, 0, 0, 0.06)",
  },
  phoneSectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4b5563",
    marginBottom: 10,
    letterSpacing: 0.1,
    textTransform: "uppercase",
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.65)",
    borderRadius: 14,
    height: 50,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.8)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  countryPicker: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    paddingRight: 10,
    height: "100%",
  },
  countryPickerFlag: {
    fontSize: 18,
    marginRight: 5,
  },
  countryPickerDial: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginRight: 4,
  },
  phoneDivider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: "rgba(0, 0, 0, 0.12)",
  },
  phoneInput: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
    paddingHorizontal: 12,
    height: "100%",
  },
  phoneLookupSpinner: {
    marginRight: 14,
  },

  // Lookup result
  lookupResult: {
    marginTop: 10,
  },
  lookupResultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  lookupResultText: {
    fontSize: 13,
    color: "#16a34a",
    fontWeight: "500",
  },
  lookupResultTextMuted: {
    fontSize: 13,
    color: "#6b7280",
  },

  // Status
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.55)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginTop: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.7)",
  },
  statusTextSuccess: {
    flex: 1,
    fontSize: 13,
    color: "#16a34a",
    lineHeight: 18,
  },
  statusTextError: {
    flex: 1,
    fontSize: 13,
    color: "#dc2626",
    lineHeight: 18,
  },

  // Action button
  actionButton: {
    flexDirection: "row",
    backgroundColor: "#eb7825",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  actionButtonDisabled: {
    opacity: 0.4,
    shadowOpacity: 0,
    elevation: 0,
  },
  actionButtonIcon: {
    marginRight: 6,
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "white",
    letterSpacing: 0.1,
  },

  // Friends section
  friendsSection: {
    paddingTop: 18,
    paddingBottom: 8,
  },
  friendsSectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4b5563",
    letterSpacing: 0.1,
    textTransform: "uppercase",
  },
  friendsSectionHint: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 4,
  },
  friendsList: {
    paddingBottom: 20,
  },
  emptyFriends: {
    paddingVertical: 40,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  emptyFriendsText: {
    fontSize: 14,
    color: "#9ca3af",
    textAlign: "center",
  },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 4,
    marginHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0, 0, 0, 0.05)",
    borderRadius: 10,
  },
  friendRowLinked: {
    backgroundColor: "rgba(34, 197, 94, 0.06)",
  },
  friendAvatar: {
    width: s(40),
    height: s(40),
    borderRadius: s(20),
    marginRight: s(12),
  },
  friendAvatarFallback: {
    width: s(40),
    height: s(40),
    borderRadius: s(20),
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    marginRight: s(12),
  },
  friendAvatarInitials: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#ffffff",
  },
  friendInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: s(15),
    fontWeight: "600",
    color: "#111827",
  },
  friendUsername: {
    fontSize: s(13),
    color: "#9ca3af",
    marginTop: 1,
  },

  // Link button on friend row
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(235, 120, 37, 0.1)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  linkButtonText: {
    fontSize: s(13),
    fontWeight: "600",
    color: "#eb7825",
  },

  // Linked badge on friend row
  linkedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  linkedBadgeText: {
    fontSize: s(13),
    fontWeight: "500",
    color: "#22c55e",
  },

  // Country picker modal
  countryPickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 16,
  },
  countrySearchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.6)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.8)",
  },
  countrySearchIcon: {
    marginRight: 10,
  },
  countrySearchInput: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
    padding: 0,
  },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0, 0, 0, 0.05)",
  },
  countryRowSelected: {
    backgroundColor: "rgba(235, 120, 37, 0.08)",
  },
  countryFlag: {
    fontSize: 20,
    marginRight: 12,
  },
  countryName: {
    flex: 1,
    fontSize: 15,
    color: "#111827",
  },
  countryDial: {
    fontSize: 14,
    color: "#6b7280",
  },
});
