import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface TravelConstraintStepProps {
  onNext: () => void | Promise<void>;
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
  const [isLoading, setIsLoading] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);

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
    progressSection: {
      paddingHorizontal: 24,
      paddingTop: 8,
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
    tabsContainer: {
      flexDirection: "row",
      marginBottom: 32,
    },
    tab: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      borderWidth: 1.5,
      marginRight: 12,
    },
    tabLast: {
      marginRight: 0,
    },
    tabSelected: {
      backgroundColor: "white",
      borderColor: "#eb7825",
    },
    tabUnselected: {
      backgroundColor: "#f3f4f6",
      borderColor: "transparent",
    },
    tabIcon: {
      marginRight: 8,
    },
    tabText: {
      fontSize: 16,
      fontWeight: "500",
    },
    tabTextSelected: {
      color: "#eb7825",
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
      color: "#111827",
      marginBottom: 8,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "white",
      borderWidth: 1.5,
      borderColor: "#e5e7eb",
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 8,
    },
    inputContainerFocused: {
      borderColor: "#eb7825",
      borderWidth: 2,
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
      lineHeight: 20,
    },
    quickOptionsContainer: {
      flexDirection: "row",
    },
    quickOption: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    quickOptionLast: {
      marginRight: 0,
    },
    quickOptionSelected: {
      backgroundColor: "#eb7825",
    },
    quickOptionUnselected: {
      backgroundColor: "#f3f4f6",
    },
    quickOptionText: {
      fontSize: 14,
      fontWeight: "500",
    },
    quickOptionTextSelected: {
      color: "#ffffff",
    },
    quickOptionTextUnselected: {
      color: "#111827",
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

  // Quick selection options for time (in minutes)
  const timeQuickOptions = [15, 30, 45, 60];

  // Quick selection options for distance (in km)
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
      <StatusBar barStyle="dark-content" backgroundColor="white" />

      {/* Progress Bar Section */}
      <View style={styles.progressSection}>
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "60%" }]} />
          </View>
          <View style={styles.progressTextContainer}>
            <Text style={styles.progressTextLeft}>Step 6 of 10</Text>
            <Text style={styles.progressTextRight}>60% complete</Text>
          </View>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        nestedScrollEnabled={true}
      >
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>How far will you go?</Text>
          <Text style={styles.subtitle}>Set your preferred travel limit</Text>
        </View>

        {/* Tab Selection - Two separate buttons */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[
              styles.tab,
              constraintType === "time"
                ? styles.tabSelected
                : styles.tabUnselected,
            ]}
            onPress={() => onConstraintTypeChange("time")}
            activeOpacity={0.7}
          >
            <Ionicons
              name="time-outline"
              size={18}
              color={constraintType === "time" ? "#eb7825" : "#6b7280"}
              style={styles.tabIcon}
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
              styles.tabLast,
              constraintType === "distance"
                ? styles.tabSelected
                : styles.tabUnselected,
            ]}
            onPress={() => onConstraintTypeChange("distance")}
            activeOpacity={0.7}
          >
            <Ionicons
              name="paper-plane-outline"
              size={18}
              color={constraintType === "distance" ? "#eb7825" : "#6b7280"}
              style={styles.tabIcon}
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

          <View
            style={[
              styles.inputContainer,
              isInputFocused && styles.inputContainerFocused,
            ]}
          >
            <Ionicons
              name={
                constraintType === "time" ? "time-outline" : "location-outline"
              }
              size={20}
              color={isInputFocused ? "#eb7825" : "#6b7280"}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              value={inputValue}
              onChangeText={handleInputChange}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
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
            {currentQuickOptions.map((value, index) => {
              const isSelected = constraintValue === value;
              const isLast = index === currentQuickOptions.length - 1;
              return (
                <TouchableOpacity
                  key={value}
                  style={[
                    styles.quickOption,
                    isLast && styles.quickOptionLast,
                    isSelected
                      ? styles.quickOptionSelected
                      : styles.quickOptionUnselected,
                  ]}
                  onPress={() => handleQuickSelect(value)}
                  activeOpacity={0.7}
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
    </SafeAreaView>
  );
};

export default TravelConstraintStep;
