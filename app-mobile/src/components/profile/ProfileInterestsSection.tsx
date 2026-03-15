import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Ionicons } from '@expo/vector-icons';
import { ONBOARDING_INTENTS } from '../../types/onboarding';
import { categories as allCategories } from '../../constants/categories';

interface ProfileInterestsSectionProps {
  intents: string[];
  categories: string[];
  isOwnProfile: boolean;
  onEditPress?: () => void;
}

const STAGGER_DELAY = 30;
const PILL_DURATION = 200;

const ProfileInterestsSection: React.FC<ProfileInterestsSectionProps> = ({
  intents,
  categories,
  isOwnProfile,
  onEditPress,
}) => {
  const hasInterests = intents.length > 0 || categories.length > 0;
  const intentData = ONBOARDING_INTENTS.filter((i) => intents.includes(i.id));
  const categoryData = allCategories.filter((c) => categories.includes(c.name));
  const totalPills = intentData.length + categoryData.length;

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
  }, [intents.join(','), categories.join(',')]);

  if (!hasInterests && !isOwnProfile) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Interests</Text>
        {isOwnProfile && (
          <TrackedTouchableOpacity
            logComponent="ProfileInterestsSection"
            onPress={onEditPress}
            style={styles.editButton}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityLabel="Edit your interests"
            accessibilityRole="button"
          >
            <Ionicons name="pencil" size={14} color="#6b7280" />
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
          <Ionicons name="sparkles" size={24} color="#eb7825" />
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
                  <Text style={styles.intentText}>{intent.label}</Text>
                </LinearGradient>
              </Animated.View>
            );
          })}
          {categoryData.map((cat, i) => {
            const idx = intentData.length + i;
            const opacity = pillAnims.current[idx] || new Animated.Value(1);
            const translateY = pillTranslates.current[idx] || new Animated.Value(0);
            return (
              <Animated.View
                key={cat.slug}
                style={[styles.categoryPillWrap, { opacity, transform: [{ translateY }] }]}
              >
                <View style={styles.categoryPill}>
                  <Text style={styles.categoryEmoji}>{cat.icon}</Text>
                  <Text style={styles.categoryText}>{cat.name}</Text>
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
  categoryEmoji: { fontSize: 14 },
  categoryText: { fontSize: 13, fontWeight: '500', color: '#374151' },
});

export default ProfileInterestsSection;
