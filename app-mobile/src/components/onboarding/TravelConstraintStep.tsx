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

interface TravelConstraintStepProps {
  onNext: () => void;
  onBack: () => void;
  constraintType: "time" | "distance";
  constraintValue: number;
  onConstraintTypeChange: (type: "time" | "distance") => void;
  onConstraintValueChange: (value: number) => void;
}

const TravelConstraintStep = ({
  onNext,
  onBack,
  constraintType,
  constraintValue,
  onConstraintTypeChange,
  onConstraintValueChange,
}: TravelConstraintStepProps) => {
  const [inputValue, setInputValue] = useState<string>(
    constraintValue?.toString() || "30"
  );

  // Update input value when constraintValue prop changes
  useEffect(() => {
    if (constraintValue) {
      setInputValue(constraintValue.toString());
    }
  }, [constraintValue]);

  const handleInputChange = (text: string) => {
    // Allow only numbers
    const numericValue = text.replace(/[^0-9]/g, "");
    setInputValue(numericValue);

    if (numericValue) {
      const numValue = parseInt(numericValue, 10);
      if (!isNaN(numValue) && numValue > 0) {
        onConstraintValueChange(numValue);
      }
    } else {
      onConstraintValueChange(0);
    }
  };

  const handleQuickSelect = (value: number) => {
    setInputValue(value.toString());
    onConstraintValueChange(value);
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
    tabsContainer: {
      flexDirection: "row",
      marginBottom: 32,
      backgroundColor: "#f3f4f6",
      borderRadius: 12,
      padding: 4,
    },
    tab: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
    },
    tabSelected: {
      backgroundColor: "#eb7825",
    },
    tabUnselected: {
      backgroundColor: "transparent",
    },
    tabText: {
      fontSize: 16,
      fontWeight: "600",
      marginLeft: 8,
    },
    tabTextSelected: {
      color: "white",
    },
    tabTextUnselected: {
      color: "#6b7280",
    },
    inputSection: {
      marginBottom: 24,
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
      backgroundColor: "white",
      marginBottom: 8,
    },
    inputIcon: {
      marginRight: 12,
    },
    input: {
      flex: 1,
      fontSize: 16,
      color: "#111827",
      padding: 0,
    },
    inputHelperText: {
      fontSize: 14,
      color: "#6b7280",
      marginBottom: 16,
    },
    quickOptionsContainer: {
      flexDirection: "row",
      gap: 12,
    },
    quickOption: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    quickOptionSelected: {
      backgroundColor: "#eb7825",
      borderColor: "#eb7825",
    },
    quickOptionUnselected: {
      backgroundColor: "white",
      borderColor: "#e5e7eb",
    },
    quickOptionText: {
      fontSize: 14,
      fontWeight: "600",
    },
    quickOptionTextSelected: {
      color: "white",
    },
    quickOptionTextUnselected: {
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

  // Quick selection options for time (in minutes)
  const timeQuickOptions = [15, 30, 45, 60];

  // Quick selection options for distance (in km) - will be shown when distance tab is selected
  const distanceQuickOptions = [5, 10, 15, 20];

  const currentQuickOptions =
    constraintType === "time" ? timeQuickOptions : distanceQuickOptions;

  const isNextDisabled =
    !constraintValue ||
    constraintValue <= 0 ||
    !inputValue ||
    inputValue.trim() === "";

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color="#9ca3af" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Travel Constraint</Text>
          <Text style={styles.headerSubtitle}>Step 6 of 10</Text>
        </View>

        <View style={{ width: 32 }} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: "60%" }]} />
      </View>

      {/* Main Content */}
      <View style={styles.mainContent}>
        {/* Title Section */}
        <View style={styles.titleSection}>
          <View style={styles.titleIcon}>
            <Ionicons name="time-outline" size={24} color="#ef4444" />
          </View>
          <View style={styles.titleContainer}>
            <Text style={styles.title}>How far will you go?</Text>
            <Text style={styles.subtitle}>Set your preferred travel limit</Text>
          </View>
        </View>

        {/* Tab Selection */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[
              styles.tab,
              constraintType === "time"
                ? styles.tabSelected
                : styles.tabUnselected,
            ]}
            onPress={() => onConstraintTypeChange("time")}
          >
            <Ionicons
              name="time-outline"
              size={18}
              color={constraintType === "time" ? "white" : "#6b7280"}
            />
            <Text
              style={[
                styles.tabText,
                constraintType === "time"
                  ? styles.tabTextSelected
                  : styles.tabTextUnselected,
              ]}
            >
              By Time
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tab,
              constraintType === "distance"
                ? styles.tabSelected
                : styles.tabUnselected,
            ]}
            onPress={() => onConstraintTypeChange("distance")}
          >
            <Ionicons
              name="paper-plane-outline"
              size={18}
              color={constraintType === "distance" ? "white" : "#6b7280"}
            />
            <Text
              style={[
                styles.tabText,
                constraintType === "distance"
                  ? styles.tabTextSelected
                  : styles.tabTextUnselected,
              ]}
            >
              By Distance
            </Text>
          </TouchableOpacity>
        </View>

        {/* Input Section */}
        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>
            {constraintType === "time"
              ? "Maximum travel time (minutes)"
              : "Maximum travel distance (km)"}
          </Text>

          <View style={styles.inputContainer}>
            <View style={styles.inputIcon}>
              <Ionicons
                name={
                  constraintType === "time"
                    ? "time-outline"
                    : "location-outline"
                }
                size={20}
                color="#6b7280"
              />
            </View>
            <TextInput
              style={styles.input}
              value={inputValue}
              onChangeText={handleInputChange}
              keyboardType="numeric"
              placeholder={constraintType === "time" ? "30" : "10"}
              placeholderTextColor="#9ca3af"
            />
          </View>

          <Text style={styles.inputHelperText}>
            {constraintType === "time"
              ? "How many minutes are you willing to travel?"
              : "How many kilometers are you willing to travel?"}
          </Text>

          {/* Quick Selection Options */}
          <View style={styles.quickOptionsContainer}>
            {currentQuickOptions.map((value) => {
              const isSelected = constraintValue === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[
                    styles.quickOption,
                    isSelected
                      ? styles.quickOptionSelected
                      : styles.quickOptionUnselected,
                  ]}
                  onPress={() => handleQuickSelect(value)}
                >
                  <Text
                    style={[
                      styles.quickOptionText,
                      isSelected
                        ? styles.quickOptionTextSelected
                        : styles.quickOptionTextUnselected,
                    ]}
                  >
                    {value}
                    {constraintType === "time" ? " min" : " km"}
                  </Text>
                </TouchableOpacity>
              );
            })}
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

export default TravelConstraintStep;
