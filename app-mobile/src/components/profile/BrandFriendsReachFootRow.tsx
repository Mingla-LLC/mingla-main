/**
 * #3682 wave 3 (#1782) — brand page line for a signed-in guest who does not
 * follow the brand: stop (or allow again) this brand inviting them through
 * friends who follow it. Rendered only when this build's controls are live and
 * the line is true (the guest opted in, or already stopped this brand).
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useFriendsReach } from "../../hooks/useFriendsReach";
import { toastManager } from "../ui/Toast";
import {
  allowedAgainToast,
  brandPageReachLine,
  shouldShowBrandFriendsReachRow,
  stoppedToast,
} from "./friendsReachCopy";

export { shouldShowBrandFriendsReachRow } from "./friendsReachCopy";

type Props = {
  userId: string | null;
  brandId: string;
  brandName: string;
  isFollowing: boolean;
};

export const BrandFriendsReachFootRow: React.FC<Props> = ({
  userId,
  brandId,
  brandName,
  isFollowing,
}) => {
  const friendsReach = useFriendsReach(userId, !!userId && !isFollowing);
  const stopped =
    friendsReach.state?.stoppedBrands.some((b) => b.brandId === brandId) === true;
  if (
    !shouldShowBrandFriendsReachRow({
      userId,
      isFollowing,
      controlsLive: friendsReach.controlsLive,
      extendedEnabled: friendsReach.state?.extendedEnabled === true,
      stopped,
    })
  ) {
    return null;
  }

  const onPress = async () => {
    try {
      await friendsReach.setBrandStopped(brandId, !stopped);
      toastManager.show(
        stopped ? allowedAgainToast(brandName) : stoppedToast(brandName, false),
        "success",
      );
    } catch {
      toastManager.show("Couldn't save that. Try again.", "error");
    }
  };

  const action = stopped ? "Allow again" : "Stop";
  return (
    <View style={styles.card} testID="brand-friends-reach-row">
      <Text style={styles.line}>{brandPageReachLine(brandName, stopped)}</Text>
      <Pressable
        onPress={() => void onPress()}
        disabled={friendsReach.isSaving}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={
          stopped
            ? `Allow ${brandName} to invite you through friends again`
            : `Stop ${brandName} inviting you through friends`
        }
        testID="brand-friends-reach-action"
      >
        <Text style={styles.actionText}>{action}</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  line: { flex: 1, fontSize: 14, lineHeight: 20, color: "#374151" },
  action: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: "#c2560f" },
});
