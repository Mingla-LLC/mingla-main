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
  openingHours?: string;
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

  const handleWebsitePress = () => {
    if (website) {
      let url = website;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `https://${url}`;
      }
      Linking.openURL(url);
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

  // Parse opening hours if it's a string
  const formatOpeningHours = (hours: string | undefined): string[] => {
    if (!hours) return [];

    // If it's already formatted as an array of strings, return as is
    if (Array.isArray(hours)) {
      return hours;
    }

    // Try to parse different formats
    try {
      // If it's JSON string, parse it
      const parsed = JSON.parse(hours);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Not JSON, treat as plain string
    }

    // Split by newlines or commas
    return hours.split(/\n|, /).filter((h) => h.trim().length > 0);
  };

  const hoursArray = formatOpeningHours(openingHours);

  const hasAnyDetails = address || openingHours || phone || website;

  if (!hasAnyDetails) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* <View style={styles.header}>
        <Ionicons name="information-circle" size={20} color="#eb7825" />
        <Text style={styles.title}>Practical Details</Text>
      </View> */}

      <View style={styles.detailsContainer}>
        {/* Address */}
        {address && (
          <TouchableOpacity
            style={styles.detailRow}
            onPress={handleAddressPress}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <Ionicons name="location" size={20} color="#6b7280" />
            </View>
            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>Address</Text>
              <Text style={styles.detailValue}>{address}</Text>
              <Text style={styles.detailAction}>Tap to open in Maps</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>
        )}

        {/* Opening Hours */}
        {hoursArray.length > 0 && (
          <View style={styles.detailRow}>
            <View style={styles.iconContainer}>
              <Ionicons name="time" size={20} color="#6b7280" />
            </View>
            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>Opening Hours</Text>
              {hoursArray.map((hour, index) => (
                <Text key={index} style={styles.detailValue}>
                  {hour}
                </Text>
              ))}
            </View>
          </View>
        )}

        {/* Phone */}
        {phone && (
          <TouchableOpacity
            style={styles.detailRow}
            onPress={handlePhonePress}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <Ionicons name="call" size={20} color="#6b7280" />
            </View>
            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>Phone</Text>
              <Text style={styles.detailValue}>{phone}</Text>
              <Text style={styles.detailAction}>Tap to call</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>
        )}

        {/* Website */}
        {website && (
          <TouchableOpacity
            style={styles.detailRow}
            onPress={handleWebsitePress}
            activeOpacity={0.7}
          >
            <View style={styles.iconContainer}>
              <Ionicons name="globe" size={20} color="#6b7280" />
            </View>
            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>Website</Text>
              <Text style={[styles.detailValue, styles.websiteText]}>
                {website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </Text>
              <Text style={styles.detailAction}>Tap to visit</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#ffffff",
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  detailsContainer: {
    paddingHorizontal: 16,
    gap: 0,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
    gap: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f9fafb",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 2,
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "500",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 15,
    color: "#111827",
    lineHeight: 22,
    marginBottom: 4,
  },
  detailAction: {
    fontSize: 12,
    color: "#eb7825",
    fontWeight: "500",
    marginTop: 2,
  },
  websiteText: {
    color: "#3b82f6",
  },
});
