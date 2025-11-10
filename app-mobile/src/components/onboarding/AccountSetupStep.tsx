import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const googleIcon = require("../../../assets/google_icon.png");

interface AccountSetupStepProps {
  onNext: () => void;
  onBack: () => void;
  onNavigateToSignUp?: (accountType?: string) => void;
  onNavigateToPhoneSignUp?: () => void;
  onNavigateToGoogleSignIn?: () => void;
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
  userProfile,
  accountType,
}: AccountSetupStepProps) => {
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
    accountMainContent: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 32,
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
      borderRadius: 12,
      paddingVertical: 16,
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
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
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
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={20} color="#6b7280" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.minglaText}>Mingla</Text>
        </View>

        <View style={{ width: 80 }} />
      </View>

      {/* Main Content */}
      <View style={styles.accountMainContent}>
        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Welcome to Mingla.</Text>
          <Text style={styles.subtitle}>
            Sign in to discover amazing experiences.
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
          <TouchableOpacity style={styles.appleButton}>
            <Ionicons name="logo-apple" size={20} color="white" />
            <Text style={styles.appleButtonText}>Continue with Apple</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

export default AccountSetupStep;
