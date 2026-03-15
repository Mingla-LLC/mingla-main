import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  AccessibilityRole,
} from "react-native";
import * as Haptics from "expo-haptics";
import { s, vs, ms } from "../utils/responsive";
import { colors, shadows } from "../constants/designSystem";

// ── Types ───────────────────────────────────────────────────────────────────

interface PersonTabBarProps {
  activeTab: number;
  onTabChange: (index: number) => void;
  labels: [string, string, string];
  counts?: [number | undefined, number | undefined, number | undefined];
}

// ── Constants ───────────────────────────────────────────────────────────────

const TRACK_PADDING = s(3);
const TRACK_HEIGHT = s(44);
const NUM_TABS = 3;

// ── Count Badge ─────────────────────────────────────────────────────────────

const CountBadge: React.FC<{ count: number }> = ({ count }) => {
  if (count <= 0) return null;
  return (
    <View style={badgeStyles.container}>
      <Text style={badgeStyles.text}>{count > 99 ? "99+" : String(count)}</Text>
    </View>
  );
};

const badgeStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.gray[200],
    borderRadius: s(8),
    minWidth: s(18),
    height: s(16),
    paddingHorizontal: s(4),
    alignItems: "center",
    justifyContent: "center",
    marginLeft: s(4),
  },
  text: {
    fontSize: ms(10),
    fontWeight: "600",
    color: colors.gray[600],
  },
});

// ── Component ───────────────────────────────────────────────────────────────

const PersonTabBar: React.FC<PersonTabBarProps> = ({
  activeTab,
  onTabChange,
  labels,
  counts,
}) => {
  const slideAnim = useRef(new Animated.Value(activeTab)).current;
  const [trackWidth, setTrackWidth] = React.useState(0);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: activeTab,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [activeTab, slideAnim]);

  const handlePress = (index: number) => {
    if (index === activeTab) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onTabChange(index);
  };

  const pillWidth =
    trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2) / NUM_TABS : 0;

  const translateX = slideAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [0, pillWidth, pillWidth * 2],
  });

  return (
    <View
      style={componentStyles.container}
      accessibilityRole={"tablist" as AccessibilityRole}
    >
      <View
        style={componentStyles.track}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        {/* Sliding pill */}
        {pillWidth > 0 && (
          <Animated.View
            style={[
              componentStyles.pill,
              {
                width: pillWidth,
                transform: [{ translateX }],
              },
            ]}
          />
        )}

        {/* Tab segments */}
        {labels.map((label, index) => {
          const isActive = activeTab === index;
          const count = counts?.[index];
          return (
            <TouchableOpacity
              key={label}
              style={componentStyles.segment}
              onPress={() => handlePress(index)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={
                count != null && count > 0
                  ? `${label} tab, ${count} items`
                  : `${label} tab`
              }
            >
              <View style={componentStyles.segmentContent}>
                <Text
                  style={[
                    componentStyles.segmentText,
                    isActive && componentStyles.segmentTextActive,
                  ]}
                >
                  {label}
                </Text>
                {count != null && <CountBadge count={count} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────────

const componentStyles = StyleSheet.create({
  container: {
    marginHorizontal: s(16),
    marginTop: vs(12),
    marginBottom: vs(4),
  },
  track: {
    flexDirection: "row",
    backgroundColor: colors.gray[100],
    borderRadius: s(12),
    padding: TRACK_PADDING,
    position: "relative",
  },
  pill: {
    position: "absolute",
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    height: TRACK_HEIGHT - TRACK_PADDING * 2,
    borderRadius: s(10),
    backgroundColor: "#ffffff",
    ...shadows.sm,
  },
  segment: {
    flex: 1,
    height: TRACK_HEIGHT - TRACK_PADDING * 2,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  segmentContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  segmentText: {
    fontSize: ms(13),
    fontWeight: "500",
    color: colors.gray[500],
  },
  segmentTextActive: {
    fontWeight: "600",
    color: colors.gray[900],
  },
});

export default PersonTabBar;
