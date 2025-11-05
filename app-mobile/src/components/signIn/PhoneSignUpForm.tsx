import React, { useState, useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Input } from "../ui/input";
import {
  checkUsernameAvailability,
  sanitizeUsername,
} from "../../utils/usernameUtils";
import {
  countryCodes,
  CountryCode,
  getDefaultCountry,
  formatPhoneNumber,
  isValidPhoneNumber,
} from "../../utils/countryCodes";

interface PhoneSignUpFormProps {
  onSignUp: (userData: {
    phone: string;
    password: string;
    username: string;
  }) => void;
  onBack: () => void;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: "white",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backButtonText: {
    color: "#6b7280",
    fontSize: 16,
    fontWeight: "500",
    marginLeft: 4,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  minglaText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#eb7825",
  },
  formContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 32,
  },
  formWrapper: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
  },
  formHeader: {
    alignItems: "center",
    marginBottom: 32,
  },
  formTitle: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 8,
    textAlign: "center",
    letterSpacing: -0.5,
  },
  formSubtitle: {
    fontSize: 16,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 22,
  },
  form: {
    gap: 0,
  },
  formCard: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    color: "#374151",
    fontWeight: "600",
    fontSize: 15,
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  phoneInputContainer: {
    flexDirection: "row",
    gap: 12,
  },
  countryCodeButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f9fafb",
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    minWidth: 100,
    gap: 6,
  },
  countryCodeText: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "500",
  },
  phoneInputWrapper: {
    flex: 1,
    position: "relative",
  },
  inputWrapper: {
    position: "relative",
  },
  inputIcon: {
    position: "absolute",
    left: 16,
    top: 14,
    zIndex: 1,
  },
  inputWithIcon: {
    paddingLeft: 48,
  },
  passwordToggle: {
    position: "absolute",
    right: 16,
    top: 14,
    padding: 4,
    zIndex: 1,
  },
  submitButton: {
    width: "100%",
    backgroundColor: "#eb7825",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,

    elevation: 5,
  },
  submitButtonText: {
    color: "white",
    fontWeight: "700",
    fontSize: 17,
    letterSpacing: 0.3,
  },
  submitButtonDisabled: {
    backgroundColor: "#d1d5db",
    shadowOpacity: 0,
  },
  submitButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  usernameStatusIcon: {
    position: "absolute",
    right: 16,
    top: 14,
    padding: 4,
    zIndex: 1,
  },
  usernameHint: {
    fontSize: 12,
    color: "#10b981",
    marginTop: 4,
    marginLeft: 4,
  },
  usernameHintError: {
    color: "#ef4444",
  },
  errorText: {
    fontSize: 12,
    color: "#ef4444",
    marginTop: 4,
    marginLeft: 4,
  },
  // Modal styles for country picker
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  closeButton: {
    padding: 4,
  },
  countryListContainer: {
    paddingVertical: 8,
  },
  countryItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    gap: 12,
  },
  countryItemText: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
  },
  countryItemDialCode: {
    fontSize: 16,
    color: "#6b7280",
    fontWeight: "500",
  },
  searchInput: {
    marginHorizontal: 24,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    fontSize: 16,
  },
});

