import * as React from "react";
import { Text, View, StyleSheet, PanResponder, Animated } from "react-native";
import { Ionicons } from '@expo/vector-icons';

import { cn } from "./utils";

interface ResizablePanelGroupProps {
  style?: any;
  direction?: "horizontal" | "vertical";
  children: React.ReactNode;
}

function ResizablePanelGroup({
  style,
  direction = "horizontal",
  children,
  ...props
}: ResizablePanelGroupProps) {
  return (
    <View
      style={[
        styles.resizablePanelGroup,
        direction === "vertical" ? styles.resizablePanelGroupVertical : styles.resizablePanelGroupHorizontal,
        style
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

interface ResizablePanelProps {
  style?: any;
  children: React.ReactNode;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
}

function ResizablePanel({
  style,
  children,
  defaultSize,
  minSize,
  maxSize,
  ...props
}: ResizablePanelProps) {
  return (
    <View
      style={[styles.resizablePanel, style]}
      {...props}
    >
      {children}
    </View>
  );
}

interface ResizableHandleProps {
  style?: any;
  withHandle?: boolean;
  direction?: "horizontal" | "vertical";
  onResize?: (delta: number) => void;
}

function ResizableHandle({
  style,
  withHandle = false,
  direction = "horizontal",
  onResize,
  ...props
}: ResizableHandleProps) {
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (evt, gestureState) => {
      if (onResize) {
        const delta = direction === "horizontal" ? gestureState.dx : gestureState.dy;
        onResize(delta);
      }
    },
  });

  return (
    <View
      style={[
        styles.resizableHandle,
        direction === "vertical" ? styles.resizableHandleVertical : styles.resizableHandleHorizontal,
        style
      ]}
      {...panResponder.panHandlers}
      {...props}
    >
      {withHandle && (
        <View style={styles.resizableHandleGrip}>
          <Ionicons 
            name="reorder-three" 
            size={10} 
            color="#6b7280" 
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  resizablePanelGroup: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  resizablePanelGroupHorizontal: {
    flexDirection: 'row',
  },
  resizablePanelGroupVertical: {
    flexDirection: 'column',
  },
  resizablePanel: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  resizableHandle: {
    backgroundColor: '#e5e7eb',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resizableHandleHorizontal: {
    width: 1,
    height: '100%',
  },
  resizableHandleVertical: {
    height: 1,
    width: '100%',
  },
  resizableHandleGrip: {
    backgroundColor: '#e5e7eb',
    zIndex: 10,
    height: 16,
    width: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
});

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
