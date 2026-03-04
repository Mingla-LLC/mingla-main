import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { GenderOption, GENDER_OPTIONS } from "../types/holidayTypes";
import { PersonAudioClip } from "../types/personAudio";
import { SavedPerson } from "../services/savedPeopleService";
import { useUpdatePerson, useDeletePerson } from "../hooks/useSavedPeople";
import { usePersonAudioClips } from "../hooks/usePersonAudio";
import { useUnlinkFriend } from "../hooks/useFriendLinks";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { generateInitials } from "../utils/stringUtils";
import { s } from "../utils/responsive";
import AudioDescriptionManager from "./AudioDescriptionManager";

interface PersonEditSheetProps {
  visible: boolean;
  person: SavedPerson;
  onClose: () => void;
  onUpdated: () => void;
  onUnlinked: () => void;
}

function formatBirthdayDisplay(dateStr: string | null): string {
  if (!dateStr) return "Not set";
  const date = new Date(dateStr);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function getGenderLabel(value: GenderOption | string | null): string {
  if (!value) return "Not set";
  const option = GENDER_OPTIONS.find((o) => o.value === value);
  return option?.label ?? value;
}

export default function PersonEditSheet({
  visible,
  person,
  onClose,
  onUpdated,
  onUnlinked,
}: PersonEditSheetProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthSimple();
  const updatePersonMutation = useUpdatePerson();
  const deletePersonMutation = useDeletePerson();
  const unlinkFriendMutation = useUnlinkFriend();

  const [name, setName] = useState(person.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [birthday, setBirthday] = useState<Date | null>(
    person.birthday ? new Date(person.birthday) : null
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [gender, setGender] = useState<GenderOption | null>(person.gender);
  const [audioClips, setAudioClips] = useState<PersonAudioClip[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch audio clips for standard persons
  const { data: fetchedClips } = usePersonAudioClips(
    person.is_linked ? "" : person.id
  );

  useEffect(() => {
    if (fetchedClips) {
      setAudioClips(fetchedClips);
    }
  }, [fetchedClips]);

  // Reset state when person changes
  useEffect(() => {
    setName(person.name);
    setBirthday(person.birthday ? new Date(person.birthday) : null);
    setGender(person.gender);
    setNameError(null);
    setError(null);
  }, [person]);

  const handleBirthdayChange = useCallback(
    (_event: any, selectedDate?: Date) => {
      if (Platform.OS === "android") {
        setShowDatePicker(false);
      }
      if (selectedDate) {
        setBirthday(selectedDate);
      }
    },
    []
  );

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Name is required");
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      const updates: Record<string, any> = {};

      if (trimmed !== person.name) {
        updates.name = trimmed;
        updates.initials = generateInitials(trimmed);
      }

      const birthdayStr = birthday ? birthday.toISOString().split("T")[0] : null;
      if (birthdayStr !== person.birthday) {
        updates.birthday = birthdayStr;
      }

      if (gender !== person.gender) {
        updates.gender = gender;
      }

      if (Object.keys(updates).length > 0) {
        await updatePersonMutation.mutateAsync({
          personId: person.id,
          updates,
        });
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onUpdated();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  }, [name, birthday, gender, person, updatePersonMutation, onUpdated, onClose]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      "Delete Person",
      `Are you sure you want to remove ${person.name}? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await deletePersonMutation.mutateAsync({
                personId: person.id,
                linkId: undefined,
              });
              onClose();
            } catch (err: any) {
              Alert.alert("Error", err.message || "Failed to delete person");
            }
          },
        },
      ]
    );
  }, [person, deletePersonMutation, onClose]);

  const handleUnlink = useCallback(() => {
    Alert.alert(
      "Unlink Person",
      `This will remove ${person.name} from both your and their For You tabs. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
          style: "destructive",
          onPress: async () => {
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (person.link_id) {
                await unlinkFriendMutation.mutateAsync(person.link_id);
              }
              onUnlinked();
              onClose();
            } catch (err: any) {
              Alert.alert("Error", err.message || "Failed to unlink person");
            }
          },
        },
      ]
    );
  }, [person, unlinkFriendMutation, onUnlinked, onClose]);

  const renderLinkedView = () => (
    <View style={styles.linkedContainer}>
      {/* Read-only profile card */}
      <View style={styles.profileCard}>
        <View style={styles.profileAvatarContainer}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>{person.initials}</Text>
          </View>
          <View style={styles.linkedBadge}>
            <Ionicons name="link" size={s(12)} color="#ffffff" />
          </View>
        </View>

        <Text style={styles.profileName}>{person.name}</Text>

        <View style={styles.profileDetails}>
          <View style={styles.profileDetailRow}>
            <Ionicons name="calendar-outline" size={s(16)} color="#9ca3af" />
            <Text style={styles.profileDetailText}>
              {formatBirthdayDisplay(person.birthday)}
            </Text>
          </View>
          <View style={styles.profileDetailRow}>
            <Ionicons name="person-outline" size={s(16)} color="#9ca3af" />
            <Text style={styles.profileDetailText}>
              {getGenderLabel(person.gender)}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.linkedHint}>
        This person is linked to a Mingla account. Their profile syncs automatically.
      </Text>

      {/* Unlink button */}
      <TouchableOpacity
        style={styles.unlinkButton}
        onPress={handleUnlink}
        activeOpacity={0.7}
        disabled={unlinkFriendMutation.isPending}
      >
        {unlinkFriendMutation.isPending ? (
          <ActivityIndicator size="small" color="#ef4444" />
        ) : (
          <>
            <Ionicons name="link-outline" size={s(18)} color="#ef4444" />
            <Text style={styles.unlinkButtonText}>Unlink Person</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderStandardView = () => (
    <View>
      {/* Name field */}
      <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          style={[styles.textInput, nameError && styles.textInputError]}
          value={name}
          onChangeText={(text) => {
            setName(text);
            if (nameError) setNameError(null);
          }}
          placeholder="Enter their name"
          placeholderTextColor="#9ca3af"
        />
        {nameError && <Text style={styles.errorText}>{nameError}</Text>}
      </View>

      {/* Birthday field */}
      <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>Birthday</Text>
        <TouchableOpacity
          style={styles.birthdayInput}
          onPress={() => setShowDatePicker(true)}
          activeOpacity={0.7}
        >
          {birthday ? (
            <Text style={styles.birthdayText}>
              {formatBirthdayDisplay(birthday.toISOString())}
            </Text>
          ) : (
            <Text style={styles.birthdayPlaceholder}>Select birthday</Text>
          )}
          <Ionicons name="calendar-outline" size={s(20)} color="#6b7280" />
        </TouchableOpacity>
        {showDatePicker &&
          (Platform.OS === "ios" ? (
            <View style={styles.datePickerContainer}>
              <DateTimePicker
                value={birthday || new Date()}
                mode="date"
                display="spinner"
                onChange={handleBirthdayChange}
                maximumDate={new Date()}
              />
              <TouchableOpacity
                style={styles.datePickerDone}
                onPress={() => setShowDatePicker(false)}
              >
                <Text style={styles.datePickerDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <DateTimePicker
              value={birthday || new Date()}
              mode="date"
              display="default"
              onChange={handleBirthdayChange}
              maximumDate={new Date()}
            />
          ))}
      </View>

      {/* Gender selection */}
      <View style={styles.fieldContainer}>
        <Text style={styles.fieldLabel}>Gender</Text>
        <View style={styles.genderGrid}>
          {GENDER_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.genderOption,
                gender === option.value && styles.genderOptionSelected,
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setGender(option.value);
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.genderOptionText,
                  gender === option.value && styles.genderOptionTextSelected,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Audio descriptions */}
      <AudioDescriptionManager
        personId={person.id}
        userId={user?.id || ""}
        clips={audioClips}
        onClipsChange={setAudioClips}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Save button */}
      <TouchableOpacity
        style={[styles.saveButton, isSaving && styles.buttonDisabled]}
        onPress={handleSave}
        activeOpacity={0.7}
        disabled={isSaving}
      >
        {isSaving ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <Text style={styles.saveButtonText}>Save Changes</Text>
        )}
      </TouchableOpacity>

      {/* Delete button */}
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={handleDelete}
        activeOpacity={0.7}
        disabled={deletePersonMutation.isPending}
      >
        {deletePersonMutation.isPending ? (
          <ActivityIndicator size="small" color="#ef4444" />
        ) : (
          <Text style={styles.deleteButtonText}>Delete Person</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
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

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerPlaceholder} />
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>
                {person.is_linked ? "Linked Person" : "Edit Person"}
              </Text>
              <Text style={styles.headerSubtitle}>{person.name}</Text>
            </View>
            <TouchableOpacity
              style={styles.headerPlaceholder}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={s(22)} color="#374151" />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
            contentContainerStyle={styles.scrollContentContainer}
          >
            {person.is_linked ? renderLinkedView() : renderStandardView()}
          </ScrollView>
        </View>
      </View>
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
    marginBottom: 16,
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
  headerSubtitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginTop: 2,
  },
  scrollContentContainer: {
    paddingBottom: 24,
  },
  // Linked person view
  linkedContainer: {
    alignItems: "center",
  },
  profileCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 20,
    padding: s(24),
    alignItems: "center",
    width: "100%",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: s(16),
  },
  profileAvatarContainer: {
    position: "relative",
    marginBottom: s(12),
  },
  profileAvatar: {
    width: s(72),
    height: s(72),
    borderRadius: s(36),
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
  },
  profileAvatarText: {
    fontSize: s(24),
    fontWeight: "700",
    color: "#ffffff",
  },
  linkedBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: s(24),
    height: s(24),
    borderRadius: s(12),
    backgroundColor: "#22c55e",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  profileName: {
    fontSize: s(20),
    fontWeight: "700",
    color: "#111827",
    marginBottom: s(12),
  },
  profileDetails: {
    gap: s(8),
    width: "100%",
  },
  profileDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(8),
  },
  profileDetailText: {
    fontSize: s(14),
    color: "#6b7280",
  },
  linkedHint: {
    fontSize: s(13),
    color: "#9ca3af",
    textAlign: "center",
    lineHeight: s(18),
    marginBottom: s(24),
    paddingHorizontal: s(16),
  },
  unlinkButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(8),
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    width: "100%",
  },
  unlinkButtonText: {
    fontSize: s(15),
    fontWeight: "600",
    color: "#ef4444",
  },
  // Standard person view
  fieldContainer: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#eb7825",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: "#111827",
  },
  textInputError: {
    borderColor: "#ef4444",
  },
  errorText: {
    fontSize: 12,
    color: "#ef4444",
    marginTop: 4,
    marginBottom: 8,
  },
  birthdayInput: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  birthdayText: {
    fontSize: 16,
    color: "#111827",
  },
  birthdayPlaceholder: {
    fontSize: 16,
    color: "#9ca3af",
  },
  datePickerContainer: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    marginTop: 8,
    overflow: "hidden",
  },
  datePickerDone: {
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  datePickerDoneText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#eb7825",
  },
  genderGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  genderOption: {
    width: "48%",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  genderOptionSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  genderOptionText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
  },
  genderOptionTextSelected: {
    color: "white",
  },
  saveButton: {
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 12,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  deleteButton: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ef4444",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
