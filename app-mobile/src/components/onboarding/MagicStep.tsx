import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import minglaLogo from "../../../assets/6850c6540f4158618f67e1fdd72281118b419a35.png";

interface MagicStepProps {
  onComplete: (onboardingData: any) => void | Promise<void>;
  onBack: () => void;
  onboardingData: any;
  onNavigateToStep?: (step: number) => void;
}

const MagicStep = ({
  onComplete,
  onBack,
  onboardingData,
  onNavigateToStep,
}: MagicStepProps) => {
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "white",
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 40,
      paddingBottom: 140,
    },
    logoContainer: {
      alignItems: "center",
      marginBottom: 24,
    },
    logo: {
      width: 120,
      height: 40,
      resizeMode: "contain",
    },
    titleSection: {
      alignItems: "center",
      marginBottom: 32,
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
    summaryList: {
      marginBottom: 32,
    },
    summaryItem: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#f9fafb",
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      shadowColor: "#000",
      shadowOffset: {
        width: 0,
        height: 1,
      },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    summaryItemIcon: {
      marginRight: 12,
    },
    summaryItemContent: {
      flex: 1,
    },
    summaryItemTitle: {
      fontSize: 14,
      fontWeight: "500",
      color: "#6b7280",
      marginBottom: 4,
    },
    summaryItemValue: {
      fontSize: 16,
      fontWeight: "400",
      color: "#111827",
    },
    summaryItemEdit: {
      marginLeft: 12,
      padding: 4,
    },
    ctaSection: {
      alignItems: "center",
      marginBottom: 24,
    },
    ctaText: {
      fontSize: 16,
      fontWeight: "400",
      color: "#111827",
      textAlign: "center",
      marginBottom: 4,
      lineHeight: 24,
    },
    getStartedButton: {
      backgroundColor: "#eb7825",
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 24,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      marginTop: 8,
    },
    getStartedButtonText: {
      color: "#ffffff",
      fontSize: 16,
      fontWeight: "600",
      marginRight: 8,
    },
  });

  // Helper functions to format data
  const formatIntents = () => {
    if (!onboardingData.intents || onboardingData.intents.length === 0) {
      return "Not selected";
    }
    return onboardingData.intents
      .map((intent: any) => {
        if (typeof intent === "string") {
          return intent;
        }
        return intent.title || intent.experienceType || intent.id;
      })
      .join(" / ");
  };

  const formatCategories = () => {
    if (!onboardingData.vibes || onboardingData.vibes.length === 0) {
      return "Not selected";
    }

    // Map vibe IDs to names
    const vibeNameMap: { [key: string]: string } = {
      "take-a-stroll": "Take a Stroll",
      "sip-and-chill": "Sip & Chill",
      "casual-eats": "Casual Eats",
      "screen-and-relax": "Screen & Relax",
      "creative-hands-on": "Creative & Hands-On",
      picnics: "Picnics",
      "play-and-move": "Play & Move",
      "dining-experiences": "Dining Experiences",
      "wellness-dates": "Wellness Dates",
      freestyle: "Freestyle",
    };

    const vibeNames = onboardingData.vibes.map((vibeId: string) => {
      return vibeNameMap[vibeId] || vibeId;
    });

    // Show first one or join if multiple
    if (vibeNames.length === 1) {
      return vibeNames[0];
    }
    return vibeNames.join(", ");
  };

  const formatLocation = () => {
    return onboardingData.location || "Not set";
  };

  const formatTravelMode = () => {
    if (!onboardingData.travelMode) {
      return "Not selected";
    }
    const mode = onboardingData.travelMode;
    const modeMap: { [key: string]: string } = {
      walking: "Walking",
      biking: "Biking",
      public_transit: "Public Transit",
      driving: "Driving",
    };
    return modeMap[mode] || mode.charAt(0).toUpperCase() + mode.slice(1);
  };

  const formatBudget = () => {
    if (!onboardingData.budgetRange) {
      return "Not set";
    }
    const { min, max } = onboardingData.budgetRange;
    if (max === null || max === undefined) {
      return `$${min.toFixed(2)} per person`;
    }
    if (min === max) {
      return `$${min.toFixed(2)} per person`;
    }
    // Show range format
    return `$${min.toFixed(2)} - $${max.toFixed(2)} per person`;
  };

  const formatTravelLimit = () => {
    if (!onboardingData.travelConstraintType || !onboardingData.travelConstraintValue) {
      return "Not set";
    }
    const { travelConstraintType, travelConstraintValue } = onboardingData;
    if (travelConstraintType === "time") {
      return `Up to ${travelConstraintValue} minutes`;
    } else {
      return `Up to ${travelConstraintValue} km`;
    }
  };

  const formatDateTime = () => {
    if (!onboardingData.dateTimePref) {
      return "Not set";
    }
    const { dateOption, timeSlot, selectedDate, exactTime } = onboardingData.dateTimePref;

    if (dateOption === "Now") {
      return "Now";
    } else if (dateOption === "Today") {
      if (exactTime) {
        return `Today, ${exactTime}`;
      } else if (timeSlot) {
        const timeSlotMap: { [key: string]: string } = {
          brunch: "Brunch",
          afternoon: "Afternoon",
          dinner: "Dinner",
          lateNight: "Late Night",
        };
        return `Today, ${timeSlotMap[timeSlot] || timeSlot}`;
      }
      return "Today";
    } else if (dateOption === "This Weekend") {
      if (exactTime) {
        return `This Weekend, ${exactTime}`;
      } else if (timeSlot) {
        const timeSlotMap: { [key: string]: string } = {
          brunch: "Brunch",
          afternoon: "Afternoon",
          dinner: "Dinner",
          lateNight: "Late Night",
        };
        return `This Weekend, ${timeSlotMap[timeSlot] || timeSlot}`;
      }
      return "This Weekend";
    } else if (dateOption === "Pick a Date") {
      if (selectedDate) {
        const date = new Date(selectedDate);
        const dateStr = date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        if (exactTime) {
          return `${dateStr}, ${exactTime}`;
        } else if (timeSlot) {
          const timeSlotMap: { [key: string]: string } = {
            brunch: "Brunch",
            afternoon: "Afternoon",
            dinner: "Dinner",
            lateNight: "Late Night",
          };
          return `${dateStr}, ${timeSlotMap[timeSlot] || timeSlot}`;
        }
        return dateStr;
      }
      return "Pick a Date";
    }

    return "Not set";
  };

  // Summary items configuration
  const summaryItems = [
    {
      id: "intents",
      title: "Intents",
      icon: "heart-outline",
      value: formatIntents(),
      step: 2,
    },
    {
      id: "categories",
      title: "Categories",
      icon: "cafe-outline",
      value: formatCategories(),
      step: 3,
    },
    {
      id: "location",
      title: "Location",
      icon: "location-outline",
      value: formatLocation(),
      step: 4,
    },
    {
      id: "travelMode",
      title: "Travel Mode",
      icon: "paper-plane-outline",
      value: formatTravelMode(),
      step: 5,
    },
    {
      id: "budget",
      title: "Budget",
      icon: "cash-outline",
      value: formatBudget(),
      step: 7,
    },
    {
      id: "travelLimit",
      title: "Travel Limit",
      icon: "time-outline",
      value: formatTravelLimit(),
      step: 6,
    },
    {
      id: "dateTime",
      title: "Date & Time",
      icon: "calendar-outline",
      value: formatDateTime(),
      step: 8,
    },
  ];

  const handleEdit = (step: number) => {
    if (onNavigateToStep) {
      onNavigateToStep(step);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />

      {/* Scrollable Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        nestedScrollEnabled={true}
      >
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Image
            source={minglaLogo}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>You're almost there!</Text>
          <Text style={styles.subtitle}>Here's your summary.</Text>
        </View>

        {/* Summary List */}
        <View style={styles.summaryList}>
          {summaryItems.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.summaryItem}
              onPress={() => handleEdit(item.step)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={item.icon as any}
                size={20}
                color="#eb7825"
                style={styles.summaryItemIcon}
              />
              <View style={styles.summaryItemContent}>
                <Text style={styles.summaryItemTitle}>{item.title}</Text>
                <Text style={styles.summaryItemValue}>{item.value}</Text>
              </View>
              <TouchableOpacity
                style={styles.summaryItemEdit}
                onPress={() => handleEdit(item.step)}
                activeOpacity={0.7}
              >
                <Ionicons name="create-outline" size={20} color="#6b7280" />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>

        {/* Call to Action Section */}
        <View style={styles.ctaSection}>
          <Text style={styles.ctaText}>
            Ready to discover amazing experiences?
          </Text>
          <Text style={styles.ctaText}>
            Click "Get Started" to begin your journey
          </Text>
        </View>
      </ScrollView>

      {/* Get Started Button */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: "white",
          paddingHorizontal: 24,
          paddingVertical: 16,
          borderTopWidth: 1,
          borderTopColor: "#f3f4f6",
        }}
      >
        <TouchableOpacity
          style={styles.getStartedButton}
          onPress={onComplete}
          activeOpacity={0.7}
        >
          <Text style={styles.getStartedButtonText}>Get Started</Text>
          <Ionicons name="arrow-forward" size={20} color="#ffffff" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default MagicStep;
