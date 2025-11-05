import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface TravelModeStepProps {
  onNext: () => void;
  onBack: () => void;
  travelMode: string;
  onTravelModeChange: (mode: string) => void;
}

const TravelModeStep = ({
  onNext,
  onBack,
  travelMode,
  onTravelModeChange,
}: TravelModeStepProps) => {
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
    optionsContainer: {
      flex: 1,
    },
    modeCard: {
      borderRadius: 12,
      marginBottom: 12,
      borderWidth: 2,
      backgroundColor: "white",
      position: "relative",
    },
    modeCardDefault: {
      borderColor: "#e5e7eb",
    },
    modeCardSelected: {
      borderColor: "#eb7825",
      backgroundColor: "#fef3f2",
    },
    modeCardContent: {
      flexDirection: "row",
      alignItems: "center",
      padding: 16,
    },
    modeIconContainer: {
      width: 56,
      height: 56,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 16,
    },
    modeIconWalking: {
      backgroundColor: "#d1fae5",
    },
    modeIconBiking: {
      backgroundColor: "#dbeafe",
    },
    modeIconTransit: {
      backgroundColor: "#e9d5ff",
    },
    modeIconDriving: {
      backgroundColor: "#fed7aa",
    },
    modeTextContainer: {
      flex: 1,
    },
    modeTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 4,
    },
    modeDescription: {
      fontSize: 14,
      color: "#6b7280",
      lineHeight: 20,
    },
    modeCheckmark: {
      position: "absolute",
      top: 12,
      right: 12,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: "#eb7825",
      alignItems: "center",
      justifyContent: "center",
    },
    footerText: {
      fontSize: 12,
      color: "#9ca3af",
      textAlign: "center",
      marginTop: 24,
      marginBottom: 16,
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

  const travelModes = [
    {
      id: "walking",
      title: "Walking",
      icon: "walk",
      iconColor: "#10b981",
      iconBackground: "#d1fae5",
      speed: "~5 km/h",
      description: "Best for nearby spots",
    },
    {
      id: "biking",
      title: "Biking",
      icon: "bicycle",
      iconColor: "#3b82f6",
      iconBackground: "#dbeafe",
      speed: "~15 km/h",
      description: "Faster than walking",
    },
    {
      id: "public_transit",
      title: "Public Transit",
      icon: "bus",
      iconColor: "#8b5cf6",
      iconBackground: "#e9d5ff",
      speed: "~20 km/h avg",
      description: "Includes wait time",
    },
    {
      id: "driving",
      title: "Driving",
      icon: "car",
      iconColor: "#f97316",
      iconBackground: "#fed7aa",
      speed: "~30 km/h city",
      description: "Fastest option",
    },
  ];

  const isNextDisabled = !travelMode || travelMode.trim() === "";

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color="#9ca3af" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Travel Mode</Text>
          <Text style={styles.headerSubtitle}>Step 5 of 10</Text>
        </View>

        <View style={{ width: 32 }} />
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: "50%" }]} />
      </View>

      {/* Main Content */}
      <View style={styles.mainContent}>
        {/* Title Section */}
        <View style={styles.titleSection}>
          <View style={styles.titleIcon}>
            <Ionicons name="car" size={24} color="#ef4444" />
          </View>
          <View style={styles.titleContainer}>
            <Text style={styles.title}>How do you get around?</Text>
            <Text style={styles.subtitle}>
              This helps us show realistic travel times
            </Text>
          </View>
        </View>

        {/* Travel Mode Options */}
        <View style={styles.optionsContainer}>
          {travelModes.map((mode) => {
            const isSelected = travelMode === mode.id;
            const iconBgColor =
              mode.id === "walking"
                ? styles.modeIconWalking
                : mode.id === "biking"
                ? styles.modeIconBiking
                : mode.id === "public_transit"
                ? styles.modeIconTransit
                : styles.modeIconDriving;

            return (
              <TouchableOpacity
                key={mode.id}
                onPress={() => onTravelModeChange(mode.id)}
                style={[
                  styles.modeCard,
                  isSelected ? styles.modeCardSelected : styles.modeCardDefault,
                ]}
              >
                <View style={styles.modeCardContent}>
                  <View style={[styles.modeIconContainer, iconBgColor]}>
                    <Ionicons
                      name={mode.icon as any}
                      size={28}
                      color={mode.iconColor}
                    />
                  </View>

                  <View style={styles.modeTextContainer}>
                    <Text style={styles.modeTitle}>{mode.title}</Text>
                    <Text style={styles.modeDescription}>
                      {mode.speed}
                      {mode.description && ` • ${mode.description}`}
                    </Text>
                  </View>
                </View>

                {isSelected && (
                  <View style={styles.modeCheckmark}>
                    <Ionicons name="checkmark" size={16} color="white" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Footer Text */}
        <Text style={styles.footerText}>
          You can change this anytime in your preferences
        </Text>
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

export default TravelModeStep;
