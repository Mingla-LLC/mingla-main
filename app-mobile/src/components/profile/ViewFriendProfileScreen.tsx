import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
  Animated,
  Easing,
  AccessibilityInfo,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Icon } from '../ui/Icon';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import { useFriendProfile } from '../../hooks/useFriendProfile';
import { useFriends } from '../../hooks/useFriends';
import { useFriendRequests } from '../../hooks/useFriendsQuery';
import { s, vs } from '../../utils/responsive';
import { getCountryByCode } from '../../constants/countries';
import type { SubscriptionTier } from '../../types/subscription';
import { useTranslation } from 'react-i18next';

// ORCH-0435: Pairing + PersonHolidayView
import { usePairingPills } from '../../hooks/usePairings';
import { useAppStore } from '../../store/appStore';
import PersonHolidayView from '../PersonHolidayView';
import ExpandedCardModal from '../ExpandedCardModal';
import CustomHolidayModal from '../CustomHolidayModal';
import FriendActionsSheet from '../friends/FriendActionsSheet';
import { getSharedCustomHolidaysByPairing, createCustomHolidayForPairing, deleteCustomHoliday as deleteCustomHolidayFromDb } from '../../services/customHolidayService';
import { savedCardsService } from '../../services/savedCardsService';
import { savedCardKeys } from '../../hooks/queryKeys';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { fetchUserLevel } from '../../services/userLevelService';
import { userLevelKeys } from '../../hooks/queryKeys';
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

// Category icon mapping for pill chips.
// ORCH-0597 (Slice 5): split brunch_lunch_casual → brunch + casual_food.
const CATEGORY_CHIP_ICONS: Record<string, string> = {
  nature: 'leaf-outline',
  icebreakers: 'chatbubbles-outline',
  drinks_and_music: 'wine-outline',
  brunch: 'cafe-outline',
  casual_food: 'fast-food-outline',
  brunch_lunch_casual: 'fast-food-outline', // [TRANSITIONAL] legacy — remove after 2026-05-12
  upscale_fine_dining: 'restaurant-outline',
  // ORCH-0598 (Slice 6): split movies_theatre → movies + theatre.
  movies: 'film-outline',
  theatre: 'theater',
  movies_theatre: 'film-outline', // [TRANSITIONAL] legacy — remove after 2026-05-13
  creative_arts: 'color-palette-outline',
  play: 'game-controller-outline',
  flowers: 'flower-outline',
};
function getCategoryChipIcon(category: string): string {
  const key = category.toLowerCase().replace(/[^a-z_]/g, '_');
  return CATEGORY_CHIP_ICONS[key] ?? getCategoryIcon(key) ?? 'sparkles-outline';
}

// ─── ORCH-0993: Add-Friend CTA ──────────────────────────────────────────────
// Relationship state derived in the parent from useFriendRequests (one owner) +
// useFriendProfile.isFriend (one owner). This component is a PURE presenter of
// the derived state — it never reads friend_requests itself (I-CONST-2/4).

type AddFriendRelationship = 'stranger' | 'outgoing_pending' | 'incoming_pending';
type CtaActionInFlight = null | 'send' | 'cancel' | 'accept';
type CtaErrorKind = null | 'generic' | 'network' | 'unavailable';

// DESIGN ORCH-0993 §2/§5 — LIGHT authoritative (screen is light-only), DARK as a
// drop-in map (no useColorScheme hook is added per SPEC §16; keyed on a future isDark).
interface CtaPalette {
  fillPrimary: string;        // Add Friend / Accept fill
  labelOnPrimary: string;     // white on primary
  outlineFill: string;        // Requested fill
  outlineBorder: string;      // Requested border
  outlineLabel: string;       // Requested label + icon
  disabledFill: string;       // filled-disabled fallback
  errorText: string;
  errorIcon: string;
}
const CTA_LIGHT: CtaPalette = {
  fillPrimary: '#c2410c',
  labelOnPrimary: '#ffffff',
  outlineFill: '#fff7ed',
  outlineBorder: '#fdba74',
  outlineLabel: '#9a3412',
  disabledFill: '#d97757',
  errorText: '#b91c1c',
  errorIcon: '#dc2626',
};
const CTA_DARK: CtaPalette = {
  fillPrimary: '#c2410c',
  labelOnPrimary: '#ffffff',
  outlineFill: 'rgba(194,65,12,0.16)',
  outlineBorder: 'rgba(253,186,116,0.55)',
  outlineLabel: '#fdba74',
  disabledFill: '#d97757',
  errorText: '#fca5a5',
  errorIcon: '#f87171',
};

