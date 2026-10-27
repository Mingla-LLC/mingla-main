/**
 * Issue #4114 Wave 2b — the dark Add a friend sheet (add = pair).
 *
 * A thin shell around AddFriendView. ConnectionsPage owns `visible`, the typed
 * number, the country and the picker flag (ORCH-1371), and passes
 * `visible={showAddFriendSheet && !addFriendPickerOpen}`, so this sheet's RN
 * <Modal> window is dropped while the sibling country picker is up and two
 * RN-Modal-backed surfaces never co-present on iOS. This shell renders no
 * picker and owns no picker or phone state.
 */
import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { glass } from "../../constants/designSystem";
import { AddFriendView } from "./AddFriendView";

const ink = glass.discover.chatList;
const fs = glass.discover.friendsSheet;
const SNAP_POINTS = ["88%"];

type AddFriendViewProps = React.ComponentProps<typeof AddFriendView>;

interface AddFriendSheetProps extends Omit<AddFriendViewProps, "onDone"> {
  /** Already gated by the parent on the picker flag (ORCH-1371). */
  visible: boolean;
  /** Fired by BaseBottomSheet on every hide, including the picker drop. */
  onSheetClose: () => void;
  /** A genuine dismiss (Cancel / Done). */
  onDismiss: () => void;
}

export function AddFriendSheet({
  visible,
  onSheetClose,
  onDismiss,
  ...viewProps
}: AddFriendSheetProps): React.ReactElement {
  const { t } = useTranslation(["connections", "common"]);
  const handleDone = useCallback(() => onDismiss(), [onDismiss]);

  const header = (
    <View style={styles.titleRow}>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t("common:cancel")}
        hitSlop={8}
        style={styles.side}
      >
        <Text style={styles.cancelText}>{t("common:cancel")}</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
        {t("connections:af_title")}
      </Text>
      <View style={styles.side} />
    </View>
  );

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onSheetClose}
      snapPoints={SNAP_POINTS}
      theme="dark"
      backgroundStyle={styles.sheetBackground}
      scrollMode="scroll"
      wrapInRNModal
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      accessibilityLabel={t("connections:af_title")}
      header={header}
      scrollProps={{
        keyboardShouldPersistTaps: "handled",
        keyboardDismissMode: "on-drag",
        showsVerticalScrollIndicator: false,
      }}
    >
      <AddFriendView {...viewProps} onDone={handleDone} />
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: fs.sheetBg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  titleRow: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  side: {
    width: 72,
  },
  cancelText: {
    color: ink.dim,
    fontSize: 15,
  },
  title: {
    flex: 1,
    textAlign: "center",
    color: ink.ink,
    fontSize: 17,
    fontWeight: "700",
  },
});
