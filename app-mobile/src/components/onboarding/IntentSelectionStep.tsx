import React, { useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface IntentSelectionStepProps {
  onNext: () => void;
  onBack: () => void;
  intents: any[];
  onIntentToggle: (intent: any) => void;
}

const IntentSelectionStep = ({
  onNext,
  onBack,
  intents,
  onIntentToggle,
}: IntentSelectionStepProps) => {
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
    intentMainContent: {
      flex: 1,
      paddingHorizontal: 24,
    },
    titleSection: {
      alignItems: "center",
      marginBottom: 32,
    },
    title: {
      fontSize: 28,
      fontWeight: "bold",
      color: "#111827",
      textAlign: "center",
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: "#6b7280",
      textAlign: "center",
    },
    selectionCounter: {
      fontSize: 14,
      color: "#eb7825",
      fontWeight: "500",
      marginTop: 8,
    },
    optionsContainer: {
      flex: 1,
    },
    optionsContent: {
      paddingBottom: 20,
    },
    intentCard: {
      borderRadius: 12,
      marginBottom: 12,
      borderWidth: 2,
      width: "100%",
    },
    intentCardDefault: {
      backgroundColor: "white",
      borderColor: "#e5e7eb",
    },
    intentCardSelected: {
      backgroundColor: "#fef3f2",
      borderColor: "#eb7825",
    },
    intentCardContent: {
      flexDirection: "row",
      alignItems: "center",
      padding: 16,
    },
    intentIcon: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 16,
    },
    intentIconDefault: {
      backgroundColor: "#f3f4f6",
    },
    intentIconSelected: {
      backgroundColor: "#eb7825",
    },
    intentEmoji: {
      fontSize: 20,
    },
    intentTextContainer: {
      flex: 1,
      flexShrink: 1,
    },
    intentTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 4,
    },
    intentDescription: {
      fontSize: 14,
      color: "#6b7280",
      lineHeight: 20,
    },
    continueButton: {
      backgroundColor: "#eb7825",
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    },
    continueButtonText: {
      color: "white",
      fontSize: 16,
      fontWeight: "600",
      marginRight: 8,
    },
    continueButtonDisabled: {
      backgroundColor: "#e5e7eb",
      opacity: 0.7,
    },
    continueButtonTextDisabled: {
      color: "#9ca3af",
    },
  });

  const intentOptions = [
    {
      id: "solo-adventure",
      title: "Explore new things solo",
      icon: "globe",
      emoji: "🌍",
      description: "Perfect for solo adventures and self-discovery",
      experienceType: "Solo adventure",
    },
    {
      id: "first-dates",
      title: "Plan First Dates",
      icon: "heart",
      emoji: "💕",
      description: "Great first impression experiences",
      experienceType: "First Date",
    },
    {
      id: "romantic",
      title: "Find Romantic Activities",
      icon: "heart",
      emoji: "💘",
      description: "Intimate and romantic experiences",
      experienceType: "Romantic",
    },
    {
      id: "friendly",
      title: "Find Friendly Activities",
      icon: "people",
      emoji: "👥",
      description: "Fun activities with friends",
      experienceType: "Friendly",
    },
    {
      id: "group-fun",
      title: "Find activities for my group",
      icon: "people",
      emoji: "🎉",
      description: "Group activities and celebrations",
      experienceType: "Group fun",
    },
    {
      id: "business",
      title: "Find places for business and work meetings",
      icon: "cafe",
      emoji: "💼",
      description: "Professional meeting spaces",
      experienceType: "Business",
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color="#9ca3af" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Your Intent</Text>
          <Text style={styles.headerSubtitle}>Step 3 of 7</Text>
        </View>

        <View style={{ width: 32 }} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: "42.9%" }]} />
      </View>

      {/* Main Content */}
      <View style={styles.intentMainContent}>
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>I'm here to...</Text>
          <Text style={styles.subtitle}>
            Select all reasons that bring you to Mingla
          </Text>
          <Text style={styles.selectionCounter}>
            {intents?.length || 0} selected
          </Text>
        </View>

        {/* Intent Options */}
        <ScrollView
          style={styles.optionsContainer}
          showsVerticalScrollIndicator={true}
          contentContainerStyle={styles.optionsContent}
        >
          {intentOptions.map((option) => {
            const isSelected = intents?.find((i: any) => i.id === option.id);

            return (
              <TouchableOpacity
                key={option.id}
                onPress={() => onIntentToggle(option)}
                style={[
                  styles.intentCard,
                  isSelected
                    ? styles.intentCardSelected
                    : styles.intentCardDefault,
                ]}
              >
                <View style={styles.intentCardContent}>
                  <View
                    style={[
                      styles.intentIcon,
                      isSelected
                        ? styles.intentIconSelected
                        : styles.intentIconDefault,
                    ]}
                  >
                    <Text style={styles.intentEmoji}>{option.emoji}</Text>
                  </View>

                  <View style={styles.intentTextContainer}>
                    <Text style={styles.intentTitle}>{option.title}</Text>
                    <Text style={styles.intentDescription}>
                      {option.description}
                    </Text>
                  </View>

                  {isSelected && (
                    <Ionicons name="checkmark" size={20} color="#eb7825" />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Continue Button */}
        <TouchableOpacity
          onPress={onNext}
          disabled={!intents || intents.length === 0}
          style={[
            styles.continueButton,
            (!intents || intents.length === 0) && styles.continueButtonDisabled,
          ]}
        >
          <Text
            style={[
              styles.continueButtonText,
              (!intents || intents.length === 0) &&
                styles.continueButtonTextDisabled,
            ]}
          >
            Continue
          </Text>
          {!intents || intents.length === 0 ? null : (
            <Ionicons name="arrow-forward" size={20} color="white" />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default IntentSelectionStep;
