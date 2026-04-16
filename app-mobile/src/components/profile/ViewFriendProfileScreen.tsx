import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Icon } from '../ui/Icon';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import { useFriendProfile } from '../../hooks/useFriendProfile';
import { s, vs } from '../../utils/responsive';
import { getCountryByCode } from '../../constants/countries';
import type { SubscriptionTier } from '../../types/subscription';
import { useTranslation } from 'react-i18next';

// ORCH-0435: Pairing + PersonHolidayView
import { usePairingPills } from '../../hooks/usePairings';
import { useAppStore } from '../../store/appStore';
import { useUserLocation } from '../../hooks/useUserLocation';
import PersonHolidayView from '../PersonHolidayView';
import ExpandedCardModal from '../ExpandedCardModal';
import CustomHolidayModal from '../CustomHolidayModal';
import { getSharedCustomHolidaysByPairing, createCustomHolidayForPairing, deleteCustomHoliday as deleteCustomHolidayFromDb } from '../../services/customHolidayService';
import { savedCardsService } from '../../services/savedCardsService';
import { savedCardKeys } from '../../hooks/queryKeys';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { getCategoryIcon } from '../../utils/categoryUtils';

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

// AsyncStorage key for archived holidays
const HOLIDAY_ARCHIVE_STORAGE_KEY = "mingla_archived_holidays";

// Category icon mapping for pill chips
const CATEGORY_CHIP_ICONS: Record<string, string> = {
  nature: 'leaf-outline',
  icebreakers: 'chatbubbles-outline',
  drinks_and_music: 'wine-outline',
  brunch_lunch_casual: 'fast-food-outline',
  upscale_fine_dining: 'restaurant-outline',
  movies_theatre: 'film-outline',
  creative_arts: 'color-palette-outline',
  play: 'game-controller-outline',
  flowers: 'flower-outline',
};
function getCategoryChipIcon(category: string): string {
  const key = category.toLowerCase().replace(/[^a-z_]/g, '_');
  return CATEGORY_CHIP_ICONS[key] ?? getCategoryIcon(key) ?? 'sparkles-outline';
}

