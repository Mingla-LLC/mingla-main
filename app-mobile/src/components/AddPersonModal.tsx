import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Platform,
  StyleSheet,
  Animated,
} from "react-native";
import { KeyboardAwareScrollView } from "./ui/KeyboardAwareScrollView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { GENDER_OPTIONS, GenderOption } from "../types/holidayTypes";
import { savedPeopleKeys } from "../hooks/useSavedPeople";
import { createSavedPerson } from "../services/savedPeopleService";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../store/appStore";
import { generateInitials } from "../utils/stringUtils";
import { s, ms, vs } from "../utils/responsive";
import {
  colors,
  spacing,
  radius,
  shadows,
  touchTargets,
} from "../constants/designSystem";

interface AddPersonModalProps {
  visible: boolean;
  onClose: () => void;
  onPersonCreated: (personId: string) => void;
}

type Step = 1 | 2 | 3 | 4 | 5;

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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function getBirthdayPhrase(birthday: Date): string {
  const now = new Date();
  const birthYear = birthday.getFullYear();
  const age = now.getFullYear() - birthYear;
  const day = birthday.getDate();
  const month = MONTH_NAMES[birthday.getMonth()];

  const isToday =
    birthday.getDate() === now.getDate() &&
    birthday.getMonth() === now.getMonth();

  if (isToday) {
    return `Turning ${age} today!`;
  }

  return `Turning ${age} on ${month} ${day}${getOrdinalSuffix(day)}`;
}

function getFormattedBirthdayPill(birthday: Date): string {
  const month = MONTH_ABBREVIATIONS[birthday.getMonth()];
  const day = birthday.getDate();
  const year = birthday.getFullYear();
  return `${month} ${day}, ${year}`;
}

