import React, { useState, useEffect, useRef } from "react";
import { useCoachMarkContext } from "../contexts/CoachMarkContext";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
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

interface ProfilePageProps {
  onSignOut?: () => void;
  onUserIdentityUpdate?: (identity: any) => Promise<void>;
  onNavigateToActivity?: (tab: "saved" | "boards" | "calendar") => void;
  onNavigateToConnections?: () => void;
  isTabVisible?: boolean;
  savedExperiences?: number;
  boardsCount?: number;
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
  boardsCount = 0,
  notificationsEnabled = true,
  onNotificationsToggle,
  userIdentity,
}: ProfilePageProps) {
  useScreenLogger('profile');
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
  const { currentStep, registerScrollRef, registerTargetScrollOffset } = useCoachMarkContext();
  const isCoachScrollLocked = currentStep === 11 || currentStep === 12;

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
    Alert.alert("Upload Profile Photo", "Choose how you want to update your profile photo", [
      { text: "Cancel", style: "cancel" },
      { text: "Take Photo", onPress: handleTakePhoto },
      { text: "Choose from Gallery", onPress: handlePickFromLibrary },
    ]);
  };

  const handleAvatarChange = () => {
    if (userIdentity?.profileImage) {
      Alert.alert("Change Profile Photo", "Upload a new photo or remove the existing one", [
        { text: "Cancel", style: "cancel" },
        { text: "Upload", onPress: showUploadOptions },
        {
          text: "Remove Photo",
          style: "destructive",
          onPress: async () => {
            if (!user?.id) return;
            setIsUploading(true);
            try {
              await authService.updateUserProfile(user.id, { avatar_url: null });
              onUserIdentityUpdate?.({ ...(userIdentity || {}), profileImage: null });
              mixpanelService.trackProfilePictureUpdated("removed");
            } catch (error) {
              Alert.alert("Error", "Failed to remove profile photo.");
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
      Alert.alert("Error", "Failed to take photo. Please try again.");
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
      Alert.alert("Error", "Failed to select image. Please try again.");
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
        Alert.alert("Error", "Failed to upload profile photo.");
      }
    } catch (error) {
      Alert.alert("Error", "Failed to upload profile photo.");
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
      Alert.alert("Error", "Failed to save bio.");
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
      <KeyboardAwareScrollView ref={scrollRef} style={styles.scrollView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" scrollEnabled={!isCoachScrollLocked}>
        <View style={styles.content} ref={contentRef} collapsable={false}>
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
              boardsCount={boardsCount}
              placesVisited={0}
              streakDays={0}
              level={1}
              levelProgress={0.35}
              onStatPress={(stat) => {
                if (stat === "saved") onNavigateToActivity?.("saved");
                else if (stat === "boards") onNavigateToActivity?.("boards");
                else if (stat === "connections") onNavigateToConnections?.();
              }}
            />
          </View>

          {/* 4. Account Section */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ACCOUNT</Text>
            <SettingsRow
              icon="credit-card"
              label="Billing"
              description="Manage your plan and subscription"
              showChevron
              onPress={() => setShowBillingSheet(true)}
            />
            <View ref={accountSettingsRef} collapsable={false}>
              <SettingsRow
                icon="shield"
                label="Account Settings"
                description="Privacy, preferences, and account management"
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
              setLegalBrowserTitle('Privacy Policy');
              setLegalBrowserVisible(true);
            }}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </TouchableOpacity>
            <Text style={styles.legalSeparator}>|</Text>
            <TouchableOpacity onPress={() => {
              setLegalBrowserUrl(LEGAL_URLS.termsOfService);
              setLegalBrowserTitle('Terms of Service');
              setLegalBrowserVisible(true);
            }}>
              <Text style={styles.legalLink}>Terms of Service</Text>
            </TouchableOpacity>
          </View>

          {/* 7. Sign Out */}
          <View style={styles.signOutSection}>
            <TouchableOpacity onPress={onSignOut} style={styles.signOutButton}>
              <Text style={styles.signOutText}>Sign Out</Text>
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
