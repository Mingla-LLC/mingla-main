import * as React from "react";
import { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatCurrency } from "../utils/formatters";
import { fetchExchangeRates, getRate } from "../../services/currencyService";
import { PreferencesService } from "../../services/preferencesService";
import { supabase } from "../../services/supabase";
import { useAppState } from "../AppStateManager";

interface AccountSettingsProps {
  accountPreferences: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  onUpdatePreferences: (preferences: any) => void;
  onDeleteAccount: () => void;
  onNavigateBack: () => void;
}

const supportedCurrencies = [
  // USD first as default
  { code: "USD", name: "US Dollar", symbol: "$" },

  // All other currencies in alphabetical order by currency code
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦" },
  { code: "BIF", name: "Burundian Franc", symbol: "FBu" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$" },
  { code: "BWP", name: "Botswanan Pula", symbol: "P" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
  { code: "CVE", name: "Cape Verdean Escudo", symbol: "$" },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč" },
  { code: "DJF", name: "Djiboutian Franc", symbol: "Fdj" },
  { code: "DKK", name: "Danish Krone", symbol: "kr" },
  { code: "DZD", name: "Algerian Dinar", symbol: "د.ج" },
  { code: "EGP", name: "Egyptian Pound", symbol: "£" },
  { code: "ERN", name: "Eritrean Nakfa", symbol: "Nfk" },
  { code: "ETB", name: "Ethiopian Birr", symbol: "Br" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "₵" },
  { code: "GMD", name: "Gambian Dalasi", symbol: "D" },
  { code: "GNF", name: "Guinean Franc", symbol: "FG" },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$" },
  { code: "HUF", name: "Hungarian Forint", symbol: "Ft" },
  { code: "ILS", name: "Israeli Shekel", symbol: "₪" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
  { code: "KMF", name: "Comorian Franc", symbol: "CF" },
  { code: "KRW", name: "South Korean Won", symbol: "₩" },
  { code: "LRD", name: "Liberian Dollar", symbol: "L$" },
  { code: "LSL", name: "Lesotho Loti", symbol: "L" },
  { code: "LYD", name: "Libyan Dinar", symbol: "ل.د" },
  { code: "MAD", name: "Moroccan Dirham", symbol: "د.م." },
  { code: "MGA", name: "Malagasy Ariary", symbol: "Ar" },
  { code: "MRU", name: "Mauritanian Ouguiya", symbol: "UM" },
  { code: "MUR", name: "Mauritian Rupee", symbol: "₨" },
  { code: "MXN", name: "Mexican Peso", symbol: "$" },
  { code: "NAD", name: "Namibian Dollar", symbol: "N$" },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$" },
  { code: "PLN", name: "Polish Złoty", symbol: "zł" },
  { code: "RUB", name: "Russian Ruble", symbol: "₽" },
  { code: "RWF", name: "Rwandan Franc", symbol: "RF" },
  { code: "SCR", name: "Seychellois Rupee", symbol: "₨" },
  { code: "SDG", name: "Sudanese Pound", symbol: "£" },
  { code: "SEK", name: "Swedish Krona", symbol: "kr" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$" },
  { code: "SLL", name: "Sierra Leonean Leone", symbol: "Le" },
  { code: "SOS", name: "Somali Shilling", symbol: "Sh" },
  { code: "SSP", name: "South Sudanese Pound", symbol: "£" },
  { code: "SZL", name: "Swazi Lilangeni", symbol: "L" },
  { code: "TND", name: "Tunisian Dinar", symbol: "د.ت" },
  { code: "TRY", name: "Turkish Lira", symbol: "₺" },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh" },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh" },
  { code: "XOF", name: "West African CFA Franc", symbol: "CFA" },
  { code: "ZAR", name: "South African Rand", symbol: "R" },
];

export default function AccountSettings() {
  const {
    accountPreferences,
    setAccountPreferences,
    setShowAccountSettings,
    user,
    profile,
    handleSignOut,
  } = useAppState();
  const [isDeleting, setIsDeleting] = useState(false);

  const [selectedCurrency, setSelectedCurrency] = useState(
    profile?.currency || "USD"
  );
  const [selectedMeasurement, setSelectedMeasurement] = useState(
    profile?.measurement_system || "imperial"
  );

  useEffect(() => {
    fetchExchangeRates();
  }, []);

  const handleCurrencyChange = async (currencyCode: string) => {
    setSelectedCurrency(currencyCode);
    const updatedPreferences = {
      ...accountPreferences,
      currency: currencyCode,
    };
    setAccountPreferences(updatedPreferences);
    if (user?.id) {
      try {
        await PreferencesService.updateUserProfile(user.id, {
          currency: currencyCode,
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
    setAccountPreferences(updatedPreferences);
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

  const getCurrentCurrency = () => {
    return supportedCurrencies.find((c) => c.code === selectedCurrency);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "Are you sure you want to permanently delete your Mingla account? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: async () => {
            if (!user?.id) {
              Alert.alert(
                "Error",
                "You must be signed in to delete your account."
              );
              return;
            }
            setIsDeleting(true);
            try {
              const { data, error } = await supabase.functions.invoke(
                "delete-user",
                { method: "POST" }
              );
              if (error) throw error;
              if (data?.error) throw new Error(data.error);
              setShowAccountSettings(false);
              await handleSignOut();
            } catch (e: any) {
              Alert.alert(
                "Delete failed",
                e?.message || "Could not delete account. Please try again."
              );
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
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

          <View style={styles.currencyContainer}>
            <ScrollView
              style={styles.currencyScrollView}
              contentContainerStyle={styles.currencyScrollContent}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
            >
              {supportedCurrencies.map((currency) => (
                <TouchableOpacity
                  key={currency.code}
                  onPress={() => handleCurrencyChange(currency.code)}
                  style={[
                    styles.currencyItem,
                    selectedCurrency === currency.code &&
                      styles.currencyItemSelected,
                  ]}
                >
                  <View style={styles.currencyInfo}>
                    <Text style={styles.currencySymbol}>{currency.symbol}</Text>
                    <View style={styles.currencyDetails}>
                      <Text style={styles.currencyCode}>{currency.code}</Text>
                      <Text style={styles.currencyName}>{currency.name}</Text>
                    </View>
                  </View>
                  <View style={styles.currencyExample}>
                    {/*  <Text style={styles.currencyExampleText}>
                      Example: {formatCurrency(25, currency.code)}
                    </Text> */}
                    <Text style={styles.currencyRate}>
                      1 USD = {getRate(currency.code)} {currency.code}
                    </Text>
                  </View>
                  {selectedCurrency === currency.code && (
                    <Ionicons
                      name="checkmark"
                      size={20}
                      color="#eb7825"
                      style={styles.checkIcon}
                    />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {selectedCurrency !== "USD" && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                <Text style={styles.infoBold}>Selected:</Text>{" "}
                {getCurrentCurrency()?.name} ({getCurrentCurrency()?.symbol})
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
});
