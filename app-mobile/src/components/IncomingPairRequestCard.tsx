/**
 * IncomingPairRequestCard — Bottom sheet shown when tapping an incoming pair request pill.
 *
 * Displays sender avatar, name, subtitle, Accept + Decline buttons.
 * Follows the same Modal + scale/fade pattern as PairingInfoCard.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Animated,
  Image,
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useAcceptPairRequest, useDeclinePairRequest } from "../hooks/usePairings";
import type { PairRequest } from "../services/pairingService";
import { useTranslation } from 'react-i18next';
import { colors, shadows } from "../constants/designSystem";
import { s } from "../utils/responsive";

const INITIALS_COLORS = [
  colors.primary[500],
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
];

interface IncomingPairRequestCardProps {
  visible: boolean;
  request: PairRequest | null;
  onAccept: () => void;
  onDecline: () => void;
  onClose: () => void;
}

function getInitialsColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return INITIALS_COLORS[Math.abs(hash) % INITIALS_COLORS.length];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function IncomingPairRequestCard({
  visible,
  request,
  onAccept,
  onDecline,
  onClose,
}: IncomingPairRequestCardProps) {
  const { t } = useTranslation(['social', 'common']);
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const acceptMutation = useAcceptPairRequest();
  const declineMutation = useDeclinePairRequest();

  const [showSuccess, setShowSuccess] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up success timer on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // Reset state when sheet opens/closes
  useEffect(() => {
    if (visible) {
      setShowSuccess(false);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      acceptMutation.reset();
      declineMutation.reset();

      scaleAnim.setValue(0.95);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 10,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!request) return null;

  const isBusy = acceptMutation.isPending || declineMutation.isPending;
  const avatarColor = getInitialsColor(request.senderName);
  const initials = getInitials(request.senderName);

  const handleAccept = async () => {
    if (!request || isBusy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await acceptMutation.mutateAsync(request.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowSuccess(true);
      successTimerRef.current = setTimeout(() => onAccept(), 800);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleDecline = async () => {
    if (!request || isBusy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await declineMutation.mutateAsync(request.id);
      onDecline();
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const errorMessage = acceptMutation.isError
    ? t('social:couldntAccept')
    : declineMutation.isError
      ? t('social:couldntDecline')
      : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={isBusy || showSuccess ? undefined : onClose}
        />
        <Animated.View
          style={[
            styles.card,
            {
              transform: [{ scale: scaleAnim }],
              opacity: opacityAnim,
            },
          ]}
        >
          {showSuccess ? (
            <>
              {/* Success state */}
              <Text style={styles.successIcon}>&#x2705;</Text>
              <Text style={styles.successTitle}>{t('social:youArePaired')}</Text>
              <Text style={styles.successSubtitle}>
                {t('social:startDiscovering')}
              </Text>
            </>
          ) : (
            <>
              {/* Avatar */}
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: avatarColor + "20" },
                ]}
              >
                {request.senderAvatar ? (
                  <Image
                    source={{ uri: request.senderAvatar }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Text style={[styles.avatarInitials, { color: avatarColor }]}>
                    {initials}
                  </Text>
                )}
              </View>

              {/* Sender name */}
              <Text
                style={styles.displayName}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {request.senderName}
              </Text>

              {/* Subtitle */}
              <Text style={styles.subtitle}>{t('social:wantsToPairWithYou')}</Text>

              {/* Description */}
              <Text style={styles.description}>
                {t('social:pairingDescription')}
              </Text>

              {/* Buttons */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[
                    styles.declineButton,
                    isBusy && styles.buttonDisabled,
                  ]}
                  onPress={handleDecline}
                  activeOpacity={0.7}
                  disabled={isBusy}
                >
                  {declineMutation.isPending ? (
                    <ActivityIndicator size="small" color={colors.gray[700]} />
                  ) : (
                    <Text style={styles.declineButtonText}>{t('social:decline')}</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.acceptButton,
                    isBusy && styles.buttonDisabled,
                  ]}
                  onPress={handleAccept}
                  activeOpacity={0.7}
                  disabled={isBusy}
                >
                  {acceptMutation.isPending ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.acceptButtonText}>{t('social:accept')}</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* Error text */}
              {errorMessage && (
                <Text style={styles.errorText}>{errorMessage}</Text>
              )}
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: s(40),
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: s(20),
    paddingVertical: s(28),
    paddingHorizontal: s(24),
    alignItems: "center",
    width: "100%",
    maxWidth: s(300),
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.5)",
    ...shadows.lg,
  },
  avatar: {
    width: s(64),
    height: s(64),
    borderRadius: s(32),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: s(12),
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: s(32),
  },
  avatarInitials: {
    fontSize: s(24),
    fontWeight: "700",
  },
  displayName: {
    fontSize: s(18),
    fontWeight: "700",
    color: colors.text.primary,
    marginBottom: s(4),
    textAlign: "center",
  },
  subtitle: {
    fontSize: s(14),
    color: colors.gray[500],
    marginBottom: s(16),
    textAlign: "center",
  },
  description: {
    fontSize: s(13),
    color: colors.gray[400],
    textAlign: "center",
    lineHeight: s(18),
    marginBottom: s(20),
  },
  buttonRow: {
    flexDirection: "row",
    gap: s(12),
    width: "100%",
  },
  declineButton: {
    flex: 1,
    backgroundColor: colors.gray[100],
    borderRadius: s(12),
    paddingVertical: s(14),
    alignItems: "center",
    justifyContent: "center",
    minHeight: s(48),
  },
  declineButtonText: {
    fontSize: s(15),
    fontWeight: "600",
    color: colors.gray[700],
  },
  acceptButton: {
    flex: 1,
    backgroundColor: "#eb7825",
    borderRadius: s(12),
    paddingVertical: s(14),
    alignItems: "center",
    justifyContent: "center",
    minHeight: s(48),
  },
  acceptButtonText: {
    fontSize: s(15),
    fontWeight: "600",
    color: "#FFFFFF",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  errorText: {
    fontSize: s(12),
    color: colors.error[500],
    textAlign: "center",
    marginTop: s(12),
  },
  successIcon: {
    fontSize: s(40),
    marginBottom: s(12),
  },
  successTitle: {
    fontSize: s(18),
    fontWeight: "700",
    color: colors.text.primary,
    marginBottom: s(4),
    textAlign: "center",
  },
  successSubtitle: {
    fontSize: s(14),
    color: colors.gray[500],
    textAlign: "center",
  },
});
