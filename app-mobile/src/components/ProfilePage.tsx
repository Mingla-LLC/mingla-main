import React, { useState, useEffect, useRef } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  Animated,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import Feather from "@expo/vector-icons/Feather";
import { useFriends } from "../hooks/useFriends";
import { useRecentActivity } from "../hooks/useRecentActivity";
import { formatActivityDate } from "../utils/dateUtils";
import type { UserActivityRecord } from "../services/userActivityService";
import { cameraService } from "../services/cameraService";
import { authService } from "../services/authService";
import { useAppStore } from "../store/appStore";
import { useAppState } from "./AppStateManager";

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
  onUnblockUser?: (blockedUser: any, suppressNotification?: boolean) => Promise<void>;
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
  placesVisited = 0,
  notificationsEnabled = true,
  onNotificationsToggle,
  userIdentity,
}: ProfilePageProps) {
  const { friends: realFriends, fetchFriends, friendCount } = useFriends();
  console.log("Real friends from useFriends hook:", realFriends);
  const actualConnectionsCount = friendCount;

  // Fetch real friends count from Supabase on mount
  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  const {
    activities: recentActivities,
    loading: recentActivityLoading,
    refetch: refetchRecentActivity,
  } = useRecentActivity(10);
  const [currentLocation, setCurrentLocation] = useState(
    "Raleigh, North Carolina, United States"
  );
  const [profileImageSrc, setProfileImageSrc] = useState(
    userIdentity?.profileImage || null
  );
  const [isUploading, setIsUploading] = useState(false);
  const user = useAppStore((s) => s.user);
  const { handleUserIdentityUpdate } = useAppState();
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const progressAnim = useRef(new Animated.Value(userIdentity?.profileImage ? 100 : 90)).current;
  const avatarScale = useRef(new Animated.Value(1)).current;
  const [hasUploadedImage, setHasUploadedImage] = useState<boolean>(!!userIdentity?.profileImage);
  const [showAvatarOverlay, setShowAvatarOverlay] = useState(false);
  const [showCompletionBar, setShowCompletionBar] = useState(!userIdentity?.profileImage);
  const [progressBarColor, setProgressBarColor] = useState("#eb7825");
  const completionBarOpacity = useRef(new Animated.Value(1)).current;
  const completionBarSlide = useRef(new Animated.Value(0)).current;
  const locationSpin = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Animation refs for stat cards flash/twinkle
  const statCardAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  // Animation refs for vibes and recent activity sections
  const vibesOpacity = useRef(new Animated.Value(0)).current;
  const vibesSlide = useRef(new Animated.Value(30)).current;
  const recentActivityOpacity = useRef(new Animated.Value(0)).current;
  const recentActivitySlide = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    let spinAnim: Animated.CompositeAnimation | null = null;
    let pulseLoop: Animated.CompositeAnimation | null = null;
    if (isLoadingLocation) {
      spinAnim = Animated.loop(
        Animated.timing(locationSpin, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        })
      );
      pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 400, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        ])
      );
      spinAnim.start();
      pulseLoop.start();
    } else {
      locationSpin.setValue(0);
      pulseAnim.setValue(1);
    }

    return () => {
      if (spinAnim) spinAnim.stop();
      if (pulseLoop) pulseLoop.stop();
    };
  }, [isLoadingLocation]);

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

  // Bounce-in avatar on mount with stronger pop
  useEffect(() => {
    avatarScale.setValue(0.5);
    Animated.spring(avatarScale, {
      toValue: 1,
      friction: 4,
      tension: 120,
      useNativeDriver: true,
    }).start();

    // Run stat card flash/twinkle animations
    statCardAnims.forEach((anim, index) => {
      anim.setValue(0);
      setTimeout(() => {
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: 80,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 80,
            useNativeDriver: true,
          }),
        ]).start();
      }, 200 + index * 80);
    });

    // Run vibes section slide up animation
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(vibesOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(vibesSlide, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }, 400);

    // Run recent activity section slide up animation
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(recentActivityOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(recentActivitySlide, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }, 550);
  }, []);

  const updateLocation = async () => {
    setIsLoadingLocation(true);
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") throw new Error("Location permission denied");

      const loc = await Location.getCurrentPositionAsync({});
      const geocoded = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });

      const place = geocoded && geocoded[0];
      const placeString = place
        ? `${place.city || place.region || ""}${place.region ? ", " + place.region : ""}${place.country ? ", " + place.country : ""}`
        : `${loc.coords.latitude.toFixed(2)}, ${loc.coords.longitude.toFixed(2)}`;

      setCurrentLocation(placeString || "San Francisco, CA, United States");
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

  const getInitials = () => {
    const first = userIdentity?.firstName || "";
    const last = userIdentity?.lastName || "";
    const fi = first.trim().charAt(0) || "";
    const li = last.trim().charAt(0) || "";
    return (fi + li).toUpperCase() || "U";
  };

  const handlePressIn = () => {
    setShowAvatarOverlay(true);
    Animated.timing(avatarScale, {
      toValue: 1.1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    setShowAvatarOverlay(false);
    Animated.timing(avatarScale, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  const showUploadOptions = () => {
    Alert.alert(
      "Upload Profile Photo",
      "Choose how you want to update your profile photo",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Take Photo", onPress: handleTakePhoto },
        { text: "Choose from Gallery", onPress: handlePickFromLibrary },
      ]
    );
  };

  const handleAvatarChange = () => {
    if (profileImageSrc) {
      // Use a compact action list to avoid Android 3-button limit
      Alert.alert(
        "Change Profile Photo",
        "Upload a new photo or remove the existing one",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Upload", onPress: showUploadOptions },
          { text: "Remove Photo", style: "destructive", onPress: handleRemovePhoto },
        ]
      );
    } else {
      showUploadOptions();
    }
  };

  const handleTakePhoto = async () => {
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in to update your profile photo.");
      return;
    }
    try {
      const result = await cameraService.takePhoto({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        compress: true,
        maxWidth: 800,
        maxHeight: 800,
      });
      if (result?.uri) {
        await uploadProfilePhoto(result.uri);
      }
    } catch (error) {
      console.error("Error taking photo:", error);
      Alert.alert("Error", "Failed to take photo. Please try again.");
    }
  };

  const handlePickFromLibrary = async () => {
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in to update your profile photo.");
      return;
    }
    try {
      const result = await cameraService.pickFromLibrary({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        compress: true,
        maxWidth: 800,
        maxHeight: 800,
      });
      if (result?.uri) {
        await uploadProfilePhoto(result.uri);
      }
    } catch (error) {
      console.error("Error picking from library:", error);
      Alert.alert("Error", "Failed to select image. Please try again.");
    }
  };

  const handleRemovePhoto = async () => {
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in to remove your profile photo.");
      return;
    }

    Alert.alert(
      "Remove Profile Photo",
      "Are you sure you want to remove your profile photo?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setIsUploading(true);
            try {
              // Clear avatar on profile
              const updatedProfile = await authService.updateUserProfile(user.id, { avatar_url: null });
              // Update local identity
              const updatedIdentity = { ...(userIdentity || {}), profileImage: null };
              handleUserIdentityUpdate?.(updatedIdentity);

              // Update UI states
              setHasUploadedImage(false);
              setProfileImageSrc(null);
              setShowCompletionBar(true);
              setProgressBarColor("#eb7825");
              Animated.timing(progressAnim, { toValue: 90, duration: 300, useNativeDriver: false }).start();

              Alert.alert("Removed", "Your profile photo has been removed.");
            } catch (error) {
              console.error("Error removing profile photo:", error);
              Alert.alert("Error", "Failed to remove profile photo. Please try again.");
            } finally {
              setIsUploading(false);
            }
          },
        },
      ]
    );
  };

  const uploadProfilePhoto = async (imageUri: string) => {
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in to update your profile photo.");
      return;
    }
    setIsUploading(true);
    try {
      const publicUrl = await authService.uploadProfilePhoto(user.id, imageUri);
      if (publicUrl) {
        const updatedIdentity = {
          ...(userIdentity || {}),
          profileImage: publicUrl,
        };
        handleUserIdentityUpdate?.(updatedIdentity);
        // animate completion progress
        setHasUploadedImage(true);
        
        // Animate to 100% and change color to green
        setProgressBarColor("#10b981"); // green color
        Animated.timing(progressAnim, {
          toValue: 100,
          duration: 800,
          useNativeDriver: false,
        }).start(() => {
          // Fade out and slide up after animation completes
          setTimeout(() => {
            Animated.parallel([
              Animated.timing(completionBarOpacity, {
                toValue: 0,
                duration: 400,
                useNativeDriver: true,
              }),
              Animated.timing(completionBarSlide, {
                toValue: -30,
                duration: 400,
                useNativeDriver: true,
              }),
            ]).start(() => {
              setShowCompletionBar(false);
            });
          }, 500);
        });
      } else {
        Alert.alert("Error", "Failed to upload profile photo. Please try again.");
      }
    } catch (error) {
      console.error("Error uploading profile photo:", error);
      Alert.alert("Error", "Failed to upload profile photo. Please try again.");
    } finally {
      setIsUploading(false);
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
      value: actualConnectionsCount,
      color: actualConnectionsCount > 0 ? "text-[#eb7825]" : "text-gray-500",
      bgColor: actualConnectionsCount > 0 ? "bg-orange-50" : "bg-gray-50",
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
      percentage: Math.min(100, Math.max(0, actualConnectionsCount * 3)),
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
            <TouchableOpacity
              onPress={handleAvatarChange}
              disabled={isUploading}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              style={styles.profileImageContainer}
            >
              <Animated.View style={{ transform: [{ scale: avatarScale }] }}>
                {isUploading ? (
                  <View style={[styles.profileImage, styles.uploadingContainer]}>
                    <ActivityIndicator size="large" color="#eb7825" />
                  </View>
                ) : profileImageSrc ? (
                  <ImageWithFallback
                    source={{ uri: profileImageSrc }}
                    style={styles.profileImage}
                  />
                ) : (
                  <LinearGradient
                    colors={["#eb7825", "#d6691f"]}
                    style={[styles.profileImage, styles.initialsContainer]}
                    start={[0, 0]}
                    end={[1, 1]}
                  >
                    <Text style={styles.initialsText}>{getInitials()}</Text>
                  </LinearGradient>
                )}
              </Animated.View>

              {/* Small camera badge bottom-right (always visible) */}
              <View style={styles.cameraBadge} pointerEvents="none">
                <Ionicons name="camera" size={14} color="white" />
              </View>

              {/* Dark overlay when active/pressed (for uploaded image interaction) */}
              {showAvatarOverlay && profileImageSrc ? (
                <View style={[styles.cameraOverlay, { backgroundColor: "rgba(0,0,0,0.3)" }]} pointerEvents="none">
                  <Ionicons name="camera" size={18} color="white" />
                </View>
              ) : null}
            </TouchableOpacity>

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
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <Ionicons name="location" size={16} color="#6b7280" />
              </Animated.View>
              <Text style={styles.locationText}>{currentLocation}</Text>
              <TouchableOpacity
                onPress={updateLocation}
                disabled={isLoadingLocation}
                style={styles.locationButton}
              >
                <Animated.View
                  style={{
                    transform: [
                      {
                        rotate: locationSpin.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["0deg", "360deg"],
                        }),
                      },
                    ],
                    opacity: isLoadingLocation ? 0.9 : 1,
                  }}
                >
                  <Ionicons
                    name={isLoadingLocation ? "refresh" : "navigate"}
                    size={12}
                    color={isLoadingLocation ? "#eb7825" : "#6b7280"}
                  />
                </Animated.View>
              </TouchableOpacity>
            </View>
            {locationError ? (
              <Text style={styles.locationError}>{locationError}</Text>
            ) : null}

            {/* Profile Completion Progress Bar - Hide when 100% */}
            {showCompletionBar && (
              <Animated.View
                style={[
                  styles.profileCompletionContainer,
                  {
                    opacity: completionBarOpacity,
                    transform: [{ translateY: completionBarSlide }],
                  },
                ]}
              >
                <View style={styles.profileCompletionHeader}>
                  <Text style={styles.profileCompletionTitle}>Profile completion</Text>
                  <Text style={[styles.profileCompletionPercent, { color: progressBarColor }]}>
                    {hasUploadedImage ? '100%' : '90%'}
                  </Text>
                </View>
                <View style={styles.profileCompletionBarBg}>
                  <Animated.View
                    style={[
                      styles.profileCompletionBarFill,
                      {
                        width: progressAnim.interpolate({
                          inputRange: [0, 100],
                          outputRange: ["0%", "100%"],
                        }),
                        backgroundColor: progressBarColor,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.profileCompletionAction}>
                  Upload a profile picture to complete your profile
                </Text>
              </Animated.View>
            )}
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsContainer}>
          <View style={styles.statsGrid}>
            {stats.map((stat, index) => (
              <Animated.View
                key={index}
                style={{
                  flex: 1,
                  minWidth: '45%',
                  opacity: statCardAnims[index].interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 0.5],
                  }),
                  transform: [{
                    scale: statCardAnims[index].interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [1, 1.08, 1.05],
                    }),
                  }],
                }}
              >
                <TouchableOpacity
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
              </Animated.View>
            ))}
          </View>
        </View>

        {/* Your Vibes */}
        <Animated.View
          style={[
            styles.section,
            {
              opacity: vibesOpacity,
              transform: [{ translateY: vibesSlide }],
            },
          ]}
        >
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
        </Animated.View>

        {/* Recent Activity */}
        <Animated.View
          style={[
            styles.section,
            {
              opacity: recentActivityOpacity,
              transform: [{ translateY: recentActivitySlide }],
            },
          ]}
        >
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
        </Animated.View>

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
    backgroundColor: "#f5f5f5",
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
  initialsContainer: {
    width: "100%",
    height: "100%",
    borderRadius: 40,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  initialsText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#6b7280",
  },
  cameraOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.18)",
    borderRadius: 40,
  },
  cameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "white",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  uploadingContainer: {
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 40,
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
    marginBottom: 8,
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
  locationError: {
    marginTop: 6,
    color: "#dc2626",
    fontSize: 13,
  },
  locationButton: {
    marginLeft: 4,
    padding: 4,
    borderRadius: 12,
  },
  profileCompletionContainer: {
    marginTop: 16,
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  profileCompletionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  profileCompletionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  profileCompletionPercent: {
    fontSize: 14,
    fontWeight: "600",
    color: "#eb7825",
  },
  profileCompletionBarBg: {
    width: "100%",
    height: 8,
    backgroundColor: "#e5e7eb",
    borderRadius: 4,
    overflow: "hidden",
  },
  profileCompletionBarFill: {
    height: 8,
    backgroundColor: "#eb7825",
    borderRadius: 4,
  },
  profileCompletionAction: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 8,
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
