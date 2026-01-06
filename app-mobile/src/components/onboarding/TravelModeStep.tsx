import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

interface TravelModeStepProps {
  onNext: () => void | Promise<void>;
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
    optionsContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      marginBottom: 24,
    },
    modeCard: {
      width: "48%",
      backgroundColor: "white",
      borderWidth: 1,
      borderColor: "#e5e7eb",
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      position: "relative",
    },
    modeCardSelected: {
      backgroundColor: "#ffedd5",
      borderWidth: 2,
      borderColor: "#eb7825",
    },
    modeIcon: {
      marginBottom: 12,
    },
    modeTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 4,
    },
    modeSpeed: {
      fontSize: 14,
      color: "#6b7280",
      marginBottom: 4,
    },
    modeDescription: {
      fontSize: 14,
      color: "#6b7280",
      lineHeight: 20,
    },
    checkmarkContainer: {
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
    nextButtonText: {
      fontSize: 16,
      fontWeight: "500",
      color: "#ffffff",
      marginRight: 4,
    },
  });

  const travelModes = [
    {
      id: "walking",
      title: "Walking",
      icon: "walk-outline",
      speed: "~5 km/h",
      description: "Best for nearby spots",
    },
    {
      id: "biking",
      title: "Biking",
      icon: "bicycle-outline",
      speed: "~15 km/h",
      description: "Faster than walking",
    },
    {
      id: "public_transit",
      title: "Public Transit",
      icon: "bus-outline",
      speed: "~20 km/h avg",
      description: "Includes wait time",
    },
    {
      id: "driving",
      title: "Driving",
      icon: "car-outline",
      speed: "~30 km/h city",
      description: "Fastest option",
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* <StatusBar barStyle="dark-content" backgroundColor="white" /> */}

      {/* Progress Bar Section */}
      <View style={styles.progressSection}>
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "50%" }]} />
          </View>
          <View style={styles.progressTextContainer}>
            <Text style={styles.progressTextLeft}>Step 5 of 10</Text>
            <Text style={styles.progressTextRight}>50% complete</Text>
          </View>
        </View>
      </View>
      <KeyboardAvoidingView></KeyboardAvoidingView>
      {/* Scrollable Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        nestedScrollEnabled={true}
      >
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>How do you get around?</Text>
          <Text style={styles.subtitle}>
            This helps us show realistic travel times
          </Text>
        </View>

        {/* Transportation Options Grid (2x2) */}
        <View style={styles.optionsContainer}>
          {travelModes.map((mode) => {
            const isSelected = travelMode === mode.id;

            return (
              <TouchableOpacity
                key={mode.id}
                onPress={() => onTravelModeChange(mode.id)}
                style={[styles.modeCard, isSelected && styles.modeCardSelected]}
                activeOpacity={0.7}
              >
                {/* Checkmark (only for selected) */}
                {isSelected && (
                  <View style={styles.checkmarkContainer}>
                    <Ionicons name="checkmark" size={16} color="#ffffff" />
                  </View>
                )}

                {/* Icon */}
                <View style={styles.modeIcon}>
                  <Ionicons
                    name={mode.icon as any}
                    size={28}
                    color={isSelected ? "#eb7825" : "#6b7280"}
                  />
                </View>

                {/* Title */}
                <Text style={styles.modeTitle}>{mode.title}</Text>

                {/* Speed */}
                <Text style={styles.modeSpeed}>{mode.speed}</Text>

                {/* Description */}
                <Text style={styles.modeDescription}>{mode.description}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Footer Text */}
        <Text style={styles.footerText}>
          You can change this anytime in your preferences
        </Text>
      </ScrollView>

      {/* Navigation Buttons */}
      <View style={styles.navigationContainer}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={18} color="#111827" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.nextButton}
          onPress={async () => {
            if (isLoading) {
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
          disabled={isLoading}
          activeOpacity={isLoading ? 1 : 0.7}
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
              <Text style={styles.nextButtonText}>Next</Text>
              <Ionicons name="arrow-forward" size={18} color="#ffffff" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default TravelModeStep;
