import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { s, vs, SCREEN_WIDTH } from '../../utils/responsive';
import { colors } from '../../constants/designSystem';
import { PERSON_GRID_CARD_WIDTH } from '../PersonGridCard';

interface PairedProfileSectionProps {
  title: string;
  subtitle: string;
  onSeeAllPress: () => void;
  children: React.ReactNode;
  count?: number;
  badgeLabel?: string;
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  emptyIcon?: string;
}

// ── Skeleton Card ───────────────────────────────────────────────────────

const SkeletonCard: React.FC = () => {
  const opacity = React.useRef(new Animated.Value(0.3)).current;

  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View style={[styles.skeletonCard, { opacity }]}>
      <View style={styles.skeletonImage} />
      <View style={styles.skeletonContent}>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonSubtitle} />
      </View>
    </Animated.View>
  );
};

// ── Empty State ─────────────────────────────────────────────────────────

const EmptyState: React.FC<{
  title?: string;
  body?: string;
  icon?: string;
}> = ({ title, body, icon }) => (
  <View style={styles.emptyContainer}>
    {icon && (
      <Icon
        name={icon}
        size={s(32)}
        color={colors.gray[300]}
      />
    )}
    {title && <Text style={styles.emptyTitle}>{title}</Text>}
    {body && <Text style={styles.emptyBody}>{body}</Text>}
  </View>
);

// ── Main Component ──────────────────────────────────────────────────────

const PairedProfileSection: React.FC<PairedProfileSectionProps> = ({
  title,
  subtitle,
  onSeeAllPress,
  children,
  count,
  badgeLabel,
  isLoading,
  isEmpty,
  emptyTitle,
  emptyBody,
  emptyIcon,
}) => {
  return (
    <View style={styles.container}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>{title}</Text>
          {count !== undefined && count > 0 && badgeLabel && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>
                {count} {badgeLabel}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          onPress={onSeeAllPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.seeAllButton}
        >
          <Text style={styles.seeAllText}>See all</Text>
          <Icon name="arrow-forward" size={s(14)} color={'#eb7825'} />
        </TouchableOpacity>
      </View>

      {/* Subtitle */}
      <Text style={styles.subtitle}>{subtitle}</Text>

      {/* Content */}
      {isLoading ? (
        <FlatList
          horizontal
          data={[1, 2, 3]}
          keyExtractor={(item) => String(item)}
          renderItem={() => <SkeletonCard />}
          contentContainerStyle={styles.listContent}
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      ) : isEmpty ? (
        <EmptyState title={emptyTitle} body={emptyBody} icon={emptyIcon} />
      ) : (
        children
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: vs(24),
    paddingHorizontal: s(16),
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  title: {
    fontSize: s(18),
    fontWeight: '700',
    color: colors.gray[900],
  },
  countBadge: {
    backgroundColor: colors.gray[100],
    borderRadius: s(10),
    paddingHorizontal: s(8),
    paddingVertical: s(2),
  },
  countBadgeText: {
    fontSize: s(12),
    fontWeight: '500',
    color: colors.gray[500],
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  seeAllText: {
    fontSize: s(14),
    fontWeight: '600',
    color: '#eb7825',
  },
  subtitle: {
    fontSize: s(13),
    color: colors.gray[500],
    marginTop: vs(4),
    marginBottom: vs(12),
  },
  listContent: {
    paddingRight: s(24),
  },
  separator: {
    width: s(12),
  },
  // Skeleton
  skeletonCard: {
    width: PERSON_GRID_CARD_WIDTH,
    height: s(240),
    borderRadius: s(16),
    backgroundColor: colors.gray[100],
    overflow: 'hidden',
  },
  skeletonImage: {
    width: '100%',
    height: s(130),
    backgroundColor: colors.gray[200],
  },
  skeletonContent: {
    padding: s(12),
    gap: s(8),
  },
  skeletonTitle: {
    width: '80%',
    height: s(14),
    borderRadius: s(4),
    backgroundColor: colors.gray[200],
  },
  skeletonSubtitle: {
    width: '50%',
    height: s(12),
    borderRadius: s(4),
    backgroundColor: colors.gray[200],
  },
  // Empty
  emptyContainer: {
    width: PERSON_GRID_CARD_WIDTH,
    height: s(240),
    borderRadius: s(16),
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(16),
  },
  emptyTitle: {
    fontSize: s(14),
    fontWeight: '600',
    color: colors.gray[500],
    textAlign: 'center',
    marginTop: vs(8),
  },
  emptyBody: {
    fontSize: s(12),
    color: colors.gray[400],
    textAlign: 'center',
    marginTop: vs(4),
    lineHeight: s(16),
  },
});

export default PairedProfileSection;
