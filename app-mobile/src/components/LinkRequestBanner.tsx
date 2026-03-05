import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { FriendLink } from "../types/friendLink";
import { supabase } from "../services/supabase";
import { s } from "../utils/responsive";
import { generateInitials } from "../utils/stringUtils";

interface RequesterProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface LinkRequestBannerProps {
  requests: FriendLink[];
  onAccept: (linkId: string) => void;
  onDecline: (linkId: string) => void;
}

export default function LinkRequestBanner({
  requests,
  onAccept,
  onDecline,
}: LinkRequestBannerProps) {
  const [profiles, setProfiles] = useState<Record<string, RequesterProfile>>({});
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  // Fetch requester profiles
  useEffect(() => {
    if (requests.length === 0) {
      setLoadingProfiles(false);
      return;
    }

    const requesterIds = requests.map((r) => r.requesterId);

    const fetchProfiles = async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", requesterIds);

        if (error) {
          console.error("[LinkRequestBanner] Profile fetch error:", error.message);
          setLoadingProfiles(false);
          return;
        }

        const profileMap: Record<string, RequesterProfile> = {};
        (data || []).forEach((p: RequesterProfile) => {
          profileMap[p.id] = p;
        });
        setProfiles(profileMap);
      } catch (err) {
        console.error("[LinkRequestBanner] Unexpected error:", err);
      } finally {
        setLoadingProfiles(false);
      }
    };

    fetchProfiles();
  }, [requests]);

  const handleAccept = useCallback(
    (linkId: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setRespondingId(linkId);
      onAccept(linkId);
    },
    [onAccept]
  );

  const handleDecline = useCallback(
    (linkId: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setRespondingId(linkId);
      onDecline(linkId);
    },
    [onDecline]
  );

  if (requests.length === 0) return null;

  const getRequesterName = (requesterId: string): string => {
    const profile = profiles[requesterId];
    return profile?.display_name || "Someone";
  };

  const getRequesterInitials = (requesterId: string): string => {
    const profile = profiles[requesterId];
    if (profile?.display_name) {
      return generateInitials(profile.display_name);
    }
    return "??";
  };

  const renderRequest = (request: FriendLink) => {
    const profile = profiles[request.requesterId];
    const name = getRequesterName(request.requesterId);
    const isResponding = respondingId === request.id;

    return (
      <View key={request.id} style={styles.requestCard}>
        <View style={styles.requestContent}>
          {/* Requester avatar */}
          <View style={styles.requesterInfo}>
            {profile?.avatar_url ? (
              <Image
                source={{ uri: profile.avatar_url }}
                style={styles.requesterAvatar}
              />
            ) : (
              <View style={styles.requesterAvatarFallback}>
                <Text style={styles.requesterAvatarInitials}>
                  {getRequesterInitials(request.requesterId)}
                </Text>
              </View>
            )}
            <View style={styles.requesterTextContainer}>
              <Text style={styles.requesterName}>{name}</Text>
              <Text style={styles.consentText}>
                wants to link with you. Your card activity will be used to personalize their recommendations.
              </Text>
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.actionButtons}>
            {isResponding ? (
              <ActivityIndicator size="small" color="#eb7825" />
            ) : (
              <>
                <TouchableOpacity
                  style={styles.declineButton}
                  onPress={() => handleDecline(request.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.declineButtonText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.acceptButton}
                  onPress={() => handleAccept(request.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.acceptButtonText}>Accept</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    );
  };

  if (loadingProfiles) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color="#eb7825" />
      </View>
    );
  }

  // Single request
  if (requests.length === 1) {
    return <View style={styles.container}>{renderRequest(requests[0])}</View>;
  }

  // Multiple requests
  return (
    <View style={styles.container}>
      <View style={styles.counterBadge}>
        <Ionicons name="link-outline" size={s(14)} color="#eb7825" />
        <Text style={styles.counterBadgeText}>
          {requests.length} link requests
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {requests.map((request) => renderRequest(request))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: s(16),
  },
  loadingContainer: {
    padding: s(16),
    alignItems: "center",
  },
  counterBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    marginBottom: s(8),
    paddingHorizontal: s(4),
  },
  counterBadgeText: {
    fontSize: s(13),
    fontWeight: "600",
    color: "#eb7825",
  },
  horizontalScroll: {
    paddingRight: s(16),
    gap: s(12),
  },
  requestCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: s(12),
    borderLeftWidth: 4,
    borderLeftColor: "#eb7825",
    overflow: "hidden",
    minWidth: s(280),
  },
  requestContent: {
    padding: s(16),
  },
  requesterInfo: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: s(14),
  },
  requesterAvatar: {
    width: s(40),
    height: s(40),
    borderRadius: s(20),
    marginRight: s(12),
  },
  requesterAvatarFallback: {
    width: s(40),
    height: s(40),
    borderRadius: s(20),
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    marginRight: s(12),
  },
  requesterAvatarInitials: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#ffffff",
  },
  requesterTextContainer: {
    flex: 1,
  },
  requesterName: {
    fontSize: s(15),
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: s(4),
  },
  consentText: {
    fontSize: s(12),
    color: "#9ca3af",
    lineHeight: s(17),
  },
  actionButtons: {
    flexDirection: "row",
    gap: s(10),
  },
  declineButton: {
    flex: 1,
    backgroundColor: "#2a2a2a",
    borderRadius: s(10),
    paddingVertical: s(10),
    alignItems: "center",
  },
  declineButtonText: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#9ca3af",
  },
  acceptButton: {
    flex: 1,
    backgroundColor: "#eb7825",
    borderRadius: s(10),
    paddingVertical: s(10),
    alignItems: "center",
  },
  acceptButtonText: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#ffffff",
  },
});
