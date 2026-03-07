import { useState, useCallback } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useCoachMarkStore } from '../../store/coachMarkStore';
import { COACH_MARKS, TUTORIAL_SEQUENCE } from '../../constants/coachMarks';
import { TutorialPage } from '../../types/coachMark';

interface ReplayTipsScreenProps {
  onBack: () => void;
}

interface GroupData {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  page: TutorialPage;
  marks: { id: string; title: string; body: string; page: TutorialPage }[];
}

const GROUP_META: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap; page: TutorialPage }> = {
  explore: { label: 'Explore', icon: 'home-outline', page: 'home' },
  discover: { label: 'Discover', icon: 'compass-outline', page: 'discover' },
  chats: { label: 'Chats', icon: 'chatbubbles-outline', page: 'connections' },
  likes: { label: 'Likes', icon: 'heart-outline', page: 'likes' },
  board: { label: 'Boards', icon: 'people-outline', page: 'board-view' },
  profile: { label: 'Profile', icon: 'person-outline', page: 'profile' },
  action: { label: 'Actions', icon: 'flash-outline', page: 'home' },
};

function buildGroups(): GroupData[] {
  const groupOrder = ['explore', 'discover', 'chats', 'likes', 'board', 'profile', 'action'];
  const groups: GroupData[] = [];

  for (const groupKey of groupOrder) {
    const meta = GROUP_META[groupKey];
    if (!meta) continue;

    // Get marks in tutorial sequence order for this group
    const marks = TUTORIAL_SEQUENCE
      .filter(step => {
        const mark = COACH_MARKS[step.markId];
        return mark && mark.group === groupKey;
      })
      .map(step => {
        const mark = COACH_MARKS[step.markId];
        return {
          id: mark.id,
          title: mark.content.title,
          body: mark.content.body,
          page: step.page,
        };
      });

    if (marks.length > 0) {
      groups.push({
        key: groupKey,
        label: meta.label,
        icon: meta.icon,
        page: meta.page,
        marks,
      });
    }
  }

  return groups;
}

export function ReplayTipsScreen({ onBack }: ReplayTipsScreenProps) {
  const insets = useSafeAreaInsets();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const startGroupReplay = useCoachMarkStore(s => s.startGroupReplay);
  const startReplay = useCoachMarkStore(s => s.startReplay);
  const groups = buildGroups();

  const handleGroupPress = useCallback((groupKey: string) => {
    Haptics.selectionAsync();
    setExpandedGroup(prev => prev === groupKey ? null : groupKey);
  }, []);

  const handleGroupReplay = useCallback((groupKey: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    startGroupReplay(groupKey);
  }, [startGroupReplay]);

  const handleTipReplay = useCallback((markId: string, page: TutorialPage) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    startReplay(markId, page);
  }, [startReplay]);

  const renderGroup = useCallback(({ item }: { item: GroupData }) => {
    const isExpanded = expandedGroup === item.key;

    return (
      <View style={styles.groupContainer}>
        {/* Group header */}
        <Pressable
          style={styles.groupHeader}
          onPress={() => handleGroupPress(item.key)}
          accessibilityRole="button"
          accessibilityLabel={`${item.label} tips group`}
          accessibilityState={{ expanded: isExpanded }}
        >
          <View style={styles.groupHeaderLeft}>
            <View style={styles.groupIconContainer}>
              <Ionicons name={item.icon} size={20} color="#f97316" />
            </View>
            <View>
              <Text style={styles.groupLabel}>{item.label}</Text>
              <Text style={styles.groupCount}>{item.marks.length} tips</Text>
            </View>
          </View>
          <View style={styles.groupHeaderRight}>
            <Pressable
              style={styles.replayGroupButton}
              onPress={() => handleGroupReplay(item.key)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Replay all ${item.label} tips`}
            >
              <Ionicons name="play" size={14} color="#ffffff" />
              <Text style={styles.replayGroupText}>Replay</Text>
            </Pressable>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color="#9ca3af"
            />
          </View>
        </Pressable>

        {/* Expanded individual tips */}
        {isExpanded && (
          <View style={styles.tipsContainer}>
            {item.marks.map((tip, index) => (
              <Pressable
                key={tip.id}
                style={[
                  styles.tipRow,
                  index === item.marks.length - 1 && styles.tipRowLast,
                ]}
                onPress={() => handleTipReplay(tip.id, tip.page)}
                accessibilityRole="button"
                accessibilityLabel={`Replay tip: ${tip.title}`}
              >
                <View style={styles.tipContent}>
                  <Text style={styles.tipTitle} numberOfLines={1}>{tip.title}</Text>
                  <Text style={styles.tipBody} numberOfLines={2}>{tip.body}</Text>
                </View>
                <Ionicons name="play-circle-outline" size={24} color="#f97316" />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  }, [expandedGroup, handleGroupPress, handleGroupReplay, handleTipReplay]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </Pressable>
        <Text style={styles.headerTitle}>Replay Tips</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Subtitle */}
      <Text style={styles.subtitle}>
        Tap a group to see individual tips, or hit Replay to run the whole set.
      </Text>

      {/* Groups list */}
      <FlatList
        data={groups}
        renderItem={renderGroup}
        keyExtractor={item => item.key}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    paddingHorizontal: 32,
    marginBottom: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  groupContainer: {
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#f3f4f6',
    overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  groupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  groupIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#fff7ed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  groupCount: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 1,
  },
  groupHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  replayGroupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f97316',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  replayGroupText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  tipsContainer: {
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  tipRowLast: {
    borderBottomWidth: 0,
  },
  tipContent: {
    flex: 1,
    marginRight: 12,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 2,
  },
  tipBody: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 16,
  },
});
