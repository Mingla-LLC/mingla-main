import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

const googleIcon = require("../../../assets/google_icon.png");
const logo = require("../../../assets/mobile_logo.png");

interface WelcomeScreenProps {
  onSignUp: () => void;
  onNavigateToSignIn: () => void;
  onStartOnboarding?: (accountType?: string) => void;
  onGoogleSignIn?: () => Promise<void>;
  onAppleSignIn?: () => Promise<void>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
  mainContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  titleContainer: {
    alignItems: "center",
  },
  logo: {
    width: 150,
    /*  height: 150, */
  },
  tagline: {
    color: "#4B5563",
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
    maxWidth: 300,
    letterSpacing: 0.025,
  },
  buttonContainer: {
    width: "100%",
    maxWidth: 400,
    gap: 16,
  },
  primaryButton: {
    width: "100%",
    backgroundColor: "#eb7825",
    paddingVertical: 10,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "white",
    fontWeight: "600",
    fontSize: 16,
  },
  continueWithText: {
    color: "#6b7280",
    fontSize: 14,
    textAlign: "center",
    marginVertical: 16,
  },
  providerButton: {
    width: "100%",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingVertical: 10,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  providerButtonDisabled: {
    opacity: 0.5,
  },
  providerButtonText: {
    color: "#111827",
    fontWeight: "500",
    fontSize: 16,
  },
  appleButton: {
    width: "100%",
    backgroundColor: "#111827",
    paddingVertical: 10,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  appleButtonDisabled: {
    opacity: 0.5,
  },
  appleButtonText: {
    color: "white",
    fontWeight: "500",
    fontSize: 16,
  },
  googleIcon: {
    width: 20,
    height: 20,
  },
  separatorContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 16,
    width: "100%",
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e5e7eb",
  },
  separatorText: {
    color: "#6b7280",
    fontSize: 14,
    marginHorizontal: 12,
  },
  emailSignInButton: {
    width: "100%",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingVertical: 10,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emailSignInButtonDisabled: {
    opacity: 0.5,
  },
  emailSignInButtonText: {
    color: "#111827",
    fontWeight: "500",
    fontSize: 16,
  },
  termsText: {
    color: "#1f2937",
    fontSize: 12,
    textAlign: "center",

    paddingHorizontal: 24,
    lineHeight: 18,
  },
  termsLink: {
    color: "#eb7825",
  },
  loadingIndicator: {
    marginRight: 8,
  },
});

export default function WelcomeScreen({
  onSignUp,
  onNavigateToSignIn,
  onStartOnboarding,
  onGoogleSignIn,
  onAppleSignIn,
}: WelcomeScreenProps) {
  const [isGoogleSignInInProgress, setIsGoogleSignInInProgress] =
    useState(false);
  const [isAppleSignInInProgress, setIsAppleSignInInProgress] = useState(false);

  const isAnyAuthInProgress =
    isGoogleSignInInProgress || isAppleSignInInProgress;

  const handleSignUp = () => {
    if (isAnyAuthInProgress) return;

    // Hardcode "explorer" as account type and navigate directly to onboarding
    if (onStartOnboarding) {
      onStartOnboarding("explorer");
    } else if (onSignUp) {
      onSignUp();
    }
  };

  const handleGoogleSignIn = async () => {
    if (isGoogleSignInInProgress || isAppleSignInInProgress || !onGoogleSignIn)
      return;

    setIsGoogleSignInInProgress(true);
    try {
      await onGoogleSignIn();
    } catch (error) {
      /*  console.error("Google sign-in error:", error); */
    } finally {
      setIsGoogleSignInInProgress(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (isAppleSignInInProgress || isGoogleSignInInProgress || !onAppleSignIn)
      return;

    setIsAppleSignInInProgress(true);
    try {
      await onAppleSignIn();
    } catch (error) {
      console.error("Apple sign-in error:", error);
    } finally {
      setIsAppleSignInInProgress(false);
    }
  };

  const handleEmailSignIn = () => {
    if (isAnyAuthInProgress) return;
    onNavigateToSignIn();
  };

  return (
    <SafeAreaView style={styles.container}>
      {/*    <StatusBar barStyle="dark-content" backgroundColor="white" /> */}

      <View style={styles.mainContent}>
        {/* Minglå Logo */}
        <View style={styles.titleContainer}>
          <Image source={logo} style={styles.logo} resizeMode="contain" />
        </View>

        {/* Tagline */}

        {/* Sign Up Button */}
        <View style={styles.buttonContainer}>
          <Text style={styles.tagline}>
            The easiest way to figure out what to do on dates and hangouts.
          </Text>
          <TouchableOpacity
            onPress={handleSignUp}
            style={[
              styles.primaryButton,
              isAnyAuthInProgress && styles.providerButtonDisabled,
            ]}
            disabled={isAnyAuthInProgress}
          >
            <Text style={styles.primaryButtonText}>Sign Up</Text>
          </TouchableOpacity>

          {/* Continue with Text */}
          <View style={styles.separatorContainer}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>or continue with</Text>
            <View style={styles.separatorLine} />
          </View>

          {/* Google Sign In Button */}
          <TouchableOpacity
            onPress={handleGoogleSignIn}
            style={[
              styles.providerButton,
              isAnyAuthInProgress && styles.providerButtonDisabled,
            ]}
            disabled={isAnyAuthInProgress}
          >
            {isGoogleSignInInProgress ? (
              <ActivityIndicator
                size="small"
                color="#111827"
                style={styles.loadingIndicator}
              />
            ) : (
              <Image source={googleIcon} style={styles.googleIcon} />
            )}
            <Text style={styles.providerButtonText}>Continue with Google</Text>
          </TouchableOpacity>

          {/* Apple Sign In Button */}
          <TouchableOpacity
            onPress={handleAppleSignIn}
            style={[
              styles.appleButton,
              isAnyAuthInProgress && styles.appleButtonDisabled,
            ]}
            disabled={isAnyAuthInProgress}
          >
            {isAppleSignInInProgress ? (
              <ActivityIndicator
                size="small"
                color="white"
                style={styles.loadingIndicator}
              />
            ) : (
              <Ionicons name="logo-apple" size={20} color="white" />
            )}
            <Text style={styles.appleButtonText}>Continue with Apple</Text>
          </TouchableOpacity>

          {/* Separator */}
          <View style={styles.separatorContainer}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>or</Text>
            <View style={styles.separatorLine} />
          </View>

          {/* Sign In with Email Button */}
          <TouchableOpacity
            onPress={handleEmailSignIn}
            style={[
              styles.emailSignInButton,
              isAnyAuthInProgress && styles.emailSignInButtonDisabled,
            ]}
            disabled={isAnyAuthInProgress}
          >
            <Ionicons name="mail-outline" size={20} color="#111827" />
            <Text style={styles.emailSignInButtonText}>Sign In with Email</Text>
          </TouchableOpacity>

          {/* Terms of Service */}
          <Text style={styles.termsText}>
            By continuing, you agree to our <Text>Terms of Service</Text> and{" "}
            <Text>Privacy Policy</Text>
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
