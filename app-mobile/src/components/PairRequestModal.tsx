/**
 * PairRequestModal — Bottom sheet for sending pair requests across all 3 tiers.
 *
 * Section 1: Friends list (Tier 1) with Pair/Paired/Pending buttons
 * Section 2: Phone number input (Tier 2 & 3) with auto-detection
 */
import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Image,
  Alert,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { KeyboardAwareScrollView } from "./ui/KeyboardAwareScrollView";
import { useFriends } from "../hooks/useFriends";
import type { Friend } from "../hooks/useFriends";
import { usePairingPills, useSendPairRequest } from "../hooks/usePairings";
import type { PairingPill } from "../services/pairingService";
import { useAuthSimple } from "../hooks/useAuthSimple";
import {
  getDefaultCountryCode,
  getCountryByCode,
} from "../constants/countries";
import type { CountryData } from "../types/onboarding";
import { CountryPickerModal } from "./onboarding/CountryPickerModal";
import { usePhoneLookup, useDebouncedValue } from "../hooks/usePhoneLookup";
import { createPendingInvite } from "../services/phoneLookupService";
import { phoneInviteKeys } from "../hooks/usePhoneInvite";
import { colors, spacing, radius, shadows } from "../constants/designSystem";
import { s } from "../utils/responsive";

const INITIALS_COLORS = [
  colors.primary[500],
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
];

interface PairRequestModalProps {
  visible: boolean;
  onClose: () => void;
  onPairRequestSent: () => void;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getInitialsColor(index: number): string {
  return INITIALS_COLORS[index % INITIALS_COLORS.length];
}

type FriendPairStatus = "available" | "paired" | "pending";

function getFriendPairStatus(
  friend: Friend,
  pairingPills: PairingPill[]
): FriendPairStatus {
  const friendUserId = friend.friend_user_id;
  const pill = pairingPills.find(
    (p) =>
      p.pairedUserId === friendUserId ||
      p.pairedUserId === friend.user_id
  );
  if (!pill) return "available";
  if (pill.pillState === "active") return "paired";
  return "pending";
}

export default function PairRequestModal({
  visible,
  onClose,
  onPairRequestSent,
}: PairRequestModalProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthSimple();
  const { friends, loading: friendsLoading } = useFriends({ autoFetchBlockedUsers: false });
  const { data: pairingPills = [] } = usePairingPills(user?.id);
  const sendPairRequest = useSendPairRequest();

  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
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
  const [sendingFriendId, setSendingFriendId] = useState<string | null>(null);
  const [sendingPhone, setSendingPhone] = useState(false);
  const [friendError, setFriendError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

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

  // Filter accepted friends
  const acceptedFriends = useMemo(() => {
    return friends.filter((f) => f.status === "accepted");
  }, [friends]);

  // Client-side search filter
  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return acceptedFriends;
    const query = searchQuery.toLowerCase();
    return acceptedFriends.filter((f) => {
      const displayName =
        f.display_name || `${f.first_name || ""} ${f.last_name || ""}`.trim() || f.username;
      return displayName.toLowerCase().includes(query);
    });
  }, [acceptedFriends, searchQuery]);

  const getFriendDisplayName = (friend: Friend): string => {
    return (
      friend.display_name ||
      `${friend.first_name || ""} ${friend.last_name || ""}`.trim() ||
      "Unknown"
    );
  };

