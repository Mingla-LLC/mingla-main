import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

const OVERFLOW_EPSILON = 0.5;

export interface MeasuredTextDisclosureProps {
  text: string;
  collapsedLines: number;
  textStyle?: StyleProp<TextStyle>;
  toggleTextStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  toggleStyle?: PressableProps["style"];
  hitSlop?: PressableProps["hitSlop"];
  expandLabel?: string;
  collapseLabel?: string;
  onBeforeToggle?: () => void;
  testID?: string;
}

/**
 * A text disclosure that renders its control only when the collapsed text
 * actually clips. Two accessibility-hidden measurement copies keep the
 * decision responsive to real width, font, platform, and copy changes.
 */
export const MeasuredTextDisclosure: React.FC<MeasuredTextDisclosureProps> = ({
  text,
  collapsedLines,
  textStyle,
  toggleTextStyle,
  containerStyle,
  toggleStyle,
  hitSlop,
  expandLabel = "Read more",
  collapseLabel = "Show less",
  onBeforeToggle,
  testID,
}) => {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [fullHeight, setFullHeight] = useState<number | null>(null);
  const [collapsedHeight, setCollapsedHeight] = useState<number | null>(null);

  useEffect(() => {
    setExpanded(false);
  }, [collapsedLines, text]);

  const measureFull = useCallback((event: LayoutChangeEvent): void => {
    setFullHeight(event.nativeEvent.layout.height);
  }, []);

  const measureCollapsed = useCallback((event: LayoutChangeEvent): void => {
    setCollapsedHeight(event.nativeEvent.layout.height);
  }, []);

  const canToggle =
    fullHeight !== null &&
    collapsedHeight !== null &&
    fullHeight - collapsedHeight > OVERFLOW_EPSILON;

  const toggle = useCallback((): void => {
    onBeforeToggle?.();
    setExpanded((value) => !value);
  }, [onBeforeToggle]);

  const label = expanded ? collapseLabel : expandLabel;

  return (
    <View style={[styles.container, containerStyle]} testID={testID}>
      <Text
        style={textStyle}
        numberOfLines={expanded ? undefined : collapsedLines}
        ellipsizeMode="tail"
        testID={testID !== undefined ? `${testID}-text` : undefined}
      >
        {text}
      </Text>

      <View
        pointerEvents="none"
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
        style={styles.measurementLayer}
      >
        <Text
          style={textStyle}
          onLayout={measureFull}
          testID={testID !== undefined ? `${testID}-measure-full` : undefined}
        >
          {text}
        </Text>
        <Text
          style={textStyle}
          numberOfLines={collapsedLines}
          ellipsizeMode="tail"
          onLayout={measureCollapsed}
          testID={
            testID !== undefined ? `${testID}-measure-collapsed` : undefined
          }
        >
          {text}
        </Text>
      </View>

      {canToggle ? (
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded }}
          aria-expanded={expanded}
          hitSlop={hitSlop}
          style={toggleStyle}
          testID={testID !== undefined ? `${testID}-toggle` : undefined}
        >
          <Text style={toggleTextStyle}>{label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "relative",
  },
  measurementLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    opacity: 0,
  },
});

export default MeasuredTextDisclosure;
