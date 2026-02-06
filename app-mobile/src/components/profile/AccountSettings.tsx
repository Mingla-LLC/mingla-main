import * as React from "react";
import { useState, useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  StatusBar,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatCurrency } from "../utils/formatters";
import { fetchExchangeRates, getRate } from "../../services/currencyService";
import { PreferencesService } from "../../services/preferencesService";
import { supabase } from "../../services/supabase";
import { useAppState } from "../AppStateManager";
import {
  countryCurrencies,
  getCountriesByRegion,
  regionDisplayNames,
  getCurrencyByCountryCode,
  getCurrencyByCountryName,
  type CountryCurrency,
} from "../../services/countryCurrencyService";
import { LocationService } from "../../services/locationService";
import { geocodingService } from "../../services/geocodingService";

interface AccountSettingsProps {
  accountPreferences: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  onUpdatePreferences: (preferences: any) => void;
  onDeleteAccount: () => void;
  onNavigateBack: () => void;
}

// Region display order
const regionOrder = ['north_america', 'europe', 'africa', 'south_america', 'asia', 'middle_east', 'oceania'];

export default function AccountSettings() {
  const {
    accountPreferences,
    handleAccountPreferencesUpdate,
    setShowAccountSettings,
    user,
    profile,
    handleSignOut,
  } = useAppState();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'confirm' | 'deleting' | 'success' | 'error'>('confirm');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteInProgressRef = useRef(false);

  // Find the country that matches the saved currency, or default to US
  const findCountryByCurrency = (currencyCode: string): CountryCurrency | undefined => {
    return countryCurrencies.find(c => c.currencyCode === currencyCode);
  };

  const initialCountry = findCountryByCurrency(profile?.currency || "USD") || 
    countryCurrencies.find(c => c.countryCode === 'US');

  const [selectedCountry, setSelectedCountry] = useState<CountryCurrency | undefined>(initialCountry);
  const [selectedCurrency, setSelectedCurrency] = useState(
    profile?.currency || "USD"
  );
  const [selectedMeasurement, setSelectedMeasurement] = useState(
    profile?.measurement_system || "imperial"
  );
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);

  // Get countries grouped by region
  const countriesByRegion = React.useMemo(() => getCountriesByRegion(), []);

  useEffect(() => {
    fetchExchangeRates();
  }, []);

  const handleCountryChange = async (country: CountryCurrency) => {
    setSelectedCountry(country);
    setSelectedCurrency(country.currencyCode);
    
    const updatedPreferences = {
      ...accountPreferences,
      currency: country.currencyCode,
    };
    handleAccountPreferencesUpdate(updatedPreferences);
    
    if (user?.id) {
      try {
        await PreferencesService.updateUserProfile(user.id, {
          currency: country.currencyCode,
        });
      } catch (_e) {
        // Local state already updated; optionally show error
      }
    }
  };

  const handleMeasurementChange = async (system: "Metric" | "Imperial") => {
    setSelectedMeasurement(system.toLocaleLowerCase());
    const updatedPreferences = {
      ...accountPreferences,
      measurementSystem: system,
    };
    handleAccountPreferencesUpdate(updatedPreferences);
    if (user?.id) {
      try {
        await PreferencesService.updateUserProfile(user.id, {
          measurement_system: system === "Metric" ? "metric" : "imperial",
        });
      } catch (_e) {
        // Local state already updated; optionally show error
      }
    }
  };

  const handleAutoDetectCurrency = async () => {
    setIsDetectingLocation(true);
    try {
      const locationService = LocationService.getInstance();
      const location = await locationService.getCurrentLocation();
      
      if (!location) {
        Alert.alert(
          "Location Access Required",
          "Please enable location access to auto-detect your currency.",
          [{ text: "OK" }]
        );
        return;
      }

      const geocodeResult = await geocodingService.reverseGeocode(
        location.latitude,
        location.longitude
      );

      if (geocodeResult.country) {
        const detectedCountry = getCurrencyByCountryName(geocodeResult.country);
        
        if (detectedCountry) {
          await handleCountryChange(detectedCountry);
          Alert.alert(
            "Currency Detected",
            `Based on your location in ${geocodeResult.country}, we've set your currency to ${detectedCountry.currencyCode} (${detectedCountry.currencySymbol}).`,
            [{ text: "OK" }]
          );
        } else {
          Alert.alert(
            "Could Not Detect Currency",
            `We detected you're in ${geocodeResult.country}, but couldn't find a matching currency. Please select manually.`,
            [{ text: "OK" }]
          );
        }
      } else {
        Alert.alert(
          "Location Detection Failed",
          "We couldn't determine your country from your location. Please select your currency manually.",
          [{ text: "OK" }]
        );
      }
    } catch (error) {
      console.error("Auto-detect currency error:", error);
      Alert.alert(
        "Error",
        "Something went wrong while detecting your location. Please select your currency manually.",
        [{ text: "OK" }]
      );
    } finally {
      setIsDetectingLocation(false);
    }
  };

  const handleDeleteAccount = () => {
    setDeleteStep('confirm');
    setDeleteError(null);
    setShowDeleteConfirmModal(true);
  };

  const executeDeleteAccount = async () => {
    // Prevent duplicate requests
    if (deleteInProgressRef.current) return;
    
    if (!user?.id) {
      setDeleteError("You must be signed in to delete your account.");
      setDeleteStep('error');
      return;
    }

    deleteInProgressRef.current = true;
    setDeleteStep('deleting');
    setIsDeleting(true);

    try {
      const response = await supabase.functions.invoke("delete-user", {
        method: "POST",
        body: { userId: user.id },
      });

      // Log the full response for debugging
      console.log("Delete user full response:", JSON.stringify(response, null, 2));

      const { data, error } = response;

      if (error) {
        // Try to extract more details from the error
        console.error("Delete account error object:", JSON.stringify(error, null, 2));
        
        // Check if there's context with the actual error message
        let errorMessage = "An error occurred while deleting your account.";
        if ((error as any)?.context?.json) {
          try {
            const jsonError = await (error as any).context.json();
            console.error("Error JSON:", jsonError);
            errorMessage = jsonError?.error || errorMessage;
          } catch {}
        }
        if ((error as any)?.message) {
          errorMessage = (error as any).message;
        }
        throw new Error(errorMessage);
      }
      if (data?.error) throw new Error(data.error);

      // Show success state briefly before signing out
      setDeleteStep('success');
      
      // Wait a moment to show success message, then sign out
      setTimeout(async () => {
        setShowDeleteConfirmModal(false);
        setShowAccountSettings(false);
        await handleSignOut();
      }, 2000);
    } catch (e: any) {
      console.error("Delete account error:", e);
      console.error("Error details:", JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
      // Try to get the most useful error message
      let errorMsg = "Could not delete account. Please try again.";
      if (e?.message && e.message !== "Edge Function returned a non-2xx status code") {
        errorMsg = e.message;
      }
      setDeleteError(errorMsg);
      setDeleteStep('error');
    } finally {
      setIsDeleting(false);
      deleteInProgressRef.current = false;
    }
  };

  const closeDeleteModal = () => {
    if (deleteStep === 'deleting') return; // Don't allow closing while deleting
    setShowDeleteConfirmModal(false);
    setDeleteStep('confirm');
    setDeleteError(null);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="dark-content" />
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <TouchableOpacity
            onPress={() => setShowAccountSettings(false)}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <ScrollView style={styles.content}>
        {/* Currency Preference */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="globe" size={20} color="#eb7825" />
            <Text style={styles.sectionTitle}>Currency Preference</Text>
          </View>

          <Text style={styles.sectionDescription}>
            Choose your preferred currency for displaying prices throughout the
            app. All amounts are converted from USD using current exchange
            rates.
          </Text>

          <View style={styles.tipBox}>
            <View style={styles.tipContent}>
              <Ionicons
                name="bulb"
                size={20}
                color="#eab308"
                style={styles.tipIcon}
              />
              <Text style={styles.tipText}>
                <Text style={styles.tipBold}>Tip:</Text> Exchange rates are
                updated regularly. All venue prices are originally in USD and
                converted for your convenience.
              </Text>
            </View>
          </View>

          {/* Auto-detect Currency Button */}
          <TouchableOpacity
            onPress={handleAutoDetectCurrency}
            style={styles.autoDetectButton}
            disabled={isDetectingLocation}
          >
            {isDetectingLocation ? (
              <ActivityIndicator size="small" color="#eb7825" />
            ) : (
              <Ionicons name="location" size={18} color="#eb7825" />
            )}
            <Text style={styles.autoDetectButtonText}>
              {isDetectingLocation ? "Detecting..." : "Detect from my location"}
            </Text>
          </TouchableOpacity>

          <View style={styles.currencyContainer}>
            <ScrollView
              style={styles.currencyScrollView}
              contentContainerStyle={styles.currencyScrollContent}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
            >
              {regionOrder.map((region) => {
                const countries = countriesByRegion[region];
                if (!countries || countries.length === 0) return null;
                
                return (
                  <View key={region}>
                    <Text style={styles.regionHeader}>
                      {regionDisplayNames[region] || region}
                    </Text>
                    {countries.map((country) => (
                      <TouchableOpacity
                        key={country.countryCode}
                        onPress={() => handleCountryChange(country)}
                        style={[
                          styles.currencyItem,
                          selectedCountry?.countryCode === country.countryCode &&
                            styles.currencyItemSelected,
                        ]}
                      >
                        <View style={styles.currencyInfo}>
                          <Text style={styles.currencySymbol}>{country.currencySymbol}</Text>
                          <View style={styles.currencyDetails}>
                            <Text style={styles.currencyCode}>{country.countryName}</Text>
                            <Text style={styles.currencyName}>
                              {country.currencyCode} ({country.currencySymbol})
                            </Text>
                          </View>
                        </View>
                        <View style={styles.currencyExample}>
                          <Text style={styles.currencyRate}>
                            1 USD = {getRate(country.currencyCode)} {country.currencyCode}
                          </Text>
                        </View>
                        {selectedCountry?.countryCode === country.countryCode && (
                          <Ionicons
                            name="checkmark"
                            size={20}
                            color="#eb7825"
                            style={styles.checkIcon}
                          />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })}
            </ScrollView>
          </View>

          {selectedCountry && selectedCountry.currencyCode !== "USD" && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                <Text style={styles.infoBold}>Selected:</Text>{" "}
                {selectedCountry.countryName} - {selectedCountry.currencyCode} ({selectedCountry.currencySymbol})
                {"\n"}
                Exchange rates are updated regularly and may fluctuate.
              </Text>
            </View>
          )}
        </View>

        {/* Measurement System */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="resize" size={20} color="#eb7825" />
            <Text style={styles.sectionTitle}>Measurement System</Text>
          </View>

          <Text style={styles.sectionDescription}>
            Choose how distances, sizes, and other measurements are displayed
            throughout the app.
          </Text>

          <View style={styles.measurementOptions}>
            <TouchableOpacity
              onPress={() => handleMeasurementChange("Imperial")}
              style={[
                styles.measurementOption,
                selectedMeasurement === "imperial" &&
                  styles.measurementOptionSelected,
              ]}
            >
              <View style={styles.measurementInfo}>
                <Text style={styles.measurementTitle}>Imperial</Text>
                <Text style={styles.measurementDescription}>
                  Miles, feet, inches, Fahrenheit
                </Text>
              </View>
              {selectedMeasurement === "imperial" && (
                <Ionicons name="checkmark" size={20} color="#eb7825" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleMeasurementChange("Metric")}
              style={[
                styles.measurementOption,
                selectedMeasurement === "metric" &&
                  styles.measurementOptionSelected,
              ]}
            >
              <View style={styles.measurementInfo}>
                <Text style={styles.measurementTitle}>Metric</Text>
                <Text style={styles.measurementDescription}>
                  Kilometers, meters, centimeters, Celsius
                </Text>
              </View>
              {selectedMeasurement === "metric" && (
                <Ionicons name="checkmark" size={20} color="#eb7825" />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              <Text style={styles.infoBold}>Selected:</Text>{" "}
              {selectedMeasurement} system
              {"\n"}
              This will apply to all distance and measurement displays in the
              app.
            </Text>
          </View>
        </View>

        {/* Account Lifecycle */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="trash" size={20} color="#ef4444" />
            <Text style={styles.sectionTitle}>Delete Account</Text>
          </View>

          <Text style={styles.sectionDescription}>
            Permanently delete your Mingla account and all associated data.
          </Text>

          <TouchableOpacity
            onPress={handleDeleteAccount}
            style={[
              styles.deleteButton,
              isDeleting && styles.deleteButtonDisabled,
            ]}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#dc2626" />
            ) : (
              <Ionicons name="trash" size={16} color="#dc2626" />
            )}
            <Text style={styles.deleteButtonText}>
              {isDeleting ? "Deleting…" : "Delete Account"}
            </Text>
          </TouchableOpacity>

          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              <Text style={styles.warningBold}>Warning:</Text> Account deletion
              is permanent and cannot be reversed. Make sure to save any
              important information before proceeding.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Delete Account Confirmation Modal */}
      <Modal
        visible={showDeleteConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {deleteStep === 'confirm' && (
              <>
                <View style={styles.modalIconContainer}>
                  <Ionicons name="warning" size={48} color="#ef4444" />
                </View>
                <Text style={styles.modalTitle}>Delete Your Account?</Text>
                <Text style={styles.modalDescription}>
                  This action is <Text style={styles.modalBold}>permanent</Text> and cannot be undone.
                </Text>
                <Text style={styles.modalSubDescription}>
                  • All your saved experiences, preferences, and activity history will be erased{"\n"}
                  • You will be removed from all collaboration boards{"\n"}
                  • You will no longer appear in search, connections, or member lists{"\n"}
                  • You cannot sign in again with these credentials
                </Text>
                <View style={styles.modalButtonRow}>
                  <TouchableOpacity
                    style={styles.modalCancelButton}
                    onPress={closeDeleteModal}
                  >
                    <Text style={styles.modalCancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalDeleteButton}
                    onPress={executeDeleteAccount}
                  >
                    <Text style={styles.modalDeleteButtonText}>Delete Account</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {deleteStep === 'deleting' && (
              <>
                <ActivityIndicator size="large" color="#ef4444" style={styles.modalLoader} />
                <Text style={styles.modalTitle}>Deleting Account...</Text>
                <Text style={styles.modalDescription}>
                  Please wait while we remove your account and all associated data.
                </Text>
                <Text style={styles.modalSubDescription}>
                  This may take a moment. Do not close the app.
                </Text>
              </>
            )}

            {deleteStep === 'success' && (
              <>
                <View style={styles.modalIconContainerSuccess}>
                  <Ionicons name="checkmark-circle" size={48} color="#10b981" />
                </View>
                <Text style={styles.modalTitle}>Account Deleted</Text>
                <Text style={styles.modalDescription}>
                  Your account has been permanently deleted.
                </Text>
                <Text style={styles.modalSubDescription}>
                  You will be signed out momentarily. Thank you for using Mingla.
                </Text>
              </>
            )}

            {deleteStep === 'error' && (
              <>
                <View style={styles.modalIconContainer}>
                  <Ionicons name="close-circle" size={48} color="#ef4444" />
                </View>
                <Text style={styles.modalTitle}>Deletion Failed</Text>
                <Text style={styles.modalDescription}>
                  {deleteError || "Something went wrong. Please try again."}
                </Text>
                <View style={styles.modalButtonRow}>
                  <TouchableOpacity
                    style={styles.modalCancelButton}
                    onPress={closeDeleteModal}
                  >
                    <Text style={styles.modalCancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalRetryButton}
                    onPress={() => {
                      setDeleteStep('confirm');
                      setDeleteError(null);
                    }}
                  >
                    <Text style={styles.modalRetryButtonText}>Try Again</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  header: {
    borderBottomColor: "#e5e7eb",
    paddingHorizontal: 16,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    paddingTop: 8,
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111827",
  },
  content: {
    flex: 1,
    gap: 24,
    padding: 12,
  },
  section: {
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingVertical: 24,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  sectionDescription: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 16,
    lineHeight: 20,
  },
  tipBox: {
    backgroundColor: "#e0f2fe",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  tipContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  tipIcon: {
    marginTop: 2,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: "#1e40af",
    lineHeight: 20,
  },
  tipBold: {
    fontWeight: "600",
  },
  autoDetectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fef3e2",
    borderWidth: 1,
    borderColor: "#eb7825",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  autoDetectButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#eb7825",
  },
  currencyContainer: {
    marginBottom: 16,
  },
  currencyScrollView: {
    height: 180, // Fixed height to show ~3 currencies
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    backgroundColor: "#f9fafb",
  },
  currencyScrollContent: {
    padding: 8,
  },
  regionHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  currencyItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 4,
    backgroundColor: "white",
  },
  currencyItemSelected: {
    borderColor: "#eb7825",
    backgroundColor: "#fef3e2",
  },
  currencyInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  currencySymbol: {
    fontSize: 18,
    fontWeight: "500",
    color: "#111827",
  },
  currencyDetails: {
    flex: 1,
  },
  currencyCode: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  currencyName: {
    fontSize: 14,
    color: "#6b7280",
  },
  currencyExample: {
    alignItems: "flex-end",
    marginRight: 8,
  },
  currencyExampleText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  currencyRate: {
    fontSize: 12,
    color: "#6b7280",
  },
  checkIcon: {
    marginLeft: 8,
  },
  infoBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#fef3e2",
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 8,
  },
  infoText: {
    fontSize: 14,
    color: "#eb7825",
    lineHeight: 20,
  },
  infoBold: {
    fontWeight: "600",
  },
  measurementOptions: {
    gap: 12,
  },
  measurementOption: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  measurementOptionSelected: {
    borderColor: "#eb7825",
    backgroundColor: "#fef3e2",
  },
  measurementInfo: {
    flex: 1,
  },
  measurementTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  measurementDescription: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 2,
  },
  deleteButton: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 8,
    marginBottom: 16,
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#dc2626",
  },
  warningBox: {
    padding: 12,
    backgroundColor: "#fef3e2",
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 8,
  },
  warningText: {
    fontSize: 14,
    color: "#eb7825",
    lineHeight: 20,
  },
  warningBold: {
    fontWeight: "600",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContainer: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },
  modalIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#fef2f2",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  modalIconContainerSuccess: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#d1fae5",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  modalLoader: {
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 12,
    textAlign: "center",
  },
  modalDescription: {
    fontSize: 16,
    color: "#4b5563",
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 22,
  },
  modalBold: {
    fontWeight: "bold",
    color: "#ef4444",
  },
  modalSubDescription: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "left",
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  modalButtonRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  modalCancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },
  modalDeleteButton: {
    flex: 1,
    backgroundColor: "#ef4444",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  modalDeleteButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  modalRetryButton: {
    flex: 1,
    backgroundColor: "#eb7825",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  modalRetryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
});
