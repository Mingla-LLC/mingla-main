import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

interface IntentSelectionStepProps {
  onNext: () => void | Promise<void>;
  onBack: () => void;
  intents: any[] | null | undefined;
  onIntentToggle: (intent: any) => void;
}

const IntentSelectionStep = ({
  onNext,
  onBack,
  intents,
  onIntentToggle,
}: IntentSelectionStepProps) => {
  const [isLoading, setIsLoading] = useState(false);

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
      paddingTop: 24,
      paddingBottom: 120,
    },
    titleSection: {
      marginBottom: 32,
    },
    title: {
      fontSize: 32,
      fontWeight: "bold",
      color: "#111827",
      marginBottom: 8,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: 16,
      color: "#6b7280",
      lineHeight: 22,
    },
    optionsContainer: {
      flex: 1,
    },
    intentCard: {
      backgroundColor: "white",
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: "#e5e7eb",
      marginBottom: 12,
      padding: 16,
      flexDirection: "row",
      alignItems: "center",
    },
    intentCardSelected: {
      backgroundColor: "#eb7825",
      borderColor: "#eb7825",
      borderWidth: 2,
    },
    intentIconContainer: {
      marginRight: 16,
      width: 24,
      height: 24,
      justifyContent: "center",
      alignItems: "center",
    },
    intentIconSelected: {
      color: "#ffffff",
    },
    intentTextContainer: {
      flex: 1,
    },
    intentTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 4,
    },
    intentTitleSelected: {
      color: "#ffffff",
    },
    intentDescription: {
      fontSize: 14,
      color: "#6b7280",
      lineHeight: 20,
    },
    intentDescriptionSelected: {
      color: "#ffffff",
      opacity: 0.9,
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
      minWidth: 100,
    },
    nextButtonEnabled: {
      backgroundColor: "#eb7825",
    },
    nextButtonDisabled: {
      backgroundColor: "#e5e7eb",
      opacity: 0.6,
    },
    nextButtonText: {
      fontSize: 16,
      fontWeight: "500",
      marginRight: 4,
    },
    nextButtonTextEnabled: {
      color: "#ffffff",
    },
    nextButtonTextDisabled: {
      color: "#6b7280",
    },
  });

  const intentOptions = [
    {
      id: "solo-adventure",
      title: "Adventurous",
      icon: "compass-outline",
      description: "Explore your city — great for adventurous souls",
      experienceType: "Adventurous",
    },
    {
      id: "first-dates",
      title: "Plan First Dates",
      icon: "heart-outline",
      description: "Great first impression experiences",
      experienceType: "First Date",
    },
    {
      id: "romantic",
      title: "Find Romantic Activities",
      icon: "heart-outline",
      description: "Intimate and romantic experiences",
      experienceType: "Romantic",
    },
    {
      id: "friendly",
      title: "Find Friendly Activities",
      icon: "people-outline",
      description: "Fun activities with friends",
      experienceType: "Friendly",
    },
    {
      id: "group-fun",
      title: "Find Activities for Groups",
      icon: "people-outline",
      description: "Group activities and celebrations",
      experienceType: "Group fun",
    },
    {
      id: "business",
      title: "Business/Work Meetings",
      icon: "briefcase-outline",
      description: "Professional meeting spaces",
      experienceType: "Business",
    },
  ];

  // Get the appropriate icon name for each option
  const getIconName = (option: (typeof intentOptions)[0]) => {
    // Use the icon specified in the option, or map to appropriate Ionicons
    switch (option.id) {
      case "solo-adventure":
        return "globe-outline";
      case "first-dates":
      case "romantic":
        return "heart-outline";
      case "friendly":
        return "people-outline"; // Two people concept
      case "group-fun":
        return "people-outline"; // Three+ people concept
      case "business":
        return "briefcase-outline";
      default:
        return option.icon;
    }
  };

  // Check if intents are selected (robust check)
  const hasIntentsSelected =
    intents && Array.isArray(intents) && intents.length > 0;

  return (
    <View style={styles.container}>
      {/* Progress Bar Section */}
      <View style={styles.progressSection}>
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "20%" }]} />
          </View>
          <View style={styles.progressTextContainer}>
            <Text style={styles.progressTextLeft}>Step 2 of 10</Text>
            <Text style={styles.progressTextRight}>20% complete</Text>
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
          <Text style={styles.title}>What brings you here?</Text>
          <Text style={styles.subtitle}>Select all that apply</Text>
        </View>

        {/* Intent Options */}
        <View style={styles.optionsContainer}>
          {intentOptions.map((option) => {
            const isSelected = hasIntentsSelected
              ? intents.some((i: any) => i.id === option.id)
              : false;

            return (
              <TouchableOpacity
                key={option.id}
                onPress={() => onIntentToggle(option)}
                style={[
                  styles.intentCard,
                  isSelected && styles.intentCardSelected,
                ]}
                activeOpacity={0.7}
              >
                <View style={styles.intentIconContainer}>
                  <Ionicons
                    name={getIconName(option) as any}
                    size={24}
                    color={isSelected ? "#ffffff" : "#374151"}
                  />
                </View>

                <View style={styles.intentTextContainer}>
                  <Text
                    style={[
                      styles.intentTitle,
                      isSelected && styles.intentTitleSelected,
                    ]}
                  >
                    {option.title}
                  </Text>
                  <Text
                    style={[
                      styles.intentDescription,
                      isSelected && styles.intentDescriptionSelected,
                    ]}
                  >
                    {option.description}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
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
            hasIntentsSelected
              ? styles.nextButtonEnabled
              : styles.nextButtonDisabled,
          ]}
          onPress={async () => {
            // Prevent onPress from firing if no intents are selected or already loading
            if (!hasIntentsSelected || isLoading) return;

            setIsLoading(true);
            try {
              // Call onNext and wait for it if it returns a promise
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
          disabled={!hasIntentsSelected || isLoading}
          activeOpacity={!hasIntentsSelected || isLoading ? 1 : 0.7}
        >
          {isLoading ? (
            <>
              <ActivityIndicator
                size="small"
                color="#ffffff"
                style={{ marginRight: 8 }}
              />
              <Text
                style={[styles.nextButtonText, styles.nextButtonTextEnabled]}
              >
                Saving...
              </Text>
            </>
          ) : (
            <>
              <Text
                style={[
                  styles.nextButtonText,
                  hasIntentsSelected
                    ? styles.nextButtonTextEnabled
                    : styles.nextButtonTextDisabled,
                ]}
              >
                Next
              </Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={hasIntentsSelected ? "#ffffff" : "#6b7280"}
              />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default IntentSelectionStep;
