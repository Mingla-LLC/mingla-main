import React, { useState, useCallback } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { Icon } from './ui/Icon';
import { colors, spacing, radius, typography, fontWeights } from '../constants/designSystem';
import { useFeedbackHistory } from '../hooks/useBetaFeedback';
import { betaFeedbackService, type BetaFeedback, type FeedbackCategory } from '../services/betaFeedbackService';

// ── Types ───────────────────────────────────────────────────────────────────

interface FeedbackHistorySheetProps {
  visible: boolean;
  onClose: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  feature_request: 'Feature',
  ux_issue: 'UX Issue',
  general: 'General',
};

const CATEGORY_COLORS: Record<FeedbackCategory, string> = {
  bug: colors.error[500],
  feature_request: colors.primary[500],
  ux_issue: colors.warning[500],
  general: colors.gray[500],
};

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  actioned: 'Actioned',
  dismissed: 'Dismissed',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// ── Item Component ──────────────────────────────────────────────────────────

function FeedbackItem({ item }: { item: BetaFeedback }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [sound, setSound] = useState<Audio.Sound | null>(null);

  const togglePlayback = useCallback(async () => {
    if (isPlaying && sound) {
      await sound.pauseAsync();
      setIsPlaying(false);
      return;
    }

    if (sound) {
      await sound.playAsync();
      setIsPlaying(true);
      return;
    }

    setIsLoadingAudio(true);
    try {
      const url = await betaFeedbackService.getFeedbackAudioUrl(item.audio_path);
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
          }
        },
      );
      setSound(newSound);
      setIsPlaying(true);
    } catch (error) {
      console.error('[FeedbackHistory] Playback error:', error);
    } finally {
      setIsLoadingAudio(false);
    }
  }, [isPlaying, sound, item.audio_path]);

  // Cleanup sound on unmount
  React.useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync().catch(() => {});
      }
    };
  }, [sound]);

  const catColor = CATEGORY_COLORS[item.category] ?? colors.gray[500];

  return (
    <View style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <View style={[styles.categoryBadge, { backgroundColor: catColor + '18' }]}>
          <Text style={[styles.categoryBadgeText, { color: catColor }]}>
            {CATEGORY_LABELS[item.category] ?? item.category}
          </Text>
        </View>
        <Text style={styles.itemDate}>{formatDate(item.created_at)}</Text>
      </View>

      <View style={styles.itemMeta}>
        <Text style={styles.itemDuration}>{formatDuration(item.audio_duration_ms)}</Text>
        <View style={[styles.statusDot, { backgroundColor: item.status === 'new' ? colors.primary[400] : colors.gray[300] }]} />
        <Text style={styles.itemStatus}>{STATUS_LABELS[item.status] ?? item.status}</Text>
      </View>

      <TouchableOpacity style={styles.playRow} onPress={togglePlayback} disabled={isLoadingAudio} activeOpacity={0.7}>
        {isLoadingAudio ? (
          <ActivityIndicator size="small" color={colors.primary[500]} />
        ) : (
          <Icon name={isPlaying ? 'pause' : 'play'} size={18} color={colors.primary[500]} />
        )}
        <Text style={styles.playLabel}>{isPlaying ? 'Pause' : 'Play recording'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function FeedbackHistorySheet({ visible, onClose }: FeedbackHistorySheetProps) {
  const insets = useSafeAreaInsets();
  const { data: history, isLoading, isError } = useFeedbackHistory();

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="chatbubble-outline" size={40} color={colors.gray[300]} />
      <Text style={styles.emptyText}>No feedback submitted yet</Text>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
          onPress={() => {}}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Feedback History</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <Icon name="close" size={24} color={colors.gray[400]} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Content */}
          {isLoading ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="large" color={colors.primary[500]} />
            </View>
          ) : isError ? (
            <View style={styles.emptyContainer}>
              <Icon name="alert-circle" size={40} color={colors.error[400]} />
              <Text style={styles.emptyText}>Failed to load history</Text>
            </View>
          ) : (
            <FlatList
              data={history ?? []}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => <FeedbackItem item={item} />}
              ListEmptyComponent={renderEmpty}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background.primary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '75%',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray[300],
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  headerTitle: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },

  // List
  listContent: {
    paddingBottom: spacing.md,
  },

  // Item
  itemCard: {
    backgroundColor: colors.background.secondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  categoryBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  categoryBadgeText: {
    ...typography.xs,
    fontWeight: fontWeights.semibold,
  },
  itemDate: {
    ...typography.xs,
    color: colors.text.tertiary,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  itemDuration: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  itemStatus: {
    ...typography.xs,
    color: colors.text.tertiary,
  },
  playRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  playLabel: {
    ...typography.sm,
    color: colors.primary[500],
    fontWeight: fontWeights.medium,
  },

  // Empty
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  emptyText: {
    ...typography.md,
    color: colors.text.tertiary,
  },
});
