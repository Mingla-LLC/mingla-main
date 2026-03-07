import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  PanResponder,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { s, vs, SCREEN_WIDTH, SCREEN_HEIGHT } from "../utils/responsive";
import { colors, spacing, radius, shadows, typography } from "../constants/designSystem";

interface ConnectBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  heightPercent?: number;
  children: React.ReactNode;
}

const ConnectBottomSheet: React.FC<ConnectBottomSheetProps> = ({
  visible,
  onClose,
  title,
  heightPercent = 70,
  children,
}) => {
  const sheetHeight = SCREEN_HEIGHT * (heightPercent / 100);
  const translateY = useRef(new Animated.Value(sheetHeight)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(sheetHeight);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 150,
      }).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.timing(translateY, {
      toValue: sheetHeight,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        gestureState.dy > 5,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 100 || gestureState.vy > 0.5) {
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 150,
          }).start();
        }
      },
    })
  ).current;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={dismiss}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />

        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              transform: [{ translateY }],
            },
          ]}
        >
          {/* Handle area */}
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={styles.handle} />
          </View>

          {/* Title row */}
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity
              onPress={dismiss}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={s(24)} color={colors.gray[400]} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={styles.content}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: s(24),
    borderTopRightRadius: s(24),
    overflow: "hidden",
  },
  handleArea: {
    alignItems: "center",
    paddingTop: vs(10),
    paddingBottom: vs(6),
  },
  handle: {
    width: s(40),
    height: s(4),
    backgroundColor: colors.gray[300],
    borderRadius: s(2),
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: s(24),
    paddingBottom: vs(14),
  },
  title: {
    fontSize: s(18),
    fontWeight: "700",
    color: colors.gray[800],
  },
  content: {
    flex: 1,
    paddingHorizontal: s(24),
  },
});

export default ConnectBottomSheet;
