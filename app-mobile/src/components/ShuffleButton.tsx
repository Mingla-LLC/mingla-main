import React, { useState, useCallback } from "react";
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { s, vs } from "../utils/responsive";
import { colors } from "../constants/designSystem";

interface ShuffleButtonProps {
  onShuffle: () => Promise<void>;
  /** Minimum height to match sibling cards */
  minHeight?: number;
}

export default function ShuffleButton({
  onShuffle,
  minHeight,
}: ShuffleButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);

  const handlePress = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLoading(true);
    setError(false);

    try {
      await onShuffle();
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, [onShuffle]);

  return (
    <TouchableOpacity
      style={[styles.container, minHeight ? { minHeight } : undefined]}
      onPress={handlePress}
      disabled={isLoading}
      activeOpacity={0.7}
    >
      {isLoading ? (
        <>
          <ActivityIndicator size="small" color="#eb7825" />
          <Text style={styles.loadingText}>Finding...</Text>
        </>
      ) : error ? (
        <>
          <Ionicons name="refresh-outline" size={s(28)} color="#eb7825" />
          <Text style={styles.label}>Couldn't shuffle.</Text>
          <Text style={styles.sublabel}>Tap to retry.</Text>
        </>
      ) : (
        <>
          <Ionicons name="shuffle-outline" size={s(28)} color="#eb7825" />
          <Text style={styles.label}>Shuffle</Text>
          <Text style={styles.sublabel}>Find new spots</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: s(100),
    minHeight: s(140),
    backgroundColor: colors.gray[100],
    borderRadius: s(12),
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: vs(12),
    paddingHorizontal: s(8),
  },
  label: {
    fontSize: s(13),
    fontWeight: "600",
    color: "#374151",
    marginTop: s(6),
    textAlign: "center",
  },
  sublabel: {
    fontSize: s(11),
    fontWeight: "400",
    color: colors.gray[500],
    marginTop: s(2),
    textAlign: "center",
  },
  loadingText: {
    fontSize: s(12),
    fontWeight: "500",
    color: colors.gray[500],
    marginTop: s(6),
  },
});
