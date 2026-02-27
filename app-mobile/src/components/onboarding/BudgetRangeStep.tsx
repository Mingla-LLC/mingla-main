import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

interface BudgetRangeStepProps {
  onNext: () => void | Promise<void>;
  onBack: () => void;
  budgetRange: { min: number; max: number | null };
  onBudgetRangeChange: (range: { min: number; max: number | null }) => void;
}

const BudgetRangeStep = ({
  onNext,
  onBack,
  budgetRange,
  onBudgetRangeChange,
}: BudgetRangeStepProps) => {
  // Check if initial budgetRange is the default (0-1000)
  const initialIsDefault = budgetRange?.min === 0 && budgetRange?.max === 1000;

  // Only show max value (min is always 0)
  const [maxValue, setMaxValue] = useState<string>(
    initialIsDefault ? "" : budgetRange?.max?.toString() || ""
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isMaxFocused, setIsMaxFocused] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(!initialIsDefault);

  // Popular budget ranges - only showing max values (min is always 0)
  const popularRanges = [
    { max: 100, label: "Up to $100" },
    { max: 200, label: "Up to $200" },
    { max: 500, label: "Up to $500" },
  ];

  // Check if the current budgetRange matches any popular range
  const checkIfPopularRangeSelected = () => {
    if (!budgetRange) return false;
    return popularRanges.some(
      (range) => budgetRange.max === range.max
    );
  };

  // Check if budgetRange is the default value (0-1000)
  const isDefaultRange = budgetRange?.min === 0 && budgetRange?.max === 1000;

  // Update local state when prop changes (but only sync values, don't override user input)
  useEffect(() => {
    if (budgetRange) {
      // Check if this is different from default, which means user has made a selection
      const currentIsDefault =
        budgetRange.min === 0 && budgetRange.max === 1000;
      if (!currentIsDefault) {
        setHasUserInteracted(true);
      }
    }
  }, [budgetRange]);

  const handleMaxChange = (text: string) => {
    // Allow only numbers
    const numericValue = text.replace(/[^0-9]/g, "");
    setMaxValue(numericValue);
    setHasUserInteracted(true);

    if (numericValue === "") {
      // Empty means no max limit
      onBudgetRangeChange({
        min: 0,
        max: null,
      });
    } else {
      const numValue = parseInt(numericValue, 10);
      if (!isNaN(numValue)) {
        onBudgetRangeChange({
          min: 0,
          max: numValue,
        });
      }
    }
  };

  const handlePopularRangeSelect = (max: number) => {
    setMaxValue(max.toString());
    setHasUserInteracted(true);
    onBudgetRangeChange({ min: 0, max });
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "white",
    },
    progressSection: {
      paddingHorizontal: 24,
      paddingBottom: 8,
    },
    progressBarContainer: {
      marginBottom: 8,
    },
    progressBar: {
      height: 4,
      backgroundColor: "#e5e7eb",
      borderRadius: 2,
      overflow: "hidden",
    },
    progressFill: {
      height: 4,
      backgroundColor: "#eb7825",
      borderRadius: 2,
    },
    progressTextContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 4,
    },
    progressTextLeft: {
      fontSize: 12,
      color: "#6b7280",
    },
    progressTextRight: {
      fontSize: 12,
      color: "#6b7280",
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 32,
      paddingBottom: 120,
    },
    titleSection: {
      marginBottom: 32,
      alignItems: "center",
    },
    title: {
      fontSize: 28,
      fontWeight: "bold",
      color: "#111827",
      marginBottom: 8,
      textAlign: "center",
    },
    subtitle: {
      fontSize: 16,
      color: "#6b7280",
      textAlign: "center",
      lineHeight: 22,
    },
    popularRangesSection: {
      marginBottom: 24,
    },
    popularRangesLabel: {
      fontSize: 14,
      fontWeight: "400",
      color: "#111827",
      marginBottom: 12,
    },
    popularRangesContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
    },
    popularRangeButton: {
      width: "48%",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
      backgroundColor: "white",
      borderColor: "#e5e7eb",
    },
    popularRangeButtonSelected: {
      backgroundColor: "#eb7825",
      borderColor: "#eb7825",
    },
    popularRangeButtonText: {
      fontSize: 14,
      fontWeight: "500",
      color: "#111827",
    },
    popularRangeButtonTextSelected: {
      color: "#ffffff",
    },
    separator: {
      alignItems: "center",
      marginVertical: 24,
    },
    separatorText: {
      fontSize: 14,
      color: "#9ca3af",
      fontWeight: "400",
    },
    customRangeSection: {
      marginBottom: 24,
    },
    customRangeRow: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    customRangeInputContainer: {
      flex: 1,
      marginRight: 12,
    },
    customRangeInputContainerLast: {
      marginRight: 0,
    },
    customRangeLabel: {
      fontSize: 14,
      fontWeight: "400",
      color: "#111827",
      marginBottom: 8,
    },
    customRangeInputWrapper: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "white",
      borderWidth: 1.5,
      borderColor: "#e5e7eb",
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    customRangeInputWrapperFocused: {
      borderColor: "#eb7825",
      borderWidth: 2,
    },
    dollarSign: {
      fontSize: 16,
      fontWeight: "400",
      color: "#111827",
      marginRight: 8,
    },
    customRangeInput: {
      flex: 1,
      fontSize: 16,
      color: "#111827",
      padding: 0,
    },
    helperText: {
      fontSize: 12,
      color: "#9ca3af",
      textAlign: "center",
      marginTop: 8,
    },
    navigationContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 24,
      paddingVertical: 16,
      backgroundColor: "white",
      borderTopWidth: 1,
      borderTopColor: "#f3f4f6",
    },
    backButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 8,
      backgroundColor: "white",
    },
    backButtonText: {
      fontSize: 16,
      color: "#111827",
      fontWeight: "500",
      marginLeft: 4,
    },
    nextButton: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: "#eb7825",
      minWidth: 100,
    },
    nextButtonDisabled: {
      backgroundColor: "#e5e7eb",
    },
    nextButtonText: {
      fontSize: 16,
      fontWeight: "500",
      color: "#ffffff",
      marginRight: 4,
    },
    nextButtonTextDisabled: {
      color: "#6b7280",
    },
  });

  // Check if a popular range is selected (for highlighting)
  const isPopularRangeSelected = (range: {
    max: number;
  }) => {
    if (!budgetRange) return false;
    return budgetRange.max === range.max;
  };

  // Validation: max should be set and greater than 0
  const currentMax = budgetRange?.max ?? null;
  const hasValidMax = currentMax !== null && currentMax > 0;

  // Button should be disabled if:
  // 1. The range is still the default (0-1000), OR
  // 2. Max value is not set or is invalid
  const isNextDisabled = isDefaultRange || !hasValidMax;

  return (
    <View style={styles.container}>
      {/*  <StatusBar barStyle="dark-content" backgroundColor="white" /> */}

      {/* Progress Bar Section */}
      <View style={styles.progressSection}>
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "70%" }]} />
          </View>
          <View style={styles.progressTextContainer}>
            <Text style={styles.progressTextLeft}>Step 7 of 10</Text>
            <Text style={styles.progressTextRight}>70% complete</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        {/* Scrollable Content */}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
        >
          {/* Title Section */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>What's your budget?</Text>
            <Text style={styles.subtitle}>
              Set your typical spending range per person
            </Text>
          </View>

          {/* Popular Ranges Section */}
          <View style={styles.popularRangesSection}>
            <Text style={styles.popularRangesLabel}>Popular ranges:</Text>
            <View style={styles.popularRangesContainer}>
              {popularRanges.map((range) => {
                const isSelected = isPopularRangeSelected(range);
                return (
                  <TouchableOpacity
                    key={range.label}
                    style={[
                      styles.popularRangeButton,
                      isSelected && styles.popularRangeButtonSelected,
                    ]}
                    onPress={() =>
                      handlePopularRangeSelect(range.max)
                    }
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.popularRangeButtonText,
                        isSelected && styles.popularRangeButtonTextSelected,
                      ]}
                    >
                      {range.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Separator */}
          <View style={styles.separator}>
            <Text style={styles.separatorText}>or set custom maximum</Text>
          </View>

          {/* Custom Max Input Only */}
          <View style={styles.customRangeSection}>
            <View style={styles.customRangeRow}>
              {/* Max Input Only */}
              <View
                style={[
                  styles.customRangeInputContainer,
                  styles.customRangeInputContainerLast,
                  { width: '100%' },
                ]}
              >
                <Text style={styles.customRangeLabel}>Maximum per person</Text>
                <View
                  style={[
                    styles.customRangeInputWrapper,
                    isMaxFocused && styles.customRangeInputWrapperFocused,
                  ]}
                >
                  <Text style={styles.dollarSign}>$</Text>
                  <TextInput
                    style={styles.customRangeInput}
                    value={maxValue}
                    onChangeText={handleMaxChange}
                    onFocus={() => setIsMaxFocused(true)}
                    onBlur={() => setIsMaxFocused(false)}
                    keyboardType="numeric"
                    placeholder="500"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Helper Text */}
          <Text style={styles.helperText}>
            Budget range is $0 to your maximum. Free experiences will always be shown
          </Text>
        </ScrollView>

        {/* Navigation Buttons */}
        <View style={styles.navigationContainer}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Ionicons name="arrow-back" size={18} color="#111827" />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.nextButton,
              isNextDisabled && styles.nextButtonDisabled,
            ]}
            onPress={async () => {
              if (isLoading || isNextDisabled) {
                return;
              }

              setIsLoading(true);
              try {
                const result = onNext();
                if (result instanceof Promise) {
                  await result;
                }
              } catch (error) {
                console.error("Error in onNext:", error);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isNextDisabled || isLoading}
            activeOpacity={isNextDisabled || isLoading ? 1 : 0.7}
          >
            {isLoading ? (
              <>
                <ActivityIndicator
                  size="small"
                  color="#ffffff"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.nextButtonText}>Saving...</Text>
              </>
            ) : (
              <>
                <Text
                  style={[
                    styles.nextButtonText,
                    isNextDisabled && styles.nextButtonTextDisabled,
                  ]}
                >
                  Next
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={18}
                  color={isNextDisabled ? "#6b7280" : "#ffffff"}
                />
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

export default BudgetRangeStep;
