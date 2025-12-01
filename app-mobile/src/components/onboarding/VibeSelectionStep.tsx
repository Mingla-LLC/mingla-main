import React, { useState, useMemo } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

interface VibeSelectionStepProps {
  onNext: () => void | Promise<void>;
  onBack: () => void;
  vibes: string[];
  onVibeToggle: (vibeId: string) => void;
  intents?: any[] | null | undefined;
}

const soloAdventureVibes = [
  "Take a Stroll",
  "Sip & Chill",
  "Casual Eats",
  "Screen & Relax",
  "Creative & Hands-On",
  "Picnics",
  "Play & Move",
  "Dining Experiences",
  "Wellness Dates",
  "Freestyle",
];
const firstDatesVibes = [
  "Take a Stroll",
  "Sip & Chill",
  "Screen & Relax",
  "Creative & Hands-On",
  "Picnics",
  "Play & Move",
  "Dining Experiences",
];
const romanticVibes = [
  "Sip & Chill",
  "Picnics",
  "Dining Experiences",
  "Wellness Dates",
];
const friendlyVibes = [
  "Take a Stroll",
  "Sip & Chill",
  "Casual Eats",
  "Screen & Relax",
  "Creative & Hands-On",
  "Picnics",
  "Play & Move",
  "Dining Experiences",
  "Wellness Dates",
  "Freestyle",
];
const groupFunVibes = [
  "Casual Eats",
  "Screen & Relax",
  "Creative & Hands-On",
  "Play & Move",
  "Freestyle",
];
const businessVibes = ["Take a Stroll", "Sip & Chill", "Dining Experiences"];

