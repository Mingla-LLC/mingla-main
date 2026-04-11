import React, { useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Pencil, Sparkles } from 'lucide-react-native';
import { ONBOARDING_INTENTS } from '../../types/onboarding';
import { categories as allCategories } from '../../constants/categories';
import { INTENT_ICON_MAP, CATEGORY_ICON_MAP } from '../../constants/interestIcons';
import { useTranslation } from 'react-i18next';

interface ProfileInterestsSectionProps {
  intents: string[];
  categories: string[];
  isOwnProfile: boolean;
  onEditPress?: () => void;
  /** Overrides default header ("Your Interests" / "Interests"). */
  sectionTitle?: string;
}

const STAGGER_DELAY = 30;
const PILL_DURATION = 200;

const ProfileInterestsSection: React.FC<ProfileInterestsSectionProps> = ({
  intents,
  categories,
  isOwnProfile,
  onEditPress,
  sectionTitle,
}) => {
  const { t } = useTranslation(['profile', 'common']);
  const hasInterests = intents.length > 0 || categories.length > 0;
  const headerTitle = sectionTitle ?? (isOwnProfile ? 'Your Interests' : 'Interests');
  const intentData = ONBOARDING_INTENTS.filter((i) => intents.includes(i.id));
  const categoryData = allCategories.filter((c) => categories.includes(c.name));
  const totalPills = intentData.length + categoryData.length;

  // Stable dep keys — avoids calling .join() inside the useEffect dep array
  const intentsKey = useMemo(() => intents.join(','), [intents]);
  const categoriesKey = useMemo(() => categories.join(','), [categories]);

  // Stagger animation refs
  const pillAnims = useRef<Animated.Value[]>([]);
  const pillTranslates = useRef<Animated.Value[]>([]);

  // Initialize animation values when pill count changes
  useEffect(() => {
    if (totalPills === 0) return;
    pillAnims.current = Array.from({ length: totalPills }, () => new Animated.Value(0));
    pillTranslates.current = Array.from({ length: totalPills }, () => new Animated.Value(8));

    const animations = pillAnims.current.map((anim, i) =>
      Animated.parallel([
        Animated.timing(anim, {
          toValue: 1,
          duration: PILL_DURATION,
          delay: i * STAGGER_DELAY,
          useNativeDriver: true,
        }),
        Animated.timing(pillTranslates.current[i], {
          toValue: 0,
          duration: PILL_DURATION,
          delay: i * STAGGER_DELAY,
          useNativeDriver: true,
        }),
      ])
    );
    Animated.parallel(animations).start();
  }, [intentsKey, categoriesKey, totalPills]);

  if (!hasInterests && !isOwnProfile) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{headerTitle}</Text>
        </View>
        <Text style={styles.friendInterestsEmpty}>Not shared</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{headerTitle}</Text>
        {isOwnProfile && (
          <TrackedTouchableOpacity
            logComponent="ProfileInterestsSection"
            onPress={onEditPress}
            style={styles.editButton}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityLabel={t('profile:interests.edit_accessibility')}
            accessibilityRole="button"
          >
            <Pencil size={14} color="#6b7280" strokeWidth={2.5} />
          </TrackedTouchableOpacity>
        )}
      </View>

      {!hasInterests && isOwnProfile ? (
        <TrackedTouchableOpacity
          logComponent="ProfileInterestsSection"
          onPress={onEditPress}
          style={styles.emptyState}
          activeOpacity={0.8}
        >
          <Sparkles size={24} color="#eb7825" strokeWidth={2} />
          <Text style={styles.emptyText}>
            Tell us what you're into — it helps us find your next favorite thing.
          </Text>
          <View style={styles.addButton}>
            <Text style={styles.addButtonText}>Add Interests</Text>
          </View>
        </TrackedTouchableOpacity>
      ) : (
        <View style={styles.pillsWrap}>
          {intentData.map((intent, i) => {
            const opacity = pillAnims.current[i] || new Animated.Value(1);
            const translateY = pillTranslates.current[i] || new Animated.Value(0);
            const IconComponent = INTENT_ICON_MAP[intent.id];
            return (
              <Animated.View
                key={intent.id}
                style={[styles.intentPillWrap, { opacity, transform: [{ translateY }] }]}
              >
                <LinearGradient
                  colors={['#eb7825', '#f5a623']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.intentPill}
                >
                  {IconComponent && (
                    <IconComponent size={14} color="#ffffff" strokeWidth={2.5} />
                  )}
                  <Text style={styles.intentText}>{intent.label}</Text>
                </LinearGradient>
              </Animated.View>
            );
          })}
          {categoryData.map((cat, i) => {
            const idx = intentData.length + i;
            const opacity = pillAnims.current[idx] || new Animated.Value(1);
            const translateY = pillTranslates.current[idx] || new Animated.Value(0);
            const CatIcon = CATEGORY_ICON_MAP[cat.slug];
            return (
              <Animated.View
                key={cat.slug}
                style={[styles.categoryPillWrap, { opacity, transform: [{ translateY }] }]}
              >
                <View style={styles.categoryPill}>
                  {CatIcon && (
                    <CatIcon size={14} color="#374151" strokeWidth={2} />
                  )}
                  <Text style={styles.categoryText}>{t(`common:category_${cat.slug}`)}</Text>
                </View>
              </Animated.View>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  friendInterestsEmpty: {
    fontSize: 15,
    color: '#6b7280',
    marginBottom: 8,
  },
  editButton: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center',
  },
  // Empty state
  emptyState: {
    borderWidth: 1.5, borderColor: '#d1d5db', borderStyle: 'dashed',
    borderRadius: 16, paddingVertical: 24, paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 8,
    lineHeight: 20,
  },
  addButton: {
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#eb7825', borderRadius: 999, marginTop: 12,
  },
  addButtonText: { fontSize: 14, fontWeight: '600', color: '#ffffff' },
  // Pills
  pillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  intentPillWrap: {},
  intentPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 3, elevation: 2,
  },
  intentText: {
    fontSize: 13, fontWeight: '600', color: '#ffffff', letterSpacing: 0.2,
  },
  categoryPillWrap: {},
  categoryPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: '#e5e7eb',
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 2, elevation: 1,
  },
  categoryText: { fontSize: 13, fontWeight: '500', color: '#374151' },
});

export default ProfileInterestsSection;
