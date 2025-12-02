import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Modal,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

interface CoachMapStep {
  id: string;
  title: string;
  description: string;
  icon: string;
  target:
    | "bottomTabs"
    | "swipeCard"
    | "preferencesButton"
    | "collaborateButton"
    | "shareButton"
    | "tabHome"
    | "tabConnections"
    | "tabActivity"
    | "tabSaved"
    | "tabProfile"
    | "center";
  position: "top" | "bottom" | "center" | "left" | "right";
  highlightPosition?: { x: number; y: number; width: number; height: number };
}

const COACH_STEPS: CoachMapStep[] = [
  {
    id: "welcome",
    title: "Welcome to Mingla! 🎉",
    description: "Let's take a quick tour to get you started",
    icon: "sparkles",
    target: "center",
    position: "center",
  },
  {
    id: "swipe",
    title: "Swipe to Discover",
    description:
      "Swipe right to save experiences you love. Swipe left to skip and see the next card.",
    icon: "swap-horizontal",
    target: "swipeCard",
    position: "top",
  },
  {
    id: "tabHome",
    title: "Home Tab",
    description:
      "Discover new experiences tailored to your preferences. Swipe through personalized recommendations.",
    icon: "home",
    target: "tabHome",
    position: "bottom",
  },
  {
    id: "tabConnections",
    title: "Connections Tab",
    description:
      "Manage your friends and connections. Add people, view mutual friends, and see who's online.",
    icon: "people",
    target: "tabConnections",
    position: "bottom",
  },
  {
    id: "tabActivity",
    title: "Activity Tab",
    description:
      "View your collaboration boards, saved experiences, and calendar. See all your planned activities in one place.",
    icon: "calendar",
    target: "tabActivity",
    position: "bottom",
  },
  {
    id: "tabSaved",
    title: "Saved Tab",
    description:
      "Access all your saved experiences. Filter, search, and manage the places you've bookmarked.",
    icon: "bookmark",
    target: "tabSaved",
    position: "bottom",
  },
  {
    id: "tabProfile",
    title: "Profile Tab",
    description:
      "Manage your account settings, view your stats, and customize your profile information.",
    icon: "person",
    target: "tabProfile",
    position: "bottom",
  },
  {
    id: "preferences",
    title: "Customize Your Preferences",
    description:
      "Tap the settings icon to adjust your interests, budget, and more",
    icon: "options",
    target: "preferencesButton",
    position: "top",
  },
  {
    id: "collaborate",
    title: "Plan with Friends",
    description: "Collaborate with friends to discover experiences together",
    icon: "people",
    target: "collaborateButton",
    position: "top",
  },
  {
    id: "complete",
    title: "You're All Set! ✨",
    description: "Start swiping to find your next adventure",
    icon: "checkmark-circle",
    target: "center",
    position: "center",
  },
];

interface CoachMapProps {
  visible: boolean;
  onComplete: () => void;
  onSkip: () => void;
  onStepChange?: (stepIndex: number, target: string) => void;
}

