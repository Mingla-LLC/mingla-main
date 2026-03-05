import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { locationService } from "../../services/locationService";
import {
  geocodingService,
  AutocompleteSuggestion,
} from "../../services/geocodingService";

interface LocationSetupStepProps {
  onNext: () => void | Promise<void>;
  onBack: () => void;
  location: string;
  onLocationChange?: (location: string) => void;
  onRequestLocationPermission?: () => Promise<void>;
}

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
  suggestionsContainer: {
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginTop: 4,
    marginBottom: 8,
    maxHeight: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  suggestionTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  suggestionText: {
    fontSize: 15,
    color: "#111827",
    fontWeight: "500",
  },
  suggestionSubtext: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
  },
});

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
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const isSelectingSuggestion = useRef(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync location prop to input when it changes externally (e.g., from "Use my current location")
  // Only update if location prop has a value (not empty string)
  useEffect(() => {
    if (location && location.trim().length > 0) {
      setLocationInput(location);
      setShowSuggestions(false);
    }
  }, [location]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

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

    // Clear previous timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Clear suggestions if text is too short
    if (text.trim().length < 4) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Debounce the API call
    debounceTimeoutRef.current = setTimeout(async () => {
      setIsLoadingSuggestions(true);
      try {
        const results = await geocodingService.autocomplete(text.trim());
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch (error) {
        console.error("Error fetching suggestions:", error);
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, 300);
  };

  // Handle selecting a suggestion
  const handleSuggestionSelect = (suggestion: AutocompleteSuggestion) => {
    // Mark that we're selecting to prevent blur handler from interfering
    isSelectingSuggestion.current = true;

    // Update input with displayName for better UX (shorter, more readable)

    setLocationInput(suggestion.displayName);
    setShowSuggestions(false);
    setIsInputFocused(false);

    // Pass fullAddress to parent for geocoding/backend processing
    if (onLocationChange) {
      onLocationChange(suggestion.fullAddress);
    }

    // Reset the flag after a short delay
    setTimeout(() => {
      isSelectingSuggestion.current = false;
    }, 300);
  };

  // Handle input blur with delay to allow clicks on suggestions
  const handleInputBlur = () => {
    setTimeout(() => {
      // Don't hide suggestions if user is selecting one
      if (!isSelectingSuggestion.current) {
        setIsInputFocused(false);
        setShowSuggestions(false);
      }
    }, 200);
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
              const locationString = `${locationData.latitude.toFixed(
                4
              )}, ${locationData.longitude.toFixed(4)}`;
              setLocationInput(locationString);
              if (onLocationChange) {
                onLocationChange(locationString);
              }
            }
          } else {
            // Could not get location, use default
            const defaultLocation = "";
            setLocationInput(defaultLocation);
            if (onLocationChange) {
              onLocationChange(defaultLocation);
            }
          }
        } else {
          // Permission denied, use default
          const defaultLocation = "";
          setLocationInput(defaultLocation);
          if (onLocationChange) {
            onLocationChange(defaultLocation);
          }
        }
      }
    } catch (error) {
      console.error("Error getting current location:", error);
      // On error, use default location
      const defaultLocation = "";
      setLocationInput(defaultLocation);
      if (onLocationChange) {
        onLocationChange(defaultLocation);
      }
    } finally {
      setIsRequestingLocation(false);
    }
  };

  return (
    <View style={styles.container}>
      {/*     <StatusBar barStyle="dark-content" backgroundColor="white" /> */}

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

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
          keyboardShouldPersistTaps="handled"
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
              onBlur={handleInputBlur}
              autoCapitalize="words"
              returnKeyType="done"
            />
          </View>

          {/* Suggestions Dropdown */}
          {showSuggestions &&
            (suggestions.length > 0 || isLoadingSuggestions) && (
              <ScrollView
                style={styles.suggestionsContainer}
                nestedScrollEnabled={true}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={true}
              >
                {isLoadingSuggestions ? (
                  <View style={styles.suggestionItem}>
                    <ActivityIndicator size="small" color="#eb7825" />
                    <Text style={styles.suggestionText}>Searching...</Text>
                  </View>
                ) : (
                  suggestions.map((suggestion, index) => (
                    <TouchableOpacity
                      key={index}
                      style={styles.suggestionItem}
                      onPress={() => {
                        console.log(
                          "TouchableOpacity onPress fired for:",
                          suggestion.displayName
                        );
                        handleSuggestionSelect(suggestion);
                      }}
                      onPressIn={() => {
                        console.log(
                          "TouchableOpacity onPressIn fired for:",
                          suggestion.displayName
                        );
                        isSelectingSuggestion.current = true;
                      }}
                      activeOpacity={0.7}
                      delayPressIn={0}
                    >
                      <Ionicons
                        name="location-outline"
                        size={18}
                        color="#6b7280"
                      />
                      <View style={styles.suggestionTextContainer}>
                        <Text style={styles.suggestionText}>
                          {suggestion.displayName}
                        </Text>
                        {suggestion.fullAddress !== suggestion.displayName && (
                          <Text
                            style={styles.suggestionSubtext}
                            numberOfLines={1}
                          >
                            {suggestion.fullAddress}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            )}

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
      </KeyboardAvoidingView>
    </View>
  );
};

export default LocationSetupStep;
