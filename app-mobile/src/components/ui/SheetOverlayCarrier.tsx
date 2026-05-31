import React, { type ReactNode } from "react";
import { Modal as RNModal, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

interface SheetOverlayCarrierProps {
  visible: boolean;
  onRequestClose: () => void;
  children: ReactNode;
}

/**
 * Hosts a related group of vanilla gorhom sheets in one RN Modal window.
 *
 * BaseBottomSheet's `wrapInRNModal` lifts one sheet root above Mingla's in-tree
 * bottom nav. Some flows (trip detail -> reserve -> cart) are multiple sibling
 * sheet roots, so the carrier has to wrap the whole group instead of one sheet.
 */
export function SheetOverlayCarrier({
  visible,
  onRequestClose,
  children,
}: SheetOverlayCarrierProps): React.ReactElement {
  return (
    <RNModal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onRequestClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        {children}
      </GestureHandlerRootView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

export default SheetOverlayCarrier;
