/**
 * NotificationsModal — V2 Server-Synced Notification Center
 *
 * Complete redesign with:
 * - Filter tabs (All, Social, Sessions, Messages)
 * - Icon mapping per notification type
 * - Action buttons for actionable notifications
 * - Date grouping (Today, Yesterday, This Week, Earlier)
 * - Loading / empty / error / offline states
 * - Deep link navigation on card tap
 */
import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Dimensions,
  SectionList,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './ui/Icon';
import { useNetInfo } from '@react-native-community/netinfo';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { colors, spacing, radius, shadows } from '../constants/designSystem';
import type { ServerNotification } from '../hooks/useNotifications';
import { useTranslation } from 'react-i18next';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.88;
const EMPTY_PENDING_SET = new Set<string>();

// ── Filter categories ────────────────────────────────────────────────────────

type FilterTab = 'all' | 'social' | 'sessions' | 'messages';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'social', label: 'Social' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'messages', label: 'Messages' },
];

function getFilterCategory(type: string): FilterTab {
  if (
    type.startsWith('friend_request_') ||
    type.startsWith('pair_request_')
  ) {
    return 'social';
  }
  if (
    type.startsWith('collaboration_') ||
    type.startsWith('session_') ||
    type.startsWith('board_card_')
  ) {
    return 'sessions';
  }
  if (
    type.startsWith('direct_message_') ||
    type.startsWith('board_message_')
  ) {
    return 'messages';
  }
  return 'all';
}

// ── Icon mapping ─────────────────────────────────────────────────────────────

interface IconConfig {
  name: string;
  color: string;
}

const NOTIFICATION_ICONS: Record<string, IconConfig> = {
  friend_request_received: { name: 'person-add-outline', color: '#3B82F6' },
  friend_request_accepted: { name: 'people', color: '#10B981' },
  pair_request_received: { name: 'people-outline', color: '#EF4444' },
  pair_request_accepted: { name: 'heart', color: '#EF4444' },
  collaboration_invite_received: { name: 'calendar-outline', color: '#eb7825' },
  collaboration_invite_accepted: { name: 'checkmark-circle', color: '#10B981' },
  collaboration_invite_declined: { name: 'close-circle-outline', color: '#9CA3AF' },
  session_member_joined: { name: 'person-add', color: '#3B82F6' },
  session_member_left: { name: 'person-remove-outline', color: '#9CA3AF' },
  direct_message_received: { name: 'chatbubble', color: '#3B82F6' },
  board_message_received: { name: 'chatbubbles-outline', color: '#8B5CF6' },
  board_message_mention: { name: 'at-outline', color: '#eb7825' },
  board_card_message: { name: 'chatbubble-ellipses-outline', color: '#8B5CF6' },
  board_card_saved: { name: 'heart', color: '#EF4444' },
  board_card_voted: { name: 'thumbs-up-outline', color: '#10B981' },
  board_card_rsvp: { name: 'calendar-outline', color: '#0EA5E9' },
  calendar_reminder_tomorrow: { name: 'calendar', color: '#0EA5E9' },
  calendar_reminder_today: { name: 'sunny-outline', color: '#F59E0B' },
  visit_feedback_prompt: { name: 'star-outline', color: '#F59E0B' },
  holiday_reminder: { name: 'gift-outline', color: '#EF4444' },
  paired_user_saved_card: { name: 'heart-outline', color: '#EF4444' },
  paired_user_visited: { name: 'location-outline', color: '#10B981' },
  trial_ending: { name: 'time-outline', color: '#F59E0B' },
  referral_credited: { name: 'gift', color: '#10B981' },
  weekly_digest: { name: 'bar-chart-outline', color: '#eb7825' },
};

function getIconConfig(type: string): IconConfig {
  return NOTIFICATION_ICONS[type] ?? { name: 'notifications-outline', color: '#6B7280' };
}

// ── Actionable notification types ────────────────────────────────────────────

const ACTIONABLE_TYPES: Record<string, { acceptLabel: string; declineLabel?: string }> = {
  friend_request_received: { acceptLabel: 'Accept', declineLabel: 'Decline' },
  pair_request_received: { acceptLabel: 'Accept', declineLabel: 'Decline' },
  collaboration_invite_received: { acceptLabel: 'Join', declineLabel: 'Decline' },
  trial_ending: { acceptLabel: 'Upgrade' },
  visit_feedback_prompt: { acceptLabel: 'Review' },
};

// ── Time formatting ──────────────────────────────────────────────────────────

