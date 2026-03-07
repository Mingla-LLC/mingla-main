import React, { useState, useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Animated,
  ActivityIndicator,
} from "react-native";
import * as Location from "expo-location";
import { throttledReverseGeocode } from "../utils/throttledGeocode";
import { Ionicons } from "@expo/vector-icons";
import Feather from "@expo/vector-icons/Feather";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFriends } from "../hooks/useFriends";
import { useRecentActivity } from "../hooks/useRecentActivity";
import { formatActivityDate } from "../utils/dateUtils";
import type { UserActivityRecord } from "../services/userActivityService";
import { cameraService } from "../services/cameraService";
import { authService } from "../services/authService";
import { useAppStore } from "../store/appStore";
import { useAppState } from "./AppStateManager";
import { mixpanelService } from "../services/mixpanelService";
import { useProfilePhotos, useUploadProfilePhoto, useDeleteProfilePhoto } from "../hooks/useProfilePhotos";
import { useProfileInterests, useUpdateProfileInterests } from "../hooks/useProfileInterests";
import ProfileHeroSection from "./profile/ProfileHeroSection";
import ProfilePhotosGallery from "./profile/ProfilePhotosGallery";
import ProfileInterestsSection from "./profile/ProfileInterestsSection";
import ProfileStatsRow from "./profile/ProfileStatsRow";
import EditBioSheet from "./profile/EditBioSheet";
import EditInterestsSheet from "./profile/EditInterestsSheet";
import { useCoachMarkTarget } from '../hooks/useCoachMarkTarget';
import * as Haptics from 'expo-haptics';

