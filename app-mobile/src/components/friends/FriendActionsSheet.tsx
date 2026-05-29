// ORCH-0987: the friend more-menu (••• action sheet). Single shared component for the
// friend profile (and, in the dedupe follow, the Connections list). Wires the six actions
// through useFriendActions and renders the existing AddToBoardModal / BlockUserModal /
// ReportUserModal. No new backend.
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { s, vs } from "../../utils/responsive";
import AddToBoardModal from "../AddToBoardModal";
import BlockUserModal from "../BlockUserModal";
import ReportUserModal from "../ReportUserModal";
import { useFriendActions } from "../../hooks/useFriendActions";

// META-ORCH-0991 Wave B Batch 3: was a flex-end action menu sized to its rows →
// a swipe-down sheet. A fixed snap (not enableDynamicSizing) is used because a
// content-height sheet inside the RN-Modal wrap measures its children below the
// viewport and snaps off-screen-bottom (sim-observed on FriendsActionChooser);
// ['55%'] comfortably fits the max-row case (pair + add-to-session + mute +
// remove + block + report + title). Module-level const per playbook §2.
const FRIEND_ACTIONS_SNAP_POINTS = ['55%'];

interface FriendActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  friendUserId: string;
  friendName: string;
  friendUsername?: string;
  friendAvatarUrl?: string | null;
  pairingId?: string | null;
  isPaired: boolean;
  isPending: boolean;
  /** Friendship gates the pairing row + remove (you can only pair/remove an accepted friend). */
  isFriend: boolean;
}

const FriendActionsSheet: React.FC<FriendActionsSheetProps> = ({
  visible,
  onClose,
  friendUserId,
  friendName,
  friendUsername,
  friendAvatarUrl,
  pairingId,
  isPaired,
  isPending,
  isFriend,
}) => {
  const a = useFriendActions({ friendUserId, friendName, friendUsername, friendAvatarUrl, pairingId, isPaired, isPending });

  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  const friendForModal = { id: friendUserId, name: friendName, username: friendUsername ?? "", isOnline: true };
  const userForReport = { id: friendUserId, name: friendName, username: friendUsername ?? "" };

  return (
    <>
      <BaseBottomSheet
        visible={visible}
        onClose={onClose}
        theme="light"
        snapPoints={FRIEND_ACTIONS_SNAP_POINTS}
        scrollMode="view"
        wrapInRNModal
        accessibilityLabel={`Actions for ${friendName}`}
      >
        <View style={styles.container}>
          <Text style={styles.title} numberOfLines={1}>{friendName}</Text>

          {/* Pair / Unpair — friends only */}
          {isFriend && a.pairAction === "unpair" && (
            <TouchableOpacity style={styles.item} onPress={() => run(a.unpair)} activeOpacity={0.7}
              accessibilityRole="button" accessibilityLabel={`Unpair from ${friendName}`}>
              <Icon name="star" size={s(20)} color="#10b981" style={styles.icon} />
              <Text style={styles.itemText}>Unpair</Text>
            </TouchableOpacity>
          )}
          {isFriend && a.pairAction === "pending" && (
            <View style={styles.item}>
              <Icon name="star-outline" size={s(20)} color="#9ca3af" style={styles.icon} />
              <Text style={[styles.itemText, { color: "#9ca3af" }]}>Pair request pending</Text>
            </View>
          )}
          {isFriend && a.pairAction === "pair" && (
            <TouchableOpacity style={styles.item} onPress={() => run(a.sendPair)} activeOpacity={0.7}
              accessibilityRole="button" accessibilityLabel={`Send pair request to ${friendName}`}>
              <Icon name="star-outline" size={s(20)} color="#eb7825" style={styles.icon} />
              <Text style={styles.itemText}>Send pair request</Text>
            </TouchableOpacity>
          )}

          {/* Add to session */}
          <TouchableOpacity style={styles.item} onPress={() => run(a.openAddToSession)} activeOpacity={0.7}
            accessibilityRole="button" accessibilityLabel={`Add ${friendName} to a session`}>
            <Icon name="people-outline" size={s(20)} color="#4b5563" style={styles.icon} />
            <Text style={styles.itemText}>Add to session</Text>
          </TouchableOpacity>

          {/* Mute / Unmute */}
          <TouchableOpacity style={styles.item} onPress={() => run(a.toggleMute)} activeOpacity={0.7}
            disabled={a.isMuteLoading}
            accessibilityRole="button" accessibilityLabel={a.isMuted ? `Unmute ${friendName}` : `Mute ${friendName}`}>
            <Icon name={a.isMuted ? "volume-high" : "volume-mute"} size={s(20)} color="#4b5563" style={styles.icon} />
            <Text style={styles.itemText}>{a.isMuted ? "Unmute" : "Mute"}</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Remove friend — friends only */}
          {isFriend && (
            <TouchableOpacity style={styles.item} onPress={() => run(a.removeFriend)} activeOpacity={0.7}
              accessibilityRole="button" accessibilityLabel={`Remove ${friendName}`}>
              <Icon name="person-remove" size={s(20)} color="#ef4444" style={styles.icon} />
              <Text style={styles.itemTextDanger}>Remove friend</Text>
            </TouchableOpacity>
          )}

          {/* Block */}
          <TouchableOpacity style={styles.item} onPress={() => run(a.openBlock)} activeOpacity={0.7}
            accessibilityRole="button" accessibilityLabel={`Block ${friendName}`}>
            <Icon name="shield" size={s(20)} color="#ef4444" style={styles.icon} />
            <Text style={styles.itemTextDanger}>Block user</Text>
          </TouchableOpacity>

          {/* Report */}
          <TouchableOpacity style={styles.item} onPress={() => run(a.openReport)} activeOpacity={0.7}
            accessibilityRole="button" accessibilityLabel={`Report ${friendName}`}>
            <Icon name="flag" size={s(20)} color="#ef4444" style={styles.icon} />
            <Text style={styles.itemTextDanger}>Report user</Text>
          </TouchableOpacity>
        </View>
      </BaseBottomSheet>

      {/* Action modals — rendered alongside the sheet so they show after it closes */}
      <AddToBoardModal isOpen={a.addToSessionVisible} onClose={a.closeAddToSession} friend={friendForModal} boardsSessions={a.boardsSessions} />
      <BlockUserModal visible={a.blockVisible} onClose={a.closeBlock} onConfirm={a.confirmBlock} userName={friendName} />
      <ReportUserModal isOpen={a.reportVisible} onClose={a.closeReport} user={userForReport} onReport={a.submitReport} />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: vs(6), paddingHorizontal: s(8), paddingBottom: vs(16),
  },
  title: { fontSize: s(16), fontWeight: "700", color: "#111827", paddingHorizontal: s(12), paddingVertical: vs(8) },
  item: { flexDirection: "row", alignItems: "center", paddingVertical: vs(14), paddingHorizontal: s(12), minHeight: vs(48) },
  icon: { marginRight: s(14) },
  itemText: { fontSize: s(16), fontWeight: "500", color: "#1f2937" },
  itemTextDanger: { fontSize: s(16), fontWeight: "500", color: "#ef4444" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#e5e7eb", marginVertical: vs(6), marginHorizontal: s(12) },
});

export default FriendActionsSheet;
