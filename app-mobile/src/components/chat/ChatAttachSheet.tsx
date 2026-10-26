/**
 * Issue #4114 Wave 4: the attach sheet — a dark panel ABOVE the composer (the
 * old menu was drawn inside the 56pt capsule, which clipped it out of sight).
 *
 * Camera · Photos and videos (up to 10) · File, a View once switch, the picked
 * items with remove buttons, and Send with a count. Picking itself lives in
 * MessageInterface (permissions go through utils/mediaLibraryPermission there);
 * this component only draws and reports taps.
 */
import React from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import { MAX_CHAT_MEDIA_ITEMS, type PickedChatMedia } from "../../utils/chatMedia";

interface ChatAttachSheetProps {
  items: readonly PickedChatMedia[];
  viewOnce: boolean;
  onToggleViewOnce: (next: boolean) => void;
  /** Name shown in the view-once hint ("Ada can open it one time…"); null in groups. */
  recipientName: string | null;
  picking: boolean;
  onCamera: () => void;
  onLibrary: () => void;
  onFile: () => void;
  onRemoveItem: (index: number) => void;
  onSend: () => void;
}

function ItemThumb({ item }: { item: PickedChatMedia }): React.ReactElement {
  if (item.kind === "image") {
    return <Image source={{ uri: item.uri }} style={styles.thumbImage} resizeMode="cover" />;
  }
  return (
    <View style={[styles.thumbImage, styles.thumbIcon]}>
      <Icon name={item.kind === "video" ? "videocam" : "document-text"} size={20} color={chatTokens.textSecondary} />
    </View>
  );
}

export function ChatAttachSheet({
  items,
  viewOnce,
  onToggleViewOnce,
  recipientName,
  picking,
  onCamera,
  onLibrary,
  onFile,
  onRemoveItem,
  onSend,
}: ChatAttachSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const full = items.length >= MAX_CHAT_MEDIA_ITEMS;
  const hasFile = items.some((item) => item.kind === "file");
  // View once applies to photos and videos only.
  const viewOnceAvailable = !hasFile;

  const rows: Array<{ key: string; icon: string; color: string; title: string; onPress: () => void; disabled: boolean }> = [
    { key: "camera", icon: "camera", color: "#f97316", title: t("chat:attachCamera"), onPress: onCamera, disabled: full || picking },
    { key: "library", icon: "images", color: "#3b82f6", title: t("chat:attachLibrary"), onPress: onLibrary, disabled: full || picking },
    // A file can't be view once, so File is off while the switch is on.
    { key: "file", icon: "document-text", color: "#10b981", title: t("chat:attachFile"), onPress: onFile, disabled: full || picking || viewOnce },
  ];

  return (
    <View style={styles.sheet} testID="chat-attach-sheet">
      {items.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
          {items.map((item, index) => (
            <View key={`${item.uri}-${index}`} style={styles.thumb}>
              <ItemThumb item={item} />
              <TouchableOpacity
                style={styles.thumbRemove}
                onPress={() => onRemoveItem(index)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t("chat:a11yRemoveAttachment")}
              >
                <Icon name="close" size={12} color={chatTokens.textPrimary} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {rows.map((row) => (
        <TouchableOpacity
          key={row.key}
          onPress={row.onPress}
          disabled={row.disabled}
          style={[styles.row, row.disabled && styles.rowDisabled]}
          accessibilityRole="button"
          accessibilityLabel={row.title}
          accessibilityState={{ disabled: row.disabled }}
          testID={`chat-attach-${row.key}`}
        >
          <View style={styles.rowIcon}>
            <Icon name={row.icon} size={16} color={row.color} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{row.title}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <View style={styles.divider} />

      <View style={[styles.row, !viewOnceAvailable && styles.rowDisabled]}>
        <View style={styles.rowIcon}>
          <Icon name="eye-off" size={16} color={chatTokens.accent} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{t("chat:viewOnce")}</Text>
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {recipientName
              ? t("chat:viewOnceHint", { name: recipientName })
              : t("chat:viewOnceHintGroup")}
          </Text>
        </View>
        <Switch
          value={viewOnce && viewOnceAvailable}
          onValueChange={onToggleViewOnce}
          disabled={!viewOnceAvailable}
          trackColor={{ false: chatTokens.hairline, true: chatTokens.accent }}
          thumbColor={chatTokens.textPrimary}
          accessibilityLabel={t("chat:viewOnce")}
          testID="chat-attach-view-once"
        />
      </View>

      <TouchableOpacity
        onPress={onSend}
        disabled={items.length === 0 || picking}
        style={[styles.send, (items.length === 0 || picking) && styles.sendDisabled]}
        accessibilityRole="button"
        accessibilityLabel={t("chat:attachSend", { count: items.length })}
        accessibilityState={{ disabled: items.length === 0 || picking }}
        testID="chat-attach-send"
      >
        {picking ? (
          <ActivityIndicator size="small" color={chatTokens.textPrimary} />
        ) : (
          <Text style={styles.sendText}>{t("chat:attachSend", { count: items.length })}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    marginBottom: 6,
    backgroundColor: chatTokens.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.chromeHairline,
    borderRadius: 18,
    padding: 8,
  },
  thumbRow: {
    gap: 8,
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 8,
  },
  thumb: {
    width: 56,
    height: 56,
  },
  thumbImage: {
    width: 56,
    height: 56,
    borderRadius: 10,
  },
  thumbIcon: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: chatTokens.strip,
  },
  thumbRemove: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: chatTokens.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.hairline,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: chatTokens.strip,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  rowSubtitle: {
    fontSize: 12,
    color: chatTokens.textSoft,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: chatTokens.hairline,
    marginVertical: 4,
    marginHorizontal: 10,
  },
  send: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: chatTokens.accent,
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendText: {
    fontSize: 15,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
});
