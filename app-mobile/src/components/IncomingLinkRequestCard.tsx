import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  ActivityIndicator,
} from "react-native";

export interface EnrichedLinkRequest {
  id: string;           // FriendLink.id
  requesterId: string;
  name: string;         // requester's display_name, falling back to first_name, then "Someone"
  avatarUrl: string | null;
  initials: string;     // First 2 characters of name, uppercased
}

interface Props {
  request: EnrichedLinkRequest;
  isAccepting: boolean;
  isDeclining: boolean;
  onAccept: (linkId: string) => void;
  onDecline: (linkId: string) => void;
}

export default function IncomingLinkRequestCard({
  request,
  isAccepting,
  isDeclining,
  onAccept,
  onDecline,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(30);
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    }, 200);
    return () => clearTimeout(timer);
  }, [request.id, opacity, translateY]);

  return (
    <Animated.View
      style={[styles.container, { opacity, transform: [{ translateY }] }]}
    >
      <View style={styles.avatarRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitials}>{request.initials}</Text>
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.name}>{request.name}</Text>
          <Text style={styles.sub}>wants to link with you</Text>
        </View>
      </View>

      <Text style={styles.description}>
        When linked, your card activity helps personalise their recommendations — and vice versa.
      </Text>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.acceptBtn, isAccepting && styles.btnDisabled]}
          onPress={() => onAccept(request.id)}
          disabled={isAccepting || isDeclining}
        >
          {isAccepting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.acceptBtnText}>Accept</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.declineBtn, isDeclining && styles.btnDisabled]}
          onPress={() => onDecline(request.id)}
          disabled={isAccepting || isDeclining}
        >
          {isDeclining ? (
            <ActivityIndicator color="#9ca3af" size="small" />
          ) : (
            <Text style={styles.declineBtnText}>Decline</Text>
          )}
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    padding: 20,
    borderLeftWidth: 4,
    borderLeftColor: "#eb7825",
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarInitials: {
    color: "#9ca3af",
    fontSize: 16,
    fontWeight: "600",
  },
  textBlock: {
    flex: 1,
  },
  name: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  sub: {
    color: "#9ca3af",
    fontSize: 13,
    marginTop: 2,
  },
  description: {
    color: "#6b7280",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: "#eb7825",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  acceptBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  declineBtn: {
    flex: 1,
    backgroundColor: "#2a2a2a",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  declineBtnText: {
    color: "#9ca3af",
    fontWeight: "600",
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
