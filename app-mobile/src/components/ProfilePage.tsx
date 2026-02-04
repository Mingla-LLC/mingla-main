import React, { useState, useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Animated,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import Feather from "@expo/vector-icons/Feather";
import { useFriends } from "../hooks/useFriends";
import { useRecentActivity } from "../hooks/useRecentActivity";
import { formatActivityDate } from "../utils/dateUtils";
import type { UserActivityRecord } from "../services/userActivityService";
import BlockedUsersModal from "./BlockedUsersModal";

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
  placesVisited?: number;
  notificationsEnabled?: boolean;
  onNotificationsToggle?: (enabled: boolean) => void;
  userIdentity?: {
    firstName: string;
    lastName: string;
    username: string;
    profileImage: string | null;
    active?: boolean;
  };
  onUnblockUser?: (blockedUser: any, suppressNotification?: boolean) => void;
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
  placesVisited = 0,
  notificationsEnabled = true,
  onNotificationsToggle,
  userIdentity,
  onUnblockUser,
}: ProfilePageProps) {
  const { blockedUsers = [], fetchBlockedUsers } = useFriends();
  const {
    activities: recentActivities,
    loading: recentActivityLoading,
    refetch: refetchRecentActivity,
  } = useRecentActivity(10);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [showBlockedUsersModal, setShowBlockedUsersModal] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(
    "Raleigh, North Carolina, United States"
  );
  const [profileImageSrc, setProfileImageSrc] = useState(
    userIdentity?.profileImage || null
  );
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);

  // Animated value for toggle
  const toggleAnim = useRef(
    new Animated.Value(notificationsEnabled ? 20 : 2)
  ).current;

  // Animate toggle when notificationsEnabled changes
  useEffect(() => {
    Animated.timing(toggleAnim, {
      toValue: notificationsEnabled ? 20 : 2,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [notificationsEnabled]);

  console.log("userIdentity in ProfilePage:", userIdentity);
  // Auto-update location on component mount
  useEffect(() => {
    updateLocation();
  }, []);

  const updateLocation = async () => {
    setIsLoadingLocation(true);
    try {
      // For now, use a default location since location services need proper configuration
      // In a real app, this would use expo-location or similar
      const defaultLocation = "San Francisco, CA, United States";
      setCurrentLocation(defaultLocation);

      // Persist location
      await AsyncStorage.setItem("mingla_user_location", defaultLocation);
    } catch (error) {
      // Fallback to last known location
      try {
        const lastLocation = await AsyncStorage.getItem("mingla_user_location");
        if (lastLocation) {
          setCurrentLocation(lastLocation);
        }
      } catch (fallbackError) {}
    } finally {
      setIsLoadingLocation(false);
    }
  };

  // Sync profile image with userIdentity changes
  useEffect(() => {
    setProfileImageSrc(userIdentity?.profileImage || null);
  }, [userIdentity?.profileImage]);

  const handleNotificationsToggle = (enabled: boolean) => {
    onNotificationsToggle?.(enabled);
    // Persist notification preference
    
  };

  const getActivityLabel = (activity: UserActivityRecord): string => {
    switch (activity.activity_type) {
      case "saved_card":
        return "❤️ Saved";
      case "scheduled_card":
        return "";
      case "joined_board":
        return "Joined board";
      default:
        return "Activity";
    }
  };

  const handleUnblockUser = async (user: { id: string; name?: string }) => {
    if (unblockingId === user.id) return;
    setUnblockingId(user.id);
    try {
      await onUnblockUser?.(user);
      await fetchBlockedUsers();
    } catch (_e) {
      // Error already logged in handler
    } finally {
      setUnblockingId(null);
    }
  };

  const stats = [
    {
      label: "Experiences Saved",
      value: savedExperiences,
      color: savedExperiences > 0 ? "text-[#eb7825]" : "text-gray-500",
      bgColor: savedExperiences > 0 ? "bg-orange-50" : "bg-gray-50",
      onClick: () => onNavigateToActivity?.("saved"),
    },
    {
      label: "Boards Created",
      value: boardsCount,
      color: boardsCount > 0 ? "text-[#eb7825]" : "text-gray-500",
      bgColor: boardsCount > 0 ? "bg-orange-50" : "bg-gray-50",
      onClick: () => onNavigateToActivity?.("boards"),
    },
    {
      label: "Connections",
      value: connectionsCount,
      color: connectionsCount > 0 ? "text-[#eb7825]" : "text-gray-500",
      bgColor: connectionsCount > 0 ? "bg-orange-50" : "bg-gray-50",
      onClick: () => onNavigateToConnections?.(),
    },
    {
      label: "Places Visited",
      value: placesVisited,
      color: placesVisited > 0 ? "text-[#eb7825]" : "text-gray-500",
      bgColor: placesVisited > 0 ? "bg-orange-50" : "bg-gray-50",
      onClick: () => onNavigateToActivity?.("calendar"),
    },
  ];

  const journeyStats = [
    { label: "This Month", value: placesVisited.toString(), icon: "calendar" },
    { label: "Day Streak", value: "0", icon: "trending-up" },
    { label: "Badges", value: "0", icon: "trophy" },
  ];

  const vibes = [
    {
      label: "Adventure",
      percentage: Math.min(100, Math.max(0, savedExperiences * 5)),
      color: "bg-[#eb7825]",
    },
    {
      label: "Social",
      percentage: Math.min(100, Math.max(0, connectionsCount * 3)),
      color: "bg-[#d6691f]",
    },
    {
      label: "Creative",
      percentage: Math.min(100, Math.max(0, boardsCount * 10)),
      color: "bg-[#f08849]",
    },
  ];

  const settingsItems = [
    {
      icon: "settings",
      label: "Profile Settings",
      description: "Edit your name, username, and profile photo",
      onClick: () => {
        if (onNavigateToProfileSettings) {
          onNavigateToProfileSettings();
        } else {
          console.error(
            "ProfilePage: onNavigateToProfileSettings is not defined!"
          );
        }
      },
    },
    {
      icon: "shield",
      label: "Account Settings",
      description: "Currency, measurements, and account lifecycle",
      onClick: () => onNavigateToAccountSettings?.(),
    },
  ];

  const legalItems = [
    {
      icon: "shield",
      label: "Privacy Policy",
      description: "How we collect, use, and protect your information",
      onClick: () => onNavigateToPrivacyPolicy?.(),
    },
    {
      icon: "file-text",
      label: "Terms of Service",
      description: "Terms and conditions for using Mingla",
      onClick: () => onNavigateToTermsOfService?.(),
    },
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            {/* Profile Image */}
            <View style={styles.profileImageContainer}>
              <ImageWithFallback
                source={
                  profileImageSrc
                    ? { uri: profileImageSrc }
                    : {
                        uri: "https://via.placeholder.com/80x80/6b7280/ffffff?text=User",
                      }
                }
                style={styles.profileImage}
              />
              <View style={styles.onlineIndicator}></View>
            </View>

            {/* User Info */}
            <Text style={styles.userName}>
              {userIdentity?.firstName && userIdentity?.lastName
                ? `${userIdentity.firstName} ${userIdentity.lastName}`.trim()
                : userIdentity?.firstName || "User"}
            </Text>
            <Text style={styles.username}>
              @{userIdentity?.username || "user"}
            </Text>

            {/* Location */}
            <View style={styles.locationContainer}>
              <Ionicons name="location" size={16} color="#6b7280" />
              <Text style={styles.locationText}>{currentLocation}</Text>
              <TouchableOpacity
                onPress={updateLocation}
                disabled={isLoadingLocation}
                style={styles.locationButton}
              >
                <Ionicons name="refresh" size={12} color="#6b7280" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Recent Activity */}
        <View style={styles.section}>
          <View style={styles.sectionCard}>
            <View style={styles.recentActivityHeader}>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              <TouchableOpacity
                onPress={() => onNavigateToActivity?.("calendar")}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.viewAllLink}>View All</Text>
              </TouchableOpacity>
            </View>
            {recentActivityLoading ? (
              <View style={styles.recentActivityLoader}>
                <ActivityIndicator size="small" color="#eb7825" />
              </View>
            ) : recentActivities.length === 0 ? (
              <Text style={styles.recentActivityEmpty}>
                No recent activity yet
              </Text>
            ) : (
              <View style={styles.recentActivityList}>
                {recentActivities.map((activity) => (
                  <View key={activity.id} style={styles.recentActivityItem}>
                    <View style={styles.recentActivityDot} />
                    <View style={styles.recentActivityContent}>
                      <Text
                        style={styles.recentActivityTitle}
                        numberOfLines={1}
                      >
                        {activity.title}
                      </Text>
                      <View style={styles.recentActivityMeta}>
                        {activity.tag ? (
                          <Text style={styles.recentActivityTag}>
                            {activity.tag}
                          </Text>
                        ) : null}
                        <Text style={styles.recentActivityDate}>
                          {getActivityLabel(activity)} –{" "}
                          {formatActivityDate(activity.created_at)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsContainer}>
          <View style={styles.statsGrid}>
            {stats.map((stat, index) => (
              <TouchableOpacity
                key={index}
                onPress={stat.onClick}
                style={[
                  styles.statCard,
                  { backgroundColor: stat.value > 0 ? "#fef3e2" : "#f9fafb" },
                ]}
              >
                <Text
                  style={[
                    styles.statValue,
                    { color: stat.value > 0 ? "#eb7825" : "#6b7280" },
                  ]}
                >
                  {stat.value}
                </Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Your Journey */}
        <View style={styles.section}></View>

        {/* Your Vibes */}
        <View style={styles.section}>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Your Vibes</Text>

            <View style={styles.vibesContainer}>
              {vibes.map((vibe, index) => (
                <View key={index} style={styles.vibeItem}>
                  <Text style={styles.vibeLabel}>{vibe.label}</Text>
                  <View style={styles.vibeProgressContainer}>
                    <View style={styles.vibeProgressBar}>
                      <View
                        style={[
                          styles.vibeProgressFill,
                          {
                            width: `${vibe.percentage}%`,
                            backgroundColor:
                              index === 0
                                ? "#eb7825"
                                : index === 1
                                ? "#d6691f"
                                : "#f08849",
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.vibePercentage}>
                      {vibe.percentage}%
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Notifications */}
        <View style={styles.section}>
          <View style={styles.sectionCard}>
            <View style={styles.notificationHeader}>
              <View style={styles.notificationTitleContainer}>
                <Ionicons name="notifications" size={20} color="#eb7825" />
                <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>
                  Notifications
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleNotificationsToggle(!notificationsEnabled)}
                style={[
                  styles.toggle,
                  {
                    backgroundColor: notificationsEnabled
                      ? "#eb7825"
                      : "#d1d5db",
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.toggleThumb,
                    { transform: [{ translateX: toggleAnim }] },
                  ]}
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.notificationDescription}>
              Get notified about collaboration invites, board activities (likes,
              RSVPs, discussions, lock-ins), and important actions like being
              tagged in discussions or activity confirmations
            </Text>
          </View>
        </View>

        {/* Settings */}
        <View style={styles.section}>
          <View style={styles.settingsContainer}>
            {settingsItems.map((item, index) => (
              <TouchableOpacity
                key={index}
                onPress={item.onClick}
                style={styles.settingsItem}
              >
                <View style={styles.settingsIconContainer}>
                  <Feather name={item.icon as any} size={20} color="#6b7280" />
                </View>
                <View style={styles.settingsContent}>
                  <Text style={styles.settingsLabel}>{item.label}</Text>
                  <Text style={styles.settingsDescription}>
                    {item.description}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Connection Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionSubtitle}>Connection Settings</Text>
          <View style={styles.connectionSettingsContainer}>
            {/* Blocked Users - Clickable to open modal */}
            <TouchableOpacity
              style={styles.blockedUsersCard}
              onPress={() => setShowBlockedUsersModal(true)}
              activeOpacity={0.7}
            >
              <View style={styles.blockedUsersHeader}>
                <View style={styles.blockedUsersIconContainer}>
                  <Feather name="shield" size={20} color="#6b7280" />
                </View>
                <View style={styles.blockedUsersInfo}>
                  <Text style={styles.blockedUsersTitle}>Blocked Users</Text>
                  <Text style={styles.blockedUsersCount}>
                    {blockedUsers.length === 0
                      ? "Manage blocked users"
                      : `${blockedUsers.length} user${
                          blockedUsers.length === 1 ? "" : "s"
                        } blocked`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Blocked Users Modal */}
        <BlockedUsersModal
          visible={showBlockedUsersModal}
          onClose={() => setShowBlockedUsersModal(false)}
          onUnblockUser={async (user) => {
            await onUnblockUser?.(user);
            await fetchBlockedUsers();
          }}
        />

        {/* Legal & Privacy */}
        <View style={styles.section}>
          <Text style={styles.sectionSubtitle}>Legal & Privacy</Text>
          <View style={styles.legalContainer}>
            {legalItems.map((item, index) => (
              <TouchableOpacity
                key={index}
                onPress={item.onClick}
                style={styles.legalItem}
              >
                <View style={styles.legalIconContainer}>
                  <Feather name={item.icon as any} size={20} color="#6b7280" />
                </View>
                <View style={styles.legalContent}>
                  <Text style={styles.legalLabel}>{item.label}</Text>
                  <Text style={styles.legalDescription}>
                    {item.description}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Sign Out */}
        <View style={styles.signOutSection}>
          <TouchableOpacity
            onPress={() => {
              if (onSignOut) {
                onSignOut();
              } else {
                console.error("ProfilePage: onSignOut is not defined!");
              }
            }}
            style={styles.signOutButton}
          >
            <Ionicons name="log-out" size={16} color="#dc2626" />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  content: {
    flex: 1,
    maxWidth: 400,
    alignSelf: "center",
    backgroundColor: "white",
    minHeight: "100%",
  },
  header: {
    paddingTop: 48,
    paddingBottom: 24,
    paddingHorizontal: 24,
    backgroundColor: "#fef3e2",
    marginBottom: 32,
  },
  headerContent: {
    alignItems: "center",
  },
  profileImageContainer: {
    position: "relative",
    width: 80,
    height: 80,
    alignSelf: "center",
    marginBottom: 16,
  },
  profileImage: {
    width: "100%",
    height: "100%",
    borderRadius: 40,
    borderWidth: 4,
    borderColor: "white",
  },
  onlineIndicator: {
    position: "absolute",
    bottom: -4,
    right: -4,
    width: 24,
    height: 24,
    backgroundColor: "#10b981",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "white",
  },
  userName: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 4,
  },
  username: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 12,
  },
  locationContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  locationText: {
    fontSize: 14,
    color: "#6b7280",
  },
  locationButton: {
    marginLeft: 4,
    padding: 4,
    borderRadius: 12,
  },
  statsContainer: {
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  statCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#fef3e2",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#f3f4f6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 5,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#eb7825",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 16,
  },
  section: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  sectionCard: {
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 16,
  },
  sectionSubtitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6b7280",
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  vibesContainer: {
    gap: 12,
  },
  vibeItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  vibeLabel: {
    fontSize: 14,
    color: "#374151",
    flex: 1,
  },
  vibeProgressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  vibeProgressBar: {
    flex: 1,
    backgroundColor: "#e5e7eb",
    borderRadius: 4,
    height: 8,
  },
  vibeProgressFill: {
    height: 8,
    borderRadius: 4,
  },
  vibePercentage: {
    fontSize: 14,
    fontWeight: "500",
    color: "#eb7825",
    width: 32,
    textAlign: "right",
  },
  notificationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  notificationTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
  },
  notificationDescription: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20,
  },
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 2,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    backgroundColor: "white",
    borderRadius: 10,
  },
  recentActivityHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 24,
  },
  viewAllLink: {
    fontSize: 14,
    fontWeight: "500",
    color: "#eb7825",
  },
  recentActivityLoader: {
    paddingVertical: 24,
    alignItems: "center",
  },
  recentActivityEmpty: {
    fontSize: 14,
    color: "#6b7280",
    paddingVertical: 16,
  },
  recentActivityList: {
    gap: 16,
  },
  recentActivityItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  recentActivityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#eb7825",
    marginTop: 6,
  },
  recentActivityContent: {
    flex: 1,
    minWidth: 0,
  },
  recentActivityTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: "#111827",
  },
  recentActivityMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  recentActivityTag: {
    fontSize: 12,
    color: "#6b7280",
  },
  recentActivityDate: {
    fontSize: 12,
    color: "#6b7280",
  },
  settingsContainer: {
    gap: 12,
  },
  settingsItem: {
    width: "100%",
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  settingsIconContainer: {
    width: 40,
    height: 40,
    backgroundColor: "#f3f4f6",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsContent: {
    flex: 1,
  },
  settingsLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  settingsDescription: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  connectionSettingsContainer: {
    gap: 12,
  },
  blockedUsersCard: {
    width: "100%",
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  blockedUsersHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  blockedUsersIconContainer: {
    width: 40,
    height: 40,
    backgroundColor: "#f3f4f6",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  blockedUsersInfo: {
    flex: 1,
  },
  blockedUsersTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  blockedUsersCount: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  blockedUsersList: {
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  blockedUserItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  blockedUserInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  blockedUserAvatar: {
    width: 32,
    height: 32,
    backgroundColor: "#e5e7eb",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  blockedUserAvatarText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
  },
  blockedUserName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  blockedUserUsername: {
    fontSize: 12,
    color: "#6b7280",
  },
  unblockButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: "#eb7825",
    borderRadius: 12,
  },
  unblockButtonText: {
    fontSize: 12,
    color: "white",
  },
  legalContainer: {
    gap: 12,
  },
  legalItem: {
    width: "100%",
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  legalIconContainer: {
    width: 40,
    height: 40,
    backgroundColor: "#f3f4f6",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  legalContent: {
    flex: 1,
  },
  legalLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  legalDescription: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  signOutSection: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  signOutButton: {
    width: "100%",
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#dc2626",
  },
});
