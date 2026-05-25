/**
 * NotificationsSheet - V2 Server-Synced Notification Center (redesigned ORCH-0975)
 *
 * Complete redesign with:
 * - @gorhom/bottom-sheet v5 sheet chrome, not React Native Modal
 * - Pan-down dismiss plus explicit close button for accessibility
 * - Single chronological list, with filter chips intentionally removed
 * - Ringed avatar/icon treatment, category pills, unread dots, and action buttons
 * - Date grouping (Today, Yesterday, This Week, Earlier)
 * - Loading / empty / error / offline states
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetSectionList,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { useNetInfo } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ImageWithFallback } from './figma/ImageWithFallback';
import { Icon, type IconName } from './ui/Icon';
import { colors, glass, radius, spacing } from '../constants/designSystem';
import type { ServerNotification } from '../hooks/useNotifications';

const SHEET_SNAP_POINTS = ['88%'];
const EMPTY_PENDING_SET = new Set<string>();

// ORCH-0975 - wraps @gorhom/bottom-sheet v5 (NOT RN Modal). Pan-down dismisses;
// x is the redundant explicit affordance for VoiceOver. Filter chips are gone.

// -- Filter categories --------------------------------------------------------

type NotificationCategory = 'all' | 'social' | 'sessions' | 'messages';

function getFilterCategory(type: string): NotificationCategory {
  if (
    type.startsWith('friend_request_') ||
    type.startsWith('pair_request_')
  ) {
    return 'social';
  }
  if (type === 'board_card_message') {
    return 'messages';
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

// -- Icon mapping -------------------------------------------------------------

interface IconConfig {
  name: IconName;
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

// -- Actionable notification types -------------------------------------------

const ACTIONABLE_TYPES: Record<string, { acceptKey: string; declineKey?: string }> = {
  friend_request_received: { acceptKey: 'actions.accept', declineKey: 'actions.decline' },
  pair_request_received: { acceptKey: 'actions.accept', declineKey: 'actions.decline' },
  collaboration_invite_received: { acceptKey: 'actions.join', declineKey: 'actions.decline' },
  trial_ending: { acceptKey: 'actions.upgrade' },
  visit_feedback_prompt: { acceptKey: 'actions.review' },
};

// -- Time formatting ----------------------------------------------------------

function formatTimeAgo(isoTimestamp: string, t: (key: string, opts?: any) => string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);

  if (diffSec < 60) return t('notifications:timeAgo.justNow');
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHr < 24) return `${diffHr}h`;
  if (diffDay < 7) return `${diffDay}d`;
  if (diffWeek < 5) return `${diffWeek}w`;
  return new Date(isoTimestamp).toLocaleDateString();
}

// -- Section grouping ---------------------------------------------------------

function groupNotificationsByDate(
  notifications: ServerNotification[],
  t: (key: string) => string
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
  if (today.length > 0) sections.push({ title: t('notifications:dateGroups.today'), data: today });
  if (yesterday.length > 0) sections.push({ title: t('notifications:dateGroups.yesterday'), data: yesterday });
  if (thisWeek.length > 0) sections.push({ title: t('notifications:dateGroups.thisWeek'), data: thisWeek });
  if (older.length > 0) sections.push({ title: t('notifications:dateGroups.earlier'), data: older });

  return sections;
}

// -- Avatar helpers -----------------------------------------------------------

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

function renderTitleWithBoldActor(
  title: string,
  data: Record<string, unknown>,
): React.ReactNode {
  const explicitName =
    (data?.inviterName as string | undefined) ||
    (data?.senderName as string | undefined) ||
    (data?.userName as string | undefined) ||
    (data?.fromUserName as string | undefined) ||
    null;

  if (!explicitName || !title.includes(explicitName)) {
    return (
      <Text
        style={styles.titleSemibold}
        numberOfLines={2}
        testID="notifications-title-semibold"
      >
        {title}
      </Text>
    );
  }

  const idx = title.indexOf(explicitName);
  const before = title.slice(0, idx);
  const after = title.slice(idx + explicitName.length);
  return (
    <Text
      style={styles.titleSemibold}
      numberOfLines={2}
      testID="notifications-title-with-bold-actor"
    >
      {before}
      <Text style={styles.titleBoldActor} testID="notifications-title-bold-actor">
        {explicitName}
      </Text>
      {after}
    </Text>
  );
}

export interface NotificationsSheetProps {
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

export default function NotificationsSheet({
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
  onRefresh,
  onLoadMore,
  hasMore = false,
  pendingActions = EMPTY_PENDING_SET,
}: NotificationsSheetProps) {
  const { t } = useTranslation(['notifications', 'common']);
  const insets = useSafeAreaInsets();
  const netInfo = useNetInfo();
  const sheetRef = useRef<BottomSheet>(null);
  const isOffline = netInfo.isConnected === false;
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(new Set());
  const [actionErrors, setActionErrors] = useState<Set<string>>(new Set());

  const sheetIndex = visible ? 0 : -1;

  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  const sections = useMemo(
    () => groupNotificationsByDate(notifications, t),
    [notifications, t]
  );

  const listContentStyle = useMemo(
    () => [
      styles.listContent,
      { paddingBottom: Math.max(insets.bottom, 16) + 16 },
    ],
    [insets.bottom]
  );

  const handleSheetChange = useCallback(
    (index: number): void => {
      if (index === -1 && visible) {
        onClose();
      }
    },
    [onClose, visible]
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        opacity={0.32}
      />
    ),
    []
  );

  const handleClosePress = useCallback(() => {
    sheetRef.current?.close();
  }, []);

  const handleImageError = useCallback((notificationId: string) => {
    setFailedImageIds((prev) => new Set(prev).add(notificationId));
  }, []);

  const handleAccept = useCallback(
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
            if (!notification.is_read) onMarkAsRead(notification.id);
            onClose();
            onNotificationTap(notification);
            break;
          default:
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
      onMarkAsRead,
      onClose,
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
    ]
  );

  const handleCardPress = useCallback(
    (notification: ServerNotification) => {
      const isActionable = !!ACTIONABLE_TYPES[notification.type];
      if (isActionable) {
        if (!notification.is_read) {
          onMarkAsRead(notification.id);
        }
      } else {
        onDeleteNotification(notification.id);
      }
      onClose();
      onNotificationTap(notification);
    },
    [onDeleteNotification, onMarkAsRead, onClose, onNotificationTap]
  );

  const getCategoryPillConfig = useCallback(
    (type: string) => {
      const category = getFilterCategory(type);
      const tokens = glass.notificationsSheet.categoryPill[category];
      const label = t(`notifications:categoryLabels.${category}`);
      return { ...tokens, label };
    },
    [t]
  );

  const renderAvatar = useCallback(
    (item: ServerNotification) => {
      const iconConfig = getIconConfig(item.type);
      const avatarUrl = getAvatarUrl(item.data || {});
      const initials = getInitials(item.data || {});
      const canRenderInitials = avatarUrl !== null && initials !== '?';

      return (
        <View
          style={[
            styles.avatarShell,
            {
              borderColor: item.is_read
                ? glass.notificationsSheet.avatarRing.read
                : glass.notificationsSheet.avatarRing.unread,
            },
          ]}
        >
          <View style={styles.avatarInner}>
            {avatarUrl && !failedImageIds.has(item.id) ? (
              <ImageWithFallback
                source={{ uri: String(avatarUrl).trim() }}
                style={styles.avatarImage}
                onError={() => handleImageError(item.id)}
                resizeMode="cover"
              />
            ) : canRenderInitials ? (
              <View style={styles.initialsFallback}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            ) : (
              // ORCH-0975 v1: avatar URL comes from data.inviterAvatarUrl when present.
              <View style={[styles.iconFallback, { backgroundColor: `${iconConfig.color}15` }]}>
                <Icon name={iconConfig.name} size={24} color={iconConfig.color} />
              </View>
            )}
          </View>
          {!item.is_read && <View style={styles.avatarStatusDot} />}
        </View>
      );
    },
    [failedImageIds, handleImageError]
  );

  const renderNotification = useCallback(
    ({ item }: { item: ServerNotification }) => {
      const actionConfig = ACTIONABLE_TYPES[item.type];
      const isActionable = !!actionConfig;
      const isPending = pendingActions.has(item.id);
      const hasError = actionErrors.has(item.id);
      const categoryPill = getCategoryPillConfig(item.type);
      const timeAgo = formatTimeAgo(item.created_at, t);

      return (
        <TouchableOpacity
          style={[
            styles.notificationCard,
            !item.is_read && styles.notificationCardUnread,
          ]}
          onPress={() => handleCardPress(item)}
          activeOpacity={0.85}
          disabled={isPending}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}. ${item.body}. ${item.is_read ? 'Read' : 'Unread'}. ${timeAgo} ago`}
        >
          {renderAvatar(item)}

          <View style={styles.cardContent}>
            <View style={styles.titleRow}>
              <View style={styles.titleTextWrap}>
                {renderTitleWithBoldActor(item.title, item.data || {})}
              </View>
              <Text style={styles.notificationTime}>{timeAgo}</Text>
            </View>

            {/* ORCH-0975 addendum: v1 renders body only; location-chain waits for structured data. */}
            {!!item.body && (
              <Text style={styles.notificationBody} numberOfLines={2}>
                {item.body}
              </Text>
            )}

            <View
              style={[styles.categoryPill, { backgroundColor: categoryPill.bg }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Icon name={categoryPill.icon} size={12} color={categoryPill.text} />
              <Text style={[styles.categoryPillText, { color: categoryPill.text }]}>
                {categoryPill.label}
              </Text>
            </View>

            {isActionable && !isPending && (
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.acceptButton}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    handleAccept(item);
                  }}
                  activeOpacity={0.85}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={t(`notifications:${actionConfig.acceptKey}`)}
                >
                  <Text style={styles.acceptButtonText}>
                    {t(`notifications:${actionConfig.acceptKey}`)}
                  </Text>
                </TouchableOpacity>
                {actionConfig.declineKey && (
                  <TouchableOpacity
                    style={styles.declineButton}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      handleDecline(item);
                    }}
                    activeOpacity={0.85}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={t(`notifications:${actionConfig.declineKey}`)}
                  >
                    <Text style={styles.declineButtonText}>
                      {t(`notifications:${actionConfig.declineKey}`)}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {isPending && (
              <View style={styles.pendingRow}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            )}

            {hasError && !isPending && (
              <Text style={styles.actionError}>
                {t('notifications:actions.actionFailed')}
              </Text>
            )}
          </View>

          {!item.is_read && (
            <View
              style={styles.unreadDotRight}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          )}
        </TouchableOpacity>
      );
    },
    [
      actionErrors,
      getCategoryPillConfig,
      handleAccept,
      handleCardPress,
      handleDecline,
      pendingActions,
      renderAvatar,
      t,
    ]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string; data: ServerNotification[] } }) => (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>{section.title}</Text>
      </View>
    ),
    []
  );

  const renderSkeleton = () => (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonContent}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonBody} />
            <View style={styles.skeletonPill} />
          </View>
        </View>
      ))}
    </View>
  );

  const renderBody = () => {
    if (isLoading && notifications.length === 0) return renderSkeleton();

    if (isError) {
      return (
        <View style={styles.centerState}>
          <Icon name="alert-circle-outline" size={48} color={colors.error[400]} />
          <Text style={styles.centerTitle}>{t('notifications:errorState.title')}</Text>
          <Text style={styles.centerSubtext}>{t('notifications:errorState.subtitle')}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={onRefresh}
            accessibilityRole="button"
            accessibilityLabel={t('notifications:errorState.tryAgain')}
          >
            <Text style={styles.retryButtonText}>
              {t('notifications:errorState.tryAgain')}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (notifications.length === 0 && !isOffline) {
      return (
        <View style={styles.centerState}>
          <View style={styles.emptyIconCircle}>
            <Icon name="notifications-outline" size={40} color={colors.gray[300]} />
          </View>
          <Text style={styles.centerTitle}>{t('notifications:emptyState.title')}</Text>
          <Text style={styles.centerSubtext}>
            {t('notifications:emptyState.subtitle')}
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.notificationsBody}>
        {isOffline && notifications.length > 0 && (
          <View style={styles.offlineBanner}>
            <Icon name="cloud-offline-outline" size={14} color={colors.gray[500]} />
            <Text style={styles.offlineBannerText}>
              {t('notifications:offline.banner')}
            </Text>
          </View>
        )}
        <BottomSheetSectionList
          style={styles.sectionList}
          sections={sections}
          keyExtractor={(item: ServerNotification) => item.id}
          renderItem={renderNotification}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={listContentStyle}
          onEndReached={() => {
            if (hasMore) onLoadMore?.();
          }}
          onEndReachedThreshold={0.3}
          refreshing={false}
          onRefresh={onRefresh}
        />
      </View>
    );
  };

  const showMarkAllRead = unreadCount > 0;
  const showClearAll = notifications.length > 0;
  const showActionRow = showMarkAllRead || showClearAll;

  return (
    <BottomSheet
      ref={sheetRef}
      index={sheetIndex}
      snapPoints={SHEET_SNAP_POINTS}
      enablePanDownToClose
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.sheetContent}>
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <View style={styles.headerTitleCluster}>
              <Text style={styles.headerTitle}>
                {t('notifications:header.title')}
              </Text>
              {unreadCount > 0 && (
                <View style={styles.newCountPill}>
                  <Text style={styles.newCountText}>
                    {t('notifications:header.newCount', { count: unreadCount })}
                  </Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleClosePress}
              activeOpacity={0.85}
              hitSlop={12}
              accessibilityLabel="Close notifications"
              accessibilityRole="button"
            >
              <Icon name="close" size={18} color={colors.gray[500]} />
            </TouchableOpacity>
          </View>

          <Text style={styles.headerSubtitle}>
            {t('notifications:header.subtitle')}
          </Text>

          {showActionRow && (
            <View style={styles.actionPillRow}>
              {showMarkAllRead && (
                <TouchableOpacity
                  style={styles.actionPillHalf}
                  onPress={onMarkAllRead}
                  activeOpacity={0.85}
                  accessibilityLabel={t('notifications:header.markAllRead')}
                  accessibilityHint="Marks every unread notification as read"
                  accessibilityRole="button"
                >
                  <Icon name="checkmark-done" size={16} color={colors.accent} />
                  <Text style={styles.markAllText}>
                    {t('notifications:header.markAllRead')}
                  </Text>
                </TouchableOpacity>
              )}

              {showMarkAllRead && showClearAll && <View style={styles.actionDivider} />}

              {showClearAll && (
                <TouchableOpacity
                  style={styles.actionPillHalf}
                  onPress={onClearAll}
                  activeOpacity={0.85}
                  accessibilityLabel={t('notifications:header.clearAll')}
                  accessibilityHint="Removes all notifications"
                  accessibilityRole="button"
                >
                  <Icon name="trash-outline" size={16} color={colors.gray[500]} />
                  <Text style={styles.clearAllText}>
                    {t('notifications:header.clearAll')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {renderBody()}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: glass.notificationsSheet.canvas,
    borderTopLeftRadius: glass.notificationsSheet.topRadius,
    borderTopRightRadius: glass.notificationsSheet.topRadius,
    ...glass.bottomSheet.shadow,
  },
  handleIndicator: {
    backgroundColor: glass.notificationsSheet.handle.color,
    width: glass.notificationsSheet.handle.width,
    height: glass.notificationsSheet.handle.height,
    borderRadius: glass.notificationsSheet.handle.radius,
  },
  sheetContent: {
    flex: 1,
    backgroundColor: glass.notificationsSheet.canvas,
    borderTopLeftRadius: glass.notificationsSheet.topRadius,
    borderTopRightRadius: glass.notificationsSheet.topRadius,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitleRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitleCluster: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 28,
    fontWeight: '700',
    color: colors.gray[900],
    letterSpacing: 0,
  },
  newCountPill: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(235, 120, 37, 0.10)',
  },
  newCountText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gray[100],
  },
  headerSubtitle: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: '400',
    color: colors.gray[500],
    lineHeight: 20,
  },
  actionPillRow: {
    minHeight: 52,
    marginTop: 18,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(243, 244, 246, 0.70)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionPillHalf: {
    minHeight: 24,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionDivider: {
    width: 1,
    height: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  markAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
  clearAllText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.gray[500],
  },
  notificationsBody: {
    flex: 1,
    minHeight: 0,
  },
  sectionList: {
    flex: 1,
  },
  listContent: {
    paddingTop: 0,
  },
  sectionHeader: {
    marginLeft: 20,
    marginTop: 24,
    marginBottom: 12,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(0, 0, 0, 0.42)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  notificationCard: {
    position: 'relative',
    minHeight: 88,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 16,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: glass.notificationsSheet.cardBorder,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    ...glass.notificationsSheet.cardShadow,
  },
  notificationCardUnread: {
    backgroundColor: glass.notificationsSheet.cardUnreadBg,
  },
  avatarShell: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: glass.notificationsSheet.avatarRing.width,
    padding: glass.notificationsSheet.avatarRing.gap,
    backgroundColor: '#FFFFFF',
  },
  avatarInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  initialsFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  avatarInitials: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  iconFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarStatusDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: glass.notificationsSheet.statusDot.size,
    height: glass.notificationsSheet.statusDot.size,
    borderRadius: glass.notificationsSheet.statusDot.size / 2,
    backgroundColor: glass.notificationsSheet.statusDot.color,
    borderColor: glass.notificationsSheet.statusDot.borderColor,
    borderWidth: glass.notificationsSheet.statusDot.borderWidth,
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
    paddingRight: 22,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  titleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  titleSemibold: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.gray[900],
  },
  titleBoldActor: {
    fontWeight: '700',
  },
  notificationTime: {
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '500',
    color: colors.gray[400],
  },
  notificationBody: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '400',
    color: colors.gray[600],
    lineHeight: 19,
  },
  categoryPill: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionButtons: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  acceptButton: {
    minHeight: 40,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  declineButton: {
    minHeight: 40,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.gray[100],
  },
  declineButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.gray[700],
  },
  pendingRow: {
    marginTop: 12,
    alignItems: 'flex-start',
  },
  actionError: {
    marginTop: 8,
    fontSize: 12,
    color: colors.error[500],
  },
  unreadDotRight: {
    position: 'absolute',
    top: 18,
    right: 12,
    width: glass.notificationsSheet.unreadDotRight.size,
    height: glass.notificationsSheet.unreadDotRight.size,
    borderRadius: glass.notificationsSheet.unreadDotRight.size / 2,
    backgroundColor: glass.notificationsSheet.unreadDotRight.color,
  },
  centerState: {
    flex: 1,
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(243, 244, 246, 0.60)',
  },
  centerTitle: {
    marginTop: 16,
    fontSize: 17,
    fontWeight: '600',
    color: colors.gray[800],
  },
  centerSubtext: {
    marginTop: 6,
    fontSize: 14,
    color: colors.gray[500],
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.lg,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  offlineBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.gray[100],
  },
  offlineBannerText: {
    fontSize: 13,
    color: colors.gray[600],
  },
  skeletonContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 12,
  },
  skeletonCard: {
    minHeight: 104,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: glass.notificationsSheet.cardBorder,
    backgroundColor: '#FFFFFF',
    ...glass.notificationsSheet.cardShadow,
  },
  skeletonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
  skeletonContent: {
    flex: 1,
  },
  skeletonTitle: {
    width: '70%',
    height: 14,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
  skeletonBody: {
    width: '90%',
    height: 12,
    marginTop: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
  skeletonPill: {
    width: 60,
    height: 22,
    marginTop: 10,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
});

/** @deprecated Renamed to NotificationsSheet in ORCH-0975. */
export { NotificationsSheet as NotificationsModal };

/** @deprecated See NotificationsSheetProps. */
export type NotificationsModalProps = NotificationsSheetProps;
