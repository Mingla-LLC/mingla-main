/**
 * Issue #4114 Wave 2a — the Chats loading skeleton.
 *
 * Static rows with the exact 72pt row geometry from chatListModel. Rendered by
 * ConnectionsPage while chats load AND by TabSwitchScaffold on the tab-tap
 * frame, so the two can never drift apart. Static Views only (no images, no
 * animation of its own): the scaffold animates its whole layer.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { glass } from "../../constants/designSystem";
import {
  CHAT_AVATAR_SIZE,
  CHAT_ROW_GAP,
  CHAT_ROW_HEIGHT,
  CHAT_ROW_SIDE_PADDING,
  CHAT_SEPARATOR_INSET,
} from "./chatListModel";

const tk = glass.discover.chatList;
const NAME_WIDTHS = ["44%", "36%", "52%", "40%", "48%", "34%", "42%", "50%"] as const;
const PREVIEW_WIDTHS = ["78%", "64%", "70%", "58%", "74%", "62%", "68%", "56%"] as const;

export function ChatListSkeleton({ rows = 8 }: { rows?: number }): React.ReactElement {
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants">
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.row} testID="chat-row-skeleton">
          {index > 0 ? <View style={styles.separator} /> : null}
          <View style={styles.avatar} />
          <View style={styles.text}>
            <View style={styles.line}>
              <View style={[styles.name, { width: NAME_WIDTHS[index % NAME_WIDTHS.length] }]} />
              <View style={styles.time} />
            </View>
            <View style={[styles.preview, { width: PREVIEW_WIDTHS[index % PREVIEW_WIDTHS.length] }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: CHAT_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: CHAT_ROW_GAP,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
  },
  separator: {
    position: "absolute",
    top: 0,
    left: CHAT_SEPARATOR_INSET,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: tk.separator,
  },
  avatar: {
    width: CHAT_AVATAR_SIZE,
    height: CHAT_AVATAR_SIZE,
    borderRadius: CHAT_AVATAR_SIZE / 2,
    backgroundColor: tk.skeletonBlockStrong,
  },
  text: {
    flex: 1,
    gap: 9,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  name: {
    height: 14,
    borderRadius: 7,
    backgroundColor: tk.skeletonBlockStrong,
  },
  time: {
    width: 34,
    height: 11,
    borderRadius: 6,
    backgroundColor: tk.skeletonBlock,
  },
  preview: {
    height: 12,
    borderRadius: 6,
    backgroundColor: tk.skeletonBlock,
  },
});
