import { useState, useMemo, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Share,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  COUNTRIES,
  getDefaultCountryCode,
  getCountryByCode,
} from "../../constants/countries";
import { CountryData } from "../../types/onboarding";
import { useSendFriendLink } from "../../hooks/useFriendLinks";
import { usePhoneLookup, useDebouncedValue } from "../../hooks/usePhoneLookup";
import { createPendingInvite } from "../../services/phoneLookupService";
import { useAppStore } from "../../store/appStore";
import { s, vs } from "../../utils/responsive";
import { useCoachMarkActions } from "../education/CoachMarkProvider";

interface AddFriendViewProps {
  currentUserId: string;
  existingFriendIds: string[];
  onRequestSent: () => void;
}

export function AddFriendView({
  currentUserId,
  existingFriendIds,
  onRequestSent,
}: AddFriendViewProps) {
  const sendLinkMutation = useSendFriendLink();
  const { user } = useAppStore();
  const { fireAction } = useCoachMarkActions();

  // Phone input state
  const [phoneNumber, setPhoneNumber] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<CountryData>(
    () => getCountryByCode(getDefaultCountryCode()) ?? COUNTRIES[0]
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
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

  const {
    data: phoneLookupResult,
    isLoading: phoneLookupLoading,
  } = usePhoneLookup(debouncedPhoneE164, debouncedDigitCount >= 7);

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
          await sendLinkMutation.mutateAsync({
            targetUserId: phoneLookupResult.user.id,
          });
          setActionStatus("sent");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          fireAction('friend_request_sent');
          onRequestSent();
          setTimeout(() => {
            setPhoneNumber("");
            setActionStatus("idle");
          }, 2000);
        } else if (phoneLookupResult.friendship_status === "friends") {
          Alert.alert("Already Friends", "You're already connected with this person.");
          setActionStatus("idle");
        } else {
          Alert.alert("Request Pending", "A friend request is already pending with this person.");
          setActionStatus("idle");
        }
      } else {
        if (user) {
          await createPendingInvite(user.id, debouncedPhoneE164);
        }
        await Share.share({
          message: `Hey! Join me on Mingla and let's find amazing experiences together. https://usemingla.com`,
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
      setActionError(err instanceof Error ? err.message : "Something went wrong");
      setActionStatus("error");
    }
  }, [isPhoneValid, debouncedPhoneE164, phoneLookupResult, sendLinkMutation, user, onRequestSent]);

  const getActionLabel = (): string => {
    if (phoneLookupLoading) return "Looking up...";
    if (!isPhoneValid) return "Enter phone number";
    if (phoneLookupResult?.found) {
      if (phoneLookupResult.friendship_status === "friends") return "Already friends";
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
    (phoneLookupResult?.found && phoneLookupResult.friendship_status !== "none");

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

  return (
    <View style={styles.container}>
      {/* Compact single-line phone input */}
      <View style={styles.phoneRow}>
        <TouchableOpacity
          style={styles.countryPicker}
          onPress={() => setShowCountryPicker(true)}
          activeOpacity={0.6}
        >
          <Text style={styles.countryPickerFlag}>{selectedCountry.flag}</Text>
          <Text style={styles.countryPickerDial}>{selectedCountry.dialCode}</Text>
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
          <ActivityIndicator size="small" color="#eb7825" style={styles.spinner} />
        )}
      </View>

      {/* Lookup result */}
      {isPhoneValid && !phoneLookupLoading && phoneLookupResult && (
        <View style={styles.lookupResult}>
          {phoneLookupResult.found ? (
            <View style={styles.lookupRow}>
              <Ionicons name="checkmark-circle" size={s(14)} color="#22c55e" />
              <Text style={styles.lookupTextGreen}>
                {phoneLookupResult.user?.display_name ||
                  phoneLookupResult.user?.username ||
                  "User"}{" "}
                is on Mingla
              </Text>
            </View>
          ) : (
            <View style={styles.lookupRow}>
              <Ionicons name="person-add-outline" size={s(14)} color="#6b7280" />
              <Text style={styles.lookupTextMuted}>Not on Mingla yet</Text>
            </View>
          )}
        </View>
      )}

      {/* Status */}
      {actionStatus === "sent" && (
        <View style={styles.statusRow}>
          <Ionicons name="checkmark-circle" size={s(16)} color="#22c55e" />
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
        style={[styles.actionButton, isActionDisabled && styles.actionButtonDisabled]}
        onPress={handlePhoneAction}
        activeOpacity={0.7}
        disabled={!!isActionDisabled}
      >
        {actionStatus === "sending" ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <>
            <Ionicons
              name={phoneLookupResult?.found ? "person-add" : "paper-plane-outline"}
              size={s(14)}
              color="#ffffff"
              style={styles.actionButtonIcon}
            />
            <Text style={styles.actionButtonText}>{getActionLabel()}</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Country picker modal */}
      <Modal
        visible={showCountryPicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <View style={styles.pickerOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setShowCountryPicker(false)}
          />
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Country</Text>
              <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
                <Ionicons name="close" size={22} color="#374151" />
              </TouchableOpacity>
            </View>
            <View style={styles.pickerSearchRow}>
              <Ionicons name="search-outline" size={18} color="#9ca3af" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.pickerSearchInput}
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
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.countryRow,
                    item.code === selectedCountry.code && styles.countryRowSelected,
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
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    maxHeight: "75%",
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
  },
  pickerSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  pickerSearchInput: {
    flex: 1,
    fontSize: 15,
    color: "#111827",
    padding: 0,
  },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  countryRowSelected: {
    backgroundColor: "#fff7ed",
  },
  countryFlag: {
    fontSize: 18,
    marginRight: 10,
  },
  countryName: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
  },
  countryDial: {
    fontSize: 13,
    color: "#6b7280",
  },
});