  const handlePairFriend = useCallback(
    async (friend: Friend) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSendingFriendId(friend.friend_user_id);
      setFriendError(null);

      try {
        const result = await sendPairRequest.mutateAsync({
          friendUserId: friend.friend_user_id,
        });
        const name = getFriendDisplayName(friend);
        Alert.alert("Sent", `Pair request sent to ${name}`);
        onPairRequestSent();
      } catch (err) {
        setFriendError(
          err instanceof Error ? err.message : "Failed to send pair request"
        );
      } finally {
        setSendingFriendId(null);
      }
    },
    [sendPairRequest, onPairRequestSent]
  );

  const handlePhoneAction = useCallback(async () => {
    if (!isPhoneValid || !debouncedPhoneE164) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSendingPhone(true);
    setPhoneError(null);

    try {
      if (phoneLookupResult?.found && phoneLookupResult.user) {
        // Self-lookup guard
        if (phoneLookupResult.user.id === user?.id) {
          Alert.alert("That's you!", "You can't send a pair request to yourself.");
          setSendingPhone(false);
          return;
        }

        // Person is on Mingla — send pair request via edge function
        const result = await sendPairRequest.mutateAsync({ phoneE164: debouncedPhoneE164 });
        if (result.tier === 2) {
          Alert.alert("Sent", "Friend request + pair request sent");
        } else {
          Alert.alert("Sent", "Pair request sent");
        }
        setPhoneNumber("");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onPairRequestSent();
      } else {
        // Not on Mingla — create pending invite + open Share sheet
        if (user) {
          await createPendingInvite(user.id, debouncedPhoneE164);
          queryClient.invalidateQueries({ queryKey: phoneInviteKeys.all });
        }
        // Also fire the pair request so the edge function creates the Tier 3 invite
        await sendPairRequest.mutateAsync({ phoneE164: debouncedPhoneE164 });

        // Share in its own try/catch — dismissal is not an error
        try {
          await Share.share({
            message:
              "Hey! Join me on Mingla and let's find amazing experiences together. https://usemingla.com",
          });
        } catch {
          // User dismissed share sheet — not an error
        }

        setPhoneNumber("");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onPairRequestSent();
      }
    } catch (err) {
      setPhoneError(
        err instanceof Error ? err.message : "Failed to send pair request"
      );
    } finally {
      setSendingPhone(false);
    }
  }, [
    isPhoneValid,
    debouncedPhoneE164,
    phoneLookupResult,
    sendPairRequest,
    user,
    queryClient,
    onPairRequestSent,
  ]);

  // Check if found user already has a pending/active pairing
  const foundUserPairStatus = useMemo(() => {
    if (!phoneLookupResult?.found || !phoneLookupResult.user) return null;
    const foundId = phoneLookupResult.user.id;
    const pill = pairingPills.find((p) => p.pairedUserId === foundId);
    if (!pill) return null;
    if (pill.pillState === "active") return "paired";
    return "pending";
  }, [phoneLookupResult, pairingPills]);

  const getActionLabel = (): string => {
    if (phoneLookupLoading) return "Looking up...";
    if (!isPhoneValid) return "Enter phone number";
    if (phoneLookupResult?.found) {
      if (foundUserPairStatus === "paired") return "Already paired";
      if (foundUserPairStatus === "pending") return "Already pending";
      return "Send pair request";
    }
    return "Invite to Mingla";
  };

  const isActionDisabled =
    !isPhoneValid ||
    phoneLookupLoading ||
    sendingPhone ||
    foundUserPairStatus !== null;

  const handleCountrySelect = useCallback((code: string) => {
    const country = getCountryByCode(code);
    if (country) setSelectedCountry(country);
  }, []);

  const handleClose = useCallback(() => {
    setSearchQuery("");
    setPhoneNumber("");
    setFriendError(null);
    setPhoneError(null);
    setShowCountryPicker(false);
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}
        >
          {/* Drag Handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Pair with someone</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={20} color={colors.gray[500]} />
            </TouchableOpacity>
          </View>

          <KeyboardAwareScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Section 1: Your Friends */}
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>YOUR FRIENDS</Text>

              {/* Search filter */}
              {acceptedFriends.length > 3 && (
                <View style={styles.searchContainer}>
                  <Ionicons
                    name="search-outline"
                    size={16}
                    color={colors.gray[400]}
                  />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search friends..."
                    placeholderTextColor={colors.gray[400]}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              )}

              {friendsLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary[500]} />
                </View>
              ) : acceptedFriends.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons
                    name="people-outline"
                    size={32}
                    color={colors.gray[300]}
                  />
                  <Text style={styles.emptyText}>
                    No friends yet — head to Connections to find your people
                  </Text>
                </View>
              ) : (
                <View style={styles.friendsList}>
                  {filteredFriends.map((friend, index) => {
                    const displayName = getFriendDisplayName(friend);
                    const initials = getInitials(displayName);
                    const status = getFriendPairStatus(friend, pairingPills);
                    const isSending =
                      sendingFriendId === friend.friend_user_id;
                    const isDisabled =
                      status !== "available" ||
                      isSending ||
                      sendingFriendId !== null;

                    return (
                      <View key={friend.id} style={styles.friendRow}>
                        {/* Avatar */}
                        <View
                          style={[
                            styles.avatar,
                            {
                              backgroundColor:
                                getInitialsColor(index) + "20",
                            },
                          ]}
                        >
                          {friend.avatar_url ? (
                            <Image
                              source={{ uri: friend.avatar_url }}
                              style={styles.avatarImage}
                              onError={() => {
                                // fallback handled by initials
                              }}
                            />
                          ) : (
                            <Text
                              style={[
                                styles.avatarInitials,
                                { color: getInitialsColor(index) },
                              ]}
                            >
                              {initials}
                            </Text>
                          )}
                        </View>

                        {/* Name */}
                        <Text
                          style={styles.friendName}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {displayName}
                        </Text>

                        {/* Action Button */}
                        {status === "paired" ? (
                          <View style={styles.pairedBadge}>
                            <Text style={styles.pairedBadgeText}>
                              Paired
                            </Text>
                          </View>
                        ) : status === "pending" ? (
                          <View style={styles.pendingBadge}>
                            <Text style={styles.pendingBadgeText}>
                              Pending
                            </Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[
                              styles.pairButton,
                              isDisabled && styles.pairButtonDisabled,
                            ]}
                            onPress={() => handlePairFriend(friend)}
                            disabled={isDisabled}
                            activeOpacity={0.7}
                          >
                            {isSending ? (
                              <ActivityIndicator
                                size="small"
                                color="white"
                              />
                            ) : (
                              <Text style={styles.pairButtonText}>
                                Pair
                              </Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {friendError && (
                <Text style={styles.errorText}>{friendError}</Text>
              )}
            </View>

            {/* Section 2: Pair by Phone */}
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>PAIR BY PHONE</Text>

              <View style={styles.phoneRow}>
                {/* Country Picker */}
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
                  <Ionicons
                    name="chevron-down"
                    size={14}
                    color={colors.gray[400]}
                  />
                </TouchableOpacity>

                <View style={styles.phoneDivider} />

                {/* Phone Input */}
                <TextInput
                  style={styles.phoneInput}
                  placeholder="Phone number"
                  placeholderTextColor={colors.gray[400]}
                  value={phoneNumber}
                  onChangeText={(text) => {
                    setPhoneNumber(text);
                    setPhoneError(null);
                  }}
                  keyboardType="phone-pad"
                  autoCorrect={false}
                  maxLength={15}
                />

                {phoneLookupLoading && (
                  <ActivityIndicator
                    size="small"
                    color={colors.primary[500]}
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
                          "Someone"}{" "}
                        is on Mingla
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.lookupRow}>
                      <Ionicons
                        name="person-add-outline"
                        size={s(14)}
                        color={colors.gray[500]}
                      />
                      <Text style={styles.lookupTextMuted}>
                        Not on Mingla yet
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {phoneError && (
                <Text style={styles.errorText}>{phoneError}</Text>
              )}

              <TouchableOpacity
                style={[
                  styles.sendPhoneButton,
                  isActionDisabled && styles.sendPhoneButtonDisabled,
                ]}
                onPress={handlePhoneAction}
                disabled={isActionDisabled}
                activeOpacity={0.7}
              >
                {sendingPhone ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <View style={styles.sendPhoneButtonContent}>
                    <Ionicons
                      name={
                        phoneLookupResult?.found
                          ? "people"
                          : "paper-plane-outline"
                      }
                      size={s(14)}
                      color="white"
                    />
                    <Text style={styles.sendPhoneButtonText}>
                      {getActionLabel()}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
        </View>
      </View>

      {/* Country picker modal */}
      <CountryPickerModal
        visible={showCountryPicker}
        selectedCode={selectedCountry.code}
        onSelect={handleCountrySelect}
        onClose={() => setShowCountryPicker(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: s(24),
    borderTopRightRadius: s(24),
    maxHeight: "85%",
    ...shadows.lg,
  },
  handleContainer: {
    alignItems: "center",
    paddingTop: s(12),
    paddingBottom: s(4),
  },
  handle: {
    width: s(40),
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray[300],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: s(20),
    paddingTop: s(12),
    paddingBottom: s(16),
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  headerTitle: {
    fontSize: s(18),
    fontWeight: "700",
    color: colors.text.primary,
  },
  closeButton: {
    width: s(36),
    height: s(36),
    borderRadius: s(18),
    backgroundColor: colors.gray[100],
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingHorizontal: s(20),
    paddingTop: s(16),
    paddingBottom: s(24),
  },
  section: {
    marginBottom: s(28),
  },
  sectionHeader: {
    fontSize: s(13),
    fontWeight: "600",
    color: colors.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: s(12),
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.gray[50],
    borderRadius: s(12),
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    marginBottom: s(12),
    gap: s(8),
  },
  searchInput: {
    flex: 1,
    fontSize: s(14),
    color: colors.text.primary,
    padding: 0,
  },
  loadingContainer: {
    paddingVertical: s(24),
    alignItems: "center",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: s(24),
    gap: s(8),
  },
  emptyText: {
    fontSize: s(14),
    color: colors.text.tertiary,
    textAlign: "center",
    lineHeight: s(20),
  },
  friendsList: {
    gap: s(4),
  },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s(10),
    paddingHorizontal: s(4),
    gap: s(12),
  },
  avatar: {
    width: s(44),
    height: s(44),
    borderRadius: s(22),
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: s(22),
  },
  avatarInitials: {
    fontSize: s(15),
    fontWeight: "700",
  },
  friendName: {
    flex: 1,
    fontSize: s(15),
    fontWeight: "500",
    color: colors.text.primary,
  },
  pairButton: {
    backgroundColor: "#eb7825",
    paddingHorizontal: s(18),
    paddingVertical: s(8),
    borderRadius: s(20),
    minWidth: s(70),
    alignItems: "center",
    justifyContent: "center",
    minHeight: s(36),
  },
  pairButtonDisabled: {
    opacity: 0.5,
  },
  pairButtonText: {
    fontSize: s(14),
    fontWeight: "600",
    color: "white",
  },
  pairedBadge: {
    backgroundColor: colors.success[50],
    paddingHorizontal: s(14),
    paddingVertical: s(8),
    borderRadius: s(20),
    borderWidth: 1,
    borderColor: colors.success[200],
  },
  pairedBadgeText: {
    fontSize: s(13),
    fontWeight: "600",
    color: colors.success[600],
  },
  pendingBadge: {
    backgroundColor: colors.gray[100],
    paddingHorizontal: s(14),
    paddingVertical: s(8),
    borderRadius: s(20),
  },
  pendingBadgeText: {
    fontSize: s(13),
    fontWeight: "500",
    color: colors.gray[500],
  },
  errorText: {
    fontSize: s(12),
    color: colors.error[500],
    marginTop: s(8),
    paddingHorizontal: s(4),
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: s(12),
    height: s(48),
    overflow: "hidden",
    marginBottom: s(12),
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
    color: colors.text.primary,
    marginRight: 3,
  },
  phoneDivider: {
    width: 1,
    height: 22,
    backgroundColor: colors.gray[300],
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: s(10),
    fontSize: s(15),
    color: colors.text.primary,
    height: "100%",
  },
  spinner: {
    marginRight: s(10),
  },
  lookupResult: {
    marginTop: s(6),
    marginBottom: s(4),
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
    color: colors.gray[500],
  },
  sendPhoneButton: {
    backgroundColor: "#eb7825",
    borderRadius: s(14),
    paddingVertical: s(14),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: s(12),
    minHeight: s(48),
  },
  sendPhoneButtonDisabled: {
    opacity: 0.5,
  },
  sendPhoneButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
  },
  sendPhoneButtonText: {
    fontSize: s(15),
    fontWeight: "600",
    color: "white",
  },
});
