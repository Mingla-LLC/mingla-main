import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ExpandedCardData, BookingOption } from "../../types/expandedCardTypes";

interface ActionButtonsProps {
  card: ExpandedCardData;
  bookingOptions: BookingOption[];
  onSave: (card: ExpandedCardData) => Promise<void> | void;
  onSchedule?: (card: ExpandedCardData) => void;
  onPurchase?: (card: ExpandedCardData, bookingOption: BookingOption) => void;
  onShare?: (card: ExpandedCardData) => void;
  onClose?: () => void;
  isSaved?: boolean;
}

export default function ActionButtons({
  card,
  bookingOptions,
  onSave,
  onSchedule,
  onPurchase,
  onShare,
  onClose,
  isSaved = false,
}: ActionButtonsProps) {
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (isSaving) return; // Prevent multiple saves

    setIsSaving(true);
    try {
      // onSave will handle saving, moving to next card, and closing modal
      await onSave(card);
    } catch (error: any) {
      // Error saving - show alert but don't close modal
      // (onSave already handles 23505 "already saved" case and closes modal)
      Alert.alert("Error", "Failed to save the card. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSchedule = () => {
    if (onSchedule) {
      onSchedule(card);
    } else {
      Alert.alert("Scheduled", `${card.title} has been added to your calendar`);
    }
  };

  const handleBuyNow = () => {
    if (bookingOptions.length > 0) {
      const primaryOption = bookingOptions[0];
      if (onPurchase) {
        onPurchase(card, primaryOption);
      } else if (primaryOption.url) {
        // Open booking URL
        Linking.openURL(primaryOption.url);
      } else if (primaryOption.phone) {
        // Open phone dialer
        Linking.openURL(`tel:${primaryOption.phone.replace(/[^0-9+]/g, "")}`);
      } else {
        Alert.alert("Booking", primaryOption.message);
      }
    } else if (card.website) {
      // Fallback to website
      let url = card.website;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `https://${url}`;
      }
      Linking.openURL(url);
    } else if (card.phone) {
      // Fallback to phone
      Linking.openURL(`tel:${card.phone.replace(/[^0-9+]/g, "")}`);
    } else {
      Alert.alert(
        "Booking",
        "Booking options are not available for this experience"
      );
    }
  };

  const handleShare = () => {
    if (onShare) {
      onShare(card);
    } else {
      Alert.alert("Share", `Share ${card.title} with friends`);
    }
  };

  const handleNavigateFullRoute = () => {
    // Check if this is a stroll card with route data
    if (card.strollData?.timeline && card.strollData.timeline.length > 0) {
      const timeline = card.strollData.timeline;

      // Collect all waypoints with valid locations
      const waypoints: string[] = [];

      timeline.forEach((step) => {
        if (step.location) {
          if (step.location.lat && step.location.lng) {
            waypoints.push(`${step.location.lat},${step.location.lng}`);
          } else if (step.location.address) {
            // Use address if coordinates not available
            waypoints.push(encodeURIComponent(step.location.address));
          } else if (step.location.name) {
            // Use name as fallback
            waypoints.push(encodeURIComponent(step.location.name));
          }
        }
      });

      // If we have waypoints, create a Google Maps directions URL
      if (waypoints.length > 0) {
        // Use the first waypoint as origin and last as destination
        const origin = waypoints[0];
        const destination = waypoints[waypoints.length - 1];
        const intermediateWaypoints = waypoints.slice(1, -1);

        // Build Google Maps directions URL
        let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;

        if (intermediateWaypoints.length > 0) {
          // Google Maps supports up to 25 waypoints
          const waypointStr = intermediateWaypoints.join("|");
          url += `&waypoints=${waypointStr}`;
        }

        Linking.openURL(url).catch((err) => {
          console.error("Error opening maps:", err);
          Alert.alert("Error", "Could not open maps application");
        });
      } else {
        // Fallback to main card location
        if (card.location) {
          const url = `https://www.google.com/maps/search/?api=1&query=${card.location.lat},${card.location.lng}`;
          Linking.openURL(url).catch((err) => {
            console.error("Error opening maps:", err);
            Alert.alert("Error", "Could not open maps application");
          });
        } else {
          Alert.alert(
            "Navigation",
            "Location data not available for this route"
          );
        }
      }
    } else {
      // For non-stroll cards, navigate to the address
      if (card.address) {
        const encodedAddress = encodeURIComponent(card.address);
        const url = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
        Linking.openURL(url).catch((err) => {
          console.error("Error opening maps:", err);
          Alert.alert("Error", "Could not open maps application");
        });
      } else if (card.location) {
        // Fallback to coordinates if address not available
        const url = `https://www.google.com/maps/search/?api=1&query=${card.location.lat},${card.location.lng}`;
        Linking.openURL(url).catch((err) => {
          console.error("Error opening maps:", err);
          Alert.alert("Error", "Could not open maps application");
        });
      } else {
        Alert.alert("Navigation", "Location data not available");
      }
    }
  };

  const hasBookingOptions =
    bookingOptions.length > 0 || card.website || card.phone;

  return (
    <View style={styles.container}>
      {/* Top Row: Schedule Button + Share/Bookmark Button */}
      <View style={styles.topRow}>
        <TouchableOpacity
          style={styles.scheduleButton}
          onPress={handleSchedule}
          activeOpacity={0.7}
        >
          <Ionicons name="calendar-outline" size={20} color="#ffffff" />
          <Text style={styles.scheduleButtonText}>Schedule</Text>
        </TouchableOpacity>

        {/* Share and Bookmark Button */}
        <View style={styles.iconButtonsContainer}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleShare}
            activeOpacity={0.7}
          >
            <Ionicons name="share-outline" size={18} color="#6b7280" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconButton, isSaved && styles.iconButtonSaved]}
            onPress={handleSave}
            activeOpacity={0.7}
            disabled={isSaving || isSaved}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#eb7825" />
            ) : (
              <Ionicons
                name={isSaved ? "bookmark" : "bookmark-outline"}
                size={18}
                color={isSaved ? "#eb7825" : "#6b7280"}
              />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Navigate Full Route Button - Available for all cards */}
      <TouchableOpacity
        style={styles.navigateButton}
        onPress={handleNavigateFullRoute}
        activeOpacity={0.7}
      >
        <Ionicons name="paper-plane" size={20} color="#ffffff" />
        <Text style={styles.navigateButtonText}>Navigate Full Route</Text>
        <Ionicons name="open-outline" size={16} color="#ffffff" />
      </TouchableOpacity>

      {/* Buy Now Button - Full Width */}
      {hasBookingOptions && (
        <TouchableOpacity
          style={styles.buyNowButton}
          onPress={handleBuyNow}
          activeOpacity={0.8}
        >
          <Ionicons name="card" size={20} color="#ffffff" />
          <Text style={styles.buyNowButtonText}>Buy Now</Text>
          {bookingOptions.length > 0 && (
            <View style={styles.bookingBadge}>
              <Text style={styles.bookingBadgeText}>
                {bookingOptions[0].provider === "opentable"
                  ? "Reserve"
                  : bookingOptions[0].provider === "eventbrite"
                  ? "Get Tickets"
                  : bookingOptions[0].provider === "viator"
                  ? "Book"
                  : "Book Now"}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#ffffff",
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    gap: 12,
  },
  topRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  scheduleButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  scheduleButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  iconButtonsContainer: {
    flexDirection: "row",
    gap: 8,
  },
  iconButton: {
    width: 48,
    height: 48,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonSaved: {
    opacity: 0.6,
  },
  navigateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  navigateButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  buyNowButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    position: "relative",
  },
  buyNowButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
  },
  bookingBadge: {
    position: "absolute",
    top: 8,
    right: 12,
    backgroundColor: "#eb7825",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  bookingBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#ffffff",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 8,
  },
  shareButtonText: {
    fontSize: 15,
    color: "#6b7280",
    fontWeight: "500",
  },
});
