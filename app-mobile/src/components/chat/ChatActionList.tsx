/**
 * Issue #4114 Wave 3: renders the one friend action list (utils/chatMenuModel)
 * on the dark chat surfaces. Used by the 1:1 chat's ⋯ menu and by
 * FriendActionsSheet, so the two can never drift apart again.
 */
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import type { FriendMenuItem, FriendMenuItemId } from "../../utils/chatMenuModel";

interface ChatActionListProps {
  items: readonly FriendMenuItem[];
  name: string;
  onSelect: (id: FriendMenuItemId) => void;
  busyIds?: ReadonlySet<FriendMenuItemId>;
  /** Already-translated labels that replace an item's default label. */
  labels?: Partial<Record<FriendMenuItemId, string>>;
}

export function ChatActionList({ items, name, onSelect, busyIds, labels }: ChatActionListProps): React.ReactElement {
  const { t } = useTranslation(["chat", "connections"]);
  const firstDanger = items.findIndex((item) => item.tone === "danger");
  return (
    <View>
      {items.map((item, index) => {
        const disabled = item.tone === "disabled" || busyIds?.has(item.id) === true;
        const danger = item.tone === "danger";
        const label = labels?.[item.id] ?? t(item.labelKey, { name });
        return (
          <React.Fragment key={item.id}>
            {index === firstDanger && index > 0 ? <View style={styles.divider} /> : null}
            <TouchableOpacity
              style={styles.item}
              onPress={() => onSelect(item.id)}
              disabled={disabled}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled }}
              testID={`chat-menu-${item.id}`}
            >
              <Icon
                name={item.icon}
                size={20}
                color={danger ? chatTokens.danger : disabled ? chatTokens.textMuted : chatTokens.textSecondary}
                style={styles.icon}
              />
              <Text style={[styles.text, danger && styles.textDanger, disabled && styles.textDisabled]}>{label}</Text>
            </TouchableOpacity>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  icon: {
    width: 28,
    marginRight: 14,
    textAlign: "center",
  },
  text: {
    fontSize: 16,
    fontWeight: "500",
    color: chatTokens.textPrimary,
  },
  textDanger: {
    color: chatTokens.danger,
  },
  textDisabled: {
    color: chatTokens.textMuted,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: chatTokens.hairline,
    marginVertical: 6,
  },
});
