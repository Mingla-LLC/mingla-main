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
} from "react-native";
import { KeyboardAwareScrollView } from "./ui/KeyboardAwareScrollView";
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

export default function ProfilePage({
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
  // Coach mark: register scroll ref + measure target positions for steps 11-12
  const scrollRef = useRef<any>(null);
  const contentRef = useRef<View>(null);
  const accountSettingsRef = useRef<View>(null);
  const feedbackButtonRef = useRef<View>(null);
  const { currentStep, registerScrollRef, registerTargetScrollOffset, scrollLockActive } = useCoachMarkContext();
  const isScrollStep = currentStep === 11 || currentStep === 12;
  const coachScrollPadding = isScrollStep ? Dimensions.get('window').height * 0.65 : 0;

  useEffect(() => {
    if (scrollRef.current) {
      registerScrollRef('profile', scrollRef);
    }
  }, [registerScrollRef]);

  // Use measureLayout to get exact positions relative to scroll content root
  useEffect(() => {
    const timer = setTimeout(() => {
      if (contentRef.current) {
        if (accountSettingsRef.current) {
          (accountSettingsRef.current as any).measureLayout(
            contentRef.current,
            (x: number, y: number, width: number, height: number) => {
              registerTargetScrollOffset(11, x, y, width, height);
            },
            () => console.warn('[CoachMark] measureLayout failed for step 11'),
          );
        }
        if (feedbackButtonRef.current) {
          (feedbackButtonRef.current as any).measureLayout(
            contentRef.current,
            (x: number, y: number, width: number, height: number) => {
              registerTargetScrollOffset(12, x, y, width, height);
            },
            () => console.warn('[CoachMark] measureLayout failed for step 12'),
          );
        }
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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <KeyboardAwareScrollView ref={scrollRef} style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" scrollEnabled={!scrollLockActive}>
        <View style={[styles.content, coachScrollPadding > 0 && { paddingBottom: coachScrollPadding }]} ref={contentRef} collapsable={false}>
          {/* 1. Hero Section — extends behind status bar */}
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
            statusBarHeight={insets.top}
            onSaveName={handleSaveName}
          />

          {/* 2. Interests Section */}
          <View style={styles.sectionSpacing}>
            <ProfileInterestsSection
              intents={interests?.intents || []}
              categories={interests?.categories || []}
              isOwnProfile
              onEditPress={() => setShowInterestsSheet(true)}
            />
          </View>

          {/* 3. Gamified Stats */}
          <View style={styles.sectionSpacing}>
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
          </View>

          {/* 4. Account Section */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('profile:page.account_section')}</Text>
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
          </View>

          {/* 5. Beta Feedback (conditional — only for beta testers) */}
          <BetaFeedbackButton isTabVisible={isTabVisible} feedbackButtonRef={feedbackButtonRef} />

          {/* 6. Legal Footer */}
          <View style={styles.legalRow}>
            <TouchableOpacity onPress={() => {
              setLegalBrowserUrl(LEGAL_URLS.privacyPolicy);
              setLegalBrowserTitle(t('common:privacy_policy'));
              setLegalBrowserVisible(true);
            }}>
              <Text style={styles.legalLink}>{t('common:privacy_policy')}</Text>
            </TouchableOpacity>
            <Text style={styles.legalSeparator}>|</Text>
            <TouchableOpacity onPress={() => {
              setLegalBrowserUrl(LEGAL_URLS.termsOfService);
              setLegalBrowserTitle(t('common:terms_of_service'));
              setLegalBrowserVisible(true);
            }}>
              <Text style={styles.legalLink}>{t('common:terms_of_service')}</Text>
            </TouchableOpacity>
          </View>

          {/* 7. Sign Out */}
          <View style={styles.signOutSection}>
            <TouchableOpacity onPress={onSignOut} style={styles.signOutButton}>
              <Text style={styles.signOutText}>{t('common:sign_out')}</Text>
            </TouchableOpacity>
          </View>
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
    backgroundColor: '#ffffff',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    alignSelf: 'center',
    width: '100%',
    backgroundColor: '#ffffff',
  },
  sectionSpacing: {
    marginTop: 24,
  },
  section: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  sectionTight: {
    paddingHorizontal: 24,
    marginTop: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 24,
    gap: 12,
  },
  legalLink: {
    fontSize: 13,
    color: '#6b7280',
  },
  legalSeparator: {
    fontSize: 13,
    color: '#d1d5db',
  },
  signOutSection: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    alignItems: 'center',
  },
  signOutButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#dc2626',
  },
});