const ViewFriendProfileScreen: React.FC<ViewFriendProfileScreenProps> = ({
  userId,
  onBack,
  onMessage,
}) => {
  const { t } = useTranslation(['profile', 'common', 'discover']);
  const insets = useSafeAreaInsets();
  const { data: profile, isLoading, isError } = useFriendProfile(userId);
  const queryClient = useQueryClient();

  // ── ORCH-0435: Pairing detection ────────────────────────
  const currentUserId = useAppStore((s) => s.user?.id);
  const currentMode = 'solo';
  const { data: pairingPills = [] } = usePairingPills(currentUserId);
  const pairedPill = useMemo(() =>
    pairingPills.find(p => p.pairedUserId === userId && p.pillState === 'active'),
    [pairingPills, userId]
  );
  const isPaired = !!pairedPill;

  // ── User location (for PersonHolidayView travel time) ───
  const locationQuery = useUserLocation(currentUserId, currentMode as string, undefined);
  const userLocation = useMemo(() => {
    if (locationQuery?.data) {
      return { latitude: locationQuery.data.lat, longitude: locationQuery.data.lng };
    }
    return { latitude: 0, longitude: 0 };
  }, [locationQuery?.data]);

  // ── Custom holidays + archived holidays ─────────────────
  const [customHolidays, setCustomHolidays] = useState<Array<{ id: string; name: string; month: number; day: number; year: number }>>([]);
  const [archivedHolidayIds, setArchivedHolidayIds] = useState<string[]>([]);
  const [showCustomHolidayModal, setShowCustomHolidayModal] = useState(false);

  // Load custom holidays for this pairing
  useEffect(() => {
    if (!isPaired || !pairedPill) return;
    const pairingId = pairedPill.pairingId ?? pairedPill.id;
    if (!pairingId) return;

    getSharedCustomHolidaysByPairing(pairingId)
      .then((holidays) => {
        setCustomHolidays(holidays.map(h => ({
          id: h.id,
          name: h.name,
          month: h.month,
          day: h.day,
          year: h.year,
        })));
      })
      .catch((e) => {
        console.warn('[ViewFriendProfile] Custom holidays fetch failed:', e);
      });
  }, [isPaired, pairedPill]);

  // Load archived holidays from AsyncStorage
  useEffect(() => {
    if (!isPaired || !currentUserId || !userId) return;
    const loadArchived = async () => {
      try {
        const key = `${HOLIDAY_ARCHIVE_STORAGE_KEY}_${currentUserId}`;
        const stored = await AsyncStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored) as Record<string, string[]>;
          setArchivedHolidayIds(parsed[userId] ?? []);
        }
      } catch { /* ignore */ }
    };
    loadArchived();
  }, [isPaired, currentUserId, userId]);

  const handleArchiveHoliday = useCallback(async (holidayId: string) => {
    if (!currentUserId || !userId) return;
    const next = [...archivedHolidayIds, holidayId];
    setArchivedHolidayIds(next);
    try {
      const key = `${HOLIDAY_ARCHIVE_STORAGE_KEY}_${currentUserId}`;
      const stored = await AsyncStorage.getItem(key);
      const map = stored ? JSON.parse(stored) as Record<string, string[]> : {};
      map[userId] = next;
      await AsyncStorage.setItem(key, JSON.stringify(map));
    } catch { /* ignore */ }
  }, [archivedHolidayIds, currentUserId, userId]);

  const handleUnarchiveHoliday = useCallback(async (holidayId: string) => {
    if (!currentUserId || !userId) return;
    const next = archivedHolidayIds.filter(id => id !== holidayId);
    setArchivedHolidayIds(next);
    try {
      const key = `${HOLIDAY_ARCHIVE_STORAGE_KEY}_${currentUserId}`;
      const stored = await AsyncStorage.getItem(key);
      const map = stored ? JSON.parse(stored) as Record<string, string[]> : {};
      map[userId] = next;
      await AsyncStorage.setItem(key, JSON.stringify(map));
    } catch { /* ignore */ }
  }, [archivedHolidayIds, currentUserId, userId]);

  const handleAddCustomDay = useCallback(() => {
    setShowCustomHolidayModal(true);
  }, []);

  const handleCustomHolidaySave = useCallback(async (holiday: { name: string; month: number; day: number; year: number }) => {
    if (!isPaired || !pairedPill) return;
    const pairingId = pairedPill.pairingId ?? pairedPill.id;
    if (!pairingId || !currentUserId) return;
    try {
      const created = await createCustomHolidayForPairing({
        pairing_id: pairingId,
        user_id: currentUserId,
        paired_user_id: userId,
        name: holiday.name,
        month: holiday.month,
        day: holiday.day,
        year: holiday.year,
      });
      if (created) {
        setCustomHolidays(prev => [...prev, {
          id: created.id,
          name: created.name,
          month: created.month,
          day: created.day,
          year: created.year,
        }]);
      }
      setShowCustomHolidayModal(false);
    } catch (e) {
      console.warn('[ViewFriendProfile] Create custom holiday failed:', e);
    }
  }, [isPaired, pairedPill, currentUserId, userId]);

  const handleDeleteCustomHoliday = useCallback((holidayId: string, holidayName: string) => {
    Alert.alert(
      t("discover:alerts.delete_holiday_title"),
      t("discover:alerts.delete_holiday_message", { name: holidayName }),
      [
        { text: t("discover:alerts.cancel"), style: "cancel" },
        {
          text: t("discover:alerts.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              await deleteCustomHolidayFromDb(holidayId);
              setCustomHolidays(prev => prev.filter(h => h.id !== holidayId));
            } catch (e) {
              console.warn('[ViewFriendProfile] Delete custom holiday failed:', e);
            }
          },
        },
      ]
    );
  }, [t]);

  // ── Expanded card modal ─────────────────────────────────
  const [expandedCard, setExpandedCard] = useState<any>(null);

  const handleCardPress = useCallback((card: any) => {
    setExpandedCard(card);
  }, []);

  const handleSaveCard = useCallback(async (cardData: Record<string, unknown>) => {
    if (!currentUserId) return;
    try {
      await savedCardsService.saveCard(currentUserId, cardData, "solo");
      queryClient.invalidateQueries({ queryKey: savedCardKeys.list(currentUserId) });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: unknown) {
      const errCode = (error as { code?: string })?.code;
      if (errCode === '23505') return; // Duplicate — already saved
      throw error;
    }
  }, [currentUserId, queryClient]);

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
        nestedScrollEnabled
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

        {/* Pill chips — ORCH-0435 */}
        <View style={styles.chipContainer}>
          {/* City chip */}
          <View style={styles.chip}>
            <Icon name="location-outline" size={s(14)} color="#eb7825" />
            <Text style={styles.chipText}>{locationLine}</Text>
          </View>

          {/* Mingla Level chip */}
          <View style={styles.chip}>
            <Icon name="sparkles-outline" size={s(14)} color="#eb7825" />
            <Text style={styles.chipText}>{levelLine}</Text>
          </View>

          {/* Subscription chip */}
          <View style={[styles.chip, { backgroundColor: tierBadge.bg, borderColor: tierBadge.border }]}>
            <Icon name="diamond-outline" size={s(14)} color={tierBadge.text} />
            <Text style={[styles.chipText, { color: tierBadge.text }]}>{TIER_LABEL[profile.tier]}</Text>
          </View>

          {/* Interest chips */}
          {profile.categories.map(cat => (
            <View key={cat} style={styles.chip}>
              <Icon name={getCategoryChipIcon(cat) as any} size={s(14)} color="#eb7825" />
              <Text style={styles.chipText}>{cat.replace(/_/g, ' ')}</Text>
            </View>
          ))}
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

        {/* PersonHolidayView — paired friends only (ORCH-0435) */}
        {isPaired && pairedPill && currentUserId && (
          <View style={styles.pairedSection}>
            <PersonHolidayView
              pairedUserId={userId}
              pairingId={pairedPill.pairingId ?? pairedPill.id}
              displayName={name}
              birthday={pairedPill.birthday ?? null}
              gender={pairedPill.gender ?? null}
              location={userLocation}
              userId={currentUserId}
              customHolidays={customHolidays}
              onAddCustomDay={handleAddCustomDay}
              archivedHolidayIds={archivedHolidayIds}
              onArchiveHoliday={handleArchiveHoliday}
              onUnarchiveHoliday={handleUnarchiveHoliday}
              onCardPress={handleCardPress}
              onSaveCardPress={handleSaveCard}
              onDeleteCustomDay={handleDeleteCustomHoliday}
            />
          </View>
        )}

        <View style={{ height: vs(40) + insets.bottom }} />
      </ScrollView>

      {/* Expanded card modal — ORCH-0435 */}
      {expandedCard && (
        <ExpandedCardModal
          visible={!!expandedCard}
          card={expandedCard}
          onClose={() => setExpandedCard(null)}
          onSave={async (card: any) => {
            await handleSaveCard(card);
            setExpandedCard(null);
          }}
          onShare={() => {}}
          isSaved={false}
          currentMode="solo"
          accountPreferences={{ currency: 'USD', measurementSystem: 'Imperial' }}
        />
      )}

      {/* Custom holiday modal — ORCH-0435 */}
      {showCustomHolidayModal && (
        <CustomHolidayModal
          visible={showCustomHolidayModal}
          onClose={() => setShowCustomHolidayModal(false)}
          onSave={handleCustomHolidaySave}
        />
      )}
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
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
    paddingHorizontal: s(20),
    marginTop: vs(16),
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    backgroundColor: '#f9fafb',
    borderRadius: s(999),
    paddingHorizontal: s(12),
    paddingVertical: vs(8),
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  chipText: {
    fontSize: s(13),
    fontWeight: '600',
    color: '#374151',
  },
  pairedSection: {
    marginTop: vs(24),
    paddingHorizontal: s(16),
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