function formatTimeAgo(isoTimestamp: string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHr < 24) return `${diffHr}h`;
  if (diffDay < 7) return `${diffDay}d`;
  if (diffWeek < 5) return `${diffWeek}w`;
  return new Date(isoTimestamp).toLocaleDateString();
}

// ── Section grouping ─────────────────────────────────────────────────────────

function groupNotificationsByDate(
  notifications: ServerNotification[]
): { title: string; data: ServerNotification[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - 7 * 86_400_000;

  const today: ServerNotification[] = [];
  const yesterday: ServerNotification[] = [];
  const thisWeek: ServerNotification[] = [];
  const older: ServerNotification[] = [];

  notifications.forEach((n) => {
    const ts = new Date(n.created_at).getTime();
    if (ts >= todayStart) today.push(n);
    else if (ts >= yesterdayStart) yesterday.push(n);
    else if (ts >= weekStart) thisWeek.push(n);
    else older.push(n);
  });

  const sections: { title: string; data: ServerNotification[] }[] = [];
  if (today.length > 0) sections.push({ title: 'Today', data: today });
  if (yesterday.length > 0) sections.push({ title: 'Yesterday', data: yesterday });
  if (thisWeek.length > 0) sections.push({ title: 'This Week', data: thisWeek });
  if (older.length > 0) sections.push({ title: 'Earlier', data: older });

  return sections;
}

// ── Avatar helpers ───────────────────────────────────────────────────────────

function getAvatarUrl(data: Record<string, unknown>): string | null {
  return (
    (data?.senderAvatarUrl as string) ||
    (data?.inviterAvatarUrl as string) ||
    (data?.avatar_url as string) ||
    null
  );
}

function getInitials(data: Record<string, unknown>): string {
  const name =
    (data?.senderName as string) ||
    (data?.inviterName as string) ||
    (data?.userName as string) ||
    (data?.fromUserName as string) ||
    '';
  if (!name) return '?';
  return name
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ── Props ────────────────────────────────────────────────────────────────────

interface NotificationsModalProps {
  visible: boolean;
  onClose: () => void;
  notifications: ServerNotification[];
  unreadCount: number;
  isLoading: boolean;
  isError: boolean;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onMarkAsRead: (notificationId: string) => void;
  onDeleteNotification: (notificationId: string) => void;
  onNotificationTap: (notification: ServerNotification) => void;
  // Action handlers
  onAcceptFriendRequest?: (requestId: string, notificationId: string) => Promise<void>;
  onDeclineFriendRequest?: (requestId: string, notificationId: string) => Promise<void>;
  onAcceptPairRequest?: (requestId: string, notificationId: string) => Promise<void>;
  onDeclinePairRequest?: (requestId: string, notificationId: string) => Promise<void>;
  onAcceptCollaborationInvite?: (inviteId: string, notificationId: string) => Promise<void>;
  onDeclineCollaborationInvite?: (inviteId: string, notificationId: string) => Promise<void>;
  onAcceptLinkRequest?: (linkId: string, notificationId: string) => Promise<void>;
  onDeclineLinkRequest?: (linkId: string, notificationId: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
  onLoadMore?: () => Promise<void>;
  hasMore?: boolean;
  pendingActions?: Set<string>;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function NotificationsModal({
  visible,
  onClose,
  notifications,
  unreadCount,
  isLoading,
  isError,
  onMarkAllRead,
  onClearAll,
  onMarkAsRead,
  onDeleteNotification,
  onNotificationTap,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onAcceptPairRequest,
  onDeclinePairRequest,
  onAcceptCollaborationInvite,
  onDeclineCollaborationInvite,
  onAcceptLinkRequest,
  onDeclineLinkRequest,
  onRefresh,
  onLoadMore,
  hasMore = false,
  pendingActions = EMPTY_PENDING_SET,
}: NotificationsModalProps) {
  const { t } = useTranslation(['notifications', 'common']);
  const insets = useSafeAreaInsets();
  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false;
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(new Set());
  const [actionErrors, setActionErrors] = useState<Set<string>>(new Set());

  // ── Filtered + grouped notifications ──
  const filteredNotifications = useMemo(() => {
    if (activeFilter === 'all') return notifications;
    return notifications.filter((n) => getFilterCategory(n.type) === activeFilter);
  }, [notifications, activeFilter]);

  const sections = useMemo(
    () => groupNotificationsByDate(filteredNotifications),
    [filteredNotifications]
  );

  const handleImageError = useCallback((notificationId: string) => {
    setFailedImageIds((prev) => new Set(prev).add(notificationId));
  }, []);

  // ── Action handlers ──

  const handleAccept = useCallback(
    async (notification: ServerNotification) => {
      const { type, id, data } = notification;
      setActionErrors((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      try {
        // Entity ID resolution: check data JSONB first, then fall back to the
        // notification.related_id DB column. notify-dispatch always stores the
        // entity ID in related_id, so this fallback ensures action buttons work
        // even when an edge function omits the ID from the data JSONB payload
        // (e.g., send-pair-request's friend_request_received path).
        switch (type) {
          case 'friend_request_received':
            await onAcceptFriendRequest?.(
              (data?.requestId as string) || notification.related_id || '',
              id
            );
            break;
          case 'pair_request_received':
            await onAcceptPairRequest?.(
              (data?.requestId as string) || notification.related_id || '',
              id
            );
            break;
          case 'collaboration_invite_received':
            await onAcceptCollaborationInvite?.(
              (data?.inviteId as string) || notification.related_id || '',
              id
            );
            break;
          case 'trial_ending':
          case 'visit_feedback_prompt':
            // Single-action types: mark as read, close modal, navigate
            if (!notification.is_read) onMarkAsRead(notification.id);
            onClose();
            onNotificationTap(notification);
            break;
          default:
            // For single-action types, tap navigates
            onNotificationTap(notification);
            break;
        }
      } catch (err) {
        setActionErrors((prev) => new Set(prev).add(id));
      }
    },
    [
      onAcceptFriendRequest,
      onAcceptPairRequest,
      onAcceptCollaborationInvite,
      onAcceptLinkRequest,
      onNotificationTap,
    ]
  );

  const handleDecline = useCallback(
    async (notification: ServerNotification) => {
      const { type, id, data } = notification;
      setActionErrors((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      try {
        switch (type) {
          case 'friend_request_received':
            await onDeclineFriendRequest?.(
              (data?.requestId as string) || notification.related_id || '',
              id
            );
            break;
          case 'pair_request_received':
            await onDeclinePairRequest?.(
              (data?.requestId as string) || notification.related_id || '',
              id
            );
            break;
          case 'collaboration_invite_received':
            await onDeclineCollaborationInvite?.(
              (data?.inviteId as string) || notification.related_id || '',
              id
            );
            break;
        }
      } catch (err) {
        setActionErrors((prev) => new Set(prev).add(id));
      }
    },
    [
      onDeclineFriendRequest,
      onDeclinePairRequest,
      onDeclineCollaborationInvite,
      onDeclineLinkRequest,
    ]
  );

  // ── Card tap ──

  const handleCardPress = useCallback(
    (notification: ServerNotification) => {
      // Mark as read optimistically
      if (!notification.is_read) {
        onMarkAsRead(notification.id);
      }
      // Close modal + navigate
      onClose();
      onNotificationTap(notification);
    },
    [onMarkAsRead, onClose, onNotificationTap]
  );

  // ── Render notification card ──

  const renderNotification = ({ item }: { item: ServerNotification }) => {
    const iconConfig = getIconConfig(item.type);
    const actionConfig = ACTIONABLE_TYPES[item.type];
    const isActionable = !!actionConfig;
    const isPending = pendingActions.has(item.id);
    const hasError = actionErrors.has(item.id);
    const avatarUrl = getAvatarUrl(item.data || {});
    const initials = getInitials(item.data || {});
    const showAvatar = !!avatarUrl || item.actor_id != null;

    return (
      <View style={styles.notificationCardWrapper}>
        <TouchableOpacity
          style={[
            styles.notificationCard,
            !item.is_read && styles.notificationCardUnread,
          ]}
          onPress={() => handleCardPress(item)}
          activeOpacity={0.7}
          disabled={isPending}
        >
          {/* Left border for unread */}
          {!item.is_read && <View style={styles.unreadLeftBorder} />}

          {/* Avatar / Icon Section */}
          <View style={styles.avatarSection}>
            {showAvatar ? (
              <View style={styles.avatarCircle}>
                {avatarUrl && !failedImageIds.has(item.id) ? (
                  <ImageWithFallback
                    source={{ uri: String(avatarUrl).trim() }}
                    style={styles.avatarImage}
                    onError={() => handleImageError(item.id)}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.avatarInitials}>{initials}</Text>
                )}
              </View>
            ) : (
              <View style={[styles.iconCircle, { backgroundColor: iconConfig.color + '15' }]}>
                <Icon
                  name={iconConfig.name}
                  size={20}
                  color={iconConfig.color}
                />
              </View>
            )}
            {!item.is_read && <View style={styles.unreadDot} />}
          </View>

          {/* Main Content */}
          <View style={styles.mainContent}>
            <View style={styles.titleRow}>
              <Text style={styles.notificationTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.notificationTime}>
                {formatTimeAgo(item.created_at)}
              </Text>
            </View>

            <Text style={styles.notificationBody} numberOfLines={2}>
              {item.body}
            </Text>

            {/* Action buttons */}
            {isActionable && !isPending && (
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.acceptButton}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    handleAccept(item);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.acceptButtonText}>
                    {actionConfig.acceptLabel}
                  </Text>
                </TouchableOpacity>
                {actionConfig.declineLabel && (
                  <TouchableOpacity
                    style={styles.declineButton}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      handleDecline(item);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.declineButtonText}>
                      {actionConfig.declineLabel}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Pending spinner */}
            {isPending && (
              <View style={styles.actionButtons}>
                <ActivityIndicator size="small" color="#eb7825" />
              </View>
            )}

            {/* Error state */}
            {hasError && !isPending && (
              <Text style={styles.actionError}>{t('notifications:actions.actionFailed')}</Text>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  // ── Section header ──

  const renderSectionHeader = ({
    section,
  }: {
    section: { title: string; data: ServerNotification[] };
  }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
      <View style={styles.sectionHeaderLine} />
    </View>
  );

  // ── Skeleton loader ──

  const renderSkeleton = () => (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonContent}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonBody} />
            <View style={styles.skeletonBodyShort} />
          </View>
        </View>
      ))}
    </View>
  );

  // ── Render ──

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.sheetOverlay}>
        {/* Tap backdrop to close */}
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onClose}
        />

        <View
          style={[styles.sheetContent, { paddingBottom: Math.max(insets.bottom, 16) }]}
        >
          {/* Drag Handle */}
          <View style={styles.dragHandleContainer}>
            <View style={styles.dragHandle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>{t('notifications:header.title')}</Text>
              {unreadCount > 0 && (
                <Text style={styles.headerUnreadBadge}>{t('notifications:header.unread', { count: unreadCount })}</Text>
              )}
            </View>
            <View style={styles.headerActions}>
              {unreadCount > 0 && (
                <TouchableOpacity
                  style={styles.headerActionButton}
                  onPress={onMarkAllRead}
                >
                  <Icon name="checkmark-done-outline" size={16} color="#eb7825" />
                  <Text style={styles.headerActionText}>{t('notifications:header.markAllRead')}</Text>
                </TouchableOpacity>
              )}
              {notifications.length > 0 && (
                <TouchableOpacity
                  style={styles.headerActionButton}
                  onPress={onClearAll}
                >
                  <Icon name="trash-outline" size={16} color={colors.gray[400]} />
                  <Text style={[styles.headerActionText, { color: colors.gray[400] }]}>
                    {t('notifications:header.clearAll')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Filter Tabs — fixed vertical size; flexShrink:0 so list never compresses them */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterTabsContainer}
            style={styles.filterTabsScroll}
            nestedScrollEnabled
          >
            {FILTER_TABS.map((tab) => (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.filterTab,
                  activeFilter === tab.key && styles.filterTabActive,
                ]}
                onPress={() => setActiveFilter(tab.key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.filterTabText,
                    activeFilter === tab.key && styles.filterTabTextActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Content — flex:1 + minHeight:0 so SectionList scrolls inside sheet without stealing filter height */}
          <View style={styles.sheetMainBody}>
            {isLoading ? (
              renderSkeleton()
            ) : isError ? (
              <View style={styles.errorState}>
                <Icon name="alert-circle-outline" size={48} color={colors.gray[300]} />
                <Text style={styles.errorTitle}>{t('notifications:errorState.title')}</Text>
                <Text style={styles.errorSubtext}>
                  {t('notifications:errorState.subtitle')}
                </Text>
                <TouchableOpacity style={styles.retryButton} onPress={onRefresh}>
                  <Text style={styles.retryButtonText}>{t('notifications:errorState.tryAgain')}</Text>
                </TouchableOpacity>
              </View>
            ) : filteredNotifications.length === 0 && !isOffline ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconCircle}>
                  <Icon
                    name="notifications-outline"
                    size={40}
                    color={colors.gray[300]}
                  />
                </View>
                <Text style={styles.emptyStateTitle}>{t('notifications:emptyState.title')}</Text>
                <Text style={styles.emptyStateSubtext}>
                  {t('notifications:emptyState.subtitle')}
                </Text>
              </View>
            ) : (
              <View style={styles.notificationsListColumn}>
                {isOffline && (
                  <View style={styles.offlineBanner}>
                    <Icon name="cloud-offline-outline" size={14} color="#6B7280" />
                    <Text style={styles.offlineBannerText}>
                      {t('notifications:offline.banner')}
                    </Text>
                  </View>
                )}
                <SectionList
                  style={styles.sectionList}
                  sections={sections}
                  keyExtractor={(item) => item.id}
                  renderItem={renderNotification}
                  renderSectionHeader={renderSectionHeader}
                  stickySectionHeadersEnabled={false}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.listContent}
                  onEndReached={() => {
                    if (hasMore) onLoadMore?.();
                  }}
                  onEndReachedThreshold={0.3}
                  refreshing={false}
                  onRefresh={onRefresh}
                />
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheetContent: {
    height: SHEET_HEIGHT,
    flexDirection: 'column',
    backgroundColor: colors.background.primary,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    overflow: 'hidden',
    ...shadows.xl,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray[300],
  },

  // ── Header ──
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },
  headerUnreadBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: '#eb7825',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerActionText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#eb7825',
  },

  sheetMainBody: {
    flex: 1,
    minHeight: 0,
  },
  sectionList: {
    flex: 1,
  },
  notificationsListColumn: {
    flex: 1,
    minHeight: 0,
  },

  // ── Filter Tabs ──
  filterTabsScroll: {
    flexGrow: 0,
    flexShrink: 0,
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  filterTabsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.sm,
    flexGrow: 0,
  },
  filterTab: {
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 0,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.gray[300],
    backgroundColor: 'transparent',
    flexShrink: 0,
  },
  filterTabActive: {
    backgroundColor: '#eb7825',
    borderColor: '#eb7825',
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.gray[500],
  },
  filterTabTextActive: {
    color: colors.text.inverse,
    fontWeight: '600',
  },

  // ── Section Header ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
    gap: 12,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.gray[100],
  },

  // ── Notification Cards ──
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    paddingBottom: 24,
  },
  notificationCardWrapper: {
    marginVertical: 4,
  },
  notificationCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.background.primary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.gray[100],
    gap: 12,
    overflow: 'hidden',
  },
  notificationCardUnread: {
    backgroundColor: colors.background.primary,
  },
  unreadLeftBorder: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#eb7825',
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },

  // ── Avatar / Icon ──
  avatarSection: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
  },
  avatarInitials: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ea6317',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#eb7825',
    borderWidth: 2,
    borderColor: colors.background.primary,
  },

  // ── Content ──
  mainContent: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  notificationTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text.primary,
    flex: 1,
    marginRight: spacing.sm,
  },
  notificationTime: {
    fontSize: 11,
    color: colors.gray[400],
    fontWeight: '500',
  },
  notificationBody: {
    fontSize: 12,
    color: colors.gray[500],
    lineHeight: 16,
    marginBottom: 4,
  },

  // ── Action Buttons ──
  actionButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  acceptButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: '#eb7825',
  },
  acceptButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text.inverse,
  },
  declineButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.gray[100],
  },
  declineButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray[500],
  },
  actionError: {
    fontSize: 11,
    color: colors.error[500],
    marginTop: 4,
  },

  // ── Empty State ──
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.gray[700],
    marginBottom: spacing.sm,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: colors.gray[400],
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Error State ──
  errorState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.gray[700],
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  errorSubtext: {
    fontSize: 14,
    color: colors.gray[400],
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: '#eb7825',
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.inverse,
  },

  // ── Offline Banner ──
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    backgroundColor: '#F3F4F6',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexShrink: 0,
  },
  offlineBannerText: {
    fontSize: 12,
    color: '#6B7280',
  },

  // ── Skeleton Loader ──
  skeletonContainer: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: 12,
  },
  skeletonCard: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  skeletonAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.gray[100],
  },
  skeletonContent: {
    flex: 1,
    gap: 8,
  },
  skeletonTitle: {
    width: '60%',
    height: 12,
    borderRadius: 4,
    backgroundColor: colors.gray[100],
  },
  skeletonBody: {
    width: '90%',
    height: 10,
    borderRadius: 4,
    backgroundColor: colors.gray[100],
  },
  skeletonBodyShort: {
    width: '50%',
    height: 10,
    borderRadius: 4,
    backgroundColor: colors.gray[100],
  },
});
