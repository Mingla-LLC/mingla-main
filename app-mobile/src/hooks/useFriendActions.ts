// ORCH-0987: single owner of friend more-menu action logic. Both the friend profile
// (FriendActionsSheet) and (in the dedupe follow) the Connections list route through this
// hook, so the six friend actions live in ONE place (Constitution #2). Reuses the existing
// services + modals — no new backend.
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import { useAppStore } from "../store/appStore";
import { useSendPairRequest, useUnpair } from "./usePairings";
import { useFriends } from "./useFriends";
import { useMutedUserIds } from "./useFriendsQuery";
import { muteService } from "../services/muteService";
import { reportService, type ReportReason } from "../services/reportService";
import type { BlockReason } from "../services/blockService";
import { cleanupSharedSessions } from "../utils/sharedSessionCleanup";
import { mixpanelService } from "../services/mixpanelService";
import { derivePairAction, type FriendPairAction } from "../utils/friendMenu";

export interface UseFriendActionsArgs {
  friendUserId: string;
  friendName: string;
  friendUsername?: string;
  friendAvatarUrl?: string | null;
  /** Active pairing id — required for unpair. */
  pairingId?: string | null;
  isPaired: boolean;
  isPending: boolean;
}

/** Minimal session shape AddToBoardModal needs for the add-to-session picker. */
export interface FriendPickerSession {
  id: string;
  name: string;
  status: "active";
  created_by: string;
  participants: { id: string; name: string; username: string }[];
}

export interface FriendActionsApi {
  pairAction: FriendPairAction;
  /** Joinable collaboration sessions for the add-to-session picker. Lazily fetched
   *  only while the picker is open (no realtime, no heavy session hook). */
  boardsSessions: FriendPickerSession[];
  isMuted: boolean;
  isMuteLoading: boolean;
  addToSessionVisible: boolean;
  blockVisible: boolean;
  reportVisible: boolean;
  sendPair: () => void;
  unpair: () => void;
  toggleMute: () => void;
  removeFriend: () => void;
  openAddToSession: () => void;
  closeAddToSession: () => void;
  openBlock: () => void;
  closeBlock: () => void;
  confirmBlock: (reason?: BlockReason) => Promise<void>;
  openReport: () => void;
  closeReport: () => void;
  submitReport: (userId: string, reason: string, details?: string) => Promise<void>;
}

