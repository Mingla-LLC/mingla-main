/**
 * FriendRequestsModal
 *
 * META-ORCH-0991 Wave B — migrated from a hand-rolled RN <Modal> (slide,
 * flex-end, fixed 88%-of-screen card with a non-draggable fake handle) onto
 * BaseBottomSheet. It is now a true swipe-down sheet that rolls up + pan-
 * dismisses like ExpandedBusinessEventSheet. Snap height ['88%'] preserves the
 * exact prior height; the primitive's real drag handle replaces the cosmetic
 * one. Light theme. Opened from HomePage (mounted high in the tree, above the
 * tab-bar sibling), so NO wrapInRNModal is needed — the sheet's absolute float
 * already clears the tab bar (same as NotificationsSheet). Fixed header +
 * scrolling request list + pinned footer map onto the primitive's slots. All
 * accept/decline logic, analytics (Mixpanel + AppsFlyer), empty/loading states,
 * and copy preserved.
 */

import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from "react-native";
import { useTranslation } from 'react-i18next';
import { Icon } from './ui/Icon';
import { BaseBottomSheet } from './ui/BaseBottomSheet';
import { getDisplayName } from '../utils/getDisplayName';
import { useFriends } from "../hooks/useFriends";
import { formatTimestamp } from "../utils/dateUtils";
import { mixpanelService } from "../services/mixpanelService";
import { logAppsFlyerEvent } from "../services/appsFlyerService";

