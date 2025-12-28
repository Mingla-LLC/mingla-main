import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Input } from "../ui/input";
import { SafeAreaView } from "react-native-safe-area-context";

const logo = require("../../../assets/mobile_logo.png");

interface SignInFormProps {
  onSignIn: (credentials: { email: string; password: string }) => void;
  onSwitchToSignUp: () => void;
  onBack: () => void;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    backgroundColor: "white",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  backButtonText: {
    color: "#6b7280",
    fontSize: 16,
    fontWeight: "500",
    marginLeft: 4,
  },
  headerCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 150,
    height: 40,
    resizeMode: "contain",
  },
  formContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    justifyContent: "center",
  },
  formWrapper: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
  },
  formHeader: {
    marginBottom: 32,
    paddingHorizontal: 4,
  },
  formTitle: {
    fontSize: 36,
    fontWeight: "800",
    color: "#0a0a0a",
    marginBottom: 12,
    letterSpacing: -1,
    lineHeight: 44,
  },
  formSubtitle: {
    fontSize: 16,
    color: "#64748b",
    lineHeight: 24,
    textAlign: "center",
    marginTop: 32,
  },
  inputContainer: {
    marginBottom: 28,
  },
  inputLabel: {
    color: "#0f172a",
    fontWeight: "600",
    fontSize: 16,
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  inputWrapper: {
    position: "relative",
    width: "100%",
  },
  inputIcon: {
    position: "absolute",
    left: 16,
    top: 15,
    zIndex: 1,
    pointerEvents: "none",
  },
  passwordToggle: {
    position: "absolute",
    right: 12,
    top: 8,
    padding: 8,
    zIndex: 1,
    borderRadius: 8,
  },
  submitButton: {
    width: "100%",
    backgroundColor: "#eb7825",
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: "white",
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: 0.2,
  },
  alternativeAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    paddingVertical: 11.5,
  },
  alternativeText: {
    color: "#64748b",
    fontSize: 15,
    fontWeight: "500",
  },
  alternativeLink: {
    color: "#eb7825",
    fontWeight: "700",
    fontSize: 15,
    marginLeft: 6,
  },
});

export default function SignInForm({
  onSignIn,
  onSwitchToSignUp,
  onBack,
}: SignInFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      await onSignIn({ email: formData.email, password: formData.password });
    } catch (error) {
      console.error("Sign in error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/*   <StatusBar barStyle="dark-content" backgroundColor="#ffffff" /> */}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={onBack}>
                <Ionicons name="arrow-back" size={20} color="#6b7280" />
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Form Content */}
          <View style={styles.formContainer}>
            <View style={styles.headerCenter}>
              <Image source={logo} style={styles.logo} resizeMode="contain" />
            </View>
            <View style={styles.formWrapper}>
              {/* Form Header */}
              <View style={styles.formHeader}>
                <Text style={styles.formSubtitle}>
                  Sign in to continue your journey
                </Text>
              </View>

              {/* Email field */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Email</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons
                    name="mail-outline"
                    size={20}
                    color="#94a3b8"
                    style={styles.inputIcon}
                  />
                  <Input
                    type="email"
                    value={formData.email}
                    onChangeText={(value) => handleInputChange("email", value)}
                    placeholder="john@example.com"
                    placeholderTextColor="#cbd5e1"
                    required
                    style={{
                      backgroundColor: "#f1f5f9",
                      borderWidth: 0,
                      borderRadius: 12,
                      paddingHorizontal: 16,
                      paddingLeft: 48,
                      fontSize: 16,
                      color: "#0f172a",
                      height: 54,
                      fontWeight: "500",
                    }}
                  />
                </View>
              </View>

              {/* Password field */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Password</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color="#94a3b8"
                    style={styles.inputIcon}
                  />
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChangeText={(value) =>
                      handleInputChange("password", value)
                    }
                    placeholder="••••••••"
                    placeholderTextColor="#cbd5e1"
                    required
                    style={{
                      backgroundColor: "#f1f5f9",
                      borderWidth: 0,
                      borderRadius: 12,
                      paddingHorizontal: 16,
                      paddingLeft: 48,
                      paddingRight: 48,
                      fontSize: 16,
                      color: "#0f172a",
                      height: 54,
                      fontWeight: "500",
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.passwordToggle}
                  >
                    {showPassword ? (
                      <Ionicons name="eye-off" size={20} color="#64748b" />
                    ) : (
                      <Ionicons name="eye" size={20} color="#64748b" />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                onPress={handleSubmit}
                style={[
                  styles.submitButton,
                  isLoading && styles.submitButtonDisabled,
                ]}
                activeOpacity={0.8}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="white" />
                ) : null}
                <Text style={styles.submitButtonText}>Sign In</Text>
              </TouchableOpacity>

              {/* Alternative Action */}
              <View style={styles.alternativeAction}>
                <Text style={styles.alternativeText}>
                  Don't have an account?{" "}
                </Text>
                <TouchableOpacity onPress={onSwitchToSignUp}>
                  <Text style={styles.alternativeLink}>Sign Up</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
