import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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

const ProfileInterestsSection: React.FC<ProfileInterestsSectionProps> = ({
  intents,
  categories,
  isOwnProfile,
  onEditPress,
}) => {
  const hasInterests = intents.length > 0 || categories.length > 0;

  if (!hasInterests && !isOwnProfile) return null;

  const intentData = ONBOARDING_INTENTS.filter((i) => intents.includes(i.id));
  const categoryData = allCategories.filter((c) => categories.includes(c.name));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Interests</Text>
        {isOwnProfile && (
          <TrackedTouchableOpacity logComponent="ProfileInterestsSection" onPress={onEditPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="pencil" size={18} color="#6b7280" />
          </TrackedTouchableOpacity>
        )}
      </View>

      {!hasInterests && isOwnProfile ? (
        <TrackedTouchableOpacity logComponent="ProfileInterestsSection" onPress={onEditPress}>
          <Text style={styles.placeholder}>Add your interests</Text>
        </TrackedTouchableOpacity>
      ) : (
        <View style={styles.pillsWrap}>
          {intentData.map((intent) => (
            <View key={intent.id} style={styles.intentPill}>
              <Text style={styles.intentText}>{intent.label}</Text>
            </View>
          ))}
          {categoryData.map((cat) => (
            <View key={cat.slug} style={styles.categoryPill}>
              <Text style={styles.categoryText}>{cat.icon} {cat.name}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, marginTop: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '700', color: '#111827' },
  placeholder: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic' },
  pillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  intentPill: {
    backgroundColor: '#eb7825',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  intentText: { fontSize: 12, color: '#ffffff', fontWeight: '600' },
  categoryPill: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryText: { fontSize: 12, color: '#374151' },
});

export default ProfileInterestsSection;