interface AddFriendCtaProps {
  relationship: AddFriendRelationship;
  name: string;
  inFlight: CtaActionInFlight;
  error: CtaErrorKind;
  onAddFriend: () => void;
  onCancelRequest: () => void;
  onAcceptRequest: () => void;
  isDark?: boolean;
}

const AddFriendCta: React.FC<AddFriendCtaProps> = ({
  relationship,
  name,
  inFlight,
  error,
  onAddFriend,
  onCancelRequest,
  onAcceptRequest,
  isDark = false,
}) => {
  const { t } = useTranslation(['profile', 'common']);
  const c = isDark ? CTA_DARK : CTA_LIGHT;
  const submitting = inFlight !== null;

  // DESIGN §4 — reduced-motion gate. Read once on mount + subscribe.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduceMotion(v));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // DESIGN §4 — cross-fade + 0.98→1.0 scale settle (200ms), instant when reduced-motion.
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const prevRel = useRef(relationship);
  useEffect(() => {
    if (prevRel.current === relationship) return;
    prevRel.current = relationship;
    if (reduceMotion) {
      opacity.setValue(1);
      scale.setValue(1);
      return;
    }
    opacity.setValue(0);
    scale.setValue(0.98);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [relationship, reduceMotion, opacity, scale]);

  // Resolve per-state visuals.
  let fill: string;
  let labelColor: string;
  let iconColor: string;
  let borderStyle: { borderWidth: number; borderColor: string } | null = null;
  let shadowStyle: object;
  let iconName: string;
  let label: string;
  let onPress: () => void;
  let a11yLabel: string;

  if (relationship === 'stranger') {
    fill = c.fillPrimary;
    labelColor = c.labelOnPrimary;
    iconColor = c.labelOnPrimary;
    shadowStyle = ctaStyles.shadowAdd;
    iconName = 'person-add-outline';
    label = inFlight === 'send' ? t('profile:friend.sending') : t('profile:friend.add_friend');
    onPress = onAddFriend;
    a11yLabel = t('profile:friend.add_friend') + ` ${name}`;
  } else if (relationship === 'outgoing_pending') {
    fill = c.outlineFill;
    labelColor = c.outlineLabel;
    iconColor = c.outlineLabel;
    borderStyle = { borderWidth: 1.5, borderColor: c.outlineBorder };
    shadowStyle = ctaStyles.shadowNone;
    iconName = 'time-outline';
    label = inFlight === 'cancel' ? t('profile:friend.canceling') : t('profile:friend.requested');
    onPress = onCancelRequest;
    a11yLabel = t('profile:friend.cancel_request_title') + ` ${name}`;
  } else {
    // incoming_pending
    fill = c.fillPrimary;
    labelColor = c.labelOnPrimary;
    iconColor = c.labelOnPrimary;
    shadowStyle = ctaStyles.shadowAccept;
    iconName = 'checkmark-outline';
    label = inFlight === 'accept' ? t('profile:friend.accepting') : t('profile:friend.accept_request');
    onPress = onAcceptRequest;
    a11yLabel = t('profile:friend.accept_request') + ` ${name}`;
  }

  // Submitting overrides fill to the disabled tone only for filled states; outline keeps its fill.
  const pillFill = submitting && relationship !== 'outgoing_pending' ? c.disabledFill : fill;
  const spinnerColor = relationship === 'outgoing_pending' ? c.outlineLabel : c.labelOnPrimary;

  const errorCopy =
    error === 'network'
      ? t('profile:friend.error_network')
      : error === 'unavailable'
        ? t('profile:friend.error_unavailable')
        : t('profile:friend.error_generic');

  return (
    <View>
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <TouchableOpacity
          style={[
            ctaStyles.pill,
            { backgroundColor: pillFill },
            borderStyle,
            shadowStyle,
            submitting ? ctaStyles.pillSubmitting : null,
            // submitting → non-interactive backs up `disabled` (DESIGN §3.1)
            submitting ? { pointerEvents: 'none' as const } : null,
          ]}
          onPress={onPress}
          disabled={submitting}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={spinnerColor} />
          ) : (
            <Icon name={iconName as any} size={s(22)} color={iconColor} />
          )}
          <Text style={[ctaStyles.label, { color: labelColor }]}>{label}</Text>
        </TouchableOpacity>
      </Animated.View>
      {error ? (
        <View
          style={ctaStyles.errorRow}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Icon name="alert-circle-outline" size={s(15)} color={c.errorIcon} />
          <Text style={[ctaStyles.errorText, { color: c.errorText }]}>{errorCopy}</Text>
        </View>
      ) : null}
    </View>
  );
};

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

  // ORCH-0437: Fetch real Mingla level (must be before early returns)
  const { data: friendLevelData } = useQuery({
    queryKey: userLevelKeys.level(userId),
    queryFn: () => fetchUserLevel(userId),
    enabled: !!userId,
    staleTime: 60_000,
  });
  const friendLevel = friendLevelData?.level ?? 1;
  const { data: pairingPills = [] } = usePairingPills(currentUserId);
  const pairedPill = useMemo(() =>
    pairingPills.find(p => p.pairedUserId === userId && p.pillState === 'active'),
    [pairingPills, userId]
  );
  const isPaired = !!pairedPill;
  // ORCH-0987: friend more-menu state + pending-pair derivation
  const isPendingPair = useMemo(
    () => pairingPills.some(p => p.pairedUserId === userId && (p.type === 'pending_request' || p.type === 'pending_invite')),
    [pairingPills, userId]
  );
  const [showActionsSheet, setShowActionsSheet] = useState(false);

  // ── ORCH-0993: Add-Friend CTA — relationship derivation + actions ─────────
  // relationship state is DERIVED from useFriendRequests (one owner) — do NOT add
  // a second pending-request read here (I-CONST-2/4). friends-edge truth stays
  // owned by useFriendProfile.isFriend.
  const { addFriend, acceptFriendRequest, cancelFriendRequest } = useFriends();
  const { data: friendRequests = [] } = useFriendRequests(currentUserId);
  const isSelf = !!currentUserId && currentUserId === userId;
  const [ctaInFlight, setCtaInFlight] = useState<CtaActionInFlight>(null);
  const [ctaError, setCtaError] = useState<CtaErrorKind>(null);

  const outgoingRequest = useMemo(
    () =>
      friendRequests.find(
        (r) => r.type === 'outgoing' && r.receiver_id === userId && r.status === 'pending',
      ),
    [friendRequests, userId],
  );
  const incomingRequest = useMemo(
    () =>
      friendRequests.find(
        (r) => r.type === 'incoming' && r.sender_id === userId && r.status === 'pending',
      ),
    [friendRequests, userId],
  );

  // friends wins over any stale pending row (SPEC §3.4 defensive rule).
  const relationship: 'friends' | AddFriendRelationship = profile?.isFriend
    ? 'friends'
    : outgoingRequest
      ? 'outgoing_pending'
      : incomingRequest
        ? 'incoming_pending'
        : 'stranger';

  const classifyCtaError = useCallback((err: unknown): CtaErrorKind => {
    const msg = (err as { message?: string })?.message ?? '';
    if (/not found|not available|blocked|can't view|cannot view/i.test(msg)) return 'unavailable';
    if (/network|offline|fetch|connection|timeout/i.test(msg)) return 'network';
    return 'generic';
  }, []);

  const handleAddFriend = useCallback(async () => {
    if (ctaInFlight) return;
    setCtaError(null);
    setCtaInFlight('send');
    try {
      await addFriend(userId, '', profile?.username ?? undefined);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setCtaError(classifyCtaError(err));
    } finally {
      setCtaInFlight(null);
    }
  }, [ctaInFlight, addFriend, userId, profile?.username, classifyCtaError]);

  const handleAcceptRequest = useCallback(async () => {
    if (ctaInFlight || !incomingRequest) return;
    setCtaError(null);
    setCtaInFlight('accept');
    try {
      await acceptFriendRequest(incomingRequest.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setCtaError(classifyCtaError(err));
    } finally {
      setCtaInFlight(null);
    }
  }, [ctaInFlight, incomingRequest, acceptFriendRequest, classifyCtaError]);

  const doCancelRequest = useCallback(async () => {
    if (ctaInFlight || !outgoingRequest) return;
    setCtaError(null);
    setCtaInFlight('cancel');
    try {
      await cancelFriendRequest(outgoingRequest.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setCtaError(classifyCtaError(err));
    } finally {
      setCtaInFlight(null);
    }
  }, [ctaInFlight, outgoingRequest, cancelFriendRequest, classifyCtaError]);

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
        <Icon name="arrow-back" size={s(22)} color="#ffffff" />
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
  const fullLocation = profile.location ?? countryName ?? t('profile:friend.not_shared');
  const locationLine = fullLocation.split(',')[0].trim();
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
        <View style={[styles.photoHero, { height: Math.min(Math.max(vs(420), vs(520)), vs(560)) }]}>
          {profile.avatar_url ? (
            <ImageWithFallback source={{ uri: profile.avatar_url }} style={styles.heroImage} />
          ) : (
            <LinearGradient
              colors={['#fdba74', '#eb7825', '#111827']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroImage}
            >
              <Text style={styles.heroInitials}>
                {getInitials(profile.first_name, profile.last_name, profile.username)}
              </Text>
            </LinearGradient>
          )}
          <LinearGradient
            colors={['rgba(0,0,0,0.28)', 'rgba(0,0,0,0.02)', 'rgba(0,0,0,0.72)']}
            locations={[0, 0.42, 1]}
            style={StyleSheet.absoluteFillObject}
          />
          {renderBack()}
          {/* ORCH-0987: friend more-menu (••• ) */}
          <TouchableOpacity
            style={[styles.overflowButton, { top: headerTop }]}
            activeOpacity={0.86}
            onPress={() => setShowActionsSheet(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Profile actions for ${name}`}
          >
            <Icon name="ellipsis-horizontal" size={s(22)} color="#ffffff" />
          </TouchableOpacity>
          <View style={styles.heroIdentity}>
            <Text style={styles.heroName} numberOfLines={2}>{name}</Text>
            <View style={styles.heroMetaRow}>
              <Icon name="location-outline" size={s(16)} color="#ffffff" />
              <Text style={styles.heroMetaText} numberOfLines={1}>{locationLine}</Text>
              <Text style={styles.heroDot}>·</Text>
              <Icon name="diamond-outline" size={s(15)} color="#fdba74" />
              <Text style={styles.heroTierText}>{levelLine}</Text>
              <Text style={styles.heroDot}>·</Text>
              <Icon name="trophy" size={s(15)} color="#ffffff" />
              <Text style={styles.heroMetaText}>Lv. {friendLevel}</Text>
            </View>
          </View>
        </View>

        <View style={styles.profileSheet}>
          <View style={styles.sheetHandle} />
          {profile.bio?.trim() ? (
            <View style={styles.bioQuoteCard} accessibilityLabel={`Bio: ${profile.bio}`}>
              <Text style={styles.quoteGlyph}>“</Text>
              <Text style={styles.bioQuoteText}>{profile.bio}</Text>
            </View>
          ) : null}

          {/* ORCH-0993: CTA region. Self → nothing. Friends → existing Message
              (gate unchanged). Else → Add-Friend CTA (new else branch keeps the
              friend-only Message gate structurally intact). */}
          {isSelf ? null : relationship === 'friends' ? (
            onMessage && profile.isFriend ? (
              <TouchableOpacity
                style={styles.messageButton}
                onPress={() => onMessage(userId)}
                activeOpacity={0.88}
                accessibilityRole="button"
                accessibilityLabel={`Message ${name}`}
              >
                <Icon name="chatbubble-outline" size={s(22)} color="#ffffff" />
                <Text style={styles.messageText}>{t('profile:friend.message')}</Text>
              </TouchableOpacity>
            ) : null
          ) : (
            <AddFriendCta
              relationship={relationship}
              name={name}
              inFlight={ctaInFlight}
              error={ctaError}
              onAddFriend={handleAddFriend}
              onAcceptRequest={handleAcceptRequest}
              onCancelRequest={() => {
                Alert.alert(
                  t('profile:friend.cancel_request_title'),
                  t('profile:friend.cancel_request_body', { name }),
                  [
                    { text: t('common:keep'), style: 'cancel' },
                    {
                      text: t('profile:friend.cancel_request_confirm'),
                      style: 'destructive',
                      onPress: doCancelRequest,
                    },
                  ],
                );
              }}
            />
          )}

          {/* ORCH-0986: "Users Vibe" — render BOTH chosen categories and intents. */}
          {(profile.categories.length > 0 || profile.intents.length > 0) && (
            <View style={styles.interestsSection}>
              <Text style={styles.interestsHeader}>{t('profile:friend.users_vibe', { defaultValue: "{{name}}'s Vibe", name: (profile.first_name || name.split(' ')[0] || name) })}</Text>
              <View style={styles.interestsWrap}>
                {profile.categories.map(cat => {
                  const slug = cat.toLowerCase().replace(/[^a-z_]/g, '_');
                  const label = t(`common:category_${slug}`, { defaultValue: cat.replace(/_/g, ' ') });
                  return (
                    <View key={`cat-${cat}`} style={styles.interestPill}>
                      <Icon name={getCategoryChipIcon(cat) as any} size={s(14)} color="#c2410c" />
                      <Text style={styles.interestPillText}>{label}</Text>
                    </View>
                  );
                })}
                {profile.intents.map(intent => {
                  const slug = intent.toLowerCase().replace(/[^a-z_]/g, '_');
                  const label = t(`common:intent_${slug}`, { defaultValue: intent.replace(/_/g, ' ') });
                  return (
                    <View key={`intent-${intent}`} style={styles.interestPill}>
                      <Icon name="sparkles-outline" size={s(14)} color="#c2410c" />
                      <Text style={styles.interestPillText}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {isPaired && pairedPill && currentUserId && (
            <View style={styles.pairedSection}>
              <PersonHolidayView
                pairedUserId={userId}
                pairingId={pairedPill.pairingId ?? pairedPill.id}
                displayName={name}
                birthday={pairedPill.birthday ?? null}
                gender={pairedPill.gender ?? null}
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
        </View>

        <View style={{ height: vs(40) + insets.bottom }} />
      </ScrollView>

      {/* Expanded card modal — ORCH-0435 */}
      {expandedCard && (
        <ExpandedCardModal
          visible={!!expandedCard}
          // ORCH-0828: discriminated-union target.
          target={{ kind: "nightOut", data: expandedCard }}
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

      {/* ORCH-0987: friend more-menu action sheet */}
      <FriendActionsSheet
        visible={showActionsSheet}
        onClose={() => setShowActionsSheet(false)}
        friendUserId={userId}
        friendName={name}
        friendUsername={profile.username ?? undefined}
        friendAvatarUrl={profile.avatar_url}
        pairingId={pairedPill?.pairingId ?? pairedPill?.id ?? null}
        isPaired={isPaired}
        isPending={isPendingPair}
        isFriend={profile.isFriend}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
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
    backgroundColor: 'rgba(17,24,39,0.48)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
      },
      android: { elevation: 2 },
    }),
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: vs(8) },
  photoHero: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  heroImage: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInitials: {
    fontSize: s(72),
    fontWeight: '800',
    color: '#ffffff',
  },
  overflowButton: {
    position: 'absolute',
    right: s(16),
    zIndex: 2,
    width: s(42),
    height: s(42),
    borderRadius: s(21),
    backgroundColor: 'rgba(17,24,39,0.48)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
      },
      android: { elevation: 4 },
    }),
  },
  heroIdentity: {
    position: 'absolute',
    left: s(24),
    right: s(24),
    bottom: vs(84),
  },
  heroName: {
    fontSize: s(32),
    lineHeight: s(38),
    fontWeight: '800',
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(7),
    marginTop: vs(8),
  },
  heroMetaText: {
    fontSize: s(15),
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
    maxWidth: s(128),
  },
  heroTierText: {
    fontSize: s(15),
    fontWeight: '800',
    color: '#fdba74',
  },
  heroDot: {
    fontSize: s(16),
    fontWeight: '700',
    color: 'rgba(255,255,255,0.78)',
  },
  profileSheet: {
    marginTop: -vs(52),
    backgroundColor: '#ffffff',
    borderTopLeftRadius: s(28),
    borderTopRightRadius: s(28),
    paddingTop: vs(12),
    paddingHorizontal: s(20),
    paddingBottom: vs(28),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,24,39,0.10)',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.10,
        shadowRadius: 24,
      },
      android: { elevation: 8 },
    }),
  },
  sheetHandle: {
    width: s(36),
    height: vs(4),
    borderRadius: s(999),
    backgroundColor: '#d1d5db',
    alignSelf: 'center',
    marginBottom: vs(20),
  },
  bioQuoteCard: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#ffedd5',
    borderRadius: s(16),
    paddingTop: vs(20),
    paddingRight: s(20),
    paddingBottom: vs(20),
    paddingLeft: s(20),
  },
  quoteGlyph: {
    fontSize: s(34),
    lineHeight: s(34),
    color: '#eb7825',
    fontWeight: '800',
  },
  bioQuoteText: {
    fontSize: s(17),
    lineHeight: s(26),
    color: '#111827',
    fontWeight: '500',
  },
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
    justifyContent: 'flex-start',
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
    paddingHorizontal: s(20),
    marginTop: vs(16),
  },
  infoLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
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
  interestsSection: {
    marginTop: vs(22),
    paddingHorizontal: s(20),
    alignItems: 'flex-start',
    alignSelf: 'stretch',
  },
  interestsHeader: {
    fontSize: s(11),
    fontWeight: '700',
    color: '#9ca3af',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: vs(12),
  },
  interestsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignSelf: 'stretch',
    rowGap: vs(8),
    columnGap: s(8),
  },
  interestPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    backgroundColor: '#fff7ed',
    borderRadius: s(999),
    paddingHorizontal: s(13),
    paddingVertical: vs(8),
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  interestPillText: {
    fontSize: s(13),
    fontWeight: '600',
    color: '#c2410c',
    textTransform: 'capitalize',
  },
  pairedSection: {
    marginTop: vs(24),
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(10),
    backgroundColor: '#111827',
    borderRadius: s(999),
    paddingVertical: vs(16),
    marginTop: vs(16),
    marginBottom: vs(16),
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.20,
        shadowRadius: 16,
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

// ─── ORCH-0993: Add-Friend CTA styles (DESIGN ORCH-0993 §1/§3) ──────────────
const ctaStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(10),
    borderRadius: s(999),
    paddingVertical: vs(16),
    paddingHorizontal: s(20),
    marginTop: vs(16),
    marginBottom: vs(16),
    minHeight: vs(52),
  },
  pillSubmitting: {
    opacity: 0.85,
  },
  label: { fontSize: s(16), fontWeight: '700' },
  shadowAdd: {
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
      },
      android: { elevation: 4 },
    }),
  },
  shadowAccept: {
    ...Platform.select({
      ios: {
        shadowColor: '#c2410c',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.28,
        shadowRadius: 18,
      },
      android: { elevation: 6 },
    }),
  },
  shadowNone: {},
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: s(6),
    paddingHorizontal: s(4),
    marginTop: -vs(8), // pill already has marginBottom vs(16); error sits in that gap
    marginBottom: vs(8),
  },
  errorText: {
    fontSize: s(13),
    fontWeight: '500',
    lineHeight: s(18),
    flex: 1,
  },
});

export default ViewFriendProfileScreen;
