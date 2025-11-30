import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
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
    backgroundColor: "#ffffff",
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: "transparent",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f5f9",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  minglaText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#eb7825",
    letterSpacing: 0.3,
  },
  formContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  formWrapper: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
  },
  formHeader: {
    marginBottom: 48,
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
  },
  inputContainer: {
    marginBottom: 28,
  },
  inputLabel: {
    color: "#0f172a",
    fontWeight: "600",
    fontSize: 14,
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
    top: 13,
    padding: 8,
    zIndex: 1,
    borderRadius: 8,
  },
  submitButton: {
    width: "100%",
    backgroundColor: "#eb7825",
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
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
    marginTop: 32,
    paddingVertical: 12,
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
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={22} color="#475569" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.minglaText}>Mingla</Text>
          </View>
          <View style={{ width: 40 }} />
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
                    backgroundColor: "#f8fafc",
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
                  onChangeText={(value) => handleInputChange("password", value)}
                  placeholder="••••••••"
                  placeholderTextColor="#cbd5e1"
                  required
                  style={{
                    backgroundColor: "#f8fafc",
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
              style={styles.submitButton}
              activeOpacity={0.8}
            >
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
    </View>
  );
}
