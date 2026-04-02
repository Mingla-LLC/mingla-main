import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { useFriendProfile } from '../../hooks/useFriendProfile';
import { s, vs } from '../../utils/responsive';
import { getCountryByCode } from '../../constants/countries';
import ProfileInterestsSection from './ProfileInterestsSection';
import type { SubscriptionTier } from '../../types/subscription';

const TIER_LABEL: Record<SubscriptionTier, string> = {
  free: 'Free',
  pro: 'Pro',
  elite: 'Elite',
};

interface ViewFriendProfileScreenProps {
  userId: string;
  onBack: () => void;
  onMessage?: (userId: string) => void;
}

function displayName(
  first: string | null,
  last: string | null,
  username: string | null,
): string {
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (username) return `@${username.replace(/^@/, '')}`;
  return 'Friend';
}

const ViewFriendProfileScreen: React.FC<ViewFriendProfileScreenProps> = ({
  userId,
  onBack,
  onMessage,
}) => {
  const { data: profile, isLoading, isError } = useFriendProfile(userId);

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Icon name="arrow-back" size={s(24)} color="#111827" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Profile</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#eb7825" />
        </View>
      </View>
    );
  }

  if (isError || !profile) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>This profile isn't available</Text>
          <Text style={styles.errorBody}>
            This person's profile may be private, or you may not be connected.
          </Text>
          <TouchableOpacity style={styles.goBackButton} onPress={onBack} activeOpacity={0.8}>
            <Text style={styles.goBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const name = displayName(profile.first_name, profile.last_name, profile.username);
  const phoneLine = profile.phone?.trim() ? profile.phone : 'Not shared';
  const countryName = profile.country
    ? getCountryByCode(profile.country)?.name ?? profile.country
    : null;
  const locationLine = countryName ?? 'Not shared';
  const levelLine = TIER_LABEL[profile.tier] ?? profile.tier;

  return (
    <View style={styles.container}>
      {renderHeader()}
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.name}>{name}</Text>

        <View style={styles.infoBlock}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Phone</Text>
            <Text style={styles.infoValue}>{phoneLine}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Location</Text>
            <Text style={styles.infoValue}>{locationLine}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Level</Text>
            <Text style={styles.infoValue}>{levelLine}</Text>
          </View>
        </View>

        <View style={styles.interestsWrap}>
          <ProfileInterestsSection
            intents={profile.intents}
            categories={profile.categories}
            isOwnProfile={false}
            sectionTitle="Interests"
          />
        </View>

        {onMessage ? (
          <TouchableOpacity
            style={styles.messageButton}
            onPress={() => onMessage(userId)}
            activeOpacity={0.8}
          >
            <Text style={styles.messageText}>Message</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: vs(48),
    paddingHorizontal: s(24),
    paddingBottom: vs(12),
    backgroundColor: '#ffffff',
  },
  headerTitle: { flex: 1, fontSize: s(18), fontWeight: '700', color: '#111827', textAlign: 'center' },
  headerSpacer: { width: s(24) },
  scroll: { flex: 1 },
  name: {
    fontSize: s(26),
    fontWeight: '700',
    color: '#111827',
    paddingHorizontal: s(24),
    marginBottom: vs(20),
  },
  infoBlock: {
    paddingHorizontal: s(24),
    gap: vs(16),
    marginBottom: vs(8),
  },
  infoRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    paddingBottom: vs(12),
  },
  infoLabel: {
    fontSize: s(12),
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: vs(4),
  },
  infoValue: {
    fontSize: s(16),
    fontWeight: '500',
    color: '#111827',
  },
  interestsWrap: {
    marginTop: vs(8),
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: s(32) },
  errorTitle: { fontSize: s(18), fontWeight: '700', color: '#111827', textAlign: 'center' },
  errorBody: {
    fontSize: s(14),
    color: '#6b7280',
    textAlign: 'center',
    marginTop: vs(8),
    lineHeight: s(20),
  },
  goBackButton: {
    backgroundColor: '#eb7825',
    borderRadius: s(12),
    paddingVertical: vs(14),
    paddingHorizontal: s(40),
    marginTop: vs(24),
  },
  goBackText: { fontSize: s(16), fontWeight: '700', color: '#ffffff' },
  messageButton: {
    backgroundColor: '#eb7825',
    borderRadius: s(12),
    paddingVertical: vs(16),
    marginHorizontal: s(24),
    alignItems: 'center',
    marginTop: vs(24),
  },
  messageText: { fontSize: s(16), fontWeight: '700', color: '#ffffff' },
  bottomPadding: { height: vs(48) },
});

export default ViewFriendProfileScreen;
