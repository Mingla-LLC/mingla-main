import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface PracticalDetailsSectionProps {
  address?: string;
  openingHours?:
    | string
    | {
        open_now?: boolean;
        weekday_text?: string[];
      }
    | null;
  phone?: string;
  website?: string;
}

export default function PracticalDetailsSection({
  address,
  openingHours,
  phone,
  website,
}: PracticalDetailsSectionProps) {
  const handlePhonePress = () => {
    if (phone) {
      Linking.openURL(`tel:${phone.replace(/[^0-9+]/g, "")}`);
    }
  };

  const handleAddressPress = () => {
    if (address) {
      const encodedAddress = encodeURIComponent(address);
      Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`
      );
    }
  };

  const hasAnyDetails = address || phone;

  if (!hasAnyDetails) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Address */}
      {address && (
        <TouchableOpacity
          style={styles.addressRow}
          onPress={handleAddressPress}
          activeOpacity={0.7}
        >
          <View style={styles.iconBadge}>
            <Ionicons name="location" size={14} color="#ea580c" />
          </View>
          <Text style={styles.addressText} numberOfLines={2}>{address}</Text>
          <Ionicons name="open-outline" size={13} color="#9ca3af" />
        </TouchableOpacity>
      )}

      {/* Phone row */}
      {phone && (
        <View style={styles.contactRow}>
          <TouchableOpacity
            style={styles.contactChip}
            onPress={handlePhonePress}
            activeOpacity={0.7}
          >
            <Ionicons name="call" size={13} color="#ea580c" />
            <Text style={styles.contactText} numberOfLines={1}>{phone}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef7f0",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#eb782533",
    gap: 8,
  },
  iconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#eb782544",
    justifyContent: "center",
    alignItems: "center",
  },
  addressText: {
    flex: 1,
    fontSize: 13,
    color: "#374151",
    lineHeight: 18,
  },
  contactRow: {
    flexDirection: "row",
    gap: 8,
  },
  contactChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef7f0",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#eb782533",
    gap: 6,
  },
  contactText: {
    flex: 1,
    fontSize: 12,
    color: "#374151",
  },
});
