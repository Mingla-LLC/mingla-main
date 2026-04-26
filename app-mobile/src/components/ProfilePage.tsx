import React, { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from '@tanstack/react-query';
import { useCoachMarkContext } from "../contexts/CoachMarkContext";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
  Dimensions,
  Animated,
  Easing,
  AccessibilityInfo,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { KeyboardAwareScrollView } from "./ui/KeyboardAwareScrollView";
import { GlassCard } from "./ui/GlassCard";
import { glass } from "../constants/designSystem";
import * as Location from "expo-location";
import { throttledReverseGeocode } from "../utils/throttledGeocode";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFriends } from "../hooks/useFriends";
import { cameraService } from "../services/cameraService";
import { authService } from "../services/authService";
import { useAppStore } from "../store/appStore";
import { supabase } from "../services/supabase";
import { mixpanelService } from "../services/mixpanelService";
import { useProfileInterests, useUpdateProfileInterests } from "../hooks/useProfileInterests";
import ProfileHeroSection from "./profile/ProfileHeroSection";
import ProfileInterestsSection from "./profile/ProfileInterestsSection";
import ProfileStatsRow from "./profile/ProfileStatsRow";
import { fetchUserLevel } from "../services/userLevelService";
import { userLevelKeys } from "../hooks/queryKeys";
import SettingsRow from "./profile/SettingsRow";
import EditBioSheet from "./profile/EditBioSheet";
import EditInterestsSheet from "./profile/EditInterestsSheet";
import AccountSettings from "./profile/AccountSettings";
import BillingSheet from "./profile/BillingSheet";
import * as Haptics from 'expo-haptics';
import { useScreenLogger } from "../hooks/useScreenLogger";
import BetaFeedbackButton from "./BetaFeedbackButton";
import InAppBrowserModal from "./InAppBrowserModal";
import { LEGAL_URLS } from "../constants/urls";
import { useTranslation } from 'react-i18next';

interface ProfilePageProps {
  onSignOut?: () => void;
  onUserIdentityUpdate?: (identity: any) => Promise<void>;
  onNavigateToActivity?: (tab: "saved" | "calendar") => void;
  onNavigateToConnections?: () => void;
  isTabVisible?: boolean;
  savedExperiences?: number;
  scheduledCount?: number;
  notificationsEnabled?: boolean;
  onNotificationsToggle?: (enabled: boolean) => void;
  userIdentity?: {
    firstName: string;
    lastName: string;
    username: string;
    profileImage: string | null;
    active?: boolean;
  };
}

