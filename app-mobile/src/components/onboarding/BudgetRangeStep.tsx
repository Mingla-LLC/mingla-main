import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface BudgetRangeStepProps {
  onNext: () => void;
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
  const [minValue, setMinValue] = useState<string>(
    budgetRange?.min?.toString() || "0"
  );
  const [maxValue, setMaxValue] = useState<string>(
    budgetRange?.max?.toString() || "100"
  );

  // Update local state when prop changes
  useEffect(() => {
    if (budgetRange) {
      setMinValue(budgetRange.min?.toString() || "0");
      setMaxValue(budgetRange.max?.toString() || "100");
    }
  }, [budgetRange]);

  const handleMinChange = (text: string) => {
    // Allow only numbers
    const numericValue = text.replace(/[^0-9]/g, "");
    setMinValue(numericValue);

    const numValue = numericValue ? parseInt(numericValue, 10) : 0;
    if (!isNaN(numValue)) {
      onBudgetRangeChange({
        min: numValue,
        max: budgetRange.max,
      });
    }
  };

  const handleMaxChange = (text: string) => {
    // Allow only numbers
    const numericValue = text.replace(/[^0-9]/g, "");
    setMaxValue(numericValue);

    if (numericValue === "") {
      // Empty means no limit
      onBudgetRangeChange({
        min: budgetRange.min,
        max: null,
      });
    } else {
      const numValue = parseInt(numericValue, 10);
      if (!isNaN(numValue)) {
        onBudgetRangeChange({
          min: budgetRange.min,
          max: numValue,
        });
      }
    }
  };

  const handlePopularRangeSelect = (min: number, max: number | null) => {
    setMinValue(min.toString());
    if (max === null) {
      setMaxValue("");
    } else {
      setMaxValue(max.toString());
    }
    onBudgetRangeChange({ min, max });
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "white",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 24,
      paddingVertical: 16,
      backgroundColor: "white",
      borderBottomWidth: 1,
      borderBottomColor: "#f3f4f6",
    },
    backButton: {
      padding: 8,
      borderRadius: 20,
    },
    headerCenter: {
      alignItems: "center",
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: "#111827",
    },
    headerSubtitle: {
      fontSize: 14,
      color: "#6b7280",
    },
    progressBar: {
      height: 8,
      backgroundColor: "#e5e7eb",
      borderRadius: 4,
      marginHorizontal: 24,
      marginVertical: 16,
    },
    progressFill: {
      height: 8,
      backgroundColor: "#eb7825",
      borderRadius: 4,
    },
    mainContent: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 32,
    },
    titleSection: {
      marginBottom: 32,
      flexDirection: "row",
      alignItems: "center",
    },
    titleIcon: {
      marginRight: 12,
    },
    titleContainer: {
      flex: 1,
    },
    title: {
      fontSize: 28,
      fontWeight: "bold",
      color: "#111827",
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: "#6b7280",
    },
    inputSection: {
      marginBottom: 32,
    },
    inputRow: {
      marginBottom: 20,
    },
    inputLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: "#374151",
      marginBottom: 8,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: "#e5e7eb",
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 16,
      backgroundColor: "#f9fafb",
    },
    dollarSign: {
      fontSize: 16,
      fontWeight: "500",
      color: "#374151",
      marginRight: 8,
    },
    input: {
      flex: 1,
      fontSize: 16,
      color: "#111827",
      padding: 0,
    },
    helperText: {
      fontSize: 14,
      color: "#6b7280",
      marginTop: 4,
    },
    popularRangesSection: {
      marginTop: 8,
    },
    popularRangesLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: "#374151",
      marginBottom: 12,
    },
    popularRangesContainer: {
      flexDirection: "row",
      gap: 12,
    },
    popularRangeButton: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    popularRangeButtonSelected: {
      backgroundColor: "#3b82f6",
      borderColor: "#3b82f6",
    },
    popularRangeButtonUnselected: {
      backgroundColor: "#f9fafb",
      borderColor: "#e5e7eb",
    },
    popularRangeButtonText: {
      fontSize: 14,
      fontWeight: "600",
    },
    popularRangeButtonTextSelected: {
      color: "white",
    },
    popularRangeButtonTextUnselected: {
      color: "#374151",
    },
    navigationContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 24,
      paddingVertical: 16,
      borderTopWidth: 1,
      borderTopColor: "#f3f4f6",
    },
    backButtonText: {
      fontSize: 16,
      color: "#6b7280",
      fontWeight: "500",
    },
    nextButton: {
      backgroundColor: "#eb7825",
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 24,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    },
    nextButtonDisabled: {
      backgroundColor: "#e5e7eb",
      opacity: 0.7,
    },
    nextButtonText: {
      color: "white",
      fontSize: 16,
      fontWeight: "600",
      marginRight: 8,
    },
    nextButtonTextDisabled: {
      color: "#9ca3af",
    },
  });

  // Popular budget ranges
  const popularRanges = [
    { min: 0, max: 25, label: "$0-25" },
    { min: 25, max: 50, label: "$25-50" },
    { min: 50, max: 100, label: "$50-100" },
    { min: 100, max: null, label: "$100+" },
  ];

  // Check if a popular range is selected
  const isPopularRangeSelected = (range: {
    min: number;
    max: number | null;
  }) => {
    return budgetRange.min === range.min && budgetRange.max === range.max;
  };

  // Validation: min should not be greater than max (if max is set)
  const minNum = parseInt(minValue, 10) || 0;
  const maxNum = maxValue ? parseInt(maxValue, 10) : null;
  const isInvalidRange = maxNum !== null && minNum > maxNum;

  const isNextDisabled = isInvalidRange || minValue === "";

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color="#9ca3af" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Budget Range</Text>
          <Text style={styles.headerSubtitle}>Step 7 of 10</Text>
        </View>

        <View style={{ width: 32 }} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: "70%" }]} />
      </View>

      {/* Main Content */}
      <View style={styles.mainContent}>
        {/* Title Section */}
        <View style={styles.titleSection}>
          <View style={styles.titleIcon}>
            <Ionicons name="wallet-outline" size={24} color="#f59e0b" />
          </View>
          <View style={styles.titleContainer}>
            <Text style={styles.title}>What's your budget?</Text>
            <Text style={styles.subtitle}>
              Set your typical spending range per person
            </Text>
          </View>
        </View>

        {/* Input Section */}
        <View style={styles.inputSection}>
          {/* Minimum Input */}
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Minimum per person</Text>
            <View style={styles.inputContainer}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                style={styles.input}
                value={minValue}
                onChangeText={handleMinChange}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#9ca3af"
              />
            </View>
          </View>

          {/* Maximum Input */}
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Maximum per person</Text>
            <View style={styles.inputContainer}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                style={styles.input}
                value={maxValue}
                onChangeText={handleMaxChange}
                keyboardType="numeric"
                placeholder="100"
                placeholderTextColor="#9ca3af"
              />
            </View>
            <Text style={styles.helperText}>
              Leave empty for no budget limit
            </Text>
          </View>

          {/* Popular Ranges */}
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
                      isSelected
                        ? styles.popularRangeButtonSelected
                        : styles.popularRangeButtonUnselected,
                    ]}
                    onPress={() =>
                      handlePopularRangeSelect(range.min, range.max)
                    }
                  >
                    <Text
                      style={[
                        styles.popularRangeButtonText,
                        isSelected
                          ? styles.popularRangeButtonTextSelected
                          : styles.popularRangeButtonTextUnselected,
                      ]}
                    >
                      {range.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </View>

      {/* Navigation Buttons */}
      <View style={styles.navigationContainer}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onNext}
          disabled={isNextDisabled}
          style={[
            styles.nextButton,
            isNextDisabled && styles.nextButtonDisabled,
          ]}
        >
          <Text
            style={[
              styles.nextButtonText,
              isNextDisabled && styles.nextButtonTextDisabled,
            ]}
          >
            Next
          </Text>
          {!isNextDisabled && (
            <Ionicons name="arrow-forward" size={20} color="white" />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default BudgetRangeStep;
