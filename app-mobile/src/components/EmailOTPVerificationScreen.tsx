import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { InputOTP } from "./ui/input-otp";
import { useAuthSimple } from "../hooks/useAuthSimple";

interface EmailOTPVerificationScreenProps {
  email: string;
  onVerificationComplete: () => void;
}

export default function EmailOTPVerificationScreen({
  email,
  onVerificationComplete,
}: EmailOTPVerificationScreenProps) {
  const [otp, setOtp] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [hasAttemptedVerification, setHasAttemptedVerification] =
    useState(false);
  const { verifyEmailOTP, resendEmailOTP } = useAuthSimple();

  // Countdown timer for resend cooldown
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown(resendCooldown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleVerify = async () => {
    if (otp.length !== 6) {
      Alert.alert("Invalid Code", "Please enter a 6-digit verification code.");
      return;
    }

    setIsVerifying(true);
    setHasAttemptedVerification(true);
    try {
      const { data, error } = await verifyEmailOTP(email, otp);
      if (error) {
        // Error alert is already shown in verifyEmailOTP function
        // Clear OTP so user can re-enter and prevent auto-submit loop
        setOtp("");
        setHasAttemptedVerification(false);
        return;
      }

      if (data?.user) {
        // Verification successful, call the completion callback
        onVerificationComplete();
      }
    } catch (error: any) {
      console.error("Verification error:", error);
      // Error alert is already shown in verifyEmailOTP function
      // Clear OTP so user can re-enter and prevent auto-submit loop
      setOtp("");
      setHasAttemptedVerification(false);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) {
      return;
    }

    setIsResending(true);
    try {
      const { error } = await resendEmailOTP(email);
      if (error) {
        // Error alert is already shown in resendEmailOTP function
        return;
      }

      // Set cooldown to 60 seconds
      setResendCooldown(60);
      // Success alert is already shown in resendEmailOTP function
    } catch (error: any) {
      console.error("Resend error:", error);
      // Error alert is already shown in resendEmailOTP function
    } finally {
      setIsResending(false);
    }
  };

  // Auto-submit when OTP is complete (only on first entry, not after failed attempts)
  useEffect(() => {
    if (otp.length === 6 && !isVerifying && !hasAttemptedVerification) {
      const timer = setTimeout(() => {
        handleVerify();
      }, 300); // Small delay to ensure the last digit is fully entered
      return () => clearTimeout(timer);
    }
    // Reset hasAttemptedVerification when OTP changes (user is entering new code)
    if (otp.length < 6) {
      setHasAttemptedVerification(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, isVerifying, hasAttemptedVerification]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "#ffffff",
    },
    header: {
      paddingHorizontal: 24,
      paddingTop: 60,
      paddingBottom: 24,
    },
    backButton: {
      marginBottom: 24,
    },
    title: {
      fontSize: 32,
      fontWeight: "bold",
      color: "#111827",
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 16,
      color: "#6b7280",
      marginBottom: 8,
    },
    emailText: {
      fontSize: 16,
      color: "#eb7825",
      fontWeight: "600",
    },
    content: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 40,
    },
    otpContainer: {
      alignItems: "center",
      marginBottom: 32,
    },
    otpLabel: {
      fontSize: 16,
      color: "#374151",
      marginBottom: 16,
      fontWeight: "500",
    },
    verifyButton: {
      backgroundColor: "#eb7825",
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 24,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 24,
    },
    verifyButtonDisabled: {
      backgroundColor: "#d1d5db",
    },
    verifyButtonText: {
      color: "#ffffff",
      fontSize: 16,
      fontWeight: "600",
      marginRight: 8,
    },
    resendContainer: {
      alignItems: "center",
      marginTop: 24,
    },
    resendText: {
      fontSize: 14,
      color: "#6b7280",
      marginBottom: 8,
    },
    resendButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    resendButtonDisabled: {
      opacity: 0.5,
    },
    resendButtonText: {
      fontSize: 14,
      color: "#eb7825",
      fontWeight: "600",
    },
    cooldownText: {
      fontSize: 14,
      color: "#9ca3af",
      marginTop: 8,
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Verify Your Email</Text>
        <Text style={styles.subtitle}>
          We've sent a 6-digit verification code to:
        </Text>
        <Text style={styles.emailText}>{email}</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.otpContainer}>
          <Text style={styles.otpLabel}>Enter Verification Code</Text>
          <InputOTP
            value={otp}
            onChange={(value) => {
              setOtp(value);
              // Reset attempted flag when user starts typing a new code
              if (value.length < otp.length) {
                setHasAttemptedVerification(false);
              }
            }}
            maxLength={6}
            disabled={isVerifying}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.verifyButton,
            (otp.length !== 6 || isVerifying) && styles.verifyButtonDisabled,
          ]}
          onPress={handleVerify}
          disabled={otp.length !== 6 || isVerifying}
        >
          {isVerifying ? (
            <>
              <ActivityIndicator size="small" color="#ffffff" />
              <Text style={styles.verifyButtonText}>Verifying...</Text>
            </>
          ) : (
            <>
              <Text style={styles.verifyButtonText}>Verify Email</Text>
              <Ionicons name="checkmark-circle" size={20} color="#ffffff" />
            </>
          )}
        </TouchableOpacity>

        {/* Resend Code Section */}
        <View style={styles.resendContainer}>
          <Text style={styles.resendText}>Didn't receive the code?</Text>
          <TouchableOpacity
            onPress={handleResend}
            disabled={isResending || resendCooldown > 0}
            style={[
              styles.resendButton,
              (isResending || resendCooldown > 0) &&
                styles.resendButtonDisabled,
            ]}
          >
            {isResending ? (
              <>
                <ActivityIndicator size="small" color="#eb7825" />
                <Text style={styles.resendButtonText}>Sending...</Text>
              </>
            ) : resendCooldown > 0 ? (
              <Text style={styles.resendButtonText}>
                Resend code in {resendCooldown}s
              </Text>
            ) : (
              <>
                <Ionicons name="refresh" size={16} color="#eb7825" />
                <Text style={styles.resendButtonText}>Resend Code</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
