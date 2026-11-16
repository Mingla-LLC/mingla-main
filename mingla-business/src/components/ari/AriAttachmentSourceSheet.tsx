/** Issue #3429 — native source choice; web uses one unified chooser. */

import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { FileText, Image as ImageIcon } from "lucide-react-native";

import { Sheet } from "../ui/Sheet";
import { ariThread, color, space } from "../../constants/designSystem";
import { deferAfterDismiss } from "../../utils/deferAfterDismiss";
import type { AriAttachmentSource } from "./ariAttachmentPickerShared";

// The photo and document pickers are native modals. iOS presents one modal at a
// time, so opening a picker in the same tick that closes this sheet lets the
// sheet's dismissal tear the picker straight down. Open it once the sheet is gone.
export const AriAttachmentSourceSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  onSelect: (source: AriAttachmentSource) => void;
}> = ({ visible, onClose, onSelect }) => {
  if (Platform.OS === "web") return null;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={260}
      testID="ari-add-context-sheet"
    >
      <View style={styles.body}>
        <Text style={styles.title}>Add context</Text>
        <Pressable
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel="Choose photos and videos"
          onPress={() => {
            onClose();
            deferAfterDismiss(() => onSelect("photos"));
          }}
        >
          <ImageIcon size={22} color={color.text1} />
          <View>
            <Text style={styles.label}>Photos & videos</Text>
            <Text style={styles.detail}>Images, MP4, MOV or WebM</Text>
          </View>
        </Pressable>
        <Pressable
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel="Choose documents"
          onPress={() => {
            onClose();
            deferAfterDismiss(() => onSelect("documents"));
          }}
        >
          <FileText size={22} color={color.text1} />
          <View>
            <Text style={styles.label}>Files & voice notes</Text>
            <Text style={styles.detail}>
              PDF, DOCX, text, CSV, MP3, M4A or WAV
            </Text>
          </View>
        </Pressable>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space[4],
    paddingBottom: space[6],
    gap: space[2],
  },
  title: {
    color: color.text1,
    fontSize: 20,
    lineHeight: 32,
    fontWeight: "600",
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingHorizontal: space[4],
    backgroundColor: color.card,
    borderRadius: 16,
    overflow: "hidden",
  },
  label: {
    color: color.text1,
    fontSize: ariThread.labelFont,
    lineHeight: ariThread.labelLine,
    fontWeight: "600",
  },
  detail: { color: color.text2, fontSize: 14, lineHeight: 20 },
});

export default AriAttachmentSourceSheet;
