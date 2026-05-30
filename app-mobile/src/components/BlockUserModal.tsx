/**
 * BlockUserModal
 *
 * Confirmation dialog for blocking a user.
 * Explains what blocking does and provides optional reason selection.
 *
 * META-ORCH-0991 Wave B — migrated from a hand-rolled RN <Modal> (fade,
 * centered card) onto BaseBottomSheet's `variant="center-dialog"`. A block
 * confirm is a deliberate, irreversible-feeling decision: per the investigation
 * §2 it MUST stay a centered confirm card (no pan-down — a confirm you can flick
 * away by accident is a footgun), NOT a swipe-down sheet. The center-dialog
 * variant gives the shared scrim + card chrome (glass.centerDialog) + RN-Modal
 * z-stacking (so it layers above the FriendActionsSheet / ConnectionsPage chat
 * that opens it) + Android hardware-back. Only the OUTER scrim/card shell was
 * removed; every bit of the inner content, copy, reason chips, callbacks, and
 * styling is preserved exactly.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from 'react-i18next';
import { Icon } from './ui/Icon';
import { BaseBottomSheet } from './ui/BaseBottomSheet';
import { BlockReason } from "../services/blockService";

interface BlockUserModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (reason?: BlockReason) => Promise<void>;
  userName: string;
  loading?: boolean;
}

const BLOCK_REASON_KEYS: { value: BlockReason; labelKey: string; icon: string }[] = [
  { value: "harassment", labelKey: "social:harassment", icon: "warning" },
  { value: "spam", labelKey: "social:spam", icon: "mail-unread" },
  { value: "inappropriate", labelKey: "social:inappropriateContent", icon: "alert-circle" },
  { value: "other", labelKey: "social:other", icon: "ellipsis-horizontal" },
];

export const BlockUserModal: React.FC<BlockUserModalProps> = ({
  visible,
  onClose,
  onConfirm,
  userName,
  loading = false,
}) => {
  const { t } = useTranslation(['social', 'common']);
  const [selectedReason, setSelectedReason] = useState<BlockReason | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm(selectedReason);
    } finally {
      setIsSubmitting(false);
      setSelectedReason(undefined);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setSelectedReason(undefined);
      onClose();
    }
  };

  const isLoading = loading || isSubmitting;

  return (
    <BaseBottomSheet
      variant="center-dialog"
      visible={visible}
      onClose={handleClose}
      theme="light"
      accessibilityLabel={t('social:blockTitle', { name: userName })}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
                <View style={styles.iconContainer}>
                  <Icon name="shield" size={32} color="#ef4444" />
                </View>
                <Text style={styles.title}>{t('social:blockTitle', { name: userName })}</Text>
              </View>

              {/* Description */}
              <View style={styles.descriptionContainer}>
                <Text style={styles.description}>
                  {t('social:blockDescription')}
                </Text>
                <View style={styles.bulletList}>
                  <View style={styles.bulletItem}>
                    <Icon name="remove-circle" size={16} color="#6b7280" />
                    <Text style={styles.bulletText}>
                      {t('social:blockBulletFriendsList')}
                    </Text>
                  </View>
                  <View style={styles.bulletItem}>
                    <Icon name="chatbubble-ellipses" size={16} color="#6b7280" />
                    <Text style={styles.bulletText}>
                      {t('social:blockBulletMessage')}
                    </Text>
                  </View>
                  <View style={styles.bulletItem}>
                    <Icon name="search" size={16} color="#6b7280" />
                    <Text style={styles.bulletText}>
                      {t('social:blockBulletSearch')}
                    </Text>
                  </View>
                  <View style={styles.bulletItem}>
                    <Icon name="people" size={16} color="#6b7280" />
                    <Text style={styles.bulletText}>
                      {t('social:blockBulletCollaboration')}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Reason Selection (Optional) */}
              <View style={styles.reasonContainer}>
                <Text style={styles.reasonLabel}>{t('social:reasonOptional')}</Text>
                <View style={styles.reasonOptions}>
                  {BLOCK_REASON_KEYS.map((reason) => (
                    <TouchableOpacity
                      key={reason.value}
                      style={[
                        styles.reasonOption,
                        selectedReason === reason.value && styles.reasonOptionSelected,
                      ]}
                      onPress={() => setSelectedReason(
                        selectedReason === reason.value ? undefined : reason.value
                      )}
                      disabled={isLoading}
                    >
                      <Icon
                        name={reason.icon}
                        size={16}
                        color={selectedReason === reason.value ? "#eb7825" : "#6b7280"}
                      />
                      <Text
                        style={[
                          styles.reasonText,
                          selectedReason === reason.value && styles.reasonTextSelected,
                        ]}
                      >
                        {t(reason.labelKey)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Action Buttons */}
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={handleClose}
                  disabled={isLoading}
                >
                  <Text style={styles.cancelButtonText}>{t('social:cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.blockButton, isLoading && styles.buttonDisabled]}
                  onPress={handleConfirm}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Icon name="shield" size={18} color="white" />
                      <Text style={styles.blockButtonText}>{t('social:block')}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
      </View>
    </BaseBottomSheet>
  );
};

const styles = StyleSheet.create({
  // META-ORCH-0991 Wave B — the scrim, centered card, radius, padding, shadow,
  // and maxWidth now come from BaseBottomSheet's center-dialog chrome
  // (glass.centerDialog). `container` is a transparent passthrough so the
  // inner content (header/bullets/reason chips/actions) keeps its exact
  // vertical rhythm without a second background/border/padding.
  container: {
    width: "100%",
  },
  header: {
    alignItems: "center",
    marginBottom: 16,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fef2f2",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1f2937",
    textAlign: "center",
  },
  descriptionContainer: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  description: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "600",
    marginBottom: 12,
  },
  bulletList: {
    gap: 8,
  },
  bulletItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: "#6b7280",
    lineHeight: 18,
  },
  reasonContainer: {
    marginBottom: 20,
  },
  reasonLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 10,
  },
  reasonOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  reasonOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#f3f4f6",
    gap: 6,
  },
  reasonOptionSelected: {
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#eb7825",
  },
  reasonText: {
    fontSize: 13,
    color: "#6b7280",
  },
  reasonTextSelected: {
    color: "#eb7825",
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6b7280",
  },
  blockButton: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  blockButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

export default BlockUserModal;