export default function AddPersonModal({
  visible,
  onClose,
  onPersonCreated,
}: AddPersonModalProps) {
  const insets = useSafeAreaInsets();
  const user = useAppStore((state) => state.user);
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>(2);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [birthday, setBirthday] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [gender, setGender] = useState<GenderOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Step 5 staggered entrance animations
  const avatarAnim = useRef(new Animated.Value(0)).current;
  const nameAnim = useRef(new Animated.Value(0)).current;
  const birthdayPhraseAnim = useRef(new Animated.Value(0)).current;
  const pillsAnim = useRef(new Animated.Value(0)).current;
  const warmMsgAnim = useRef(new Animated.Value(0)).current;
  const avatarScale = useRef(new Animated.Value(0.8)).current;
  const nameTranslateY = useRef(new Animated.Value(12)).current;
  const birthdayTranslateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    if (step === 5) {
      // Reset animation values
      avatarAnim.setValue(0);
      nameAnim.setValue(0);
      birthdayPhraseAnim.setValue(0);
      pillsAnim.setValue(0);
      warmMsgAnim.setValue(0);
      avatarScale.setValue(0.8);
      nameTranslateY.setValue(12);
      birthdayTranslateY.setValue(12);

      // Avatar: scale 0.8→1.0 + fade in (spring)
      Animated.spring(avatarScale, {
        toValue: 1,
        tension: 80,
        friction: 12,
        useNativeDriver: true,
      }).start();
      Animated.timing(avatarAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();

      // Name: delay 100ms, translateY 12→0 + fade in
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(nameAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(nameTranslateY, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      }, 100);

      // Birthday phrase: delay 200ms, translateY 12→0 + fade in
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(birthdayPhraseAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(birthdayTranslateY, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      }, 200);

      // Detail pills: delay 300ms, fade in only
      setTimeout(() => {
        Animated.timing(pillsAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }).start();
      }, 300);

      // Warm message: delay 400ms, fade in only
      setTimeout(() => {
        Animated.timing(warmMsgAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }).start();
      }, 400);
    }
  }, [step, avatarAnim, nameAnim, birthdayPhraseAnim, pillsAnim, warmMsgAnim, avatarScale, nameTranslateY, birthdayTranslateY]);

  const resetState = useCallback(() => {
    setStep(2);
    setName("");
    setNameError(null);
    setBirthday(null);
    setShowDatePicker(false);
    setGender(null);
    setError(null);
    setIsSubmitting(false);
    setShowSuccess(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

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

    setStep((prev) => Math.min(prev + 1, 5) as Step);
  }, [step, name, birthday, gender]);

  const handlePrevStep = useCallback(() => {
    if (step > 2) {
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

    setIsSubmitting(true);
    setError(null);

    try {
      console.log("[AddPersonModal] Creating person…");
      const newPerson = await createSavedPerson({
        user_id: user.id,
        name: name.trim(),
        initials: generateInitials(name.trim()),
        birthday: birthday.toISOString().split("T")[0],
        gender,
        description: null,
      });
      console.log("[AddPersonModal] Person created:", newPerson.id);

      // Refresh the saved-people list so the new person shows up
      queryClient.invalidateQueries({ queryKey: savedPeopleKeys.list(user.id) });

      // Show success moment
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowSuccess(true);

      // After 1200ms, close modal and notify parent
      setTimeout(() => {
        onPersonCreated(newPerson.id);
        handleClose();
      }, 1200);
    } catch (err: any) {
      console.error("[AddPersonModal] Submit error:", err);
      setError(err.message || "Failed to add person");
      setIsSubmitting(false);
    }
  }, [user, name, birthday, gender, queryClient, onPersonCreated, handleClose]);

  const renderStepContent = () => {
    switch (step) {
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
            {/* [A] Initials Avatar */}
            <Animated.View
              style={[
                styles.confirmAvatar,
                {
                  opacity: avatarAnim,
                  transform: [{ scale: avatarScale }],
                },
              ]}
            >
              <Text style={styles.confirmAvatarText}>
                {generateInitials(name.trim())}
              </Text>
            </Animated.View>

            {/* [B] Person's Name */}
            <Animated.Text
              style={[
                styles.confirmName,
                {
                  opacity: nameAnim,
                  transform: [{ translateY: nameTranslateY }],
                },
              ]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {name.trim()}
            </Animated.Text>

            {/* [C] Birthday Phrase */}
            {birthday && (
              <Animated.Text
                style={[
                  styles.confirmBirthdayPhrase,
                  {
                    opacity: birthdayPhraseAnim,
                    transform: [{ translateY: birthdayTranslateY }],
                  },
                ]}
              >
                {getBirthdayPhrase(birthday)}
              </Animated.Text>
            )}

            {/* [D] Detail Pills */}
            <Animated.View
              style={[styles.confirmPillsRow, { opacity: pillsAnim }]}
            >
              {birthday && (
                <View style={styles.confirmPill}>
                  <Ionicons
                    name="calendar-outline"
                    size={s(14)}
                    color={colors.text.tertiary}
                  />
                  <Text style={styles.confirmPillText}>
                    {getFormattedBirthdayPill(birthday)}
                  </Text>
                </View>
              )}
              {gender && (
                <View style={styles.confirmPill}>
                  <Text style={styles.confirmPillText}>
                    {getGenderLabel(gender)}
                  </Text>
                </View>
              )}
            </Animated.View>

            {/* [E] Warm Message */}
            <Animated.Text
              style={[styles.confirmWarmMessage, { opacity: warmMsgAnim }]}
            >
              Ready to start gifting thoughtfully
            </Animated.Text>

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
              {step > 2 && !isSubmitting && !showSuccess && (
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
              <Text style={styles.headerSubtitle}>Step {step - 1} of 4</Text>
            </View>
            <View style={styles.headerPlaceholder}>
              {!isSubmitting && !showSuccess && (
                <TouchableOpacity
                  onPress={handleClose}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={s(22)} color="#374151" />
                </TouchableOpacity>
              )}
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
          {step >= 2 && (
            <View style={styles.buttonsContainer}>
              {showSuccess ? (
                <View style={styles.successContainer}>
                  <Ionicons
                    name="checkmark-circle"
                    size={s(32)}
                    color={colors.success[500]}
                  />
                  <Text style={styles.successText}>You're on it.</Text>
                </View>
              ) : step < 5 ? (
                <TouchableOpacity
                  style={[
                    styles.nextButton,
                    !canProceed() && styles.buttonDisabled,
                  ]}
                  onPress={handleNextStep}
                  activeOpacity={0.7}
                  disabled={!canProceed()}
                >
                  <Text style={styles.nextButtonText}>Next</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    isSubmitting && styles.submitButtonLoading,
                  ]}
                  onPress={handleSubmit}
                  activeOpacity={0.7}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.submitButtonText}>Add to my people</Text>
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
  // Step 5 — Warm Confirmation
  confirmAvatar: {
    width: s(80),
    height: s(80),
    borderRadius: 999,
    backgroundColor: colors.primary[50],
    borderWidth: 2,
    borderColor: colors.primary[200],
    alignSelf: "center",
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.lg,
  },
  confirmAvatarText: {
    fontSize: ms(28),
    fontWeight: "700",
    color: colors.primary[600],
    letterSpacing: 1,
  },
  confirmName: {
    fontSize: ms(28),
    fontWeight: "700",
    color: colors.text.primary,
    textAlign: "center",
    marginTop: spacing.md,
  },
  confirmBirthdayPhrase: {
    fontSize: ms(18),
    fontWeight: "400",
    color: colors.text.secondary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  confirmPillsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  confirmPill: {
    backgroundColor: colors.gray[100],
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  confirmPillText: {
    fontSize: ms(14),
    fontWeight: "500",
    color: colors.text.tertiary,
  },
  confirmWarmMessage: {
    fontSize: ms(14),
    fontWeight: "400",
    fontStyle: "italic",
    color: colors.text.tertiary,
    opacity: 0.8,
    textAlign: "center",
    marginTop: spacing.xl,
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
    backgroundColor: colors.primary[500],
    borderRadius: radius.lg,
    height: touchTargets.large,
    justifyContent: "center",
    alignItems: "center",
    ...shadows.md,
  },
  submitButtonLoading: {
    opacity: 0.7,
  },
  submitButtonText: {
    fontSize: ms(17),
    fontWeight: "600",
    color: "#ffffff",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Success moment
  successContainer: {
    alignItems: "center",
    paddingVertical: 8,
    gap: 6,
  },
  successText: {
    fontSize: s(14),
    color: colors.text.tertiary,
  },
});
