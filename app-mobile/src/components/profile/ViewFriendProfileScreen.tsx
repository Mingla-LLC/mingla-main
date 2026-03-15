import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFriendProfile } from '../../hooks/useFriendProfile';
import { usePairedSaves } from '../../hooks/usePairedSaves';
import { usePairedUserVisits } from '../../hooks/useVisits';
import { useAppStore } from '../../store/appStore';
import { supabase } from '../../services/supabase';
import { s, vs } from '../../utils/responsive';
import { colors } from '../../constants/designSystem';
import { PriceTierSlug } from '../../constants/priceTiers';
import ProfileHeroSection from './ProfileHeroSection';
import ProfileInterestsSection from './ProfileInterestsSection';
import ProfileStatsRow from './ProfileStatsRow';
import PairedProfileSection from './PairedProfileSection';
import PersonGridCard from '../PersonGridCard';
import BilateralToggle from '../BilateralToggle';
import VisitBadge from '../VisitBadge';
import LearningToast from '../LearningToast';
import PairedSavesListScreen from '../PairedSavesListScreen';

// ── Types ───────────────────────────────────────────────────────────────────

interface ViewFriendProfileScreenProps {
  userId: string;
  onBack: () => void;
  onMessage?: (userId: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const VALID_PRICE_TIERS: Set<string> = new Set(['chill', 'comfy', 'bougie', 'lavish']);
function asPriceTier(val: string | null | undefined): PriceTierSlug | null {
  return val && VALID_PRICE_TIERS.has(val) ? (val as PriceTierSlug) : null;
}

const getBilateralKey = (pairedUserId: string) =>
  `bilateral_mode_${pairedUserId}`;

// ── PersonalizedBadge (inline) ──────────────────────────────────────────────

const PersonalizedBadge: React.FC<{ name: string }> = ({ name }) => (
  <View
    style={styles.personalizedBadge}
    accessibilityLabel={`Cards personalized based on ${name}'s preferences`}
    accessibilityRole="text"
  >
    <Ionicons name="sparkles-outline" size={s(12)} color="#eb7825" />
    <Text style={styles.personalizedBadgeText}>Tuned to {name}</Text>
  </View>
);

// ── Component ───────────────────────────────────────────────────────────────

const ViewFriendProfileScreen: React.FC<ViewFriendProfileScreenProps> = ({
  userId,
  onBack,
  onMessage,
}) => {
  const { user } = useAppStore();
  const { data: profile, isLoading, isError } = useFriendProfile(userId);

  // Pairing status
  const [isPaired, setIsPaired] = useState(false);
  const [pairingChecked, setPairingChecked] = useState(false);

  // Bilateral mode state
  const [bilateralMode, setBilateralMode] = useState<'individual' | 'bilateral'>('individual');

  // Sub-screen navigation
  const [showSavesList, setShowSavesList] = useState(false);
  const [showVisitsList, setShowVisitsList] = useState(false);

  // Toast state
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  // Check pairing status
  useEffect(() => {
    if (!user?.id || !userId) return;
    supabase
      .from('pairings')
      .select('id')
      .or(
        `and(user_a_id.eq.${user.id},user_b_id.eq.${userId}),and(user_a_id.eq.${userId},user_b_id.eq.${user.id})`,
      )
      .maybeSingle()
      .then(({ data }) => {
        setIsPaired(!!data);
        setPairingChecked(true);
      })
      .catch(() => setPairingChecked(true));
  }, [user?.id, userId]);

  // Load bilateral mode from AsyncStorage (only if paired)
  useEffect(() => {
    if (!userId || !isPaired) return;
    AsyncStorage.getItem(getBilateralKey(userId)).then((stored) => {
      if (stored === 'bilateral') setBilateralMode('bilateral');
    }).catch(() => {});
  }, [userId, isPaired]);

  // Paired saves and visits — only fetch when paired
  const {
    data: savesData,
    isLoading: savesLoading,
    isError: savesError,
  } = usePairedSaves(isPaired ? userId : undefined);

  const {
    data: visitsData,
    isLoading: visitsLoading,
    isError: visitsError,
  } = usePairedUserVisits(isPaired ? user?.id : undefined, isPaired ? userId : undefined);

  const saves = savesData?.saves ?? [];
  const visits = visitsData ?? [];

  const firstName = profile?.first_name || 'Friend';

  const handleModeChange = useCallback(
    (mode: 'individual' | 'bilateral') => {
      setBilateralMode(mode);
      AsyncStorage.setItem(getBilateralKey(userId), mode).catch(() => {});
    },
    [userId],
  );

  const handleToastDismiss = useCallback(() => setToastVisible(false), []);

  const handleRemoveFriend = () => {
    if (!profile) return;
    Alert.alert(
      'Remove Friend',
      `Are you sure you want to remove ${profile.first_name || 'this person'} as a friend?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          Alert.alert('Coming Soon', 'Friend removal from profile will be available in a future update.');
        } },
      ],
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="arrow-back" size={s(24)} color="#111827" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Profile</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  // ── Sub-screens ─────────────────────────────────────────────────────────

  if (showSavesList) {
    return (
      <PairedSavesListScreen
        title={`${firstName}'s saves`}
        items={saves.map((sv) => ({
          id: sv.id,
          title: sv.title,
          category: sv.category,
          imageUrl: sv.imageUrl,
          priceTier: asPriceTier(sv.priceTier),
          rating: sv.rating,
          timestamp: sv.savedAt,
          timestampLabel: 'Saved',
        }))}
        isLoading={savesLoading}
        onBack={() => setShowSavesList(false)}
        onCardPress={() => {}}
      />
    );
  }

  if (showVisitsList) {
    return (
      <PairedSavesListScreen
        title={`${firstName}'s been here`}
        items={visits.map((v) => ({
          id: v.id,
          title: v.cardData?.title || 'Unknown place',
          category: v.cardData?.category || '',
          imageUrl: v.cardData?.imageUrl || '',
          priceTier: asPriceTier(v.cardData?.priceTier),
          timestamp: v.visitedAt,
          timestampLabel: 'Visited',
          isVisited: true,
        }))}
        isLoading={visitsLoading}
        onBack={() => setShowVisitsList(false)}
        onCardPress={() => {}}
      />
    );
  }

  // ── Loading / Error States ──────────────────────────────────────────────

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

  const hasInterests = profile.intents.length > 0 || profile.categories.length > 0;

  // Bilateral empty state check
  const bilateralHasEnoughCards = false; // Placeholder — bilateral cards come from a different source
  const showBilateralEmpty = bilateralMode === 'bilateral' && !bilateralHasEnoughCards;

  return (
    <View style={styles.container}>
      {renderHeader()}
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <ProfileHeroSection
          isOwnProfile={false}
          firstName={profile.first_name}
          lastName={profile.last_name}
          username={profile.username}
          avatarUrl={profile.avatar_url}
          bio={profile.bio}
        />

        {hasInterests && (
          <ProfileInterestsSection
            intents={profile.intents}
            categories={profile.categories}
            isOwnProfile={false}
          />
        )}

        <ProfileStatsRow
          savedCount={profile.savedCount}
          connectionsCount={profile.connectionsCount}
          boardsCount={profile.boardsCount}
        />

        {/* ── Preference Intelligence Sections (paired only) ───────── */}

        {isPaired && (
          <>
            {/* Bilateral Toggle */}
            <BilateralToggle
              name={firstName}
              mode={bilateralMode}
              onModeChange={handleModeChange}
            />

            {/* Bilateral Empty State */}
            {showBilateralEmpty && (
              <View style={styles.bilateralEmptyContainer}>
                <Ionicons name="people-outline" size={s(40)} color={colors.gray[300]} />
                <Text style={styles.bilateralEmptyTitle}>
                  Still finding your common ground
                </Text>
                <Text style={styles.bilateralEmptyBody}>
                  The more you both swipe, the better this gets. We'll surface spots you'll both love.
                </Text>
                <TouchableOpacity
                  style={styles.bilateralFallbackButton}
                  onPress={() => handleModeChange('individual')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.bilateralFallbackText}>
                    Show {firstName}'s picks
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Saves Section */}
            {bilateralMode === 'individual' && (
              <PairedProfileSection
                title={`${firstName}'s saves`}
                subtitle="Places on their radar"
                onSeeAllPress={() => setShowSavesList(true)}
                count={saves.length}
                badgeLabel="saved"
                isLoading={savesLoading}
                isEmpty={!savesLoading && saves.length === 0 && !savesError}
                emptyTitle="Nothing saved yet"
                emptyBody="Their favorites will land here as they swipe."
                emptyIcon="bookmark-outline"
              >
                <FlatList
                  horizontal
                  data={saves.slice(0, 10)}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <PersonGridCard
                      id={item.id}
                      title={item.title}
                      category={item.category}
                      imageUrl={item.imageUrl}
                      priceTier={asPriceTier(item.priceTier)}
                      priceLevel={null}
                      onPress={() => {}}
                    />
                  )}
                  contentContainerStyle={styles.horizontalListContent}
                  showsHorizontalScrollIndicator={false}
                  ItemSeparatorComponent={() => <View style={styles.cardSeparator} />}
                />
              </PairedProfileSection>
            )}

            {/* Visits Section */}
            {bilateralMode === 'individual' && (
              <PairedProfileSection
                title={`${firstName}'s been here`}
                subtitle="The real deal \u2014 places they actually went"
                onSeeAllPress={() => setShowVisitsList(true)}
                count={visits.length}
                badgeLabel="visited"
                isLoading={visitsLoading}
                isEmpty={!visitsLoading && visits.length === 0 && !visitsError}
                emptyTitle="No visits yet"
                emptyBody="Once they start checking places off, you'll see them here."
                emptyIcon="location-outline"
              >
                <FlatList
                  horizontal
                  data={visits.slice(0, 10)}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View style={styles.visitCardContainer}>
                      <PersonGridCard
                        id={item.id}
                        title={item.cardData?.title || 'Unknown place'}
                        category={item.cardData?.category || ''}
                        imageUrl={item.cardData?.imageUrl || ''}
                        priceTier={asPriceTier(item.cardData?.priceTier)}
                        priceLevel={null}
                        onPress={() => {}}
                      />
                      <VisitBadge />
                    </View>
                  )}
                  contentContainerStyle={styles.horizontalListContent}
                  showsHorizontalScrollIndicator={false}
                  ItemSeparatorComponent={() => <View style={styles.cardSeparator} />}
                />
              </PairedProfileSection>
            )}
          </>
        )}

