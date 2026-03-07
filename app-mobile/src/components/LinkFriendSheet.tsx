import React, { useState, useCallback, useMemo, useEffect } from "react";
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
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  COUNTRIES,
  getDefaultCountryCode,
  getCountryByCode,
} from "../constants/countries";
import { CountryData } from "../types/onboarding";
import { UserSearchResult } from "../types/friendLink";
import { useUserSearch, useSendFriendLink } from "../hooks/useFriendLinks";
import { useSendPhoneInvite } from "../hooks/usePhoneInvite";
import { generateInitials } from "../utils/stringUtils";
import { s } from "../utils/responsive";

type TabMode = "search" | "invite";

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
  const sendInviteMutation = useSendPhoneInvite();

  const [activeTab, setActiveTab] = useState<TabMode>("search");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(
    null
  );
  const [linkSent, setLinkSent] = useState(false);

  // Phone invite state
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<CountryData>(
    () => getCountryByCode(getDefaultCountryCode()) ?? COUNTRIES[0]
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "sending" | "sent" | "already_invited" | "error"
  >("idle");
  const [inviteError, setInviteError] = useState("");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: searchResults, isLoading: isSearching } =
    useUserSearch(debouncedQuery);

  const resetState = useCallback(() => {
    setActiveTab("search");
    setSearchQuery("");
    setDebouncedQuery("");
    setSelectedUser(null);
    setLinkSent(false);
    setPhoneNumber("");
    setInviteStatus("idle");
    setInviteError("");
    setShowCountryPicker(false);
    setCountrySearch("");
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // ── Search tab handlers ──

  const handleSelectUser = useCallback((user: UserSearchResult) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedUser(user);
  }, []);

  const handleCancelSelection = useCallback(() => {
    setSelectedUser(null);
  }, []);

  const handleSendLink = useCallback(async () => {
    if (!selectedUser) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await sendLinkMutation.mutateAsync({
        targetUserId: selectedUser.id,
      });
      setLinkSent(true);
      setTimeout(() => {
        onLinkSent(result.linkId);
        handleClose();
      }, 2000);
    } catch (err) {
      console.error("[LinkFriendSheet] Send link error:", err);
    }
  }, [selectedUser, sendLinkMutation, onLinkSent, handleClose]);

  const getUserInitials = useCallback((user: UserSearchResult): string => {
    if (user.display_name) return generateInitials(user.display_name);
    if (user.username) return user.username.substring(0, 2).toUpperCase();
    return "??";
  }, []);

  // ── Phone invite handlers ──

  const fullPhoneE164 = useMemo(() => {
    const digits = phoneNumber.replace(/\D/g, "");
    if (!digits) return "";
    return `${selectedCountry.dialCode}${digits}`;
  }, [phoneNumber, selectedCountry]);

  const isPhoneValid = useMemo(() => {
    const digits = phoneNumber.replace(/\D/g, "");
    return digits.length >= 4 && digits.length <= 15;
  }, [phoneNumber]);

  const handleSendInvite = useCallback(async () => {
    if (!isPhoneValid || !fullPhoneE164) return;
    setInviteStatus("sending");
    setInviteError("");
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await sendInviteMutation.mutateAsync(fullPhoneE164);
      if (result.status === "already_invited") {
        setInviteStatus("already_invited");
      } else {
        setInviteStatus("sent");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => {
          handleClose();
        }, 2500);
      }
    } catch (err) {
      console.error("[LinkFriendSheet] Send invite error:", err);
      setInviteError(
        err instanceof Error ? err.message : "Failed to send invite"
      );
      setInviteStatus("error");
    }
  }, [isPhoneValid, fullPhoneE164, sendInviteMutation, handleClose]);

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

  // ── Render helpers ──

  const renderSearchResult = useCallback(
    ({ item }: { item: UserSearchResult }) => (
      <TouchableOpacity
        style={styles.resultRow}
        onPress={() => handleSelectUser(item)}
        activeOpacity={0.7}
      >
        {item.avatar_url ? (
          <Image
            source={{ uri: item.avatar_url }}
            style={styles.resultAvatar}
          />
        ) : (
          <View style={styles.resultAvatarFallback}>
            <Text style={styles.resultAvatarInitials}>
              {getUserInitials(item)}
            </Text>
          </View>
        )}
        <View style={styles.resultInfo}>
          <Text style={styles.resultName}>
            {item.display_name || "Unknown"}
          </Text>
          {item.username && (
            <Text style={styles.resultUsername}>@{item.username}</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={s(18)} color="#9ca3af" />
      </TouchableOpacity>
    ),
    [handleSelectUser, getUserInitials]
  );

  // ── Country picker modal ──

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
        <View
          style={[
            styles.sheetContent,
            styles.sheetContentTall,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}
        >
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>
          <View style={styles.countryPickerHeader}>
            <Text style={styles.headerTitle}>Select Country</Text>
            <TouchableOpacity
              onPress={() => setShowCountryPicker(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={s(22)} color="#374151" />
            </TouchableOpacity>
          </View>
          <View style={styles.searchContainer}>
            <Ionicons
              name="search-outline"
              size={s(18)}
              color="#9ca3af"
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
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
      </View>
    </Modal>
  );

  // ── Link sent success ──

  if (linkSent) {
    return (
      <Modal
        visible={visible}
        transparent={true}
        animationType="slide"
        onRequestClose={handleClose}
      >
        <View style={styles.overlay}>
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={handleClose}
          />
          <View
            style={[
              styles.sheetContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 16 },
            ]}
          >
            <View style={styles.successContainer}>
              <View style={styles.successIcon}>
                <Ionicons
                  name="checkmark-circle"
                  size={s(64)}
                  color="#22c55e"
                />
              </View>
              <Text style={styles.successTitle}>Link request sent!</Text>
              <Text style={styles.successSubtitle}>
                {selectedUser?.display_name || "User"} will receive your
                request.
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Search: confirm selection ──

  if (selectedUser) {
    return (
      <Modal
        visible={visible}
        transparent={true}
        animationType="slide"
        onRequestClose={handleClose}
      >
        <View style={styles.overlay}>
          <TouchableOpacity
            style={styles.backdrop}
            activeOpacity={1}
            onPress={handleClose}
          />
          <View
            style={[
              styles.sheetContent,
              { paddingBottom: Math.max(insets.bottom, 16) + 16 },
            ]}
          >
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
            <View style={styles.confirmContainer}>
              {selectedUser.avatar_url ? (
                <Image
                  source={{ uri: selectedUser.avatar_url }}
                  style={styles.confirmAvatar}
                />
              ) : (
                <View style={styles.confirmAvatarFallback}>
                  <Text style={styles.confirmAvatarInitials}>
                    {getUserInitials(selectedUser)}
                  </Text>
                </View>
              )}
              <Text style={styles.confirmTitle}>
                Send link request to{" "}
                <Text style={styles.confirmName}>
                  {selectedUser.display_name ||
                    selectedUser.username ||
                    "this user"}
                </Text>
                ?
              </Text>
              <Text style={styles.confirmDescription}>
                Once accepted, their card activity will be used to personalize
                your recommendations for them.
              </Text>
              {sendLinkMutation.isError && (
                <Text style={styles.errorText}>
                  {(sendLinkMutation.error as Error)?.message ||
                    "Failed to send request"}
                </Text>
              )}
              <View style={styles.confirmButtons}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={handleCancelSelection}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    sendLinkMutation.isPending && styles.buttonDisabled,
                  ]}
                  onPress={handleSendLink}
                  activeOpacity={0.7}
                  disabled={sendLinkMutation.isPending}
                >
                  {sendLinkMutation.isPending ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.sendButtonText}>Send</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Main sheet with tabs ──

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
        <View
          style={[
            styles.sheetContent,
            styles.sheetContentTall,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}
        >
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerPlaceholder} />
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Link a Friend</Text>
            </View>
            <TouchableOpacity
              style={styles.headerPlaceholder}
              onPress={handleClose}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={s(22)} color="#374151" />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tab, activeTab === "search" && styles.tabActive]}
              onPress={() => {
                setActiveTab("search");
                setInviteStatus("idle");
                setInviteError("");
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name="search"
                size={s(16)}
                color={activeTab === "search" ? "#eb7825" : "#9ca3af"}
                style={styles.tabIcon}
              />
              <Text
                style={[
                  styles.tabText,
                  activeTab === "search" && styles.tabTextActive,
                ]}
              >
                Search Mingla
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === "invite" && styles.tabActive]}
              onPress={() => {
                setActiveTab("invite");
                setInviteStatus("idle");
                setInviteError("");
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name="phone-portrait-outline"
                size={s(16)}
                color={activeTab === "invite" ? "#eb7825" : "#9ca3af"}
                style={styles.tabIcon}
              />
              <Text
                style={[
                  styles.tabText,
                  activeTab === "invite" && styles.tabTextActive,
                ]}
              >
                Invite by Phone
              </Text>
            </TouchableOpacity>
          </View>

          {/* Tab content */}
          {activeTab === "search" ? (
            <>
              {/* Search input */}
              <View style={styles.searchContainer}>
                <Ionicons
                  name="search-outline"
                  size={s(18)}
                  color="#9ca3af"
                  style={styles.searchIcon}
                />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search by username or phone"
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setSearchQuery("")}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name="close-circle"
                      size={s(18)}
                      color="#9ca3af"
                    />
                  </TouchableOpacity>
                )}
              </View>

              {/* Results */}
              {isSearching ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color="#eb7825" />
                  <Text style={styles.searchingText}>Searching...</Text>
                </View>
              ) : debouncedQuery.length < 2 ? (
                <View style={styles.centerContainer}>
                  <Ionicons
                    name="people-outline"
                    size={s(48)}
                    color="#9ca3af"
                  />
                  <Text style={styles.emptyText}>
                    Type at least 2 characters to search
                  </Text>
                </View>
              ) : searchResults && searchResults.length > 0 ? (
                <FlatList
                  data={searchResults}
                  keyExtractor={(item) => item.id}
                  renderItem={renderSearchResult}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.resultsList}
                  keyboardShouldPersistTaps="handled"
                />
              ) : (
                <View style={styles.centerContainer}>
                  <Ionicons
                    name="search-outline"
                    size={s(48)}
                    color="#9ca3af"
                  />
                  <Text style={styles.emptyText}>No users found</Text>
                  <Text style={styles.emptySubtext}>
                    Try a different search term
                  </Text>
                </View>
              )}
            </>
          ) : (
            <ScrollView
              style={styles.inviteScrollView}
              contentContainerStyle={styles.inviteContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.inviteDescription}>
                Invite someone to Mingla via SMS. When they sign up, you'll be
                linked automatically.
              </Text>

              {/* Country picker */}
              <TouchableOpacity
                style={styles.countrySelector}
                onPress={() => setShowCountryPicker(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.countrySelectorFlag}>
                  {selectedCountry.flag}
                </Text>
                <Text style={styles.countrySelectorName}>
                  {selectedCountry.name}
                </Text>
                <Text style={styles.countrySelectorDial}>
                  {selectedCountry.dialCode}
                </Text>
                <Ionicons name="chevron-down" size={s(16)} color="#9ca3af" />
              </TouchableOpacity>

              {/* Phone input */}
              <View style={styles.phoneInputContainer}>
                <View style={styles.phonePrefix}>
                  <Text style={styles.phonePrefixText}>
                    {selectedCountry.dialCode}
                  </Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  value={phoneNumber}
                  onChangeText={(text) => {
                    setPhoneNumber(text);
                    if (inviteStatus !== "idle" && inviteStatus !== "sending") {
                      setInviteStatus("idle");
                      setInviteError("");
                    }
                  }}
                  placeholder="Phone number"
                  placeholderTextColor="#9ca3af"
                  keyboardType="phone-pad"
                  autoCorrect={false}
                />
              </View>

              {/* Status messages */}
              {inviteStatus === "sent" && (
                <View style={styles.statusBox}>
                  <Ionicons
                    name="checkmark-circle"
                    size={s(20)}
                    color="#22c55e"
                  />
                  <Text style={styles.statusTextSuccess}>
                    Invite sent! They will be linked when they join.
                  </Text>
                </View>
              )}

              {inviteStatus === "already_invited" && (
                <View style={styles.statusBox}>
                  <Ionicons
                    name="information-circle"
                    size={s(20)}
                    color="#3b82f6"
                  />
                  <Text style={styles.statusTextInfo}>
                    Already invited. They will be linked when they join.
                  </Text>
                </View>
              )}

              {inviteStatus === "error" && (
                <View style={styles.statusBox}>
                  <Ionicons
                    name="alert-circle"
                    size={s(20)}
                    color="#ef4444"
                  />
                  <Text style={styles.statusTextError}>{inviteError}</Text>
                </View>
              )}

              {/* Send button */}
              <TouchableOpacity
                style={[
                  styles.sendInviteButton,
                  (!isPhoneValid ||
                    inviteStatus === "sending" ||
                    inviteStatus === "sent" ||
                    inviteStatus === "already_invited") &&
                    styles.buttonDisabled,
                ]}
                onPress={handleSendInvite}
                activeOpacity={0.7}
                disabled={
                  !isPhoneValid ||
                  inviteStatus === "sending" ||
                  inviteStatus === "sent" ||
                  inviteStatus === "already_invited"
                }
              >
                {inviteStatus === "sending" ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Ionicons
                      name="paper-plane-outline"
                      size={s(18)}
                      color="#ffffff"
                      style={styles.sendInviteIcon}
                    />
                    <Text style={styles.sendInviteButtonText}>Send Invite</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          )}
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
  sheetContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    width: "100%",
    maxHeight: "90%",
  },
  sheetContentTall: {
    minHeight: "60%",
  },
  handleContainer: {
    alignItems: "center",
    marginBottom: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    marginBottom: 0,
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
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
  },
  // Tabs
  tabContainer: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: "#eb7825",
  },
  tabIcon: {
    marginRight: 6,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#9ca3af",
  },
  tabTextActive: {
    color: "#eb7825",
  },
  // Search
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
    padding: 0,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 40,
    gap: 12,
  },
  searchingText: {
    fontSize: 14,
    color: "#9ca3af",
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#6b7280",
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 13,
    color: "#9ca3af",
    textAlign: "center",
  },
  resultsList: {
    paddingBottom: 20,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  resultAvatar: {
    width: s(44),
    height: s(44),
    borderRadius: s(22),
    marginRight: s(12),
  },
  resultAvatarFallback: {
    width: s(44),
    height: s(44),
    borderRadius: s(22),
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    marginRight: s(12),
  },
  resultAvatarInitials: {
    fontSize: s(16),
    fontWeight: "600",
    color: "#ffffff",
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: s(15),
    fontWeight: "600",
    color: "#111827",
  },
  resultUsername: {
    fontSize: s(13),
    color: "#9ca3af",
    marginTop: 2,
  },
  // Confirm
  confirmContainer: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  confirmAvatar: {
    width: s(72),
    height: s(72),
    borderRadius: s(36),
    marginBottom: s(16),
  },
  confirmAvatarFallback: {
    width: s(72),
    height: s(72),
    borderRadius: s(36),
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: s(16),
  },
  confirmAvatarInitials: {
    fontSize: s(24),
    fontWeight: "700",
    color: "#ffffff",
  },
  confirmTitle: {
    fontSize: s(18),
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
    marginBottom: s(8),
  },
  confirmName: {
    color: "#eb7825",
  },
  confirmDescription: {
    fontSize: s(14),
    color: "#6b7280",
    textAlign: "center",
    lineHeight: s(20),
    marginBottom: s(24),
  },
  errorText: {
    fontSize: 12,
    color: "#ef4444",
    marginBottom: 12,
    textAlign: "center",
  },
  confirmButtons: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },
  sendButton: {
    flex: 1,
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Success
  successContainer: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 16,
  },
  successIcon: {
    marginBottom: s(16),
  },
  successTitle: {
    fontSize: s(20),
    fontWeight: "700",
    color: "#22c55e",
    marginBottom: s(8),
  },
  successSubtitle: {
    fontSize: s(14),
    color: "#6b7280",
    textAlign: "center",
  },
  // Phone invite tab
  inviteScrollView: {
    flexShrink: 1,
  },
  inviteContent: {
    paddingBottom: 20,
  },
  inviteDescription: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20,
    marginBottom: 20,
    textAlign: "center",
  },
  countrySelector: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  countrySelectorFlag: {
    fontSize: 20,
    marginRight: 10,
  },
  countrySelectorName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: "#111827",
  },
  countrySelectorDial: {
    fontSize: 15,
    color: "#6b7280",
    marginRight: 8,
  },
  phoneInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    marginBottom: 20,
    overflow: "hidden",
  },
  phonePrefix: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#e5e7eb",
    borderRightWidth: 1,
    borderRightColor: "#d1d5db",
  },
  phonePrefixText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },
  phoneInput: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    gap: 10,
  },
  statusTextSuccess: {
    flex: 1,
    fontSize: 14,
    color: "#16a34a",
    lineHeight: 20,
  },
  statusTextInfo: {
    flex: 1,
    fontSize: 14,
    color: "#2563eb",
    lineHeight: 20,
  },
  statusTextError: {
    flex: 1,
    fontSize: 14,
    color: "#dc2626",
    lineHeight: 20,
  },
  sendInviteButton: {
    flexDirection: "row",
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  sendInviteIcon: {
    marginRight: 8,
  },
  sendInviteButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  // Country picker
  countryPickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 16,
  },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  countryRowSelected: {
    backgroundColor: "#fff7ed",
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