export default function PhoneSignUpForm({
  onSignUp,
  onBack,
}: PhoneSignUpFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    phone: "",
    password: "",
    username: "",
  });
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(
    getDefaultCountry()
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available: boolean | null;
  }>({
    checking: false,
    available: null,
  });

  const usernameCheckDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Filter countries based on search
  const filteredCountries = countryCodes.filter(
    (country) =>
      country.name.toLowerCase().includes(countrySearchQuery.toLowerCase()) ||
      country.dialCode.includes(countrySearchQuery) ||
      country.code.toLowerCase().includes(countrySearchQuery.toLowerCase())
  );

  // Check username availability when username changes
  useEffect(() => {
    if (usernameCheckDebounceRef.current) {
      clearTimeout(usernameCheckDebounceRef.current);
    }

    if (formData.username.trim().length === 0) {
      setUsernameStatus({
        checking: false,
        available: null,
      });
      return;
    }

    const sanitized = sanitizeUsername(formData.username);
    if (sanitized.length < 3) {
      setUsernameStatus({
        checking: false,
        available: false,
      });
      return;
    }

    setUsernameStatus({
      checking: true,
      available: null,
    });

    usernameCheckDebounceRef.current = setTimeout(async () => {
      const isAvailable = await checkUsernameAvailability(sanitized);
      setUsernameStatus({
        checking: false,
        available: isAvailable,
      });
    }, 500); // Debounce username checking

    return () => {
      if (usernameCheckDebounceRef.current) {
        clearTimeout(usernameCheckDebounceRef.current);
      }
    };
  }, [formData.username]);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (value: string) => {
    // Remove any non-digit characters except +
    const cleaned = value.replace(/[^\d+]/g, "");
    handleInputChange("phone", cleaned);
  };

  const handleSelectCountry = (country: CountryCode) => {
    setSelectedCountry(country);
    setShowCountryPicker(false);
    setCountrySearchQuery("");
  };

  const handleSubmit = async () => {
    // Validate form
    if (!formData.phone.trim()) {
      Alert.alert("Error", "Please enter your phone number");
      return;
    }

    if (!formData.username.trim()) {
      Alert.alert("Error", "Please enter a username");
      return;
    }

    if (formData.password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }

    const sanitizedUsername = sanitizeUsername(formData.username);
    if (sanitizedUsername.length < 3) {
      Alert.alert("Error", "Username must be at least 3 characters");
      return;
    }

    // Check username availability one more time
    const isAvailable = await checkUsernameAvailability(sanitizedUsername);
    if (!isAvailable) {
      Alert.alert(
        "Username Taken",
        "This username is already taken. Please choose another one."
      );
      setUsernameStatus({
        checking: false,
        available: false,
      });
      return;
    }

    // Format phone number
    const formattedPhone = formatPhoneNumber(
      selectedCountry,
      formData.phone.trim()
    );

    // Validate phone number
    if (!isValidPhoneNumber(formattedPhone)) {
      Alert.alert("Error", "Please enter a valid phone number");
      return;
    }

    setIsLoading(true);
    try {
      onSignUp({
        phone: formattedPhone,
        password: formData.password,
        username: sanitizedUsername,
      });
    } catch (error) {
      console.error("Sign up error:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "string"
          ? error
          : error?.toString?.() ||
            "An error occurred during sign up. Please try again.";

      Alert.alert("Sign Up Failed", errorMessage, [{ text: "OK" }]);
    } finally {
      setTimeout(() => {
        setIsLoading(false);
      }, 500);
    }
  };

  const renderCountryItem = ({ item }: { item: CountryCode }) => (
    <TouchableOpacity
      style={styles.countryItem}
      onPress={() => handleSelectCountry(item)}
    >
      <Text style={{ fontSize: 24 }}>{item.flag}</Text>
      <Text style={styles.countryItemText}>{item.name}</Text>
      <Text style={styles.countryItemDialCode}>{item.dialCode}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />

      {/* Header with back button and logo */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={20} color="#6b7280" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.minglaText}>Mingla</Text>
        </View>
        <View style={{ width: 80 }} />
      </View>

      {/* Form Content */}
      <View style={styles.formContainer}>
        <View style={styles.formWrapper}>
          {/* Form Header */}
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Sign Up with Phone</Text>
            <Text style={styles.formSubtitle}>
              Create your account using your phone number
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.formCard}>
              {/* Phone Number field */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Phone Number</Text>
                <View style={styles.phoneInputContainer}>
                  <TouchableOpacity
                    style={styles.countryCodeButton}
                    onPress={() => setShowCountryPicker(true)}
                  >
                    <Text style={{ fontSize: 20 }}>{selectedCountry.flag}</Text>
                    <Text style={styles.countryCodeText}>
                      {selectedCountry.dialCode}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color="#6b7280" />
                  </TouchableOpacity>
                  <View style={styles.phoneInputWrapper}>
                    <View style={styles.inputWrapper}>
                      <View style={styles.inputIcon}>
                        <Ionicons
                          name="call-outline"
                          size={20}
                          color="#9ca3af"
                        />
                      </View>
                      <Input
                        type="number"
                        value={formData.phone}
                        onChangeText={handlePhoneChange}
                        placeholder="Phone number"
                        keyboardType="phone-pad"
                        style={{
                          backgroundColor: "#f9fafb",
                          borderWidth: 1.5,
                          borderColor: "#e5e7eb",
                          borderRadius: 12,
                          paddingHorizontal: 16,
                          paddingLeft: 48,
                          fontSize: 16,
                          color: "#111827",
                        }}
                      />
                    </View>
                  </View>
                </View>
              </View>

              {/* Username field */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Username</Text>
                <View style={styles.inputWrapper}>
                  <View style={styles.inputIcon}>
                    <Ionicons name="at" size={20} color="#9ca3af" />
                  </View>
                  <Input
                    type="text"
                    value={formData.username}
                    onChangeText={(value) => {
                      const sanitized = value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "");
                      handleInputChange("username", sanitized);
                    }}
                    placeholder="username"
                    autoCapitalize="none"
                    style={{
                      backgroundColor: "#f9fafb",
                      borderWidth: 1.5,
                      borderColor: "#e5e7eb",
                      borderRadius: 12,
                      paddingHorizontal: 16,
                      paddingLeft: 48,
                      fontSize: 16,
                      color: "#111827",
                    }}
                  />
                  {usernameStatus.checking && (
                    <View style={styles.usernameStatusIcon}>
                      <ActivityIndicator size="small" color="#6b7280" />
                    </View>
                  )}
                  {!usernameStatus.checking &&
                    formData.username &&
                    usernameStatus.available !== null && (
                      <View style={styles.usernameStatusIcon}>
                        <Ionicons
                          name={
                            usernameStatus.available
                              ? "checkmark-circle"
                              : "close-circle"
                          }
                          size={20}
                          color={
                            usernameStatus.available ? "#10b981" : "#ef4444"
                          }
                        />
                      </View>
                    )}
                </View>
                {formData.username && (
                  <>
                    {usernameStatus.available === true && (
                      <Text style={styles.usernameHint}>
                        ✓ Username is available
                      </Text>
                    )}
                    {usernameStatus.available === false && (
                      <Text style={styles.usernameHintError}>
                        ✗ Username is already taken
                      </Text>
                    )}
                  </>
                )}
              </View>

              {/* Password field */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Password</Text>
                <View style={styles.inputWrapper}>
                  <View style={styles.inputIcon}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={20}
                      color="#9ca3af"
                    />
                  </View>
                  <Input
                    type="password"
                    value={formData.password}
                    onChangeText={(value) =>
                      handleInputChange("password", value)
                    }
                    placeholder="Password"
                    secureTextEntry={!showPassword}
                    style={{
                      backgroundColor: "#f9fafb",
                      borderWidth: 1.5,
                      borderColor: "#e5e7eb",
                      borderRadius: 12,
                      paddingHorizontal: 16,
                      paddingLeft: 48,
                      fontSize: 16,
                      color: "#111827",
                    }}
                  />
                  <TouchableOpacity
                    style={styles.passwordToggle}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Ionicons
                      name={showPassword ? "eye-off-outline" : "eye-outline"}
                      size={20}
                      color="#9ca3af"
                    />
                  </TouchableOpacity>
                </View>
                {formData.password && formData.password.length < 6 && (
                  <Text style={styles.errorText}>
                    Password must be at least 6 characters
                  </Text>
                )}
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  (isLoading ||
                    !formData.phone ||
                    !formData.username ||
                    !formData.password ||
                    usernameStatus.available === false) &&
                    styles.submitButtonDisabled,
                ]}
                onPress={handleSubmit}
                disabled={
                  isLoading ||
                  !formData.phone ||
                  !formData.username ||
                  !formData.password ||
                  usernameStatus.available === false
                }
              >
                <View style={styles.submitButtonContent}>
                  {isLoading && (
                    <ActivityIndicator size="small" color="white" />
                  )}
                  <Text style={styles.submitButtonText}>
                    {isLoading ? "Creating Account..." : "Sign Up"}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* Country Picker Modal */}
      <Modal
        visible={showCountryPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Country</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => {
                  setShowCountryPicker(false);
                  setCountrySearchQuery("");
                }}
              >
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <Input
              type="text"
              value={countrySearchQuery}
              onChangeText={setCountrySearchQuery}
              placeholder="Search country..."
              style={styles.searchInput}
            />
            <FlatList
              data={filteredCountries}
              renderItem={renderCountryItem}
              keyExtractor={(item) => item.code}
              style={styles.countryListContainer}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
