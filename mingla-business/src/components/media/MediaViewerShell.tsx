import React, { useEffect, useRef } from "react";
import { Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotionNative } from "../../hooks/useReducedMotionNative";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useEscapeLayer } from "../ui/escapeLayerStack";
import { calculateMediaViewerStage } from "./fitContain";

export interface MediaViewerStage {
  width: number;
  height: number;
  style: ViewStyle;
}

export interface MediaViewerShellProps {
  visible: boolean;
  onClose: () => void;
  topBar?: React.ReactNode;
  bottomBar?: React.ReactNode;
  hasBottomArea?: boolean;
  children: React.ReactNode | ((stage: MediaViewerStage) => React.ReactNode);
  testID?: string;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Full-screen child supplies its own safe-area bars; shell still owns Modal/Esc/back/fade. */
  contentOnly?: boolean;
  closeAccessibilityLabel?: string;
}

export function MediaViewerShell({
  visible,
  onClose,
  topBar,
  bottomBar,
  hasBottomArea = Boolean(bottomBar),
  children,
  testID,
  onPrevious,
  onNext,
  contentOnly = false,
  closeAccessibilityLabel = "Close",
}: MediaViewerShellProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { isWideDesktop } = useResponsiveLayout();
  const reduceMotion = useReducedMotionNative();
  const isTopLayer = useEscapeLayer(visible);
  const closeRef = useRef<View>(null);

  const measuredStage = calculateMediaViewerStage({
    viewportWidth: width,
    viewportHeight: height,
    insetTop: insets.top,
    insetBottom: insets.bottom,
    wideDesktop: isWideDesktop,
    hasBottomArea,
  });
  const { width: stageWidth, height: stageHeight, bottomArea } = measuredStage;
  const stage = {
    width: stageWidth,
    height: stageHeight,
    style: { width: stageWidth, height: stageHeight },
  };

  useEffect(() => {
    if (!visible || Platform.OS !== "web" || typeof document === "undefined") return;
    const opener = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      const node = closeRef.current as unknown as { focus?: () => void } | null;
      node?.focus?.();
    }, 0);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && isTopLayer()) {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft" && isTopLayer() && onPrevious) {
        event.preventDefault();
        onPrevious();
      } else if (event.key === "ArrowRight" && isTopLayer() && onNext) {
        event.preventDefault();
        onNext();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [isTopLayer, onClose, onNext, onPrevious, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={() => { if (isTopLayer()) onClose(); }}
    >
      <View testID={testID} style={styles.scrim}>
        {contentOnly ? children as React.ReactNode : <>
        <View style={[styles.topBar, { paddingTop: insets.top }]}>
          <Pressable
            ref={closeRef}
            accessibilityRole="button"
            accessibilityLabel={closeAccessibilityLabel}
            onPress={onClose}
            style={styles.hiddenFocusTarget}
          />
          {topBar}
        </View>
        <View style={styles.stageWrap}>
          {typeof children === "function" ? children(stage) : children}
        </View>
        <View style={[styles.bottomBar, { minHeight: bottomArea, paddingBottom: Math.max(0, insets.bottom) }]}>
          {bottomBar}
        </View>
        </>}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.82)" },
  topBar: { minHeight: 56, justifyContent: "flex-end" },
  stageWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 16 },
  bottomBar: { justifyContent: "flex-start" },
  hiddenFocusTarget: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
