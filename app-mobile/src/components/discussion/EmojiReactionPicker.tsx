import React, { useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import { shadows } from "../../constants/designSystem";

const EMOJI_OPTIONS = ["❤️", "😂", "👍", "😮", "😢", "🔥"];

interface EmojiReactionPickerProps {
  visible: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  position: { top: number };
  existingReactions?: string[];
}

function EmojiReactionPicker({
  visible,
  onSelect,
  onClose,
  position,
  existingReactions = [],
}: EmojiReactionPickerProps) {
  const scale = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 20,
          bounciness: 6,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scale.setValue(0.8);
      opacity.setValue(0);
    }
  }, [visible, scale, opacity]);

  if (!visible) return null;

  const handleSelect = async (emoji: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelect(emoji);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onClose}
      />

      {/* Picker */}
      <Animated.View
        style={[
          styles.picker,
          { top: position.top - 56 },
          { transform: [{ scale }], opacity },
        ]}
      >
        {EMOJI_OPTIONS.map((emoji) => {
          const isUsed = existingReactions.includes(emoji);
          return (
            <TouchableOpacity
              key={emoji}
              onPress={() => handleSelect(emoji)}
              style={[styles.emojiButton, isUsed && styles.emojiButtonUsed]}
            >
              <Text style={styles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          );
        })}
      </Animated.View>
    </View>
  );
}

export default EmojiReactionPicker;

const styles = StyleSheet.create({
  picker: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 8,
    ...shadows.lg,
  },
  emojiButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  emojiButtonUsed: {
    backgroundColor: "#fff7ed", // colors.orange[50]
  },
  emojiText: {
    fontSize: 22,
  },
});
