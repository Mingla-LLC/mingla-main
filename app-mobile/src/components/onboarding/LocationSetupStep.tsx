import React, { useState, useMemo, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { locationService } from "../../services/locationService";

interface LocationSetupStepProps {
  onNext: () => void | Promise<void>;
  onBack: () => void;
  location: string;
  onLocationChange?: (location: string) => void;
  onRequestLocationPermission?: () => Promise<void>;
}

const LocationSetupStep = ({
  onNext,
  onBack,
  location,
  onLocationChange,
  onRequestLocationPermission,
}: LocationSetupStepProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  const [locationInput, setLocationInput] = useState("");
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Sync location prop to input when it changes externally (e.g., from "Use my current location")
  // Only update if location prop has a value (not empty string)
  useEffect(() => {
    if (location && location.trim().length > 0) {
      setLocationInput(location);
    }
  }, [location]);

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
      marginBottom: 24,
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
    useLocationButton: {
      backgroundColor: "#ffedd5",
      borderWidth: 1.5,
      borderColor: "#eb7825",
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20,
      width: "100%",
    },
    useLocationButtonText: {
      color: "#eb7825",
      fontSize: 16,
      fontWeight: "600",
      marginLeft: 10,
    },
    separator: {
      alignItems: "center",
      marginVertical: 20,
    },
    separatorText: {
      fontSize: 14,
      color: "#9ca3af",
      fontWeight: "400",
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "white",
      borderWidth: 1.5,
      borderColor: "#e5e7eb",
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 16,
      marginBottom: 8,
    },
    inputContainerFocused: {
      borderColor: "#eb7825",
      borderWidth: 2,
    },
    inputIcon: {
      marginRight: 12,
    },
    textInput: {
      flex: 1,
      fontSize: 16,
      color: "#111827",
      padding: 0,
    },
    helperText: {
      fontSize: 12,
      color: "#9ca3af",
      marginBottom: 24,
      lineHeight: 18,
    },
    popularLocationsSection: {
      marginTop: 4,
    },
    popularLocationsTitle: {
      fontSize: 14,
      fontWeight: "400",
      color: "#111827",
      marginBottom: 12,
    },
    popularLocationsContainer: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    popularLocationChip: {
      backgroundColor: "#f3f4f6",
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 10,
      marginRight: 8,
      marginBottom: 8,
    },
    popularLocationChipText: {
      fontSize: 14,
      color: "#111827",
      fontWeight: "400",
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

  const popularLocations = [
    "San Francisco, CA",
    "New York, NY",
    "Los Angeles, CA",
    "Chicago, IL",
  ];

  // Check if location is entered
  const hasLocation = useMemo(() => {
    return locationInput && locationInput.trim().length > 0;
  }, [locationInput]);

  // Update location when input changes
  const handleLocationInputChange = (text: string) => {
    setLocationInput(text);
    if (onLocationChange) {
      onLocationChange(text);
    }
  };

  // Handle popular location selection
  const handlePopularLocationSelect = (location: string) => {
    setLocationInput(location);
    if (onLocationChange) {
      onLocationChange(location);
    }
  };

  // Handle "Use my current location" button
  const handleUseCurrentLocation = async () => {
    setIsRequestingLocation(true);
    try {
      if (onRequestLocationPermission) {
        // Use the provided handler if available
        await onRequestLocationPermission();
      } else {
        // Otherwise, use the location service directly
        const hasPermission = await locationService.requestPermissions();
        if (hasPermission) {
          const locationData = await locationService.getCurrentLocation();
          if (locationData) {
            // Reverse geocode to get city name
            const cityName = await locationService.reverseGeocode(
              locationData.latitude,
              locationData.longitude
            );
            if (cityName) {
              setLocationInput(cityName);
              if (onLocationChange) {
                onLocationChange(cityName);
              }
            } else {
              // Fallback to coordinates if reverse geocode fails
              const locationString = `${locationData.latitude.toFixed(4)}, ${locationData.longitude.toFixed(4)}`;
              setLocationInput(locationString);
              if (onLocationChange) {
                onLocationChange(locationString);
              }
            }
          } else {
            // Could not get location, use default
            const defaultLocation = "San Francisco, CA";
            setLocationInput(defaultLocation);
            if (onLocationChange) {
              onLocationChange(defaultLocation);
            }
          }
        } else {
          // Permission denied, use default
          const defaultLocation = "San Francisco, CA";
          setLocationInput(defaultLocation);
          if (onLocationChange) {
            onLocationChange(defaultLocation);
          }
        }
      }
    } catch (error) {
      console.error("Error getting current location:", error);
      // On error, use default location
      const defaultLocation = "San Francisco, CA";
      setLocationInput(defaultLocation);
      if (onLocationChange) {
        onLocationChange(defaultLocation);
      }
    } finally {
      setIsRequestingLocation(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />

      {/* Progress Bar Section */}
      <View style={styles.progressSection}>
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "40%" }]} />
          </View>
          <View style={styles.progressTextContainer}>
            <Text style={styles.progressTextLeft}>Step 4 of 10</Text>
            <Text style={styles.progressTextRight}>40% complete</Text>
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
          <Text style={styles.title}>Where are you?</Text>
          <Text style={styles.subtitle}>
            We'll show you experiences near your location
          </Text>
        </View>

        {/* Use My Current Location Button */}
        <TouchableOpacity
          style={styles.useLocationButton}
          onPress={handleUseCurrentLocation}
          disabled={isRequestingLocation}
          activeOpacity={0.7}
        >
          {isRequestingLocation ? (
            <ActivityIndicator size="small" color="#eb7825" />
          ) : (
            <Ionicons name="send-outline" size={20} color="#eb7825" />
          )}
          <Text style={styles.useLocationButtonText}>
            {isRequestingLocation
              ? "Getting location..."
              : "Use my current location"}
          </Text>
        </TouchableOpacity>

        {/* Separator */}
        <View style={styles.separator}>
          <Text style={styles.separatorText}>or</Text>
        </View>

        {/* Location Input Field */}
        <View
          style={[
            styles.inputContainer,
            isInputFocused && styles.inputContainerFocused,
          ]}
        >
          <Ionicons
            name="location"
            size={20}
            color={isInputFocused ? "#eb7825" : "#6b7280"}
            style={styles.inputIcon}
          />
          <TextInput
            style={styles.textInput}
            placeholder="Enter your city or address"
            placeholderTextColor="#9ca3af"
            value={locationInput}
            onChangeText={handleLocationInputChange}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>

        {/* Helper Text */}
        <Text style={styles.helperText}>
          We use your location to find experiences nearby
        </Text>

        {/* Popular Locations Section */}
        <View style={styles.popularLocationsSection}>
          <Text style={styles.popularLocationsTitle}>Popular locations:</Text>
          <View style={styles.popularLocationsContainer}>
            {popularLocations.map((loc) => (
              <TouchableOpacity
                key={loc}
                style={styles.popularLocationChip}
                onPress={() => handlePopularLocationSelect(loc)}
                activeOpacity={0.7}
              >
                <Text style={styles.popularLocationChipText}>{loc}</Text>
              </TouchableOpacity>
            ))}
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
            hasLocation && !isLoading
              ? styles.nextButtonEnabled
              : styles.nextButtonDisabled,
          ]}
          onPress={async () => {
            // Prevent onPress from firing if no location is entered or already loading
            if (!hasLocation || isLoading) {
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
          disabled={!hasLocation || isLoading}
          activeOpacity={!hasLocation || isLoading ? 1 : 0.7}
        >
          {isLoading ? (
            <>
              <ActivityIndicator
                size="small"
                color="#ffffff"
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.nextButtonText, styles.nextButtonTextEnabled]}>
                Saving...
              </Text>
            </>
          ) : (
            <>
              <Text
                style={[
                  styles.nextButtonText,
                  hasLocation
                    ? styles.nextButtonTextEnabled
                    : styles.nextButtonTextDisabled,
                ]}
              >
                Next
              </Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={hasLocation ? "#ffffff" : "#6b7280"}
              />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default LocationSetupStep;
