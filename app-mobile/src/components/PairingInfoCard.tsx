/**
 * PairingInfoCard — Small bottom sheet shown when tapping a greyed-out or pending pill.
 *
 * Displays avatar, name, status message, and cancel action.
 * Animates in with scale + fade.
 */
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Animated,
  Image,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { PairingPill } from "../services/pairingService";
import { useTranslation } from 'react-i18next';
import { colors, radius, shadows } from "../constants/designSystem";
import { s } from "../utils/responsive";

const INITIALS_COLORS = [
  colors.primary[500],
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
];

interface PairingInfoCardProps {
  visible: boolean;
  pill: PairingPill | null;
  onCancel: () => void;
  onClose: () => void;
}

function getInitialsColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return INITIALS_COLORS[Math.abs(hash) % INITIALS_COLORS.length];
}

export default function PairingInfoCard({
  visible,
  pill,
  onCancel,
  onClose,
}: PairingInfoCardProps) {
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
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
  }, [visible, scaleAnim, opacityAnim]);

  const { t } = useTranslation(['social', 'common']);

  if (!pill) return null;

  const cancelLabel =
    pill.type === "pending_invite" ? t('social:cancelInviteLabel') : t('social:cancelPairRequest');

  const avatarColor = getInitialsColor(pill.displayName);

  const handleCancel = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onCancel();
  };

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
          onPress={onClose}
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
          {/* Avatar */}
          <View
            style={[
              styles.avatar,
              { backgroundColor: avatarColor + "20" },
            ]}
          >
            {pill.avatarUrl ? (
              <Image
                source={{ uri: pill.avatarUrl }}
                style={styles.avatarImage}
              />
            ) : (
              <Text style={[styles.avatarInitials, { color: avatarColor }]}>
                {pill.initials}
              </Text>
            )}
          </View>

          {/* Display Name */}
          <Text style={styles.displayName} numberOfLines={1} ellipsizeMode="tail">
            {pill.displayName}
          </Text>

          {/* Status Message */}
          {pill.statusMessage ? (
            <Text style={styles.statusMessage} numberOfLines={2}>
              {pill.statusMessage}
            </Text>
          ) : null}

          {/* Cancel Button */}
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelButtonText}>{cancelLabel}</Text>
          </TouchableOpacity>
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
    width: s(56),
    height: s(56),
    borderRadius: s(28),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: s(12),
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: s(28),
  },
  avatarInitials: {
    fontSize: s(20),
    fontWeight: "700",
  },
  displayName: {
    fontSize: s(18),
    fontWeight: "700",
    color: colors.text.primary,
    marginBottom: s(6),
    textAlign: "center",
  },
  statusMessage: {
    fontSize: s(14),
    color: colors.text.tertiary,
    textAlign: "center",
    lineHeight: s(20),
    marginBottom: s(20),
  },
  cancelButton: {
    borderWidth: 1.5,
    borderColor: colors.error[400],
    borderRadius: s(12),
    paddingVertical: s(12),
    paddingHorizontal: s(24),
    minWidth: s(200),
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: s(15),
    fontWeight: "600",
    color: colors.error[500],
  },
});
