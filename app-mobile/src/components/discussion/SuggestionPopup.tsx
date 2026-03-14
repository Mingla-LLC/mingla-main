import React, { useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Animated,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, typography, shadows } from "../../constants/designSystem";

interface SuggestionItem {
  id: string;
  name: string;
  avatar_url?: string | null;
}

interface SuggestionPopupProps {
  type: "mention" | "cardTag";
  items: SuggestionItem[];
  onSelect: (item: { id: string; name: string }) => void;
}

function SuggestionPopup({ type, items, onSelect }: SuggestionPopupProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  if (items.length === 0) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {items.map((item, index) => (
          <TouchableOpacity
            key={item.id}
            onPress={() => onSelect({ id: item.id, name: item.name })}
            style={[
              styles.row,
              index < items.length - 1 && styles.rowBorder,
            ]}
          >
            {type === "mention" ? (
              <View style={styles.mentionAvatar}>
                <Text style={styles.mentionAvatarText}>
                  {item.name[0]?.toUpperCase()}
                </Text>
              </View>
            ) : (
              <Ionicons
                name="hash"
                size={16}
                color={colors.primary[500]}
              />
            )}
            <Text style={styles.itemName} numberOfLines={1}>
              {item.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

export default SuggestionPopup;

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.gray[100],
    maxHeight: 160,
    overflow: "hidden",
    ...shadows.lg,
  },
  scroll: {
    flexGrow: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    paddingHorizontal: 12,
    gap: 8,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[50],
  },
  mentionAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.orange[100],
    alignItems: "center",
    justifyContent: "center",
  },
  mentionAvatarText: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.orange[700],
  },
  itemName: {
    ...typography.sm,
    color: colors.gray[800],
    flex: 1,
  },
});
