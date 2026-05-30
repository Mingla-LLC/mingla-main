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
  StyleSheet,
  Image,
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import { BaseBottomSheet } from "./ui/BaseBottomSheet";
import { Icon } from "./ui/Icon";
import { useAcceptPairRequest, useDeclinePairRequest } from "../hooks/usePairings";
import type { PairRequest } from "../services/pairingService";
import { useTranslation } from 'react-i18next';
import { colors } from "../constants/designSystem";
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

  // Guard dismissal while a mutation is in flight or success is showing, matching
  // the prior backdrop-press guard (was `isBusy || showSuccess ? undefined : onClose`).
  const handleClose = (): void => {
    if (isBusy || showSuccess) return;
    onClose();
  };

  return (
    <BaseBottomSheet
      variant="center-dialog"
      visible={visible}
      onClose={handleClose}
      accessibilityLabel={t('social:wantsToPairWithYou')}
    >
      <View style={styles.card}>
          {showSuccess ? (
            <>
              {/* Success state — premium */}
              <View style={styles.successIconWrap}>
                <Icon name="star" size={s(28)} color="#ffffff" />
              </View>
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
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  // META-ORCH-0991 Wave B Batch 4: was a hand-rolled RN <Modal> centered card with
  // its own scrim (`overlay`), `backdrop`, and `card` chrome + scale/fade spring.
  // Now a NON-swipe center-dialog (BaseBottomSheet variant="center-dialog") — it's an
  // accept/decline confirm that must not be flickable (operator rule, playbook §1).
  // The center-dialog supplies scrim + card canvas + radius + padding + shadow +
  // maxWidth + fade from glass.centerDialog, so `card` is now just the content layout
  // passthrough (alignItems:center) per playbook §1.
  card: {
    // META-ORCH-0991 Wave B Batch 4: the visible dialog surface (scrim + opaque
    // canvas + radius + padding + shadow + maxWidth) is now supplied by the
    // BaseBottomSheet center-dialog itself (glass.centerDialog canvas is already
    // Android-opaque #FFFFFF, clipped to radius — so the META-ORCH-1002 Android
    // glass/inset-ring concern is satisfied at the dialog canvas, not here). This
    // inner card is therefore just the content layout passthrough.
    width: "100%",
    alignItems: "center",
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
  successIconWrap: {
    width: s(64),
    height: s(64),
    borderRadius: s(32),
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: s(16),
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  successTitle: {
    fontSize: s(20),
    fontWeight: "700",
    color: colors.text.primary,
    marginBottom: s(6),
    textAlign: "center",
    letterSpacing: -0.3,
  },
  successSubtitle: {
    fontSize: s(14),
    fontWeight: "500",
    color: colors.gray[500],
    textAlign: "center",
    lineHeight: s(20),
  },
});