function ProfilePage({
  onSignOut,
  onUserIdentityUpdate,
  onNavigateToActivity,
  onNavigateToConnections,
  isTabVisible,
  savedExperiences = 0,
  scheduledCount = 0,
  notificationsEnabled = true,
  onNotificationsToggle,
  userIdentity,
}: ProfilePageProps) {
  // ORCH-0679 Wave 2A: Dev-only render counter (I-TAB-PROPS-STABLE verification).
  const renderCountRef = React.useRef(0);
  if (__DEV__) {
    renderCountRef.current += 1;
    console.log(`[render-count] ProfilePage: ${renderCountRef.current}`);
  }

  useScreenLogger('profile');
  const { t } = useTranslation(['profile', 'common']);
  const insets = useSafeAreaInsets();
  const [legalBrowserVisible, setLegalBrowserVisible] = useState(false);
  const [legalBrowserUrl, setLegalBrowserUrl] = useState('');
  const [legalBrowserTitle, setLegalBrowserTitle] = useState('');
  const { friends: realFriends, fetchFriends, friendCount } = useFriends();
  const actualConnectionsCount = friendCount;

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  const [currentLocation, setCurrentLocation] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);

  // ORCH-0437: Fetch real user level from user_levels table
  const { data: levelData } = useQuery({
    queryKey: userLevelKeys.level(user?.id ?? ''),
    queryFn: () => fetchUserLevel(user!.id),
    enabled: !!user?.id,
    staleTime: 60_000,
  });
  const userLevel = levelData?.level ?? 1;
  const userXp = levelData?.xp_score ?? 0;
  // Progress to next level: ln-based curve — level = floor(10*ln(xp+1))+1
  // Next level XP = e^((level)/10) - 1
  const nextLevelXp = Math.exp((userLevel) / 10) - 1;
  const currentLevelXp = Math.exp((userLevel - 1) / 10) - 1;
  const levelProgress = nextLevelXp > currentLevelXp
    ? Math.min(1, (userXp - currentLevelXp) / (nextLevelXp - currentLevelXp))
    : 0;
  // onUserIdentityUpdate comes via props — no more useAppState() call.
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Modal state
  const [showBioSheet, setShowBioSheet] = useState(false);
  const [showInterestsSheet, setShowInterestsSheet] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [showBillingSheet, setShowBillingSheet] = useState(false);
  // ORCH-0635: coach-mark scroll-offset steps on Profile — step 8 (Account Settings
  // row) + step 9 (Beta Feedback button). Step 9 was re-added after device feedback.
  const scrollRef = useRef<any>(null);
  const contentRef = useRef<View>(null);
  const accountSettingsRef = useRef<View>(null);
  const feedbackButtonRef = useRef<View>(null);
  const { currentStep, registerScrollRef, registerTargetScrollOffset, scrollLockActive } = useCoachMarkContext();
  const isScrollStep = currentStep === 8 || currentStep === 9;
  const coachScrollPadding = isScrollStep ? Dimensions.get('window').height * 0.65 : 0;

  useEffect(() => {
    if (scrollRef.current) {
      registerScrollRef('profile', scrollRef);
    }
  }, [registerScrollRef]);

  // ORCH-0635: measureLayout for both Profile scroll-offset targets —
  // step 8 (Account Settings row) and step 9 (Beta Feedback button).
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!contentRef.current) return;
      if (accountSettingsRef.current) {
        (accountSettingsRef.current as any).measureLayout(
          contentRef.current,
          (x: number, y: number, width: number, height: number) => {
            registerTargetScrollOffset(8, x, y, width, height);
          },
          () => console.warn('[CoachMark] measureLayout failed for step 8'),
        );
      }
      if (feedbackButtonRef.current) {
        (feedbackButtonRef.current as any).measureLayout(
          contentRef.current,
          (x: number, y: number, width: number, height: number) => {
            registerTargetScrollOffset(9, x, y, width, height);
          },
          () => console.warn('[CoachMark] measureLayout failed for step 9'),
        );
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [registerTargetScrollOffset]);

  // Profile interests
  const { data: interests } = useProfileInterests();
  const updateInterestsMutation = useUpdateProfileInterests();

  // Location
  useEffect(() => {
    updateLocation();
  }, []);

  const updateLocation = async () => {
    setIsLoadingLocation(true);
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") throw new Error("Location permission denied");

      const loc = await Location.getCurrentPositionAsync({});
      const { addresses: geocoded } = await throttledReverseGeocode(
        loc.coords.latitude,
        loc.coords.longitude,
      );

      const place = geocoded && geocoded[0];
      const placeString = place
        ? `${place.city || place.region || ""}${place.region ? ", " + place.region : ""}${place.country ? ", " + place.country : ""}`
        : `${loc.coords.latitude.toFixed(2)}, ${loc.coords.longitude.toFixed(2)}`;

      setCurrentLocation(placeString || "");
      await AsyncStorage.setItem("mingla_user_location", placeString || "");
      if (user?.id && placeString) {
        await supabase
          .from('profiles')
          .update({ location: placeString })
          .eq('id', user.id);
      }
    } catch (error: any) {
      setLocationError(error?.message || "Unable to fetch location");
      try {
        const lastLocation = await AsyncStorage.getItem("mingla_user_location");
        if (lastLocation) setCurrentLocation(lastLocation);
      } catch (_) {}
    } finally {
      setIsLoadingLocation(false);
    }
  };

  // Avatar upload handlers
  const showUploadOptions = () => {
    Alert.alert(t('profile:page.upload_profile_photo_title'), t('profile:page.upload_profile_photo_body'), [
      { text: t('common:cancel'), style: "cancel" },
      { text: t('common:take_photo'), onPress: handleTakePhoto },
      { text: t('common:choose_from_gallery'), onPress: handlePickFromLibrary },
    ]);
  };

  const handleAvatarChange = () => {
    if (userIdentity?.profileImage) {
      Alert.alert(t('profile:page.change_profile_photo_title'), t('profile:page.change_profile_photo_body'), [
        { text: t('common:cancel'), style: "cancel" },
        { text: t('common:upload'), onPress: showUploadOptions },
        {
          text: t('common:remove_photo'),
          style: "destructive",
          onPress: async () => {
            if (!user?.id) return;
            setIsUploading(true);
            try {
              await authService.updateUserProfile(user.id, { avatar_url: null });
              onUserIdentityUpdate?.({ ...(userIdentity || {}), profileImage: null });
              mixpanelService.trackProfilePictureUpdated("removed");
            } catch (error) {
              Alert.alert(t('common:error'), t('profile:page.error_remove_photo'));
            } finally {
              setIsUploading(false);
            }
          },
        },
      ]);
    } else {
      showUploadOptions();
    }
  };

  const handleTakePhoto = async () => {
    if (!user?.id) return;
    try {
      const result = await cameraService.takePhoto({
        allowsEditing: true, aspect: [1, 1], quality: 0.8, compress: true, maxWidth: 800, maxHeight: 800,
      });
      if (result?.uri) await uploadAvatar(result.uri);
    } catch (error) {
      Alert.alert(t('common:error'), t('profile:page.error_take_photo'));
    }
  };

  const handlePickFromLibrary = async () => {
    if (!user?.id) return;
    try {
      const result = await cameraService.pickFromLibrary({
        allowsEditing: true, aspect: [1, 1], quality: 0.8, compress: true, maxWidth: 800, maxHeight: 800,
      });
      if (result?.uri) await uploadAvatar(result.uri);
    } catch (error) {
      Alert.alert(t('common:error'), t('profile:page.error_select_image'));
    }
  };

  const uploadAvatar = async (imageUri: string) => {
    if (!user?.id) return;
    setIsUploading(true);
    try {
      const publicUrl = await authService.uploadProfilePhoto(user.id, imageUri);
      if (publicUrl) {
        onUserIdentityUpdate?.({ ...(userIdentity || {}), profileImage: publicUrl });
        mixpanelService.trackProfilePictureUpdated("uploaded");
      } else {
        Alert.alert(t('common:error'), t('profile:page.error_upload_photo'));
      }
    } catch (error) {
      Alert.alert(t('common:error'), t('profile:page.error_upload_photo'));
    } finally {
      setIsUploading(false);
    }
  };

  // Name save — inline from hero
  const handleSaveName = async (firstName: string, lastName: string): Promise<boolean> => {
    if (!user?.id || !userIdentity) return false;
    try {
      const updatedIdentity = {
        ...userIdentity,
        firstName,
        lastName,
      };
      await onUserIdentityUpdate?.(updatedIdentity);
      if (firstName !== userIdentity?.firstName) mixpanelService.trackProfileSettingUpdated({ field: 'first_name' });
      if (lastName !== userIdentity?.lastName) mixpanelService.trackProfileSettingUpdated({ field: 'last_name' });
      return true;
    } catch {
      return false;
    }
  };

  // Bio save
  const handleSaveBio = async (bio: string) => {
    if (!user?.id) return;
    try {
      await authService.updateBio(user.id, bio);
    } catch (error) {
      Alert.alert(t('common:error'), t('profile:page.error_save_bio'));
    }
  };

  // Interests save
  const handleSaveInterests = (intents: string[], categories: string[]) => {
    updateInterestsMutation.mutate({ intents, categories }, {
      onError: () => console.error('[ProfilePage] Failed to update interests'),
    });
  };

  // ORCH-0627 — Hero gradient height (42% of viewport per spec §2)
  const { height: windowHeight } = useWindowDimensions();
  const heroGradientHeight = Math.round(windowHeight * glass.profile.heroGradient.heightRatio);

  // ORCH-0627 — Hero glow breathing animation. 8s cycle, 0.85 ↔ 1.0.
  // Respects Reduce Motion: static at 0.92.
  const glowOpacityRef = useRef(
    new Animated.Value(glass.profile.heroGlow.breathingOpacityRange[1]),
  ).current;
  useEffect(() => {
    let mounted = true;
    let loop: Animated.CompositeAnimation | null = null;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (!mounted) return;
        if (reduceMotion) {
          glowOpacityRef.setValue(0.92);
          return;
        }
        const [lo, hi] = glass.profile.heroGlow.breathingOpacityRange;
        const halfMs = glass.profile.heroGlow.breathingRangeMs / 2;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(glowOpacityRef, {
              toValue: lo,
              duration: halfMs,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(glowOpacityRef, {
              toValue: hi,
              duration: halfMs,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
        );
        loop.start();
      })
      .catch(() => {
        glowOpacityRef.setValue(0.92);
      });

    return () => {
      mounted = false;
      loop?.stop();
    };
  }, [glowOpacityRef]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ORCH-0627 — Orange top gradient wash (behind everything) */}
      <LinearGradient
        colors={glass.profile.heroGradient.colors}
        locations={glass.profile.heroGradient.locations}
        style={[styles.heroGradient, { height: heroGradientHeight }]}
        pointerEvents="none"
      />

      {/* ORCH-0627 — Orange radial glow behind avatar (3-layer concentric, breathing).
          Wrapper is absolute-positioned so glow center aligns with avatar center:
          avatar center y ≈ insets.top + 28(cardPadTop) + 56(avatarRadius) = insets.top + 84.
          Glow wrapper is 360pt tall, so wrapper.top = avatarCenter - 180 = insets.top - 96. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.heroGlowWrap,
          { top: insets.top - 96, opacity: glowOpacityRef },
        ]}
      >
        <View style={styles.heroGlowOuter} />
        <View style={styles.heroGlowMid} />
        <View style={styles.heroGlowInner} />
      </Animated.View>

      <KeyboardAwareScrollView ref={scrollRef} style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" scrollEnabled={!scrollLockActive}>
        <View style={[styles.content, coachScrollPadding > 0 && { paddingBottom: coachScrollPadding }]} ref={contentRef} collapsable={false}>
          {/* ORCH-0627 Phase 1 — 5 bento cards: Hero → Interests → Stats → Account → Footer */}

          {/* 1. Hero card (elevated) */}
          <View style={{ marginTop: insets.top }}>
            <GlassCard variant="elevated">
              <ProfileHeroSection
                isOwnProfile
                firstName={userIdentity?.firstName || null}
                lastName={userIdentity?.lastName || null}
                username={userIdentity?.username || null}
                avatarUrl={userIdentity?.profileImage || null}
                bio={profile?.bio || null}
                location={currentLocation}
                isLoadingLocation={isLoadingLocation}
                locationError={locationError}
                onAvatarPress={handleAvatarChange}
                onBioPress={() => setShowBioSheet(true)}
                onLocationRefresh={updateLocation}
                isUploading={isUploading}
                statusBarHeight={0}
                onSaveName={handleSaveName}
              />
            </GlassCard>
          </View>

          {/* 2. Interests card */}
          <GlassCard variant="base">
            <ProfileInterestsSection
              intents={interests?.intents || []}
              categories={interests?.categories || []}
              isOwnProfile
              onEditPress={() => setShowInterestsSheet(true)}
            />
          </GlassCard>

          {/* 3. Stats bento card */}
          <GlassCard variant="base">
            <Text style={styles.cardTitle}>{t('profile:page.stats_section')}</Text>
            <ProfileStatsRow
              savedCount={savedExperiences}
              connectionsCount={actualConnectionsCount}
              scheduledCount={scheduledCount}
              placesVisited={0}
              streakDays={0}
              level={userLevel}
              levelProgress={levelProgress}
              onStatPress={(stat) => {
                if (stat === "saved") onNavigateToActivity?.("saved");
                else if (stat === "scheduled") onNavigateToActivity?.("calendar");
                else if (stat === "connections") onNavigateToConnections?.();
              }}
            />
          </GlassCard>

          {/* 4. Account card */}
          <GlassCard variant="base">
            <Text style={styles.cardTitle}>{t('profile:page.account_section')}</Text>
            <SettingsRow
              icon="credit-card"
              label={t('profile:page.billing_label')}
              description={t('profile:page.billing_description')}
              showChevron
              onPress={() => setShowBillingSheet(true)}
            />
            <View ref={accountSettingsRef} collapsable={false}>
              <SettingsRow
                icon="shield"
                label={t('profile:page.account_settings_label')}
                description={t('profile:page.account_settings_description')}
                showChevron
                onPress={() => setShowAccountSettings(true)}
                isLast
              />
            </View>
          </GlassCard>

          {/* 5. Beta feedback (conditional — retained styling for Phase 1; re-skin = ORCH-0634) */}
          <BetaFeedbackButton isTabVisible={isTabVisible} feedbackButtonRef={feedbackButtonRef} />

          {/* 6. Footer card — legal + sign out + meta */}
          <GlassCard variant="base">
            <View style={styles.legalRow}>
              <TouchableOpacity onPress={() => {
                setLegalBrowserUrl(LEGAL_URLS.privacyPolicy);
                setLegalBrowserTitle(t('common:privacy_policy'));
                setLegalBrowserVisible(true);
              }}>
                <Text style={styles.legalLink}>{t('common:privacy_policy')}</Text>
              </TouchableOpacity>
              <Text style={styles.legalSeparator}>·</Text>
              <TouchableOpacity onPress={() => {
                setLegalBrowserUrl(LEGAL_URLS.termsOfService);
                setLegalBrowserTitle(t('common:terms_of_service'));
                setLegalBrowserVisible(true);
              }}>
                <Text style={styles.legalLink}>{t('common:terms_of_service')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={onSignOut} style={styles.signOutButton} activeOpacity={0.85}>
              <Text style={styles.signOutText}>{t('common:sign_out')}</Text>
            </TouchableOpacity>
            <Text style={styles.metaText}>Mingla · v1.0.0</Text>
          </GlassCard>
        </View>
      </KeyboardAwareScrollView>

      {/* Bottom Sheets */}
      <EditBioSheet
        visible={showBioSheet}
        onClose={() => setShowBioSheet(false)}
        currentBio={profile?.bio || ""}
        onSave={handleSaveBio}
      />
      <EditInterestsSheet
        visible={showInterestsSheet}
        onClose={() => setShowInterestsSheet(false)}
        currentIntents={interests?.intents || []}
        currentCategories={interests?.categories || []}
        onSave={handleSaveInterests}
      />
      <AccountSettings
        user={user}
        onSignOut={onSignOut}
        visible={showAccountSettings}
        onClose={() => setShowAccountSettings(false)}
        notificationsEnabled={notificationsEnabled}
        onNotificationsToggle={onNotificationsToggle}
      />
      <BillingSheet
        visible={showBillingSheet}
        onClose={() => setShowBillingSheet(false)}
      />
      <InAppBrowserModal
        visible={legalBrowserVisible}
        url={legalBrowserUrl}
        title={legalBrowserTitle}
        onClose={() => setLegalBrowserVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: glass.profile.screenBg,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    width: '100%',
    paddingBottom: 96, // clearance above floating bottom nav
  },
  // ORCH-0627 — Hero top gradient wash (orange → transparent)
  heroGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // height set inline from window dimensions × heightRatio
  },
  // ORCH-0627 — Hero radial glow: three concentric circles stacked, progressively
  // larger with progressively lower alpha. Overlapping transparent oranges compound
  // to create a convincing radial falloff (center ≈ 0.38 effective, edge ≈ 0.08).
  heroGlowWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 360,
    // top set inline from safe area insets
  },
  heroGlowOuter: {
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(235, 120, 37, 0.08)',
  },
  heroGlowMid: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(235, 120, 37, 0.14)',
    top: 60,              // (360 - 240) / 2 — vertical centering inside 360pt wrapper
    alignSelf: 'center',  // horizontal centering
  },
  heroGlowInner: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(235, 120, 37, 0.22)',
    top: 110,             // (360 - 140) / 2
    alignSelf: 'center',
  },
  // ORCH-0627 — Small-caps card title ("YOUR JOURNEY", "ACCOUNT")
  cardTitle: {
    ...glass.profile.text.cardTitle,
    marginBottom: 14,
  },
  // Footer legal row
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 10,
  },
  legalLink: {
    ...glass.profile.text.legalLink,
  },
  legalSeparator: {
    color: 'rgba(255, 255, 255, 0.28)',
    fontSize: 13,
    fontWeight: '500',
  },
  // Sign out (destructive)
  signOutButton: {
    marginTop: 16,
    paddingVertical: glass.profile.signOut.paddingVertical,
    paddingHorizontal: glass.profile.signOut.paddingHorizontal,
    borderRadius: glass.profile.signOut.radius,
    borderWidth: glass.profile.signOut.borderWidth,
    borderColor: glass.profile.signOut.border,
    backgroundColor: glass.profile.signOut.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    ...glass.profile.text.signOut,
  },
  // Meta (version)
  metaText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.32)',
    textAlign: 'center',
    marginTop: 14,
    letterSpacing: 0.2,
  },
});

// ORCH-0679 Wave 2A: I-TAB-SCREENS-MEMOIZED.
export default React.memo(ProfilePage);