export function useFriendActions(args: UseFriendActionsArgs): FriendActionsApi {
  const { friendUserId, friendName, friendUsername, friendAvatarUrl, pairingId, isPaired, isPending } = args;
  const currentUserId = useAppStore((s) => s.user?.id);
  const queryClient = useQueryClient();

  const sendPairMutation = useSendPairRequest();
  const unpairMutation = useUnpair();
  const { removeFriend: removeFriendMutation, blockFriend } = useFriends();
  const mutedQuery = useMutedUserIds(currentUserId);
  const mutedData = mutedQuery.data;
  const isMuted = Array.isArray(mutedData)
    ? mutedData.includes(friendUserId)
    : mutedData instanceof Set
      ? mutedData.has(friendUserId)
      : false;

  const [isMuteLoading, setIsMuteLoading] = useState(false);
  const [addToSessionVisible, setAddToSessionVisible] = useState(false);
  const [blockVisible, setBlockVisible] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);

  // Joinable sessions for the add-to-session picker. One-shot, lazy (enabled only while
  // the picker is open), no realtime — deliberately NOT useSessionManagement, which mounts
  // a duplicate session_pills realtime channel and loops the menu. [TRANSITIONAL] the
  // dedupe follow should consolidate this read with the canonical session loader.
  const sessionsQuery = useQuery<FriendPickerSession[]>({
    queryKey: ["friend-actions-sessions", currentUserId],
    enabled: addToSessionVisible && !!currentUserId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data: myParts } = await supabase
        .from("session_participants")
        .select("session_id")
        .eq("user_id", currentUserId)
        .eq("has_accepted", true);
      const ids = (myParts ?? []).map((p: { session_id: string }) => p.session_id);
      if (ids.length === 0) return [];

      const [{ data: sessions }, { data: parts }] = await Promise.all([
        supabase.from("collaboration_sessions").select("id, name, created_by").in("id", ids),
        supabase.from("session_participants").select("session_id, user_id").in("session_id", ids),
      ]);

      const userIds = [...new Set((parts ?? []).map((p: { user_id: string }) => p.user_id))];
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("id, username, first_name, last_name").in("id", userIds)
        : { data: [] as Array<{ id: string; username: string | null; first_name: string | null; last_name: string | null }> };

      return (sessions ?? []).map((s: { id: string; name: string | null; created_by: string | null }) => ({
        id: s.id,
        name: s.name || "Session",
        status: "active" as const,
        created_by: s.created_by || "",
        participants: (parts ?? [])
          .filter((p: { session_id: string }) => p.session_id === s.id)
          .map((p: { user_id: string }) => {
            const prof = (profiles ?? []).find((pr) => pr.id === p.user_id);
            const name = [prof?.first_name, prof?.last_name].filter(Boolean).join(" ") || prof?.username || "Friend";
            return { id: p.user_id, name, username: prof?.username ?? "user" };
          }),
      }));
    },
  });

  const sendPair = useCallback(() => {
    sendPairMutation
      .mutateAsync({ friendUserId, displayName: friendName || undefined, avatarUrl: friendAvatarUrl ?? null })
      .then(() => Alert.alert("Pair request sent", `Your pair request to ${friendName} was sent.`))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "";
        if (msg !== "pairing_limit_reached") {
          Alert.alert("Couldn't send pair request", "Please try again.");
        }
      });
  }, [sendPairMutation, friendUserId, friendName, friendAvatarUrl]);

  const unpair = useCallback(() => {
    if (!pairingId) return;
    Alert.alert("Unpair", `Are you sure you want to unpair from ${friendName}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Unpair", style: "destructive", onPress: () => unpairMutation.mutate(pairingId) },
    ]);
  }, [pairingId, friendName, unpairMutation]);

  const toggleMute = useCallback(async () => {
    if (isMuteLoading) return;
    setIsMuteLoading(true);
    try {
      const { success, isMuted: nowMuted, error } = await muteService.toggleMuteUser(friendUserId);
      if (success) {
        await mutedQuery.refetch();
        Alert.alert(
          nowMuted ? "Muted" : "Unmuted",
          nowMuted ? `You won't get notifications from ${friendName}.` : `Notifications from ${friendName} are back on.`,
        );
      } else {
        Alert.alert("Error", error || "Couldn't update mute. Please try again.");
      }
    } catch (e) {
      console.error("[useFriendActions] toggleMute error:", e);
      Alert.alert("Error", "Couldn't update mute. Please try again.");
    } finally {
      setIsMuteLoading(false);
    }
  }, [isMuteLoading, friendUserId, friendName, mutedQuery]);

  const removeFriend = useCallback(() => {
    Alert.alert("Remove friend", `Remove ${friendName} from your friends?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          mixpanelService.trackFriendRemoved({ friendName, friendUsername: friendUsername ?? "" });
          cleanupSharedSessions(currentUserId ?? "", friendUserId)
            .then(() => removeFriendMutation(friendUserId))
            .then(() => queryClient.invalidateQueries({ queryKey: ["nearby-people"] }))
            .catch((e: unknown) => {
              console.error("[useFriendActions] removeFriend error:", e);
              Alert.alert("Error", "Couldn't remove friend. Please try again.");
            });
        },
      },
    ]);
  }, [friendName, friendUsername, currentUserId, friendUserId, removeFriendMutation, queryClient]);

  const openAddToSession = useCallback(() => setAddToSessionVisible(true), []);
  const closeAddToSession = useCallback(() => setAddToSessionVisible(false), []);
  const openBlock = useCallback(() => setBlockVisible(true), []);
  const closeBlock = useCallback(() => setBlockVisible(false), []);
  const openReport = useCallback(() => setReportVisible(true), []);
  const closeReport = useCallback(() => setReportVisible(false), []);

  const confirmBlock = useCallback(
    async (reason?: BlockReason) => {
      setBlockVisible(false);
      mixpanelService.trackFriendBlocked({
        blockedUserName: friendName,
        blockedUserUsername: friendUsername ?? "",
        reason,
      });
      try {
        await cleanupSharedSessions(currentUserId ?? "", friendUserId);
        await blockFriend(friendUserId, reason);
      } catch (e: unknown) {
        console.error("[useFriendActions] block error:", e);
        Alert.alert("Error", "Couldn't block this user. Please try again.");
      }
    },
    [friendName, friendUsername, currentUserId, friendUserId, blockFriend],
  );

  const submitReport = useCallback(
    async (userId: string, reason: string, details?: string) => {
      try {
        const result = await reportService.submitReport(userId, reason as ReportReason, details);
        setReportVisible(false);
        if (result.success) {
          Alert.alert("Report submitted", "Thanks — our team will review this.");
        } else {
          Alert.alert("Couldn't submit report", result.error || "Please try again.");
        }
      } catch (e) {
        console.error("[useFriendActions] report error:", e);
        setReportVisible(false);
        Alert.alert("Error", "Something went wrong. Please try again.");
      }
    },
    [],
  );

  return {
    pairAction: derivePairAction(isPaired, isPending),
    boardsSessions: sessionsQuery.data ?? [],
    isMuted,
    isMuteLoading,
    addToSessionVisible,
    blockVisible,
    reportVisible,
    sendPair,
    unpair,
    toggleMute,
    removeFriend,
    openAddToSession,
    closeAddToSession,
    openBlock,
    closeBlock,
    confirmBlock,
    openReport,
    closeReport,
    submitReport,
  };
}