export default function CoachMap({
  visible,
  onComplete,
  onSkip,
  onStepChange,
}: CoachMapProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [highlightLayout, setHighlightLayout] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  const currentStep = COACH_STEPS[currentStepIndex];

  useEffect(() => {
    if (visible) {
      // Reset to first step when opened
      setCurrentStepIndex(0);
      // Notify parent of initial step
      if (onStepChange) {
        onStepChange(0, COACH_STEPS[0].target);
      }

      // Animate in
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();

      // Pulse animation for highlight
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      // Reset animations when closed
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.8);
      slideAnim.setValue(50);
      pulseAnim.setValue(1);
      // Notify parent that coach map is closed
      if (onStepChange) {
        onStepChange(-1, "");
      }
    }
  }, [visible]);

  const handleNext = () => {
    if (currentStepIndex < COACH_STEPS.length - 1) {
      const nextIndex = currentStepIndex + 1;
      // Notify parent of step change immediately (synchronously, before animation)
      if (onStepChange && COACH_STEPS[nextIndex]) {
        onStepChange(nextIndex, COACH_STEPS[nextIndex].target);
      }

      // Animate out
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setCurrentStepIndex(nextIndex);
        // Animate in next step
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            friction: 8,
            tension: 40,
            useNativeDriver: true,
          }),
        ]).start();
      });
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStepIndex > 0) {
      const prevIndex = currentStepIndex - 1;
      // Notify parent of step change immediately (synchronously, before animation)
      if (onStepChange && COACH_STEPS[prevIndex]) {
        onStepChange(prevIndex, COACH_STEPS[prevIndex].target);
      }

      // Animate out
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.9,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setCurrentStepIndex(prevIndex);
        // Animate in previous step
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            friction: 8,
            tension: 40,
            useNativeDriver: true,
          }),
        ]).start();
      });
    }
  };

  const handleComplete = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onComplete();
    });
  };

  const handleSkip = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onSkip();
    });
  };

  const getTooltipPosition = () => {
    const tooltipWidth = SCREEN_WIDTH - 40;
    const tooltipCenter = tooltipWidth / 2;

    switch (currentStep.position) {
      case "top":
        // For swipe card, position tooltip at the top so it doesn't block the card
        if (currentStep.target === "swipeCard") {
          return {
            position: "absolute" as const,
            top: 180,
            left: 20,
            right: 20,
          };
        }
        return {
          position: "absolute" as const,
          top: 120,
          left: 20,
          right: 20,
        };
      case "bottom":
        return {
          position: "absolute" as const,
          bottom: 120,
          left: 20,
          right: 20,
        };
      case "center":
        return {
          position: "absolute" as const,
          top: SCREEN_HEIGHT / 2 - 150,
          left: 20,
          right: 20,
        };
      default:
        return {
          position: "absolute" as const,
          top: SCREEN_HEIGHT / 2 - 150,
          left: 20,
          right: 20,
        };
    }
  };

  const isTabStep = () => {
    return (
      currentStep.target === "tabHome" ||
      currentStep.target === "tabConnections" ||
      currentStep.target === "tabActivity" ||
      currentStep.target === "tabSaved" ||
      currentStep.target === "tabProfile"
    );
  };

  const isHeaderStep = () => {
    return (
      currentStep.target === "preferencesButton" ||
      currentStep.target === "collaborateButton"
    );
  };

  const renderHighlight = () => {
    // Don't render highlight for center/welcome steps
    if (currentStep.target === "center") {
      return null;
    }

    // Calculate highlight position based on target
    // These positions account for SafeAreaView padding and actual button sizes
    let highlightStyle: any = {};

    switch (currentStep.target) {
      case "bottomTabs":
        highlightStyle = {
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 90,
        };
        break;
      case "tabHome":
        // Exact measurements from styles:
        // navItem: paddingVertical: 8, paddingHorizontal: 16
        // navText: fontSize: 12, marginTop: 4
        // Icon: size 24
        // Tab item height: icon (24) + marginTop (4) + text (12) + paddingVertical (8*2) = 56px
        // Tab item width: paddingHorizontal (16*2) + icon space ≈ 60-70px, use 65px
        // bottomNavigation: paddingTop: 8, paddingBottom: 8
        // navigationContainer: paddingHorizontal: 16, uses space-around
        const tabItemWidth = 65; // Approximate width per tab
        const tabItemHeight = 56; // icon (24) + marginTop (4) + text (12) + padding (16)
        const tabPadding = 8;
        const tabBarPaddingTop = 8;
        const tabBarPaddingBottom = 8;
        const safeAreaBottom = 20; // Approximate SafeArea bottom
        const tabBarHeight =
          tabBarPaddingTop + tabBarPaddingBottom + tabItemHeight; // 72px
        const tabIndex = 0;
        // With space-around and 5 tabs, calculate approximate centers
        // Container has paddingHorizontal: 16, so available width = SCREEN_WIDTH - 32
        // With space-around, tabs are evenly distributed
        const containerPadding = 16;
        const availableWidth = SCREEN_WIDTH - containerPadding * 2;
        // For 5 tabs with space-around, approximate centers
        const tabCenters = [
          containerPadding + availableWidth * 0.1,
          containerPadding + availableWidth * 0.3,
          containerPadding + availableWidth * 0.5,
          containerPadding + availableWidth * 0.7,
          containerPadding + availableWidth * 0.9,
        ];
        const tabCenterX = tabCenters[tabIndex];
        const tabButtonLeft = tabCenterX - tabItemWidth / 2;
        const tabButtonTop =
          SCREEN_HEIGHT - safeAreaBottom - tabBarHeight + tabBarPaddingTop;
        const tabOffset = 45; // Move highlight down significantly to align with tabs
        highlightStyle = {
          position: "absolute",
          top: tabButtonTop - tabPadding + tabOffset,
          left: tabButtonLeft - tabPadding,
          width: tabItemWidth + tabPadding * 2,
          height: tabItemHeight + tabPadding * 2,
          borderRadius: 16,
        };
        break;
      case "tabConnections":
        const tabItemWidth2 = 65;
        const tabItemHeight2 = 56;
        const tabPadding2 = 8;
        const tabBarPaddingTop2 = 8;
        const tabBarPaddingBottom2 = 8;
        const safeAreaBottom2 = 20;
        const tabBarHeight2 =
          tabBarPaddingTop2 + tabBarPaddingBottom2 + tabItemHeight2;
        const tabIndex2 = 1;
        const containerPadding2 = 16;
        const availableWidth2 = SCREEN_WIDTH - containerPadding2 * 2;
        const tabCenters2 = [
          containerPadding2 + availableWidth2 * 0.1,
          containerPadding2 + availableWidth2 * 0.3,
          containerPadding2 + availableWidth2 * 0.5,
          containerPadding2 + availableWidth2 * 0.7,
          containerPadding2 + availableWidth2 * 0.9,
        ];
        const tabCenterX2 = tabCenters2[tabIndex2];
        const tabButtonLeft2 = tabCenterX2 - tabItemWidth2 / 2;
        const tabButtonTop2 =
          SCREEN_HEIGHT - safeAreaBottom2 - tabBarHeight2 + tabBarPaddingTop2;
        const tabOffset2 = 45; // Match Home tab offset to accommodate label
        const extraWidth2 = 10; // Small extra width to center tab within ring
        const rightOffset2 = 15; // Move ring further right
        const tabButtonCenter2 = tabButtonLeft2 + tabItemWidth2 / 2;
        highlightStyle = {
          position: "absolute",
          top: tabButtonTop2 - tabPadding2 + tabOffset2,
          left:
            tabButtonCenter2 -
            (tabItemWidth2 + tabPadding2 * 2 + extraWidth2) / 2 +
            rightOffset2,
          width: tabItemWidth2 + tabPadding2 * 2 + extraWidth2,
          height: tabItemHeight2 + tabPadding2 * 2,
          borderRadius: 16,
        };
        break;
      case "tabActivity":
        const tabItemWidth3 = 65;
        const tabItemHeight3 = 56;
        const tabPadding3 = 8;
        const tabBarPaddingTop3 = 8;
        const tabBarPaddingBottom3 = 8;
        const safeAreaBottom3 = 20;
        const tabBarHeight3 =
          tabBarPaddingTop3 + tabBarPaddingBottom3 + tabItemHeight3;
        const tabIndex3 = 2;
        const containerPadding3 = 16;
        const availableWidth3 = SCREEN_WIDTH - containerPadding3 * 2;
        const tabCenters3 = [
          containerPadding3 + availableWidth3 * 0.1,
          containerPadding3 + availableWidth3 * 0.3,
          containerPadding3 + availableWidth3 * 0.5,
          containerPadding3 + availableWidth3 * 0.7,
          containerPadding3 + availableWidth3 * 0.9,
        ];
        const tabCenterX3 = tabCenters3[tabIndex3];
        const tabButtonLeft3 = tabCenterX3 - tabItemWidth3 / 2;
        const tabButtonTop3 =
          SCREEN_HEIGHT - safeAreaBottom3 - tabBarHeight3 + tabBarPaddingTop3;
        const tabOffset3 = 45; // Match Home tab offset to accommodate label
        const extraWidth3 = 10; // Small extra width to center tab within ring
        const rightOffset3 = 15; // Move ring further right
        const tabButtonCenter3 = tabButtonLeft3 + tabItemWidth3 / 2;
        highlightStyle = {
          position: "absolute",
          top: tabButtonTop3 - tabPadding3 + tabOffset3,
          left:
            tabButtonCenter3 -
            (tabItemWidth3 + tabPadding3 * 2 + extraWidth3) / 2 +
            rightOffset3,
          width: tabItemWidth3 + tabPadding3 * 2 + extraWidth3,
          height: tabItemHeight3 + tabPadding3 * 2,
          borderRadius: 16,
        };
        break;
      case "tabSaved":
        const tabItemWidth4 = 65;
        const tabItemHeight4 = 56;
        const tabPadding4 = 8;
        const tabBarPaddingTop4 = 8;
        const tabBarPaddingBottom4 = 8;
        const safeAreaBottom4 = 20;
        const tabBarHeight4 =
          tabBarPaddingTop4 + tabBarPaddingBottom4 + tabItemHeight4;
        const tabIndex4 = 3;
        const containerPadding4 = 16;
        const availableWidth4 = SCREEN_WIDTH - containerPadding4 * 2;
        const tabCenters4 = [
          containerPadding4 + availableWidth4 * 0.1,
          containerPadding4 + availableWidth4 * 0.3,
          containerPadding4 + availableWidth4 * 0.5,
          containerPadding4 + availableWidth4 * 0.7,
          containerPadding4 + availableWidth4 * 0.9,
        ];
        const tabCenterX4 = tabCenters4[tabIndex4];
        const tabButtonLeft4 = tabCenterX4 - tabItemWidth4 / 2;
        const tabButtonTop4 =
          SCREEN_HEIGHT - safeAreaBottom4 - tabBarHeight4 + tabBarPaddingTop4;
        const tabOffset4 = 45; // Match Home tab offset to accommodate label
        const extraWidth4 = 10; // Small extra width to center tab within ring
        const rightOffset4 = 15; // Move ring further right
        const tabButtonCenter4 = tabButtonLeft4 + tabItemWidth4 / 2;
        highlightStyle = {
          position: "absolute",
          top: tabButtonTop4 - tabPadding4 + tabOffset4,
          left:
            tabButtonCenter4 -
            (tabItemWidth4 + tabPadding4 * 2 + extraWidth4) / 2 +
            rightOffset4,
          width: tabItemWidth4 + tabPadding4 * 2 + extraWidth4,
          height: tabItemHeight4 + tabPadding4 * 2,
          borderRadius: 16,
        };
        break;
      case "tabProfile":
        const tabItemWidth5 = 65;
        const tabItemHeight5 = 56;
        const tabPadding5 = 8;
        const tabBarPaddingTop5 = 8;
        const tabBarPaddingBottom5 = 8;
        const safeAreaBottom5 = 20;
        const tabBarHeight5 =
          tabBarPaddingTop5 + tabBarPaddingBottom5 + tabItemHeight5;
        const tabIndex5 = 4;
        const containerPadding5 = 16;
        const availableWidth5 = SCREEN_WIDTH - containerPadding5 * 2;
        const tabCenters5 = [
          containerPadding5 + availableWidth5 * 0.1,
          containerPadding5 + availableWidth5 * 0.3,
          containerPadding5 + availableWidth5 * 0.5,
          containerPadding5 + availableWidth5 * 0.7,
          containerPadding5 + availableWidth5 * 0.9,
        ];
        const tabCenterX5 = tabCenters5[tabIndex5];
        const tabButtonLeft5 = tabCenterX5 - tabItemWidth5 / 2;
        const tabButtonTop5 =
          SCREEN_HEIGHT - safeAreaBottom5 - tabBarHeight5 + tabBarPaddingTop5;
        const tabOffset5 = 45; // Match Home tab offset to accommodate label
        const extraWidth5 = 10; // Small extra width to center tab within ring
        const rightOffset5 = 15; // Move ring further right
        const tabButtonCenter5 = tabButtonLeft5 + tabItemWidth5 / 2;
        highlightStyle = {
          position: "absolute",
          top: tabButtonTop5 - tabPadding5 + tabOffset5,
          left:
            tabButtonCenter5 -
            (tabItemWidth5 + tabPadding5 * 2 + extraWidth5) / 2 +
            rightOffset5,
          width: tabItemWidth5 + tabPadding5 * 2 + extraWidth5,
          height: tabItemHeight5 + tabPadding5 * 2,
          borderRadius: 16,
        };
        break;
      case "preferencesButton":
        // Exact measurements: padding: 10, minWidth: 40, minHeight: 40 = 60x60 button
        // Header: paddingHorizontal: 16, paddingTop: 8
        // SafeArea top: ~44px average
        // Button position: left: 16px, top: SafeArea (44) + header paddingTop (8) = 52px
        // Move highlight UP by subtracting more from top
        const preferencesButtonSize = 60;
        const preferencesPadding = 8;
        const preferencesHighlightSize =
          preferencesButtonSize + preferencesPadding * 2;
        const safeAreaTop = 44;
        const headerPaddingTop = 8;
        const preferencesButtonLeft = 16;
        const preferencesButtonTop = safeAreaTop + headerPaddingTop;
        const preferencesOffset = 6; // Move highlight up
        highlightStyle = {
          position: "absolute",
          top: preferencesButtonTop - preferencesPadding - preferencesOffset,
          left: preferencesButtonLeft - preferencesPadding,
          width: preferencesHighlightSize,
          height: preferencesHighlightSize,
          borderRadius: 16,
        };
        break;
      case "collaborateButton":
        // Exact measurements: paddingHorizontal: 12, paddingVertical: 6
        // Button width: ~140px, height: ~44px
        // Move highlight UP by subtracting more from top
        const collaborateButtonWidth = 140;
        const collaborateButtonHeight = 44;
        const collaboratePadding = 8;
        const collaborateHighlightWidth =
          collaborateButtonWidth + collaboratePadding * 2;
        const collaborateHighlightHeight =
          collaborateButtonHeight + collaboratePadding * 2;
        const safeAreaTop2 = 44;
        const headerPaddingTop2 = 8;
        const collaborateButtonRight = 16;
        const collaborateButtonTop = safeAreaTop2 + headerPaddingTop2;
        const collaborateButtonLeft =
          SCREEN_WIDTH - collaborateButtonRight - collaborateButtonWidth;
        const collaborateOffset = 6; // Move highlight up
        highlightStyle = {
          position: "absolute",
          top: collaborateButtonTop - collaboratePadding - collaborateOffset,
          left: collaborateButtonLeft - collaboratePadding,
          width: collaborateHighlightWidth,
          height: collaborateHighlightHeight,
          borderRadius: 24,
        };
        break;
      case "swipeCard":
        // Position card highlight in center, but tooltip will be above it
        highlightStyle = {
          position: "absolute",
          top: SCREEN_HEIGHT / 2 - 280,
          left: SCREEN_WIDTH / 2 - 175,
          width: 350,
          height: 600,
          borderRadius: 24,
        };
        break;
      default:
        return null;
    }

    return (
      <Animated.View
        style={[
          styles.highlight,
          highlightStyle,
          {
            transform: [{ scale: pulseAnim }],
          },
        ]}
        pointerEvents="none"
      >
        {/* Ring border only */}
        <View style={styles.highlightBorder} />
      </Animated.View>
    );
  };

  if (!visible) return null;

  const tooltipPosition = getTooltipPosition();
  const progress = ((currentStepIndex + 1) / COACH_STEPS.length) * 100;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
    >
      <View style={styles.container}>
        {/* Dark overlay - exclude bottom nav area when highlighting tabs, exclude header when highlighting header buttons */}
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.darkOverlay,
            isTabStep() && { bottom: 100 }, // Leave space for bottom navigation
            isHeaderStep() && { top: 100 }, // Leave space for header
          ]}
        />

        {/* Highlight effect */}
        {renderHighlight()}

        {/* Tooltip */}
        <Animated.View
          style={[
            styles.tooltipContainer,
            tooltipPosition,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }, { translateY: slideAnim }],
            },
          ]}
        >
          {/* Close button (X) */}
          {currentStepIndex < COACH_STEPS.length - 1 && (
            <TouchableOpacity
              onPress={handleSkip}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color="#9ca3af" />
            </TouchableOpacity>
          )}

          {/* Icon */}
          <View style={styles.iconContainer}>
            <Ionicons
              name={currentStep.icon as any}
              size={32}
              color="#eb7825"
            />
          </View>

          {/* Content */}
          <View style={styles.tooltipContent}>
            <Text style={styles.tooltipTitle}>{currentStep.title}</Text>
            <Text style={styles.tooltipDescription}>
              {currentStep.description}
            </Text>
          </View>

          {/* Progress bar */}
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: `${progress}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {currentStepIndex + 1} of {COACH_STEPS.length}
            </Text>
          </View>

          {/* Actions */}
          <View style={styles.actionsContainer}>
            {currentStepIndex > 0 && (
              <TouchableOpacity
                onPress={handlePrevious}
                style={styles.secondaryButton}
              >
                <Ionicons name="chevron-back" size={20} color="#6b7280" />
                <Text style={styles.secondaryButtonText}>Previous</Text>
              </TouchableOpacity>
            )}

            <View style={styles.primaryActions}>
              <TouchableOpacity
                onPress={handleNext}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>
                  {currentStepIndex === COACH_STEPS.length - 1
                    ? "Get Started"
                    : "Next"}
                </Text>
                {currentStepIndex < COACH_STEPS.length - 1 && (
                  <Ionicons name="chevron-forward" size={20} color="white" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  darkOverlay: {
    backgroundColor: "rgba(0, 0, 0, 0.7)",
  },
  highlight: {
    backgroundColor: "transparent",
    overflow: "visible",
    alignItems: "center",
    justifyContent: "center",
  },
  highlightBackgroundRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    borderWidth: 8,
    borderColor: "white",
    backgroundColor: "transparent",
  },
  highlightBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: "#eb7825",
    backgroundColor: "transparent", // Ensure no background
    // Removed shadow to eliminate orange overlay effect
  },
  highlightGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    backgroundColor: "transparent", // Make transparent so button is visible
  },
  highlightCutout: {
    backgroundColor: "white", // White background to create cutout effect
    zIndex: 10, // Ensure it's above other highlight layers
  },
  tooltipContainer: {
    backgroundColor: "white",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 20,
    position: "relative",
  },
  closeButton: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fef3e2",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  tooltipContent: {
    alignItems: "center",
    marginBottom: 24,
  },
  tooltipTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  tooltipDescription: {
    fontSize: 16,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 24,
  },
  progressBarContainer: {
    marginBottom: 24,
  },
  progressBar: {
    height: 4,
    backgroundColor: "#e5e7eb",
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#eb7825",
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: "#9ca3af",
    textAlign: "center",
    fontWeight: "500",
  },
  actionsContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  primaryActions: {
    flex: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "flex-end",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6b7280",
  },
  skipButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  skipButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#9ca3af",
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: "#eb7825",
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "white",
  },
});