        {/* ── End Preference Intelligence Sections ────────────────── */}

        {onMessage && (
          <TouchableOpacity
            style={styles.messageButton}
            onPress={() => onMessage(userId)}
            activeOpacity={0.8}
          >
            <Text style={styles.messageText}>Message</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={handleRemoveFriend} style={styles.removeWrap}>
          <Text style={styles.removeText}>Remove Friend</Text>
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Learning Toast */}
      <LearningToast
        message={toastMessage}
        visible={toastVisible}
        onDismiss={handleToastDismiss}
      />
    </View>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────────

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
  removeWrap: { alignItems: 'center', marginTop: vs(16) },
  removeText: { fontSize: s(15), color: '#ef4444', fontWeight: '600' },
  bottomPadding: { height: vs(48) },

  // ── Personalized Badge ──
  personalizedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primary[50],
    borderRadius: s(999),
    paddingHorizontal: s(10),
    paddingVertical: vs(4),
    marginHorizontal: s(16),
    marginBottom: vs(8),
    gap: s(4),
  },
  personalizedBadgeText: {
    fontSize: s(11),
    fontWeight: '600',
    color: '#eb7825',
  },

  // ── Bilateral Empty State ──
  bilateralEmptyContainer: {
    alignItems: 'center',
    paddingHorizontal: s(24),
    paddingVertical: vs(32),
    marginHorizontal: s(16),
    marginTop: vs(16),
    backgroundColor: colors.gray[50],
    borderRadius: s(16),
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  bilateralEmptyTitle: {
    fontSize: s(16),
    fontWeight: '600',
    color: colors.text?.primary || '#111827',
    textAlign: 'center',
    marginTop: vs(12),
  },
  bilateralEmptyBody: {
    fontSize: s(13),
    color: colors.text?.tertiary || '#6b7280',
    textAlign: 'center',
    marginTop: vs(6),
    lineHeight: s(18),
    marginBottom: vs(16),
  },
  bilateralFallbackButton: {
    backgroundColor: '#eb7825',
    borderRadius: s(12),
    paddingVertical: vs(10),
    paddingHorizontal: s(20),
  },
  bilateralFallbackText: {
    fontSize: s(14),
    fontWeight: '600',
    color: '#ffffff',
  },

  // ── Horizontal Lists ──
  horizontalListContent: {
    paddingRight: s(16),
  },
  cardSeparator: {
    width: s(12),
  },
  visitCardContainer: {
    position: 'relative',
  },
});

export default ViewFriendProfileScreen;
