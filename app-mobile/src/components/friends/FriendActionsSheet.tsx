// ORCH-0987: the friend more-menu (••• action sheet). Single shared component for the
// friend profile (and, in the dedupe follow, the Connections list). Wires the six actions
// through useFriendActions and renders the existing AddToBoardModal / BlockUserModal /
// ReportUserModal. No new backend.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { s, vs } from "../../utils/responsive";
import AddToBoardModal from "../AddToBoardModal";
import BlockUserModal from "../BlockUserModal";
import ReportUserModal from "../ReportUserModal";
import { useFriendActions } from "../../hooks/useFriendActions";
import { CustomPaywallScreen } from "../CustomPaywallScreen";
import { useAppStore } from "../../store/appStore";
import { ChatActionList } from "../chat/ChatActionList";
import { buildFriendMenu, type FriendMenuItemId } from "../../utils/chatMenuModel";
import { chatTokens } from "../../constants/chatTokens";

const MUTE_BUSY: ReadonlySet<FriendMenuItemId> = new Set<FriendMenuItemId>(["mute"]);

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
  /** Issue #4114 Wave 3: shared-list rows that leave this sheet. */
  onViewProfile?: () => void;
  onOpenPairedView?: () => void;
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
  onViewProfile,
  onOpenPairedView,
}) => {
  const currentUserId = useAppStore((state) => state.user?.id);
  const a = useFriendActions({ friendUserId, friendName, friendUsername, friendAvatarUrl, pairingId, isPaired, isPending });

  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  const menuItems = buildFriendMenu({
    surface: "friendSheet",
    isFriend,
    pairState: isPaired ? "paired" : isPending ? "pending" : "none",
    canOpenPairedView: Boolean(onOpenPairedView),
    canUnpair: Boolean(pairingId),
    canViewProfile: Boolean(onViewProfile),
    hasConversation: false,
    isMuted: a.isMuted,
  });

  const friendForModal = { id: friendUserId, name: friendName, username: friendUsername ?? "", isOnline: true };
  const userForReport = { id: friendUserId, name: friendName, username: friendUsername ?? "" };

  return (
    <>
      <BaseBottomSheet
        visible={visible}
        onClose={onClose}
        theme="dark"
        snapPoints={FRIEND_ACTIONS_SNAP_POINTS}
        scrollMode="view"
        wrapInRNModal
        accessibilityLabel={`Actions for ${friendName}`}
      >
        <View style={styles.container}>
          <Text style={styles.title} numberOfLines={1}>{friendName}</Text>
          {/* Issue #4114 Wave 3: the same ordered list as the 1:1 chat's ⋯ menu. */}
          <ChatActionList
            items={menuItems}
            name={friendName}
            busyIds={a.isMuteLoading ? MUTE_BUSY : undefined}
            onSelect={(id) => {
              switch (id) {
                case "viewProfile": run(() => onViewProfile?.()); return;
                case "addToSession": run(a.openAddToSession); return;
                case "mute": run(a.toggleMute); return;
                case "sendPair": run(a.sendPair); return;
                case "unpair": run(a.unpair); return;
                case "pairedView": run(() => onOpenPairedView?.()); return;
                case "removeFriend": run(a.removeFriend); return;
                case "report": run(a.openReport); return;
                case "block": run(a.openBlock); return;
                default: return;
              }
            }}
          />
        </View>
      </BaseBottomSheet>

      {/* Action modals — rendered alongside the sheet so they show after it closes */}
      <AddToBoardModal isOpen={a.addToSessionVisible} onClose={a.closeAddToSession} friend={friendForModal} boardsSessions={a.boardsSessions} />
      <BlockUserModal visible={a.blockVisible} onClose={a.closeBlock} onConfirm={a.confirmBlock} userName={friendName} />
      <ReportUserModal isOpen={a.reportVisible} onClose={a.closeReport} user={userForReport} onReport={a.submitReport} />
      {/* Issue #4114: pairing past the free limit opens Mingla+ here too. */}
      {currentUserId ? (
        <CustomPaywallScreen isVisible={a.paywallVisible} onClose={a.closePaywall} userId={currentUserId} feature="pairing" />
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: vs(6), paddingHorizontal: s(20), paddingBottom: vs(16),
  },
  title: { fontSize: s(16), fontWeight: "700", color: chatTokens.textPrimary, paddingVertical: vs(8) },
});

export default FriendActionsSheet;
