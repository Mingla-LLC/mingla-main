import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  Platform,
  StyleSheet,
  Alert,
} from "react-native";
import { KeyboardAwareScrollView } from "./ui/KeyboardAwareScrollView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { GENDER_OPTIONS, GenderOption } from "../types/holidayTypes";
import { PersonAudioClip } from "../types/personAudio";
import { useCreatePerson } from "../hooks/useSavedPeople";
import { useUploadAudioClip } from "../hooks/usePersonAudio";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { generateInitials } from "../utils/stringUtils";
import { s } from "../utils/responsive";
import AudioDescriptionManager from "./AudioDescriptionManager";

interface AddPersonModalProps {
  visible: boolean;
  onClose: () => void;
  onPersonCreated: (personId: string) => void;
  onStartLinkFlow: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

function formatBirthdayDisplay(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getGenderLabel(value: GenderOption): string {
  const option = GENDER_OPTIONS.find((o) => o.value === value);
  return option?.label ?? value;
}

export default function AddPersonModal({
  visible,
  onClose,
  onPersonCreated,
  onStartLinkFlow,
}: AddPersonModalProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthSimple();
  const createPersonMutation = useCreatePerson();
  const uploadClipMutation = useUploadAudioClip();

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [birthday, setBirthday] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [gender, setGender] = useState<GenderOption | null>(null);
  const [audioClips, setAudioClips] = useState<PersonAudioClip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetState = useCallback(() => {
    setStep(1);
    setName("");
    setNameError(null);
    setBirthday(null);
    setShowDatePicker(false);
    setGender(null);
    setAudioClips([]);
    setError(null);
    setIsSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleLinkFlow = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handleClose();
    onStartLinkFlow();
  }, [handleClose, onStartLinkFlow]);

  const handleNextStep = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (step === 2) {
      const trimmed = name.trim();
      if (!trimmed) {
        setNameError("Name is required");
        return;
      }
      setNameError(null);
    }

    if (step === 3 && !birthday) {
      return;
    }

    if (step === 4 && !gender) {
      return;
    }

    setStep((prev) => Math.min(prev + 1, 6) as Step);
  }, [step, name, birthday, gender]);

  const handlePrevStep = useCallback(() => {
    if (step > 1) {
      setStep((prev) => (prev - 1) as Step);
    }
  }, [step]);

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

  const handleSubmit = useCallback(async () => {
    if (!user?.id || !name.trim() || !birthday || !gender) return;

    try {
      setIsSubmitting(true);
      setError(null);

      const newPerson = await createPersonMutation.mutateAsync({
        user_id: user.id,
        name: name.trim(),
        initials: generateInitials(name.trim()),
        birthday: birthday.toISOString().split("T")[0],
        gender,
        description: null,
      });

      // Upload audio clips
      for (let i = 0; i < audioClips.length; i++) {
        const clip = audioClips[i];
        if (clip.localUri) {
          try {
            await uploadClipMutation.mutateAsync({
              userId: user.id,
              personId: newPerson.id,
              localUri: clip.localUri,
              fileName: clip.fileName,
              durationSeconds: clip.durationSeconds,
              sortOrder: i,
            });
          } catch (uploadErr) {
            console.error("[AddPersonModal] Clip upload error:", uploadErr);
          }
        }
      }

      onPersonCreated(newPerson.id);
      handleClose();
    } catch (err: any) {
      setError(err.message || "Failed to add person");
    } finally {
      setIsSubmitting(false);
    }
  }, [user, name, birthday, gender, audioClips, createPersonMutation, uploadClipMutation, onPersonCreated, handleClose]);

