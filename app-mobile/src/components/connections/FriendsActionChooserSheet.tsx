import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";

// META-ORCH-0991 Wave B Batch 3: was a centered card capped at maxHeight 40% →
// a swipe-down sheet at the same height. A fixed snap (not enableDynamicSizing)
// is used because a content-height sheet inside the RN-Modal wrap measures its
// children below the viewport and snaps off-screen-bottom (sim-observed); a
// fixed percentage snaps reliably. Module-level const per playbook §2.
const FRIENDS_ACTION_CHOOSER_SNAP_POINTS = ['40%'];
import { colors, fontWeights } from "../../constants/designSystem";
import { s } from "../../utils/responsive";
import { HapticFeedback } from "../../utils/hapticFeedback";

interface FriendsActionChooserSheetProps {
  visible: boolean;
  onClose: () => void;
  onChooseCreateGroupChat: () => void;
  onChooseAddFriend: () => void;
  createGroupChatDisabled?: boolean;
  onCreateGroupChatPaywall?: () => void;
}

type ChooserOption = {
  icon: string;
  label: string;
  disabled?: boolean;
  badge?: string;
  onPress: () => void;
};

export function FriendsActionChooserSheet({
  visible,
  onClose,
  onChooseCreateGroupChat,
  onChooseAddFriend,
  createGroupChatDisabled = false,
  onCreateGroupChatPaywall,
}: FriendsActionChooserSheetProps) {
  const { t } = useTranslation(["social", "common"]);

  const handleOptionPress = (option: ChooserOption) => {
    HapticFeedback.medium();
    option.onPress();
  };

  const options: ChooserOption[] = [
    {
      icon: "people-outline",
      label: t("social:friendsActionChooserCreateGroupChat"),
      disabled: createGroupChatDisabled,
      badge: createGroupChatDisabled
        ? t("social:friendsActionChooserCreateDisabledPaywall")
        : undefined,
      onPress: createGroupChatDisabled
        ? onCreateGroupChatPaywall ?? onChooseCreateGroupChat
        : onChooseCreateGroupChat,
    },
    {
      icon: "person-add-outline",
      label: t("social:friendsActionChooserAddFriend"),
      onPress: onChooseAddFriend,
    },
  ];

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      theme="light"
      snapPoints={FRIENDS_ACTION_CHOOSER_SNAP_POINTS}
      scrollMode="view"
      wrapInRNModal
      accessibilityLabel={t("social:friendsActionChooserTitle")}
    >
      <View style={styles.sheet}>
        <Text style={styles.title} accessibilityRole="header">
          {t("social:friendsActionChooserTitle")}
        </Text>
        <View style={styles.divider} />

        <View style={styles.options}>
          {options.map((option) => (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              accessibilityLabel={
                option.badge ? `${option.label} - ${option.badge}` : option.label
              }
              onPress={() => handleOptionPress(option)}
              style={({ pressed }) => [
                styles.optionButton,
                pressed ? styles.optionButtonPressed : null,
              ]}
            >
              <View
                style={[
                  styles.optionIcon,
                  option.disabled ? styles.disabledContent : null,
                ]}
              >
                <Icon name={option.icon} size={22} color={colors.text.primary} />
              </View>
              <View style={styles.optionTextWrap}>
                <Text style={styles.optionLabel} numberOfLines={1}>
                  {option.label}
                </Text>
                {option.badge ? (
                  <Text style={styles.optionBadge} numberOfLines={1}>
                    {option.badge}
                  </Text>
                ) : null}
              </View>
              <Icon name="chevron-right" size={20} color={colors.gray[400]} />
            </Pressable>
          ))}
        </View>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingTop: s(6),
    paddingHorizontal: s(20),
    paddingBottom: s(24),
  },
  title: {
    color: colors.text.primary,
    fontSize: s(18),
    fontWeight: fontWeights.bold,
    textAlign: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.gray[100],
    marginTop: s(18),
    marginBottom: s(12),
  },
  options: {
    gap: s(12),
  },
  optionButton: {
    minHeight: s(64),
    borderRadius: s(14),
    backgroundColor: colors.gray[50],
    paddingVertical: s(14),
    paddingHorizontal: s(20),
    flexDirection: "row",
    alignItems: "center",
    gap: s(12),
  },
  optionButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  optionIcon: {
    width: s(28),
    alignItems: "center",
  },
  disabledContent: {
    opacity: 0.5,
  },
  optionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  optionLabel: {
    color: colors.text.primary,
    fontSize: s(16),
    fontWeight: fontWeights.semibold,
  },
  optionBadge: {
    color: colors.warning[500],
    fontSize: s(12),
    fontWeight: fontWeights.semibold,
    marginTop: s(2),
  },
});
