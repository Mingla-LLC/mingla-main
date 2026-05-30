/**
 * PairingInfoCard — Small bottom sheet shown when tapping a greyed-out or pending pill.
 *
 * Displays avatar, name, status message, and cancel action.
 * Animates in with scale + fade.
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
} from "react-native";
import * as Haptics from "expo-haptics";
import { BaseBottomSheet } from "./ui/BaseBottomSheet";
import type { PairingPill } from "../services/pairingService";
import { useTranslation } from 'react-i18next';
import { colors } from "../constants/designSystem";
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
    <BaseBottomSheet
      variant="center-dialog"
      visible={visible}
      onClose={onClose}
      accessibilityLabel={pill.displayName}
    >
      <View style={styles.card}>
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
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  // META-ORCH-0991 Wave B Batch 4: was a hand-rolled RN <Modal> centered card with
  // its own scrim (`overlay`), `backdrop`, and `card` chrome + scale/fade spring.
  // Now a NON-swipe center-dialog (BaseBottomSheet variant="center-dialog") — it's a
  // cancel-pairing confirm that must not be flickable (operator rule, playbook §1).
  // Card chrome (scrim/canvas/radius/padding/shadow/maxWidth/fade) comes from
  // glass.centerDialog; `card` is just the content layout passthrough (playbook §1).
  card: {
    // META-ORCH-0991 Wave B Batch 4: the visible dialog surface (scrim + opaque
    // canvas + radius + padding + shadow + maxWidth) is supplied by the
    // BaseBottomSheet center-dialog (glass.centerDialog canvas is already
    // Android-opaque #FFFFFF, clipped to radius — the META-ORCH-1002 Android
    // glass/inset-ring concern lands at the dialog canvas, not here). This inner
    // card is just the content layout passthrough.
    width: "100%",
    alignItems: "center",
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
