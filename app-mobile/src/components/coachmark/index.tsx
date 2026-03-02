import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface CoachMarkWelcomeProps {
  visible: boolean;
  onStartTour: () => void;
  onGiveFeedback: () => void;
  onClose: () => void;
}

export default function CoachMarkWelcome({
  visible,
  onStartTour,
  onGiveFeedback,
  onClose,
}: CoachMarkWelcomeProps) {
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const shimmerAnim = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    if (visible) {
      // Reset
      overlayAnim.setValue(0);
      scaleAnim.setValue(0.9);
      slideAnim.setValue(30);
      shimmerAnim.setValue(-1);

      // Entrance
      Animated.parallel([
        Animated.timing(overlayAnim, {
          toValue: 1,
          duration: 400,
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
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();

      // Shimmer loop on Start Tour button
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, {
            toValue: 2,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.delay(800),
          Animated.timing(shimmerAnim, {
            toValue: -1,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [visible]);

  const animateOut = (callback: () => void) => {
    Animated.parallel([
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 30,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => callback());
  };

  const handleClose = () => {
    animateOut(onClose);
  };

  const handleStartTour = () => {
    animateOut(onStartTour);
  };

  const handleGiveFeedback = () => {
    animateOut(onGiveFeedback);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <Animated.View style={[styles.overlay, { opacity: overlayAnim }]}>
        {/* Backdrop dismiss */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={handleClose}
        />

        <Animated.View
          style={[
            styles.card,
            {
              opacity: overlayAnim,
              transform: [
                { scale: scaleAnim },
                { translateY: slideAnim },
              ],
            },
          ]}
        >
          {/* Gradient glow border */}
          <View style={styles.glowBorder} />

          {/* Inner card */}
          <View style={styles.inner}>
            {/* Close button */}
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={20} color="#9ca3af" />
            </TouchableOpacity>

            {/* Buttons */}
            <View style={styles.buttonsContainer}>
              {/* Start Tour */}
              <TouchableOpacity
                onPress={handleStartTour}
                style={styles.startTourButton}
                activeOpacity={0.85}
              >
                <View style={styles.startTourContent}>
                  <Ionicons name="sparkles" size={20} color="white" />
                  <Text style={styles.startTourText}>Start Tour</Text>
                </View>
                {/* Shimmer overlay */}
                <Animated.View
                  style={[
                    styles.shimmer,
                    {
                      transform: [
                        {
                          translateX: shimmerAnim.interpolate({
                            inputRange: [-1, 2],
                            outputRange: [-200, 400],
                          }),
                        },
                      ],
                    },
                  ]}
                  pointerEvents="none"
                />
              </TouchableOpacity>

              {/* Give Feedback */}
              <TouchableOpacity
                onPress={handleGiveFeedback}
                style={styles.feedbackButton}
                activeOpacity={0.85}
              >
                <View style={styles.feedbackContent}>
                  <Ionicons
                    name="chatbubble-outline"
                    size={18}
                    color="#eb7825"
                  />
                  <Text style={styles.feedbackText}>Give Feedback</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 28,
    overflow: "visible",
  },
  glowBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
    backgroundColor: "#eb7825",
    opacity: 0.25,
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 15,
  },
  inner: {
    backgroundColor: "#fdf6f0",
    borderRadius: 28,
    paddingHorizontal: 28,
    paddingTop: 56,
    paddingBottom: 32,
    overflow: "hidden",
  },
  closeButton: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(243, 244, 246, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  buttonsContainer: {
    gap: 14,
    zIndex: 5,
  },
  startTourButton: {
    backgroundColor: "#eb7825",
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 24,
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    overflow: "hidden",
  },
  startTourContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  startTourText: {
    color: "white",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  shimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 120,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    borderRadius: 20,
    // Skewed via a narrow width and soft edges
    opacity: 0.7,
  },
  feedbackButton: {
    backgroundColor: "white",
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  feedbackContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  feedbackText: {
    color: "#374151",
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
});