interface FriendRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function FriendRequestsModal({
  isOpen,
  onClose,
}: FriendRequestsModalProps) {
  const { t } = useTranslation(['social', 'common']);
  const {
    friendRequests,
    loadFriendRequests,
    acceptFriendRequest,
    declineFriendRequest,
  } = useFriends();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [processedRequests, setProcessedRequests] = useState<{
    [key: string]: "accepted" | "declined";
  }>({});

  // Load friend requests when modal opens
  useEffect(() => {
    if (isOpen) {
      setInitialLoading(true);
      const fetchRequests = async () => {
        try {
          await loadFriendRequests();
        } catch (error) {
          console.error("Error loading friend requests:", error);
        } finally {
          setInitialLoading(false);
        }
      };
      fetchRequests();
    } else {
      // Reset loading state when modal closes
      setInitialLoading(true);
    }
  }, [isOpen, loadFriendRequests]);

  // Filter only incoming pending requests
  const incomingRequests = friendRequests.filter(
    (req) => req.type === "incoming" && req.status === "pending"
  );

  const handleAcceptRequest = async (requestId: string) => {
    setProcessedRequests((prev) => ({ ...prev, [requestId]: "accepted" }));
    setLoading(true);

    // Find the request to get sender info for tracking
    const request = incomingRequests.find((r) => r.id === requestId);

    try {
      await acceptFriendRequest(requestId);

      // Track friend request accepted
      if (request) {
        const senderName = getDisplayName(request.sender, "Unknown");
        mixpanelService.trackFriendRequestAccepted({
          requestId,
          senderName,
        });
        logAppsFlyerEvent('friend_request_accepted', { source: 'notification' });
      }

      // Reload requests after accepting
      await loadFriendRequests();

      // Remove from processed requests after animation
      setTimeout(() => {
        setProcessedRequests((prev) => {
          const newState = { ...prev };
          delete newState[requestId];
          return newState;
        });
      }, 1500);
    } catch (error) {
      console.error("Error accepting friend request:", error);
      // Revert the processed state on error
      setProcessedRequests((prev) => {
        const newState = { ...prev };
        delete newState[requestId];
        return newState;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    setProcessedRequests((prev) => ({ ...prev, [requestId]: "declined" }));
    setLoading(true);

    // Find the request to get sender info for tracking
    const request = incomingRequests.find((r) => r.id === requestId);

    try {
      await declineFriendRequest(requestId);

      // Track friend request declined
      if (request) {
        const senderName = getDisplayName(request.sender, "Unknown");
        mixpanelService.trackFriendRequestDeclined({
          requestId,
          senderName,
        });
      }

      // Reload requests after declining
      await loadFriendRequests();

      // Remove from processed requests after animation
      setTimeout(() => {
        setProcessedRequests((prev) => {
          const newState = { ...prev };
          delete newState[requestId];
          return newState;
        });
      }, 1500);
    } catch (error) {
      console.error("Error declining friend request:", error);
      // Revert the processed state on error
      setProcessedRequests((prev) => {
        const newState = { ...prev };
        delete newState[requestId];
        return newState;
      });
    } finally {
      setLoading(false);
    }
  };

  // META-ORCH-0991 Wave B — fixed header (title + dynamic subtitle), pinned to
  // the top of the sheet above the scrolling request list.
  const header = (
    <View style={styles.header}>
      <View style={styles.headerContent}>
        <View style={styles.headerSidePlaceholder} />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('social:friendRequests')}</Text>
          <Text style={styles.headerSubtitle}>
            {initialLoading ? (
              t('social:loading')
            ) : incomingRequests.length === 0 ? (
              t('social:allCaughtUp')
            ) : (
              t('social:pendingCount', { count: incomingRequests.length })
            )}
          </Text>
        </View>
        <View style={styles.headerSidePlaceholder} />
      </View>
    </View>
  );

  // Pinned footer (only shown once requests have loaded, matching prior layout).
  const footer = initialLoading ? undefined : (
    <View style={styles.footer}>
      <Text style={styles.footerText}>
        {t('social:manageConnectionsFooter')}
      </Text>
    </View>
  );

  return (
    <BaseBottomSheet
      visible={isOpen}
      onClose={onClose}
      theme="light"
      snapPoints={FRIEND_REQUESTS_SNAP_POINTS}
      scrollMode="scroll"
      // ORCH-1016 ROOT-CAUSE FIX: BARE scrollMode="scroll" — the gorhom scroll is
      // the DIRECT child of BottomSheetContent (the only structure gorhom binds to
      // the snap height). Header + footer are now scroll children, NOT the
      // header/stickyFooter props (those wrap the scroll in a BottomSheetView →
      // viewport == content → frozen). `hidesBottomNav` hides the floating nav while
      // open, so the footer/last row isn't painted over — replacing the old
      // tabBarAware padding workaround.
      hidesBottomNav
      scrollProps={{
        style: styles.content,
        contentContainerStyle: styles.contentContainer,
        showsVerticalScrollIndicator: false,
      }}
      accessibilityLabel={t('social:friendRequests')}
    >
          {header}
          {/* Content */}
          {initialLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#eb7825" />
            </View>
          ) : (
            <>
                {/* Received Requests */}
                {incomingRequests.length === 0 ? (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyStateIcon}>
                      <Icon name="inbox" size={32} color="#9ca3af" />
                    </View>
                    <Text style={styles.emptyStateTitle}>
                      {t('social:noFriendRequests')}
                    </Text>
                    <Text style={styles.emptyStateText}>
                      {t('social:noFriendRequestsMessage')}
                    </Text>
                    <View style={styles.emptyStateHint}>
                      <Icon name="info" size={14} color="#9ca3af" />
                      <Text style={styles.emptyStateHintText}>
                        {t('social:friendRequestHint')}
                      </Text>
                    </View>
                  </View>
                ) : (
                    <View style={styles.requestsList}>
                      {incomingRequests.map((request) => {
                        const status = processedRequests[request.id];
                        const senderName = getDisplayName(request.sender, "Unknown");
                        const initials = senderName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2);

                        return (
                          <View
                            key={request.id}
                            style={[
                              styles.requestItem,
                              status === "accepted" && styles.requestItemAccepted,
                              status === "declined" && styles.requestItemDeclined,
                            ]}
                          >
                            <View style={styles.requestContent}>
                              {/* Avatar */}
                              <View style={styles.avatarContainer}>
                                <View style={styles.avatar}>
                                  {request.sender.avatar_url ? (
                                    <Image
                                      source={{ uri: request.sender.avatar_url }}
                                      style={styles.avatarImage}
                                    />
                                  ) : (
                                    <Text style={styles.avatarText}>
                                      {initials}
                                    </Text>
                                  )}
                                </View>
                              </View>

                              {/* User Info */}
                              <View style={styles.userInfo}>
                                <Text style={styles.userName} numberOfLines={1}>{senderName}</Text>
                                <Text style={styles.requestTime}>
                                  {formatTimestamp(request.created_at)}
                                </Text>
                              </View>

                              {/* Action Buttons */}
                              <View style={styles.actionButtons}>
                                {status === "accepted" ? (
                                  <View style={styles.statusAccepted}>
                                    <Icon
                                      name="checkmark"
                                      size={16}
                                      color="#059669"
                                    />
                                    <Text style={styles.statusText}>
                                      {t('social:accepted')}
                                    </Text>
                                  </View>
                                ) : status === "declined" ? (
                                  <View style={styles.statusDeclined}>
                                    <Icon
                                      name="close"
                                      size={16}
                                      color="#dc2626"
                                    />
                                    <Text style={styles.statusTextDeclined}>
                                      {t('social:declined')}
                                    </Text>
                                  </View>
                                ) : (
                                  <>
                                    <TouchableOpacity
                                      onPress={() =>
                                        handleDeclineRequest(request.id)
                                      }
                                      style={styles.declineButton}
                                      disabled={loading}
                                    >
                                      {loading &&
                                      processedRequests[request.id] ===
                                        "declined" ? (
                                        <ActivityIndicator
                                          size="small"
                                          color="#6b7280"
                                        />
                                      ) : (
                                        <Icon
                                          name="user-x"
                                          size={16}
                                          color="#6b7280"
                                        />
                                      )}
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      onPress={() =>
                                        handleAcceptRequest(request.id)
                                      }
                                      style={styles.acceptButton}
                                      disabled={loading}
                                    >
                                      {loading &&
                                      processedRequests[request.id] ===
                                        "accepted" ? (
                                        <ActivityIndicator
                                          size="small"
                                          color="white"
                                        />
                                      ) : (
                                        <Icon
                                          name="user-plus"
                                          size={16}
                                          color="white"
                                        />
                                      )}
                                    </TouchableOpacity>
                                  </>
                                )}
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
            </>
          )}
          {footer}
    </BaseBottomSheet>
  );
}

// META-ORCH-0991 Wave B — single tall snap preserving the prior
// SCREEN_HEIGHT * 0.88 fixed card height for the request list.
const FRIEND_REQUESTS_SNAP_POINTS = ['88%'];

const styles = StyleSheet.create({
  // META-ORCH-0991 Wave B — the scrim (sheetOverlay), backdrop touch target,
  // fixed-height card (sheetContent), and cosmetic drag handle are removed:
  // BaseBottomSheet provides the backdrop (press-to-close), the ['88%'] snap,
  // the light-theme rounded top, and a REAL draggable handle.
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginTop: 2,
    textAlign: "center",
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButtonPlaceholder: {
    width: 36,
    height: 36,
  },
  headerSidePlaceholder: {
    width: 36,
    height: 36,
  },
  content: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  contentContainer: {
    flexGrow: 1,
    padding: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyStateIcon: {
    width: 64,
    height: 64,
    backgroundColor: "#f3f4f6",
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 16,
  },
  emptyStateHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f9fafb",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  emptyStateHintText: {
    fontSize: 13,
    color: "#6b7280",
    flex: 1,
  },
  requestsList: {
    gap: 12,
  },
  requestItem: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 12,
  },
  requestItemAccepted: {
    backgroundColor: "#f0fdf4",
  },
  requestItemDeclined: {
    backgroundColor: "#fef2f2",
  },
  requestContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarContainer: {
    flexShrink: 0,
  },
  avatar: {
    width: 44,
    height: 44,
    backgroundColor: "#eb7825",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  avatarText: {
    color: "white",
    fontWeight: "600",
    fontSize: 16,
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  userName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  requestTime: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 1,
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  statusAccepted: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#dcfce7",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  statusDeclined: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fee2e2",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#059669",
  },
  statusTextDeclined: {
    fontSize: 14,
    fontWeight: "500",
    color: "#dc2626",
  },
  declineButton: {
    padding: 10,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButton: {
    padding: 10,
    backgroundColor: "#eb7825",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  loadingContainer: {
    padding: 64,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 200,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
    alignItems: "center",
  },
  footerText: {
    fontSize: 13,
    color: "#9ca3af",
    textAlign: "center",
  },
});
