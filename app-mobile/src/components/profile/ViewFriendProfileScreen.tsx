import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../ui/Icon';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import { useFriendProfile } from '../../hooks/useFriendProfile';
import { s, vs } from '../../utils/responsive';
import { getCountryByCode } from '../../constants/countries';
import ProfileInterestsSection from './ProfileInterestsSection';
import ProfileStatsRow from './ProfileStatsRow';
import type { SubscriptionTier } from '../../types/subscription';
import { useTranslation } from 'react-i18next';

const TIER_LABEL: Record<SubscriptionTier, string> = {
  free: 'Free',
  mingla_plus: 'Mingla+',
};

const TIER_BADGE_STYLES: Record<
  SubscriptionTier,
  { bg: string; text: string; border: string }
> = {
  free: { bg: '#f3f4f6', text: '#4b5563', border: '#e5e7eb' },
  mingla_plus: { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
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

function getInitials(first: string | null, last: string | null, username: string | null): string {
  const f = first?.charAt(0)?.toUpperCase() ?? '';
  const l = last?.charAt(0)?.toUpperCase() ?? '';
  if (f || l) return `${f}${l}`;
  const u = username?.charAt(0)?.toUpperCase();
  return u || '?';
}

function InfoRow({
  icon,
  label,
  value,
  muted,
  rightSlot,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  value?: string;
  muted?: boolean;
  rightSlot?: React.ReactNode;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIconCircle}>
        <Icon name={icon} size={s(20)} color="#eb7825" />
      </View>
      <View style={styles.infoRowText}>
        <Text style={styles.infoRowLabel}>{label}</Text>
        {rightSlot ?? (
          <Text style={[styles.infoRowValue, muted && styles.infoRowValueMuted]} numberOfLines={2}>
            {value}
          </Text>
        )}
      </View>
    </View>
  );
}

const ViewFriendProfileScreen: React.FC<ViewFriendProfileScreenProps> = ({
  userId,
  onBack,
  onMessage,
}) => {
  const { t } = useTranslation(['profile', 'common']);
  const insets = useSafeAreaInsets();
  const { data: profile, isLoading, isError } = useFriendProfile(userId);

  const headerTop = insets.top + vs(8);

  const renderBack = () => (
    <TouchableOpacity
      onPress={onBack}
      style={[styles.backButton, { top: headerTop }]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={t('common:go_back')}
    >
      <View style={styles.backButtonInner}>
        <Icon name="arrow-back" size={s(22)} color="#111827" />
      </View>
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.heroWrap}>
          <LinearGradient
            colors={['#fef3e2', '#fef9f3', '#ffffff']}
            locations={[0, 0.45, 1]}
            style={{ width: '100%', height: vs(200) + insets.top }}
          />
          {renderBack()}
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#eb7825" />
          <Text style={styles.loadingHint}>{t('profile:friend.loading_profile')}</Text>
        </View>
      </View>
    );
  }

  if (isError || !profile) {
    return (
      <View style={styles.container}>
        <View style={styles.heroWrap}>
          <LinearGradient
            colors={['#fef3e2', '#fef9f3', '#ffffff']}
            locations={[0, 0.45, 1]}
            style={{ width: '100%', height: vs(160) + insets.top }}
          />
          {renderBack()}
        </View>
        <View style={styles.centered}>
          <View style={styles.errorIconWrap}>
            <Icon name="person-outline" size={s(40)} color="#d1d5db" />
          </View>
          <Text style={styles.errorTitle}>{t('profile:friend.profile_unavailable_title')}</Text>
          <Text style={styles.errorBody}>
            {t('profile:friend.profile_unavailable_body')}
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onBack} activeOpacity={0.85}>
            <Text style={styles.primaryButtonText}>{t('common:go_back')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const name = displayName(profile.first_name, profile.last_name, profile.username);
  const countryName = profile.country
    ? getCountryByCode(profile.country)?.name ?? profile.country
    : null;
  const locationLine = profile.location ?? countryName ?? t('profile:friend.not_shared');
  const levelLine = TIER_LABEL[profile.tier] ?? profile.tier;
  const tierBadge = TIER_BADGE_STYLES[profile.tier] ?? TIER_BADGE_STYLES.free;
  const locationMuted = locationLine === t('profile:friend.not_shared');

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroWrap}>
          <LinearGradient
            colors={['#fef3e2', '#fef9f3', '#ffffff']}
            locations={[0, 0.35, 1]}
            style={{ width: '100%', height: vs(152) + insets.top }}
          />
          {renderBack()}

          <View style={[styles.avatarBlock, { marginTop: -vs(54) }]}>
            <View style={styles.avatarRing}>
              {profile.avatar_url ? (
                <ImageWithFallback source={{ uri: profile.avatar_url }} style={styles.avatar} />
              ) : (
                <LinearGradient
                  colors={['#eb7825', '#f5a623']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.avatar}
                >
                  <Text style={styles.avatarInitials}>
                    {getInitials(profile.first_name, profile.last_name, profile.username)}
                  </Text>
                </LinearGradient>
              )}
            </View>
            <Text style={styles.displayName}>{name}</Text>
            {profile.bio ? (
              <Text style={styles.bioText} numberOfLines={3}>{profile.bio}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardSectionLabel}>{t('profile:friend.about')}</Text>
          <InfoRow
            icon="map-pin"
            label={t('profile:friend.location_label')}
            value={locationLine}
            muted={locationMuted}
          />
          <View style={styles.rowDivider} />
          <InfoRow
            icon="sparkles-outline"
            label={t('profile:friend.mingla_level')}
            rightSlot={
              <View
                style={[
                  styles.tierPill,
                  {
                    backgroundColor: tierBadge.bg,
                    borderColor: tierBadge.border,
                  },
                ]}
              >
                <Text style={[styles.tierPillText, { color: tierBadge.text }]}>{levelLine}</Text>
              </View>
            }
          />
        </View>

        <View style={styles.statsWrap}>
          <ProfileStatsRow
            savedCount={0}
            connectionsCount={profile.friendCount}
            scheduledCount={0}
            placesVisited={0}
            streakDays={0}
            level={1}
            levelProgress={0}
          />
        </View>

        <View style={styles.interestsWrap}>
          <ProfileInterestsSection
            intents={profile.intents}
            categories={profile.categories}
            isOwnProfile={false}
            sectionTitle={t('profile:friend.interests')}
          />
        </View>

        {onMessage && profile.isFriend ? (
          <TouchableOpacity
            style={styles.messageButton}
            onPress={() => onMessage(userId)}
            activeOpacity={0.88}
          >
            <Icon name="chatbubble-outline" size={s(20)} color="#ffffff" />
            <Text style={styles.messageText}>{t('profile:friend.message')}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={{ height: vs(40) + insets.bottom }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  heroWrap: {
    width: '100%',
    position: 'relative',
  },
  backButton: {
    position: 'absolute',
    left: s(16),
    zIndex: 2,
  },
  backButtonInner: {
    width: s(42),
    height: s(42),
    borderRadius: s(21),
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: vs(8) },
  avatarBlock: {
    alignItems: 'center',
    paddingHorizontal: s(24),
    marginBottom: vs(8),
  },
  avatarRing: {
    padding: s(4),
    borderRadius: s(60),
    backgroundColor: '#ffffff',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
    }),
  },
  avatar: {
    width: s(104),
    height: s(104),
    borderRadius: s(52),
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarInitials: {
    fontSize: s(36),
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  displayName: {
    marginTop: vs(14),
    fontSize: s(26),
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  bioText: {
    fontSize: s(15),
    color: '#374151',
    textAlign: 'center',
    marginTop: vs(8),
    paddingHorizontal: s(24),
    lineHeight: s(22),
  },
  card: {
    marginHorizontal: s(20),
    marginTop: vs(12),
    backgroundColor: '#ffffff',
    borderRadius: s(20),
    paddingHorizontal: s(18),
    paddingTop: vs(18),
    paddingBottom: vs(10),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      },
      android: { elevation: 2 },
    }),
  },
  cardSectionLabel: {
    fontSize: s(13),
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: vs(14),
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: vs(12),
  },
  infoIconCircle: {
    width: s(44),
    height: s(44),
    borderRadius: s(22),
    backgroundColor: '#fff7ed',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: s(14),
  },
  infoRowText: {
    flex: 1,
    justifyContent: 'center',
    minHeight: s(44),
    paddingTop: vs(2),
  },
  infoRowLabel: {
    fontSize: s(12),
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: vs(4),
  },
  infoRowValue: {
    fontSize: s(16),
    fontWeight: '600',
    color: '#111827',
    lineHeight: s(22),
  },
  infoRowValueMuted: {
    color: '#9ca3af',
    fontWeight: '500',
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#f3f4f6',
    marginLeft: s(44) + s(14),
  },
  tierPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: s(12),
    paddingVertical: vs(6),
    borderRadius: s(999),
    borderWidth: 1,
  },
  tierPillText: {
    fontSize: s(14),
    fontWeight: '700',
  },
  statsWrap: {
    marginTop: vs(16),
  },
  interestsWrap: {
    marginTop: vs(22),
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(10),
    backgroundColor: '#eb7825',
    borderRadius: s(16),
    paddingVertical: vs(16),
    marginHorizontal: s(20),
    marginTop: vs(28),
    ...Platform.select({
      ios: {
        shadowColor: '#eb7825',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  messageText: { fontSize: s(16), fontWeight: '700', color: '#ffffff' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(32),
    paddingTop: vs(24),
  },
  loadingHint: {
    marginTop: vs(14),
    fontSize: s(15),
    color: '#6b7280',
    fontWeight: '500',
  },
  errorIconWrap: {
    width: s(88),
    height: s(88),
    borderRadius: s(44),
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: vs(16),
  },
  errorTitle: {
    fontSize: s(19),
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  errorBody: {
    fontSize: s(15),
    color: '#6b7280',
    textAlign: 'center',
    marginTop: vs(10),
    lineHeight: s(22),
    maxWidth: s(300),
  },
  primaryButton: {
    backgroundColor: '#eb7825',
    borderRadius: s(14),
    paddingVertical: vs(14),
    paddingHorizontal: s(36),
    marginTop: vs(28),
  },
  primaryButtonText: { fontSize: s(16), fontWeight: '700', color: '#ffffff' },
});

export default ViewFriendProfileScreen;