const VibeSelectionStep = ({
  onNext,
  onBack,
  vibes,
  onVibeToggle,
  intents,
}: VibeSelectionStepProps) => {
  const [isLoading, setIsLoading] = useState(false);

  // Get screen dimensions for responsive layout
  const screenWidth = Dimensions.get("window").width;
  const isLargeScreen = screenWidth >= 768; // Tablet or larger
  const numColumns = isLargeScreen ? 3 : 2;
  const padding = 24;
  const gap = 12;
  const cardWidth = useMemo(() => {
    const totalPadding = padding * 2;
    const totalGaps = gap * (numColumns - 1);
    return (screenWidth - totalPadding - totalGaps) / numColumns;
  }, [screenWidth, numColumns, padding, gap]);

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
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "flex-start",
    },
    vibeCard: {
      backgroundColor: "white",
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: "#e5e7eb",
      padding: 16,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 90,
      marginBottom: 12,
    },
    vibeCardSelected: {
      backgroundColor: "#eb7825",
      borderColor: "#eb7825",
      borderWidth: 2,
    },
    vibeIconContainer: {
      width: 28,
      height: 28,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: 8,
    },
    vibeIconSelected: {
      color: "#ffffff",
    },
    vibeTextContainer: {
      alignItems: "center",
      justifyContent: "center",
    },
    vibeTitle: {
      fontSize: 13,
      fontWeight: "600",
      color: "#111827",
      textAlign: "center",
    },
    vibeTitleSelected: {
      color: "#ffffff",
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

  // Get the appropriate icon name for each vibe
  const getIconName = (vibeId: string): string => {
    switch (vibeId) {
      case "take-a-stroll":
        return "eye-outline";
      case "sip-and-chill":
        return "cafe-outline";
      case "casual-eats":
        return "restaurant-outline";
      case "screen-and-relax":
        return "musical-notes-outline";
      case "creative-hands-on":
        return "construct-outline"; // Gear/cog icon for Creative & Hands-On
      case "picnics":
        return "basket-outline";
      case "play-and-move":
        return "people-outline"; // Two people icon for Play & Move
      case "dining-experiences":
        return "fast-food-outline"; // Fork and knife icon for Dining Experiences
      case "wellness-dates":
        return "leaf-outline";
      case "freestyle":
        return "star-outline";
      default:
        return "ellipse-outline";
    }
  };

  // Map vibe names to vibe IDs
  const vibeNameToId: { [key: string]: string } = {
    "Take a Stroll": "take-a-stroll",
    "Sip & Chill": "sip-and-chill",
    "Casual Eats": "casual-eats",
    "Screen & Relax": "screen-and-relax",
    "Creative & Hands-On": "creative-hands-on",
    Picnics: "picnics",
    "Play & Move": "play-and-move",
    "Dining Experiences": "dining-experiences",
    "Wellness Dates": "wellness-dates",
    Freestyle: "freestyle",
  };

  // Map intents to their vibe arrays
  const getVibesForIntent = (intentId: string): string[] => {
    let vibeNames: string[] = [];

    switch (intentId) {
      case "solo-adventure":
        vibeNames = soloAdventureVibes;
        break;
      case "first-dates":
        vibeNames = firstDatesVibes;
        break;
      case "romantic":
        vibeNames = romanticVibes;
        break;
      case "friendly":
        vibeNames = friendlyVibes;
        break;
      case "group-fun":
        vibeNames = groupFunVibes;
        break;
      case "business":
        vibeNames = businessVibes;
        break;
      default:
        // Default: show all vibes
        vibeNames = soloAdventureVibes; // All vibes
        break;
    }

    // Convert vibe names to vibe IDs
    return vibeNames
      .map((name) => vibeNameToId[name])
      .filter((id) => id !== undefined) as string[];
  };

  // All available vibe options
  const allVibeOptions = [
    {
      id: "take-a-stroll",
      name: "Take a Stroll",
    },
    {
      id: "sip-and-chill",
      name: "Sip & Chill",
    },
    {
      id: "casual-eats",
      name: "Casual Eats",
    },
    {
      id: "screen-and-relax",
      name: "Screen & Relax",
    },
    {
      id: "creative-hands-on",
      name: "Creative & Hands-On",
    },
    {
      id: "picnics",
      name: "Picnics",
    },
    {
      id: "play-and-move",
      name: "Play & Move",
    },
    {
      id: "dining-experiences",
      name: "Dining Experiences",
    },
    {
      id: "wellness-dates",
      name: "Wellness Dates",
    },
    {
      id: "freestyle",
      name: "Freestyle",
    },
  ];

  // Filter vibe options based on selected intents
  // When multiple intents are selected, show the union of all vibes from all selected intents
  const getFilteredVibeOptions = (): typeof allVibeOptions => {
    // Always require intents to filter vibes - if no intents, return empty array
    // This ensures we don't show all vibes when intents aren't properly loaded
    if (!intents || !Array.isArray(intents) || intents.length === 0) {
      console.warn(
        "VibeSelectionStep: No intents provided, showing empty vibe list"
      );
      return [];
    }

    // Get all unique vibe IDs that are available for ALL selected intents (union)
    const availableVibeIds = new Set<string>();

    intents.forEach((intent: any) => {
      // Handle both object format {id: "first-dates"} and string format "first-dates"
      let intentId: string;
      if (typeof intent === "string") {
        intentId = intent;
      } else if (intent && intent.id) {
        intentId = intent.id;
      } else {
        console.warn("VibeSelectionStep: Invalid intent format", intent);
        return;
      }

      // Get vibes for this specific intent
      const vibesForIntent = getVibesForIntent(intentId);
      if (vibesForIntent && vibesForIntent.length > 0) {
        // Add all vibes from this intent to the set (union operation)
        vibesForIntent.forEach((vibeId) => availableVibeIds.add(vibeId));
      }
    });

    // Filter and return only the vibes that are available for the selected intents
    // Maintain the order from allVibeOptions for consistency
    const filtered = allVibeOptions.filter((vibe) =>
      availableVibeIds.has(vibe.id)
    );

    return filtered;
  };

  const vibeOptions = getFilteredVibeOptions();

  // Check if vibes are selected (robust check)
  // Only consider vibes that are actually in the filtered list
  const hasVibesSelected = useMemo(() => {
    // If no vibes are available (no intents selected), disable button
    if (vibeOptions.length === 0) {
      return false;
    }

    // If no vibes are selected, disable button
    if (!vibes || !Array.isArray(vibes) || vibes.length === 0) {
      return false;
    }

    // Check if any of the selected vibes are in the current filtered vibe options
    const availableVibeIds = new Set(vibeOptions.map((v) => v.id));

    // Only return true if at least one selected vibe is in the available options
    const hasValidSelection = vibes.some((vibeId: string) =>
      availableVibeIds.has(vibeId)
    );

    return hasValidSelection;
  }, [vibes, vibeOptions]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />

      {/* Progress Bar Section */}
      <View style={styles.progressSection}>
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "30%" }]} />
          </View>
          <View style={styles.progressTextContainer}>
            <Text style={styles.progressTextLeft}>Step 3 of 10</Text>
            <Text style={styles.progressTextRight}>30% complete</Text>
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
          <Text style={styles.title}>What's your vibe?</Text>
          <Text style={styles.subtitle}>
            Pick the experience categories you love
          </Text>
        </View>

        {/* Vibe Options Grid */}
        <View style={styles.optionsContainer}>
          {vibeOptions.map((option, index) => {
            const isSelected = hasVibesSelected && vibes.includes(option.id);

            // Calculate marginRight based on column position
            const isLastInRow = (index + 1) % numColumns === 0;
            const marginRight = isLastInRow ? 0 : gap;

            return (
              <TouchableOpacity
                key={option.id}
                onPress={() => onVibeToggle(option.id)}
                style={[
                  styles.vibeCard,
                  isSelected && styles.vibeCardSelected,
                  {
                    width: cardWidth,
                    marginRight: marginRight,
                  },
                ]}
                activeOpacity={0.7}
              >
                <View style={styles.vibeIconContainer}>
                  <Ionicons
                    name={getIconName(option.id) as any}
                    size={24}
                    color={isSelected ? "#ffffff" : "#374151"}
                  />
                </View>

                <View style={styles.vibeTextContainer}>
                  <Text
                    style={[
                      styles.vibeTitle,
                      isSelected && styles.vibeTitleSelected,
                    ]}
                  >
                    {option.name}
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
            hasVibesSelected && !isLoading
              ? styles.nextButtonEnabled
              : styles.nextButtonDisabled,
          ]}
          onPress={async () => {
            // Prevent onPress from firing if no vibes are selected or already loading
            if (!hasVibesSelected || isLoading) {
              return;
            }

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
          disabled={!hasVibesSelected || isLoading}
          activeOpacity={!hasVibesSelected || isLoading ? 1 : 0.7}
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
                  hasVibesSelected
                    ? styles.nextButtonTextEnabled
                    : styles.nextButtonTextDisabled,
                ]}
              >
                Next
              </Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={hasVibesSelected ? "#ffffff" : "#6b7280"}
              />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default VibeSelectionStep;
