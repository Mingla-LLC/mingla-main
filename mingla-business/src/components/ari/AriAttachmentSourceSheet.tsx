/** Issue #3429 — native source choice; web uses one unified chooser. */

import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { FileText, Image as ImageIcon } from "lucide-react-native";

import { Sheet } from "../ui/Sheet";
import { ariThread, spacing, text as textTokens } from "../../constants/designSystem";
import type { AriAttachmentSource } from "./ariAttachmentPickerShared";

export const AriAttachmentSourceSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  onSelect: (source: AriAttachmentSource) => void;
}> = ({ visible, onClose, onSelect }) => {
  if (Platform.OS === "web") return null;
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={260} testID="ari-add-context-sheet">
      <View style={styles.body}>
        <Text style={styles.title}>Add context</Text>
        <Pressable style={styles.row} accessibilityRole="button" accessibilityLabel="Choose photos" onPress={() => { onClose(); onSelect("photos"); }}>
          <ImageIcon size={22} color={textTokens.primary} />
          <View><Text style={styles.label}>Photos</Text><Text style={styles.detail}>JPG, PNG, WebP or HEIC</Text></View>
        </Pressable>
        <Pressable style={styles.row} accessibilityRole="button" accessibilityLabel="Choose documents" onPress={() => { onClose(); onSelect("documents"); }}>
          <FileText size={22} color={textTokens.primary} />
          <View><Text style={styles.label}>Documents</Text><Text style={styles.detail}>PDF, DOCX, TXT or CSV</Text></View>
        </Pressable>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm },
  title: { color: textTokens.primary, fontSize: 20, lineHeight: 32, fontWeight: "600" },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, backgroundColor: ariThread.composerSurface, borderRadius: 16, overflow: "hidden" },
  label: { color: textTokens.primary, fontSize: ariThread.labelFont, lineHeight: ariThread.labelLine, fontWeight: "600" },
  detail: { color: textTokens.secondary, fontSize: 14, lineHeight: 20 },
});

export default AriAttachmentSourceSheet;