  const renderStepContent = () => {
    switch (step) {
      case 1:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Would you like to link a friend?</Text>
            <Text style={styles.stepDescription}>
              Link with a Mingla user to get personalized recommendations based on their activity, or add someone manually.
            </Text>

            <TouchableOpacity
              style={styles.choiceCard}
              onPress={handleLinkFlow}
              activeOpacity={0.7}
            >
              <View style={styles.choiceIconContainer}>
                <Ionicons name="link-outline" size={s(32)} color="#eb7825" />
              </View>
              <Text style={styles.choiceTitle}>Link a Friend</Text>
              <Text style={styles.choiceSubtitle}>
                Search for a Mingla user and send a link request
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.choiceCardSecondary}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setStep(2);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.choiceIconContainerSecondary}>
                <Ionicons name="person-add-outline" size={s(32)} color="#9ca3af" />
              </View>
              <Text style={styles.choiceTitle}>Add Manually</Text>
              <Text style={styles.choiceSubtitle}>
                Enter their details and describe them for recommendations
              </Text>
            </TouchableOpacity>
          </View>
        );

      case 2:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>What is their name?</Text>
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
                autoFocus
              />
              {nameError && <Text style={styles.errorText}>{nameError}</Text>}
            </View>
          </View>
        );

      case 3:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>When is their birthday?</Text>
            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Birthday</Text>
              <TouchableOpacity
                style={styles.birthdayInput}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.7}
              >
                {birthday ? (
                  <Text style={styles.birthdayText}>
                    {formatBirthdayDisplay(birthday)}
                  </Text>
                ) : (
                  <Text style={styles.birthdayPlaceholder}>dd/mm/yyyy</Text>
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
          </View>
        );

      case 4:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>What is their gender?</Text>
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
        );

      case 5:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Describe them with voice</Text>
            <Text style={styles.stepDescription}>
              Record voice notes about what they enjoy. This helps us find better recommendations.
            </Text>
            <AudioDescriptionManager
              personId=""
              userId={user?.id || ""}
              clips={audioClips}
              onClipsChange={setAudioClips}
            />
          </View>
        );

      case 6:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Confirm Details</Text>

            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Name</Text>
                <Text style={styles.summaryValue}>{name.trim()}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Birthday</Text>
                <Text style={styles.summaryValue}>
                  {birthday ? formatBirthdayDisplay(birthday) : "—"}
                </Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Gender</Text>
                <Text style={styles.summaryValue}>
                  {gender ? getGenderLabel(gender) : "—"}
                </Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Recordings</Text>
                <Text style={styles.summaryValue}>{audioClips.length}</Text>
              </View>
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}
          </View>
        );

      default:
        return null;
    }
  };

  const canProceed = () => {
    switch (step) {
      case 2:
        return name.trim().length > 0;
      case 3:
        return birthday !== null;
      case 4:
        return gender !== null;
      case 5:
        return true;
      case 6:
        return true;
      default:
        return true;
    }
  };

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

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerPlaceholder}>
              {step > 1 && (
                <TouchableOpacity
                  onPress={handlePrevStep}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="arrow-back" size={s(22)} color="#374151" />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Add Person</Text>
              {step > 1 && (
                <Text style={styles.headerSubtitle}>Step {step - 1} of 5</Text>
              )}
            </View>
            <View style={styles.headerPlaceholder}>
              <TouchableOpacity
                onPress={handleClose}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={s(22)} color="#374151" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Step content */}
          <KeyboardAwareScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            style={styles.scrollContent}
          >
            {renderStepContent()}
          </KeyboardAwareScrollView>

          {/* Bottom buttons */}
          {step > 1 && (
            <View style={styles.buttonsContainer}>
              {step < 6 ? (
                <TouchableOpacity
                  style={[
                    styles.nextButton,
                    !canProceed() && styles.buttonDisabled,
                  ]}
                  onPress={handleNextStep}
                  activeOpacity={0.7}
                  disabled={!canProceed()}
                >
                  <Text style={styles.nextButtonText}>
                    {step === 5 ? "Review" : "Next"}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    isSubmitting && styles.buttonDisabled,
                  ]}
                  onPress={handleSubmit}
                  activeOpacity={0.7}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.submitButtonText}>Add Person</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
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
  scrollContent: {
    flexShrink: 1,
  },
  stepContainer: {
    paddingBottom: 24,
  },
  stepTitle: {
    fontSize: s(20),
    fontWeight: "700",
    color: "#111827",
    marginBottom: s(8),
  },
  stepDescription: {
    fontSize: s(14),
    color: "#6b7280",
    lineHeight: s(20),
    marginBottom: s(20),
  },
  // Step 1 — Choice cards
  choiceCard: {
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#eb7825",
    borderRadius: s(16),
    padding: s(20),
    marginBottom: s(16),
    alignItems: "center",
  },
  choiceCardSecondary: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: s(16),
    padding: s(20),
    alignItems: "center",
  },
  choiceIconContainer: {
    width: s(56),
    height: s(56),
    borderRadius: s(28),
    backgroundColor: "#fff7ed",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: s(12),
  },
  choiceIconContainerSecondary: {
    width: s(56),
    height: s(56),
    borderRadius: s(28),
    backgroundColor: "#f3f4f6",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: s(12),
  },
  choiceTitle: {
    fontSize: s(16),
    fontWeight: "600",
    color: "#111827",
    marginBottom: s(4),
  },
  choiceSubtitle: {
    fontSize: s(13),
    color: "#6b7280",
    textAlign: "center",
    lineHeight: s(18),
  },
  // Step 2 — Name
  fieldContainer: {
    marginBottom: s(20),
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
  },
  // Step 3 — Birthday
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
  // Step 4 — Gender grid (2 columns x 4 rows = 8 options)
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
  // Step 6 — Summary
  summaryCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 16,
    padding: s(16),
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: s(12),
  },
  summaryLabel: {
    fontSize: s(14),
    color: "#6b7280",
  },
  summaryValue: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#111827",
  },
  summaryDivider: {
    height: 1,
    backgroundColor: "#e5e7eb",
  },
  // Buttons
  buttonsContainer: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  nextButton: {
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  submitButton: {
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
