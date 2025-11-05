import React, { useState, useRef, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface OTPScreenProps {
  phone: string;
  onVerify: (otp: string) => Promise<void>;
  onResend: () => Promise<void>;
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
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  contentWrapper: {
    maxWidth: 400,
    alignSelf: "center",
    width: "100%",
  },
  titleSection: {
    alignItems: "center",
    marginBottom: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 12,
    textAlign: "center",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 22,
  },
  phoneNumber: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    marginTop: 8,
  },
  otpContainer: {
    marginBottom: 32,
  },
  otpInputContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 24,
  },
  otpInput: {
    flex: 1,
    height: 64,
    backgroundColor: "#f9fafb",
    borderWidth: 2,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    textAlign: "center",
    fontSize: 24,
    fontWeight: "600",
    color: "#111827",
  },
  otpInputFocused: {
    borderColor: "#eb7825",
    backgroundColor: "white",
  },
  verifyButton: {
    width: "100%",
    backgroundColor: "#eb7825",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  verifyButtonDisabled: {
    backgroundColor: "#d1d5db",
    shadowOpacity: 0,
  },
  verifyButtonText: {
    color: "white",
    fontWeight: "700",
    fontSize: 17,
    letterSpacing: 0.3,
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
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  resendButtonText: {
    color: "#eb7825",
    fontWeight: "600",
    fontSize: 15,
  },
  resendButtonDisabled: {
    opacity: 0.5,
  },
  timerText: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 8,
  },
  errorText: {
    fontSize: 14,
    color: "#ef4444",
    textAlign: "center",
    marginTop: 16,
  },
});

const OTP_LENGTH = 6;
const RESEND_TIMEOUT = 300; // 5 minutes in seconds

export default function OTPScreen({
  phone,
  onVerify,
  onResend,
  onBack,
}: OTPScreenProps) {
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(RESEND_TIMEOUT);
  const [canResend, setCanResend] = useState(false);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Timer countdown
  useEffect(() => {
    if (resendTimer > 0 && !canResend) {
      const timer = setInterval(() => {
        setResendTimer((prev) => {
          if (prev <= 1) {
            setCanResend(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [resendTimer, canResend]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleOtpChange = (index: number, value: string) => {
    // Only allow single digit
    if (value.length > 1) {
      value = value[value.length - 1];
    }

    // Only allow digits
    if (value && !/^\d$/.test(value)) {
      return;
    }

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    setError(null);

    // Auto-focus next input
    if (value && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-verify when all digits are entered
    if (newOtp.every((digit) => digit !== "") && newOtp.length === OTP_LENGTH) {
      handleVerify(newOtp.join(""));
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    // Handle backspace
    if (key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async (otpValue?: string) => {
    const otpString = otpValue || otp.join("");
    if (otpString.length !== OTP_LENGTH) {
      setError("Please enter the complete OTP code");
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      await onVerify(otpString);
    } catch (err: any) {
      setError(err.message || "Invalid OTP. Please try again.");
      // Clear OTP on error
      setOtp(Array(OTP_LENGTH).fill(""));
      inputRefs.current[0]?.focus();
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!canResend || isResending) return;

    setIsResending(true);
    setError(null);
    setCanResend(false);
    setResendTimer(RESEND_TIMEOUT);

    try {
      await onResend();
      Alert.alert("OTP Sent", "A new OTP has been sent to your phone number");
    } catch (err: any) {
      setError(err.message || "Failed to resend OTP. Please try again.");
      setCanResend(true);
    } finally {
      setIsResending(false);
    }
  };

  const otpComplete = otp.every((digit) => digit !== "");

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />

      {/* Header */}
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

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.contentWrapper}>
          <View style={styles.titleSection}>
            <Text style={styles.title}>Verify Your Phone</Text>
            <Text style={styles.subtitle}>
              We've sent a verification code to
            </Text>
            <Text style={styles.phoneNumber}>{phone}</Text>
          </View>

          {/* OTP Input */}
          <View style={styles.otpContainer}>
            <View style={styles.otpInputContainer}>
              {Array.from({ length: OTP_LENGTH }).map((_, index) => (
                <TextInput
                  key={index}
                  ref={(ref) => {
                    inputRefs.current[index] = ref;
                  }}
                  style={[
                    styles.otpInput,
                    otp[index] && styles.otpInputFocused,
                  ]}
                  value={otp[index]}
                  onChangeText={(value) => handleOtpChange(index, value)}
                  onKeyPress={({ nativeEvent }) =>
                    handleKeyPress(index, nativeEvent.key)
                  }
                  keyboardType="number-pad"
                  maxLength={1}
                  selectTextOnFocus
                  autoFocus={index === 0}
                />
              ))}
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <TouchableOpacity
              style={[
                styles.verifyButton,
                (!otpComplete || isVerifying) && styles.verifyButtonDisabled,
              ]}
              onPress={() => handleVerify()}
              disabled={!otpComplete || isVerifying}
            >
              {isVerifying ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text style={styles.verifyButtonText}>Verify</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Resend OTP */}
          <View style={styles.resendContainer}>
            <Text style={styles.resendText}>Didn't receive the code?</Text>
            {canResend ? (
              <TouchableOpacity
                style={styles.resendButton}
                onPress={handleResend}
                disabled={isResending}
              >
                <Text
                  style={[
                    styles.resendButtonText,
                    isResending && styles.resendButtonDisabled,
                  ]}
                >
                  {isResending ? "Sending..." : "Resend OTP"}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.timerText}>
                Resend in {formatTime(resendTimer)}
              </Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