interface ProfilePageProps {
  onSignOut?: () => void;
  onNavigateToActivity?: (tab: "saved" | "boards" | "calendar") => void;
  onNavigateToConnections?: () => void;
  onNavigateToProfileSettings?: () => void;
  onNavigateToAccountSettings?: () => void;
  onNavigateToPrivacyPolicy?: () => void;
  onNavigateToTermsOfService?: () => void;
  savedExperiences?: number;
  boardsCount?: number;
  connectionsCount?: number;
  notificationsEnabled?: boolean;
  onNotificationsToggle?: (enabled: boolean) => void;
  onUnblockUser?: (blockedUser: any, suppressNotification?: boolean) => Promise<void>;
  onNavigateToFriendProfile?: (userId: string) => void;
  onNavigateToReplayTips?: () => void;
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
  onNavigateToProfileSettings,
  onNavigateToAccountSettings,
  onNavigateToPrivacyPolicy,
  onNavigateToTermsOfService,
  savedExperiences = 0,
  boardsCount = 0,
  connectionsCount = 0,
  notificationsEnabled = true,
  onNotificationsToggle,
  onNavigateToReplayTips,
  userIdentity,
}: ProfilePageProps) {
  // Coach mark targets
  const { ref: heroSectionRef, onLayout: heroSectionOnLayout } = useCoachMarkTarget('profile-hero-section');
  const { ref: statsRowRef, onLayout: statsRowOnLayout } = useCoachMarkTarget('profile-stats-row');
  const { ref: interestsSectionRef, onLayout: interestsSectionOnLayout } = useCoachMarkTarget('profile-interests-section');
  const { ref: settingsSectionRef, onLayout: settingsSectionOnLayout } = useCoachMarkTarget('profile-settings-section');
  const { ref: notificationsToggleRef, onLayout: notificationsToggleOnLayout } = useCoachMarkTarget('profile-notifications-toggle');
  const { ref: activityToggleRef, onLayout: activityToggleOnLayout } = useCoachMarkTarget('profile-activity-toggle');
  const { ref: replayTipsRef, onLayout: replayTipsOnLayout } = useCoachMarkTarget('profile-replay-tips');

  const { friends: realFriends, fetchFriends, friendCount } = useFriends();
  const actualConnectionsCount = friendCount;

  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  const {
    activities: recentActivities,
    loading: recentActivityLoading,
  } = useRecentActivity(5);

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

  // Profile photos
  const { data: galleryPhotos } = useProfilePhotos();
  const uploadPhotoMutation = useUploadProfilePhoto();
  const deletePhotoMutation = useDeleteProfilePhoto();

  // Profile interests
  const { data: interests } = useProfileInterests();
  const updateInterestsMutation = useUpdateProfileInterests();

  // Notification toggle animation
  const toggleAnim = useRef(new Animated.Value(notificationsEnabled ? 20 : 2)).current;
  useEffect(() => {
    Animated.timing(toggleAnim, {
      toValue: notificationsEnabled ? 20 : 2,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [notificationsEnabled]);

  // Activity status toggle animation
  const activityToggleAnim = useRef(new Animated.Value(profile?.active !== false ? 20 : 2)).current;
  useEffect(() => {
    Animated.timing(activityToggleAnim, {
      toValue: profile?.active !== false ? 20 : 2,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [profile?.active]);

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

  // Gallery photo handlers
  const handleAddGalleryPhoto = (position: number) => {
    Alert.alert("Add Photo", "Choose how you want to add a photo", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Take Photo",
        onPress: async () => {
          const result = await cameraService.takePhoto({
            allowsEditing: true, aspect: [1, 1], quality: 0.8, compress: true, maxWidth: 800, maxHeight: 800,
          });
          if (result?.uri) uploadPhotoMutation.mutate(
            { imageUri: result.uri, position },
            { onError: () => Alert.alert("Error", "Failed to upload photo. Please try again.") }
          );
        },
      },
      {
        text: "Choose from Gallery",
        onPress: async () => {
          const result = await cameraService.pickFromLibrary({
            allowsEditing: true, aspect: [1, 1], quality: 0.8, compress: true, maxWidth: 800, maxHeight: 800,
          });
          if (result?.uri) uploadPhotoMutation.mutate(
            { imageUri: result.uri, position },
            { onError: () => Alert.alert("Error", "Failed to upload photo. Please try again.") }
          );
        },
      },
    ]);
  };

  const handleRemoveGalleryPhoto = (position: number) => {
    deletePhotoMutation.mutate(position, {
      onError: () => Alert.alert("Error", "Failed to remove photo. Please try again."),
    });
  };

  const isGalleryBusy = uploadPhotoMutation.isPending || deletePhotoMutation.isPending;

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
    updateInterestsMutation.mutate({ intents, categories });
  };

  // Notifications toggle
  const handleNotificationsToggle = (enabled: boolean) => {
    onNotificationsToggle?.(enabled);
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
    const currentIndex = visibilityModes.indexOf(currentVisibility);
    const nextMode = visibilityModes[(currentIndex + 1) % visibilityModes.length];
    try {
      await authService.updateUserProfile(user.id, { visibility_mode: nextMode });
    } catch (error) {
      Alert.alert("Error", "Failed to update visibility.");
    }
  };

  // Activity status
  const isActive = profile?.active !== false;
  const handleToggleActive = async () => {
    if (!user?.id) return;
    try {
      await authService.updateUserProfile(user.id, { active: !isActive });
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

  const getActivityLabel = (activity: UserActivityRecord): string => {
    switch (activity.activity_type) {
      case "saved_card": return "Saved";
      case "scheduled_card": return "";
      case "joined_board": return "Joined board";
      default: return "Activity";
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        {/* 1. Hero Section */}
        <View ref={heroSectionRef} onLayout={heroSectionOnLayout}>
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
        </View>

        {/* 2. Photos Gallery */}
        <ProfilePhotosGallery
          photos={galleryPhotos || []}
          isOwnProfile
          onAddPhoto={isGalleryBusy ? undefined : handleAddGalleryPhoto}
          onRemovePhoto={isGalleryBusy ? undefined : handleRemoveGalleryPhoto}
        />

        {/* 3. Interests Section */}
        <View style={styles.sectionSpacing} ref={interestsSectionRef} onLayout={interestsSectionOnLayout}>
          <ProfileInterestsSection
            intents={interests?.intents || []}
            categories={interests?.categories || []}
            isOwnProfile
            onEditPress={() => setShowInterestsSheet(true)}
          />
        </View>

        {/* 4. Stats Row */}
        <View ref={statsRowRef} onLayout={statsRowOnLayout}>
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
        </View>

        {/* 5. Recent Activity */}
        <View style={styles.section}>
          <View style={styles.sectionCard}>
            <View style={styles.recentActivityHeader}>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              <TouchableOpacity onPress={() => onNavigateToActivity?.("calendar")} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={styles.viewAllLink}>View All</Text>
              </TouchableOpacity>
            </View>
            {recentActivityLoading ? (
              <ActivityIndicator size="small" color="#eb7825" style={styles.loader} />
            ) : recentActivities.length === 0 ? (
              <Text style={styles.emptyText}>No recent activity yet</Text>
            ) : (
              <View style={styles.activityList}>
                {recentActivities.map((activity) => (
                  <View key={activity.id} style={styles.activityItem}>
                    <View style={styles.activityDot} />
                    <View style={styles.activityContent}>
                      <Text style={styles.activityTitle} numberOfLines={1}>{activity.title}</Text>
                      <Text style={styles.activityDate}>
                        {getActivityLabel(activity)}{getActivityLabel(activity) ? " – " : ""}{formatActivityDate(activity.created_at)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* 6. Quick Settings */}
        <View style={styles.section} ref={settingsSectionRef} onLayout={settingsSectionOnLayout}>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Settings</Text>

            {/* Notifications toggle */}
            <View style={styles.settingRow} ref={notificationsToggleRef} onLayout={notificationsToggleOnLayout}>
              <View style={styles.settingLabelContainer}>
                <Text style={styles.settingLabel}>Notifications</Text>
                <Text style={styles.settingHint}>Invites, board updates, and messages</Text>
              </View>
              <TouchableOpacity
                onPress={() => handleNotificationsToggle(!notificationsEnabled)}
                style={[styles.toggle, { backgroundColor: notificationsEnabled ? "#eb7825" : "#d1d5db" }]}
              >
                <Animated.View style={[styles.toggleThumb, { transform: [{ translateX: toggleAnim }] }]} />
              </TouchableOpacity>
            </View>

            {/* Visibility cycle */}
            <TouchableOpacity style={styles.settingRow} onPress={handleCycleVisibility}>
              <View style={styles.settingLabelContainer}>
                <Text style={styles.settingLabel}>Profile Visibility</Text>
              </View>
              <View style={styles.settingValueRow}>
                <Text style={styles.settingValue}>{visibilityLabels[currentVisibility] || "Friends Only"}</Text>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </View>
            </TouchableOpacity>

            {/* Activity status toggle */}
            <View style={styles.settingRow} ref={activityToggleRef} onLayout={activityToggleOnLayout}>
              <View style={styles.settingLabelContainer}>
                <Text style={styles.settingLabel}>Show Activity</Text>
                <Text style={styles.settingHint}>Let friends see when you're active</Text>
              </View>
              <TouchableOpacity
                onPress={handleToggleActive}
                style={[styles.toggle, { backgroundColor: isActive ? "#eb7825" : "#d1d5db" }]}
              >
                <Animated.View
                  style={[styles.toggleThumb, { transform: [{ translateX: activityToggleAnim }] }]}
                />
              </TouchableOpacity>
            </View>

            {/* Replay Tips */}
            <TouchableOpacity
              ref={replayTipsRef as any}
              onLayout={replayTipsOnLayout}
              style={styles.settingRow}
              onPress={handleReplayTips}
              accessibilityRole="button"
              accessibilityLabel="Replay Tips"
              accessibilityHint="Browse and replay tutorial tips"
            >
              <View style={styles.settingLabelContainer}>
                <View style={styles.replayTipsLabelRow}>
                  <Ionicons name="refresh-outline" size={22} color="#f97316" />
                  <Text style={styles.settingLabel}>Replay Tips</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 7. Account & More */}
        <View style={styles.section}>
          <View style={styles.settingsContainer}>
            <TouchableOpacity onPress={onNavigateToProfileSettings} style={styles.settingsItem}>
              <View style={styles.settingsIconContainer}>
                <Feather name="settings" size={20} color="#6b7280" />
              </View>
              <View style={styles.settingsContent}>
                <Text style={styles.settingsLabel}>Edit Profile</Text>
                <Text style={styles.settingsDescription}>Name, username, email, and more</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onNavigateToAccountSettings} style={styles.settingsItem}>
              <View style={styles.settingsIconContainer}>
                <Feather name="shield" size={20} color="#6b7280" />
              </View>
              <View style={styles.settingsContent}>
                <Text style={styles.settingsLabel}>Account</Text>
                <Text style={styles.settingsDescription}>Delete account and app info</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 8. Legal */}
        <View style={styles.legalRow}>
          <TouchableOpacity onPress={onNavigateToPrivacyPolicy}>
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.legalSeparator}>|</Text>
          <TouchableOpacity onPress={onNavigateToTermsOfService}>
            <Text style={styles.legalLink}>Terms of Service</Text>
          </TouchableOpacity>
        </View>

        {/* 9. Sign Out */}
        <View style={styles.signOutSection}>
          <TouchableOpacity onPress={onSignOut} style={styles.signOutButton}>
            <Ionicons name="log-out" size={16} color="#dc2626" />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Modals */}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { flex: 1, maxWidth: 400, alignSelf: "center", backgroundColor: "white", minHeight: "100%" },
  sectionSpacing: { marginTop: 16 },
  section: { paddingHorizontal: 24, paddingBottom: 16 },
  sectionCard: {
    backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: "#e5e7eb",
    padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 12 },
  recentActivityHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  viewAllLink: { fontSize: 14, color: "#eb7825", fontWeight: "600" },
  loader: { marginVertical: 16 },
  emptyText: { fontSize: 14, color: "#9ca3af", textAlign: "center", paddingVertical: 12 },
  activityList: { gap: 12 },
  activityItem: { flexDirection: "row", alignItems: "center" },
  activityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#eb7825", marginRight: 10 },
  activityContent: { flex: 1 },
  activityTitle: { fontSize: 14, fontWeight: "500", color: "#111827" },
  activityDate: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  settingRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f3f4f6",
  },
  settingLabelContainer: { flex: 1 },
  settingLabel: { fontSize: 15, fontWeight: "500", color: "#111827" },
  settingHint: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  settingValueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  settingValue: { fontSize: 14, color: "#eb7825", fontWeight: "600" },
  toggle: { width: 44, height: 24, borderRadius: 12, justifyContent: "center", paddingHorizontal: 2 },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "white" },
  settingsContainer: {
    backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: "#e5e7eb",
    overflow: "hidden",
  },
  settingsItem: {
    flexDirection: "row", alignItems: "center", padding: 16,
    borderBottomWidth: 1, borderBottomColor: "#f3f4f6",
  },
  settingsIconContainer: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: "#f3f4f6",
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  settingsContent: { flex: 1 },
  settingsLabel: { fontSize: 15, fontWeight: "600", color: "#111827" },
  settingsDescription: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  legalRow: {
    flexDirection: "row", justifyContent: "center", alignItems: "center",
    paddingVertical: 16, gap: 12,
  },
  legalLink: { fontSize: 13, color: "#6b7280" },
  legalSeparator: { fontSize: 13, color: "#d1d5db" },
  signOutSection: { paddingHorizontal: 24, paddingBottom: 48, alignItems: "center" },
  signOutButton: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 12, paddingHorizontal: 24,
    borderRadius: 12, borderWidth: 1, borderColor: "#fecaca",
  },
  signOutText: { fontSize: 15, fontWeight: "600", color: "#dc2626" },
  replayTipsLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
});
