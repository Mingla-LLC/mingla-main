import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
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
  const insets = useSafeAreaInsets();
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
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      accessibilityViewIsModal
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t("common:close", { defaultValue: "Close" })}
        onPress={onClose}
      />
      <View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, s(16)) + s(16) },
        ]}
      >
        <View style={styles.handle} />
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "40%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: s(24),
    borderTopRightRadius: s(24),
    paddingTop: s(12),
    paddingHorizontal: s(20),
  },
  handle: {
    width: s(40),
    height: s(4),
    borderRadius: s(2),
    backgroundColor: colors.gray[300],
    alignSelf: "center",
    marginBottom: s(18),
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
