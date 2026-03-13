import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import * as Location from "expo-location";
import { throttledReverseGeocode } from "../utils/throttledGeocode";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFriends } from "../hooks/useFriends";
import { cameraService } from "../services/cameraService";
import { authService } from "../services/authService";
import { useAppStore } from "../store/appStore";
import { useAppState } from "./AppStateManager";
import { mixpanelService } from "../services/mixpanelService";
import { useProfileInterests, useUpdateProfileInterests } from "../hooks/useProfileInterests";
import ProfileHeroSection from "./profile/ProfileHeroSection";
import ProfileInterestsSection from "./profile/ProfileInterestsSection";
import ProfileStatsRow from "./profile/ProfileStatsRow";
import SettingsRow from "./profile/SettingsRow";
import EditBioSheet from "./profile/EditBioSheet";
import EditInterestsSheet from "./profile/EditInterestsSheet";
import EditProfileSheet from "./profile/EditProfileSheet";
import * as Haptics from 'expo-haptics';
import { useScreenLogger } from "../hooks/useScreenLogger";

interface ProfilePageProps {
  onSignOut?: () => void;
  onNavigateToActivity?: (tab: "saved" | "boards" | "calendar") => void;
  onNavigateToConnections?: () => void;
  onNavigateToAccountSettings?: () => void;
  onNavigateToPrivacyPolicy?: () => void;
  onNavigateToTermsOfService?: () => void;
  onNavigateToReplayTips?: () => void;
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
  onNavigateToActivity,
  onNavigateToConnections,
  onNavigateToAccountSettings,
  onNavigateToPrivacyPolicy,
  onNavigateToTermsOfService,
  onNavigateToReplayTips,
  savedExperiences = 0,
  boardsCount = 0,
  notificationsEnabled = true,
  onNotificationsToggle,
  userIdentity,
}: ProfilePageProps) {
  useScreenLogger('profile');
  const { friends: realFriends, fetchFriends, friendCount } = useFriends();
  const actualConnectionsCount = friendCount;

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  const [currentLocation, setCurrentLocation] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const user = useAppStore((s) => s.user);
  const profile = useAppStore((s) => s.profile);
  const { handleUserIdentityUpdate } = useAppState();
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Modal state
  const [showBioSheet, setShowBioSheet] = useState(false);
  const [showInterestsSheet, setShowInterestsSheet] = useState(false);
  const [showEditProfileSheet, setShowEditProfileSheet] = useState(false);

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
              handleUserIdentityUpdate?.({ ...(userIdentity || {}), profileImage: null });
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
        handleUserIdentityUpdate?.({ ...(userIdentity || {}), profileImage: publicUrl });
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

  // Notifications toggle
  const handleNotificationsToggle = () => {
    onNotificationsToggle?.(!notificationsEnabled);
  };

  // Visibility mode cycling
  const visibilityModes = ["friends", "public", "private"] as const;
  const visibilityLabels: Record<string, string> = {
    friends: "Friends Only",
    public: "Everyone",
    private: "Nobody",
  };
  const currentVisibility = profile?.visibility_mode || "friends";
  const handleCycleVisibility = async () => {
    if (!user?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const currentIndex = visibilityModes.indexOf(currentVisibility);
    const nextMode = visibilityModes[(currentIndex + 1) % visibilityModes.length];
    try {
      await authService.updateUserProfile(user.id, { visibility_mode: nextMode });
    } catch (error) {
      Alert.alert("Error", "Failed to update visibility.");
    }
  };

  // Show Activity — uses show_activity (NOT active, which is account status)
  const showActivity = profile?.show_activity !== false;
  const handleToggleShowActivity = async () => {
    if (!user?.id) return;
    try {
      await authService.updateUserProfile(user.id, { show_activity: !showActivity });
    } catch (error) {
      Alert.alert("Error", "Failed to update activity status.");
    }
  };

  // Replay Tips
  const handleReplayTips = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onNavigateToReplayTips) {
      onNavigateToReplayTips();
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        {/* 1. Hero Section */}
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

        {/* 3. Stats Row */}
        <ProfileStatsRow
          savedCount={savedExperiences}
          connectionsCount={actualConnectionsCount}
          boardsCount={boardsCount}
          onStatPress={(stat) => {
            if (stat === "saved") onNavigateToActivity?.("saved");
            else if (stat === "boards") onNavigateToActivity?.("boards");
            else if (stat === "connections") onNavigateToConnections?.();
          }}
        />

        {/* 4. Settings Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SETTINGS</Text>
          <SettingsRow
            label="Notifications"
            hint="Invites, boards, and messages"
            toggle
            toggleValue={notificationsEnabled}
            onToggle={handleNotificationsToggle}
          />
          <SettingsRow
            label="Profile Visibility"
            value={visibilityLabels[currentVisibility] || "Friends Only"}
            onPress={handleCycleVisibility}
          />
          <SettingsRow
            label="Show Activity"
            hint="Friends can see when you're active"
            toggle
            toggleValue={showActivity}
            onToggle={handleToggleShowActivity}
            isLast
          />
        </View>

        {/* 5. Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACCOUNT</Text>
          <SettingsRow
            icon="settings"
            label="Edit Profile"
            description="Name, username, and bio"
            showChevron
            onPress={() => setShowEditProfileSheet(true)}
          />
          <SettingsRow
            icon="refresh-cw"
            label="Replay Tips"
            showChevron
            onPress={handleReplayTips}
          />
          <SettingsRow
            icon="shield"
            label="Account"
            description="App info and account management"
            showChevron
            onPress={onNavigateToAccountSettings}
            isLast
          />
        </View>

        {/* 6. Legal Footer */}
        <View style={styles.legalRow}>
          <TouchableOpacity onPress={onNavigateToPrivacyPolicy}>
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.legalSeparator}>|</Text>
          <TouchableOpacity onPress={onNavigateToTermsOfService}>
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
      <EditProfileSheet
        visible={showEditProfileSheet}
        onClose={() => setShowEditProfileSheet(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  content: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    backgroundColor: '#ffffff',
    minHeight: '100%',
  },
  sectionSpacing: {
    marginTop: 16,
  },
  section: {
    paddingHorizontal: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 24,
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 16,
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
