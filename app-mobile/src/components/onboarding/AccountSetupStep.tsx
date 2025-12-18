import React from "react";
import { Text, View, TouchableOpacity, StyleSheet, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const googleIcon = require("../../../assets/google_icon.png");
const logo = require("../../../assets/mobile_logo.png");

interface AccountSetupStepProps {
  onNext: () => void;
  onBack: () => void;
  onNavigateToSignUp?: (accountType?: string) => void;
  onNavigateToPhoneSignUp?: () => void;
  onNavigateToGoogleSignIn?: () => void;
  onNavigateToAppleSignIn?: () => void;
  userProfile?: {
    name: string;
    email: string;
    profileImage?: string | null;
  };
  accountType?: string | null;
}

const AccountSetupStep = ({
  onNext,
  onBack,
  onNavigateToSignUp,
  onNavigateToPhoneSignUp,
  onNavigateToGoogleSignIn,
  onNavigateToAppleSignIn,
  userProfile,
  accountType,
}: AccountSetupStepProps) => {
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "white",
      justifyContent: "center",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 24,

      backgroundColor: "white",
    },
    backButton: {
      flexDirection: "row",
      alignItems: "center",

      paddingHorizontal: 4,
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
      marginTop: 8,
    },
    logo: {
      width: 150,
    },
    accountMainContent: {
      flex: 1,
      paddingHorizontal: 24,
      justifyContent: "center",
    },
    titleSection: {
      alignItems: "center",
      marginBottom: 40,
    },
    title: {
      fontSize: 32,
      fontWeight: "bold",
      color: "#111827",
      textAlign: "center",
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: "#6b7280",
      textAlign: "center",
    },
    loginOptions: {
      marginBottom: 24,
    },
    authButton: {
      backgroundColor: "white",
      borderRadius: 24,
      paddingVertical: 10,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "#e5e7eb",
      marginBottom: 12,
      gap: 12,
    },
    authButtonText: {
      color: "#111827",
      fontSize: 16,
      fontWeight: "500",

      textAlign: "center",
    },
    appleButton: {
      backgroundColor: "#000000",
      borderRadius: 24,
      paddingVertical: 10,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 120,
    },
    appleButtonText: {
      color: "white",
      fontSize: 16,
      fontWeight: "500",
      marginLeft: 12,

      textAlign: "center",
    },
    separatorContainer: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: 16,
      marginBottom: 12,
    },
    separatorLine: {
      flex: 1,
      height: 1,
      backgroundColor: "#e5e7eb",
    },
    separatorText: {
      paddingHorizontal: 16,
      fontSize: 14,
      color: "#9ca3af",
    },
    googleIcon: {
      width: 20,
      height: 20,
      resizeMode: "contain",
    },
  });

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color="#6b7280" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content */}
      <View style={styles.accountMainContent}>
        <View style={styles.headerCenter}>
          <Image source={logo} style={styles.logo} resizeMode="contain" />
        </View>
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.subtitle}>
            Sign up to discover amazing experiences.
          </Text>
        </View>

        {/* Login Options */}
        <View style={styles.loginOptions}>
          {/* Continue with Email */}
          <TouchableOpacity
            style={styles.authButton}
            onPress={() => onNavigateToSignUp?.(accountType || undefined)}
          >
            <Ionicons name="mail-outline" size={20} color="#111827" />
            <Text style={styles.authButtonText}>Continue with Email</Text>
          </TouchableOpacity>

          {/* Continue with Phone */}
          {/* <TouchableOpacity
            style={styles.authButton}
            onPress={onNavigateToPhoneSignUp}
          >
            <Ionicons name="call-outline" size={20} color="#111827" />
            <Text style={styles.authButtonText}>Continue with Phone</Text>
          </TouchableOpacity> */}

          {/* Separator */}
          <View style={styles.separatorContainer}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>or continue with</Text>
            <View style={styles.separatorLine} />
          </View>

          {/* Continue with Google */}
          <TouchableOpacity
            style={styles.authButton}
            onPress={onNavigateToGoogleSignIn}
          >
            <Image source={googleIcon} style={styles.googleIcon} />
            <Text style={styles.authButtonText}>Continue with Google</Text>
          </TouchableOpacity>

          {/* Continue with Apple */}
          <TouchableOpacity
            style={styles.appleButton}
            onPress={onNavigateToAppleSignIn}
          >
            <Ionicons name="logo-apple" size={20} color="white" />
            <Text style={styles.appleButtonText}>Continue with Apple</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

export default AccountSetupStep;
