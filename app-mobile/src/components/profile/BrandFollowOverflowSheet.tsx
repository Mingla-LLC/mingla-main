/**
 * #3682 Wave 2.6 — brand overflow / Following menu: Mute for…, channels, Unfollow.
 */
import React, { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
  brandFollowIsMuted,
  brandFollowsService,
  type BrandFollowRow,
  type MuteDuration,
} from "../../services/brandFollowsService";
import { toastManager } from "../ui/Toast";

type Props = {
  visible: boolean;
  row: BrandFollowRow | null;
  userId: string | null;
  onClose: () => void;
  onMuted: (duration: MuteDuration) => void;
  onUnfollowed: () => void;
  onOpenChannels: () => void;
};

export const BrandFollowOverflowSheet: React.FC<Props> = ({
  visible,
  row,
  userId,
  onClose,
  onMuted,
  onUnfollowed,
  onOpenChannels,
}) => {
  const [mutePicker, setMutePicker] = useState(false);
  if (!row) return null;
  const muted = brandFollowIsMuted(row.mutedUntil);

  const applyMute = async (duration: MuteDuration) => {
    if (!userId) return;
    try {
      await brandFollowsService.muteBrand(userId, row.brandId, duration);
      const label =
        duration === "week"
          ? "for 1 week"
          : duration === "month"
            ? "for 30 days"
            : "";
      toastManager.show(
        label
          ? `Muted ${row.brandName} ${label}`
          : `Muted ${row.brandName}`,
        "success",
      );
      setMutePicker(false);
      onMuted(duration);
    } catch {
      toastManager.show("Couldn't save that. Try again.", "error");
    }
  };

  const unmute = async () => {
    if (!userId) return;
    try {
      await brandFollowsService.unmuteBrand(userId, row.brandId);
      toastManager.show(`${row.brandName} unmuted`, "success");
      onMuted("week"); // parent refreshes
      onClose();
    } catch {
      toastManager.show("Couldn't save that. Try again.", "error");
    }
  };

  const confirmUnfollow = () => {
    Alert.alert(
      `Unfollow ${row.brandName}?`,
      "You'll stop getting their offers and news on every channel. Tickets and order updates still arrive.",
      [
        { text: "Keep following", style: "cancel" },
        {
          text: "Unfollow",
          style: "destructive",
          onPress: () => {
            if (!userId) return;
            void brandFollowsService
              .unfollowBrand(userId, row.brandId)
              .then(() => {
                toastManager.show(`Unfollowed ${row.brandName}.`, "success");
                onUnfollowed();
                onClose();
              })
              .catch(() => {
                toastManager.show("Couldn't save that. Try again.", "error");
              });
          },
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{row.brandName}</Text>
          <Text style={styles.summary}>
            {muted
              ? formatMuted(row.mutedUntil)
              : "Following · choose how they reach you"}
          </Text>

          {mutePicker ? (
            <>
              <Text style={styles.muteBody}>
                You stay following. No offers or news from them until the mute
                ends. Tickets and order updates still arrive.
              </Text>
              {(
                [
                  ["week", "For 1 week"],
                  ["month", "For 30 days"],
                  ["indefinite", "Until I turn it back on"],
                ] as const
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  style={styles.row}
                  onPress={() => void applyMute(key)}
                  accessibilityRole="radio"
                  testID={`brand-follow-mute-${key}`}
                >
                  <Ionicons
                    name="notifications-off-outline"
                    size={22}
                    color="#111827"
                  />
                  <Text style={styles.rowLabel}>{label}</Text>
                </Pressable>
              ))}
              <Pressable style={styles.cancel} onPress={() => setMutePicker(false)}>
                <Text style={styles.cancelText}>Back</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={styles.row}
                onPress={() => {
                  if (muted) void unmute();
                  else setMutePicker(true);
                }}
                testID="brand-follow-mute-row"
              >
                <Ionicons
                  name="notifications-off-outline"
                  size={22}
                  color="#111827"
                />
                <Text style={styles.rowLabel}>
                  {muted ? "Unmute" : "Mute for…"}
                </Text>
                {!muted ? (
                  <Ionicons name="chevron-forward" size={18} color="#6b7280" />
                ) : null}
              </Pressable>
              <Pressable
                style={styles.row}
                onPress={() => {
                  onClose();
                  onOpenChannels();
                }}
                testID="brand-follow-channels-row"
              >
                <Ionicons name="options-outline" size={22} color="#111827" />
                <Text style={styles.rowLabel}>Notification channels</Text>
                <Ionicons name="chevron-forward" size={18} color="#6b7280" />
              </Pressable>
              <Pressable
                style={styles.row}
                onPress={confirmUnfollow}
                testID="brand-follow-unfollow-row"
              >
                <Ionicons
                  name="person-remove-outline"
                  size={22}
                  color="#b42318"
                />
                <Text style={[styles.rowLabel, styles.destructive]}>
                  Unfollow {row.brandName}
                </Text>
              </Pressable>
              <Pressable style={styles.cancel} onPress={onClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

function formatMuted(mutedUntil: string | null): string {
  if (!mutedUntil || mutedUntil === "infinity" || mutedUntil.includes("infinity")) {
    return "Muted";
  }
  const d = new Date(mutedUntil);
  if (Number.isNaN(d.getTime())) return "Muted";
  return `Muted until ${d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}`;
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#d1d5db",
    marginBottom: 12,
  },
  title: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: "#111827" },
  summary: {
    fontSize: 12,
    lineHeight: 16,
    color: "#6b7280",
    marginBottom: 8,
    marginTop: 2,
  },
  muteBody: {
    fontSize: 14,
    lineHeight: 20,
    color: "#4b5563",
    marginBottom: 8,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  rowLabel: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: "500", color: "#111827" },
  destructive: { color: "#b42318" },
  cancel: {
    marginTop: 10,
    height: 50,
    borderRadius: 14,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: 16, fontWeight: "600", color: "#111827" },
});
