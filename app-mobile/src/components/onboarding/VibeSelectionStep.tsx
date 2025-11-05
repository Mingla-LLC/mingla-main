import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface VibeSelectionStepProps {
  onNext: () => void;
  onBack: () => void;
  vibes: string[];
  onVibeToggle: (vibeId: string) => void;
}

const VibeSelectionStep = ({
  onNext,
  onBack,
  vibes,
  onVibeToggle,
}: VibeSelectionStepProps) => {
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
    vibeMainContent: {
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
    vibeOptionsContainer: {
      flex: 1,
    },
    vibeOptionsContent: {
      paddingBottom: 20,
    },
    vibeGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
    },
    vibeCard: {
      width: "48%",
      borderRadius: 12,
      marginBottom: 12,
      borderWidth: 2,
    },
    vibeCardDefault: {
      backgroundColor: "white",
      borderColor: "#e5e7eb",
    },
    vibeCardSelected: {
      backgroundColor: "#fef3f2",
      borderColor: "#eb7825",
    },
    vibeCardContent: {
      padding: 16,
      alignItems: "center",
      position: "relative",
    },
    vibeIcon: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    vibeIconDefault: {
      backgroundColor: "#f3f4f6",
    },
    vibeIconSelected: {
      backgroundColor: "#eb7825",
    },
    vibeEmoji: {
      fontSize: 20,
    },
    vibeTextContainer: {
      alignItems: "center",
    },
    vibeTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 4,
      textAlign: "center",
    },
    vibeDescription: {
      fontSize: 12,
      color: "#6b7280",
      textAlign: "center",
      lineHeight: 16,
    },
    vibeCheckmark: {
      position: "absolute",
      top: 8,
      right: 8,
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
    continueButtonDisabled: {
      backgroundColor: "#e5e7eb",
      opacity: 0.7,
    },
    continueButtonText: {
      color: "white",
      fontSize: 16,
      fontWeight: "600",
      marginRight: 8,
    },
    continueButtonTextDisabled: {
      color: "#9ca3af",
    },
  });

  const vibeCategories = [
    {
      id: "take-a-stroll",
      name: "Take a Stroll",
      icon: "eye",
      emoji: "🚶",
      description: "Walking tours, parks, scenic routes",
    },
    {
      id: "sip-and-chill",
      name: "Sip & Chill",
      icon: "cafe",
      emoji: "☕",
      description: "Cafes, bars, lounges",
    },
    {
      id: "casual-eats",
      name: "Casual Eats",
      icon: "restaurant",
      emoji: "🍕",
      description: "Casual dining, food trucks, markets",
    },
    {
      id: "screen-and-relax",
      name: "Screen & Relax",
      icon: "musical-notes",
      emoji: "🎬",
      description: "Movies, shows, entertainment",
    },
    {
      id: "creative-hands-on",
      name: "Creative & Hands-On",
      icon: "sparkles",
      emoji: "🎨",
      description: "Workshops, classes, DIY activities",
    },
    {
      id: "play-and-move",
      name: "Play & Move",
      icon: "fitness",
      emoji: "⚽",
      description: "Sports, games, active fun",
    },
    {
      id: "dining-experiences",
      name: "Dining Experiences",
      icon: "restaurant",
      emoji: "🍽️",
      description: "Fine dining, tastings, culinary",
    },
    {
      id: "wellness-dates",
      name: "Wellness Dates",
      icon: "leaf",
      emoji: "🧘",
      description: "Spa, yoga, meditation, nature",
    },
    {
      id: "freestyle",
      name: "Freestyle",
      icon: "star",
      emoji: "✨",
      description: "Spontaneous and unique experiences",
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
          <Text style={styles.headerTitle}>Your Vibes</Text>
          <Text style={styles.headerSubtitle}>Step 4 of 7</Text>
        </View>

        <View style={{ width: 32 }} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: "57.1%" }]} />
      </View>

      {/* Main Content */}
      <View style={styles.vibeMainContent}>
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Choose Your Vibe</Text>
          <Text style={styles.subtitle}>
            Select all categories that match your style
          </Text>
          <Text style={styles.selectionCounter}>
            {vibes?.length || 0} selected
          </Text>
        </View>

        {/* Vibe Options Grid */}
        <ScrollView
          style={styles.vibeOptionsContainer}
          showsVerticalScrollIndicator={true}
          contentContainerStyle={styles.vibeOptionsContent}
        >
          <View style={styles.vibeGrid}>
            {vibeCategories.map((vibe) => {
              const isSelected = vibes?.includes(vibe.id);

              return (
                <TouchableOpacity
                  key={vibe.id}
                  onPress={() => onVibeToggle(vibe.id)}
                  style={[
                    styles.vibeCard,
                    isSelected
                      ? styles.vibeCardSelected
                      : styles.vibeCardDefault,
                  ]}
                >
                  <View style={styles.vibeCardContent}>
                    <View
                      style={[
                        styles.vibeIcon,
                        isSelected
                          ? styles.vibeIconSelected
                          : styles.vibeIconDefault,
                      ]}
                    >
                      <Text style={styles.vibeEmoji}>{vibe.emoji}</Text>
                    </View>

                    <View style={styles.vibeTextContainer}>
                      <Text style={styles.vibeTitle}>{vibe.name}</Text>
                      <Text style={styles.vibeDescription}>
                        {vibe.description}
                      </Text>
                    </View>

                    {isSelected && (
                      <View style={styles.vibeCheckmark}>
                        <Ionicons name="checkmark" size={16} color="#eb7825" />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        {/* Continue Button */}
        <TouchableOpacity
          onPress={onNext}
          disabled={!vibes || vibes.length === 0}
          style={[
            styles.continueButton,
            (!vibes || vibes.length === 0) && styles.continueButtonDisabled,
          ]}
        >
          <Text
            style={[
              styles.continueButtonText,
              (!vibes || vibes.length === 0) &&
                styles.continueButtonTextDisabled,
            ]}
          >
            Continue
          </Text>
          {!vibes || vibes.length === 0 ? null : (
            <Ionicons name="arrow-forward" size={20} color="white" />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default VibeSelectionStep;
