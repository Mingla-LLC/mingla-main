import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Input } from "../ui/input";

interface SignInFormProps {
  onSignIn: (credentials: { email: string; password: string }) => void;
  onSwitchToSignUp: () => void;
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
    marginBottom: 10,
    letterSpacing: 0.2,
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
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  submitButtonText: {
    color: "white",
    fontWeight: "700",
    fontSize: 17,
    letterSpacing: 0.3,
  },
  alternativeAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    paddingVertical: 8,
  },
  alternativeText: {
    color: "#6b7280",
    fontSize: 15,
  },
  alternativeLink: {
    color: "#eb7825",
    fontWeight: "600",
    fontSize: 15,
    marginLeft: 4,
  },
});

export default function SignInForm({
  onSignIn,
  onSwitchToSignUp,
  onBack,
}: SignInFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    onSignIn({ email: formData.email, password: formData.password });
  };

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
            <Text style={styles.formTitle}>Welcome Back</Text>
            <Text style={styles.formSubtitle}>
              Sign in to continue your journey
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.formCard}>
              {/* Email field */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Email</Text>
                <View style={styles.inputWrapper}>
                  <View style={styles.inputIcon}>
                    <Ionicons name="mail-outline" size={20} color="#9ca3af" />
                  </View>
                  <Input
                    type="email"
                    value={formData.email}
                    onChangeText={(value) => handleInputChange("email", value)}
                    placeholder="Enter your email"
                    required
                    style={[
                      {
                        backgroundColor: "#f9fafb",
                        borderWidth: 1.5,
                        borderColor: "#e5e7eb",
                        borderRadius: 12,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        paddingLeft: 48,
                        fontSize: 16,
                        color: "#111827",
                      },
                      styles.inputWithIcon,
                    ]}
                  />
                </View>
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
                    type={showPassword ? "text" : "password"}
                    value={formData.password}
                    onChangeText={(value) =>
                      handleInputChange("password", value)
                    }
                    placeholder="Enter your password"
                    required
                    style={[
                      {
                        backgroundColor: "#f9fafb",
                        borderWidth: 1.5,
                        borderColor: "#e5e7eb",
                        borderRadius: 12,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        paddingLeft: 48,
                        paddingRight: 48,
                        fontSize: 16,
                        color: "#111827",
                      },
                      styles.inputWithIcon,
                    ]}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.passwordToggle}
                  >
                    {showPassword ? (
                      <Ionicons name="eye-off" size={20} color="#9ca3af" />
                    ) : (
                      <Ionicons name="eye" size={20} color="#9ca3af" />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                onPress={handleSubmit}
                style={styles.submitButton}
                activeOpacity={0.9}
              >
                <Text style={styles.submitButtonText}>Sign In</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Alternative Action */}
          <View style={styles.alternativeAction}>
            <Text style={styles.alternativeText}>Don't have an account? </Text>
            <TouchableOpacity onPress={onSwitchToSignUp}>
              <Text style={styles.alternativeLink}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}
