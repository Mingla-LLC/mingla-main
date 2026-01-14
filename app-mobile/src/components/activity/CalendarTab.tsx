import React, { useState, useMemo } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  Linking,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import ProposeDateTimeModal from "./ProposeDateTimeModal";

interface CalendarEntry {
  id: string;
  title: string;
  category: string;
  categoryIcon: any;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  date: string;
  time: string;
  source: "solo" | "collaboration";
  sourceDetails: string;
  priceRange: string;
  description: string;
  fullDescription: string;
  address: string;
  highlights: string[];
  socialStats: {
    views: number;
    likes: number;
    saves: number;
  };
  status: "confirmed" | "pending" | "completed";
  experience?: any;
  suggestedDates?: string[];
  sessionType?: string;
  sessionName?: string;
  purchaseOption?: any;
  isPurchased?: boolean;
  dateTimePreferences?: any;
  phoneNumber?: string;
  website?: string;
}

interface CalendarTabProps {
  calendarEntries: CalendarEntry[];
  onRemoveFromCalendar: (entry: CalendarEntry) => void;
  onShareCard: (card: any) => void;
  onAddToCalendar: (entry: CalendarEntry) => void;
  onShowQRCode: (entryId: string) => void;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
}

const CalendarTab = ({
  calendarEntries,
  onRemoveFromCalendar,
  onShareCard,
  onAddToCalendar,
  onShowQRCode,
  userPreferences,
  accountPreferences,
}: CalendarTabProps) => {
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<{
    [cardId: string]: number;
  }>({});
  const [removingEntryId, setRemovingEntryId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"active" | "archive">("active");
  const [showProposeDateTimeModal, setShowProposeDateTimeModal] =
    useState(false);
  const [entryToReschedule, setEntryToReschedule] =
    useState<CalendarEntry | null>(null);

  // Filter entries into Active and Archive based on scheduled date
  const { activeEntries, archiveEntries } = useMemo(() => {
    const now = new Date();
    const active: CalendarEntry[] = [];
    const archive: CalendarEntry[] = [];

    calendarEntries.forEach((entry) => {
      // Check if entry has a scheduled date
      const scheduledDate = entry.suggestedDates?.[0]
        ? new Date(entry.suggestedDates[0])
        : entry.date && entry.time
        ? new Date(`${entry.date}T${entry.time}`)
        : null;

      if (scheduledDate && scheduledDate < now) {
        // Past date - add to archive
        archive.push(entry);
      } else {
        // Future date or no date - add to active
        active.push(entry);
      }
    });

    return { activeEntries: active, archiveEntries: archive };
  }, [calendarEntries]);

  // Get entries for current tab
  const currentEntries =
    activeTab === "active" ? activeEntries : archiveEntries;

  const handleReschedule = (entry: CalendarEntry) => {
    setEntryToReschedule(entry);
    setShowProposeDateTimeModal(true);
  };

  const handleProposeDateTime = (
    date: Date,
    dateOption: "now" | "today" | "weekend" | "custom"
  ) => {
    if (!entryToReschedule) return;

    setShowProposeDateTimeModal(false);
    // Update the calendar entry with new date
    // This will need to call a service to update the entry
    const updatedEntry = {
      ...entryToReschedule,
      suggestedDates: [date.toISOString()],
    };
    // Call onAddToCalendar to update the entry
    onAddToCalendar(updatedEntry);
    setEntryToReschedule(null);
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    listContent: {
      gap: 16,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 62, // Add padding to prevent tab bar from touching last card
    },
    calendarCard: {
      backgroundColor: "white",
      borderRadius: 16,
      borderWidth: 1,
      borderColor: "#e5e7eb",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
      overflow: "hidden",
    },
    cardContent: {
      padding: 16,
    },
    cardHeader: {
      flexDirection: "row",
      gap: 12,
    },
    cardImage: {
      width: 64,
      height: 64,
      borderRadius: 12,
      overflow: "hidden",
    },
    cardInfo: {
      flex: 1,
      minWidth: 0,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: "#111827",
      marginBottom: 8,
    },
    cardCategory: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    categoryIcon: {
      width: 16,
      height: 16,
      color: "#eb7825",
    },
    categoryText: {
      fontSize: 14,
      color: "#6b7280",
    },
    dateTimeInfo: {
      alignItems: "flex-end",
    },
    dateText: {
      fontSize: 14,
      fontWeight: "500",
      color: "#111827",
    },
    timeText: {
      fontSize: 12,
      color: "#6b7280",
    },
    cardMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      marginBottom: 8,
    },
    metaItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    metaIcon: {
      width: 16,
      height: 16,
      color: "#eb7825",
    },
    metaText: {
      fontSize: 14,
      color: "#6b7280",
    },
    priceText: {
      fontSize: 14,
      fontWeight: "600",
      color: "#eb7825",
    },
    statusIndicators: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 8,
    },
    sessionBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
    },
    soloBadge: {
      backgroundColor: "#dbeafe",
    },
    collaborationBadge: {
      backgroundColor: "#f3e8ff",
    },
    soloText: {
      color: "#1e40af",
    },
    collaborationText: {
      color: "#7c3aed",
    },
    sourceText: {
      fontSize: 12,
      fontWeight: "500",
    },
    statusText: {
      fontSize: 12,
      fontWeight: "500",
    },
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
      flexShrink: 0,
    },
    confirmedBadge: {
      backgroundColor: "#dcfce7",
    },
    completedBadge: {
      backgroundColor: "#dbeafe",
    },
    pendingBadge: {
      backgroundColor: "#fef3c7",
    },
    confirmedText: {
      color: "#166534",
    },
    completedText: {
      color: "#1e40af",
    },
    pendingText: {
      color: "#92400e",
    },
    purchaseDetails: {
      paddingHorizontal: 16,
    },
    purchaseCard: {
      padding: 12,
      backgroundColor: "#ecfdf5",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#a7f3d0",
      marginBottom: 16,
    },
    purchaseHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    purchaseIcon: {
      width: 16,
      height: 16,
      color: "#059669",
    },
    purchaseTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: "#065f46",
    },
    purchaseDetailsList: {
      gap: 4,
    },
    purchaseDetailRow: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    purchaseLabel: {
      fontSize: 12,
      color: "#047857",
    },
    purchaseValue: {
      fontSize: 12,
      fontWeight: "500",
      color: "#047857",
    },
    purchaseFeatures: {
      marginTop: 8,
    },
    purchaseFeaturesTitle: {
      fontSize: 12,
      color: "#047857",
      marginBottom: 4,
    },
    purchaseFeaturesList: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
    },
    purchaseFeature: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      backgroundColor: "#a7f3d0",
      borderRadius: 12,
    },
    purchaseFeatureText: {
      fontSize: 12,
      color: "#047857",
    },
    actionsContainer: {
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    actionsRow: {
      flexDirection: "row",
      gap: 8,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: "#eb7825",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: "center",
    },
    primaryButtonText: {
      color: "white",
      fontSize: 16,
      fontWeight: "500",
    },
    secondaryButton: {
      flex: 1,
      backgroundColor: "white",
      borderWidth: 1,
      borderColor: "#eb7825",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: "center",
    },
    secondaryButtonText: {
      color: "#eb7825",
      fontSize: 16,
      fontWeight: "500",
    },
    tertiaryButton: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: "#e5e7eb",
      borderRadius: 12,
    },
    tertiaryButtonIcon: {
      width: 20,
      height: 20,
      color: "#6b7280",
    },
    purchasedButton: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: "#a7f3d0",
      backgroundColor: "#ecfdf5",
      borderRadius: 12,
    },
    purchasedButtonIcon: {
      width: 20,
      height: 20,
      color: "#059669",
    },
    qrButton: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: "#93c5fd",
      backgroundColor: "#dbeafe",
      borderRadius: 12,
    },
    qrButtonIcon: {
      width: 20,
      height: 20,
      color: "#2563eb",
    },
    expandedContent: {
      borderTopWidth: 1,
      borderTopColor: "#f3f4f6",
      backgroundColor: "#f9fafb",
    },
    imageGallery: {
      position: "relative",
    },
    galleryImage: {
      aspectRatio: 16 / 9,
      overflow: "hidden",
    },
    imageNavigation: {
      position: "absolute",
      top: "50%",
      transform: [{ translateY: -16 }],
      width: 32,
      height: 32,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    leftNav: {
      left: 8,
    },
    rightNav: {
      right: 8,
    },
    navIcon: {
      width: 16,
      height: 16,
      color: "white",
    },
    imageIndicators: {
      position: "absolute",
      bottom: 8,
      left: "50%",
      transform: [{ translateX: -50 }],
      flexDirection: "row",
      gap: 4,
    },
    indicator: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    activeIndicator: {
      backgroundColor: "white",
    },
    inactiveIndicator: {
      backgroundColor: "rgba(255, 255, 255, 0.5)",
    },
    detailsSection: {
      padding: 16,
      gap: 16,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: "#111827",
      marginBottom: 8,
    },
    sectionText: {
      fontSize: 14,
      color: "#6b7280",
      lineHeight: 20,
    },
    highlightsContainer: {
      gap: 8,
    },
    highlightsList: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    highlightTag: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: "#fef3e2",
      borderRadius: 8,
    },
    highlightText: {
      fontSize: 12,
      color: "#ea580c",
    },
    scheduleDetails: {
      gap: 8,
    },
    scheduleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    scheduleIcon: {
      width: 16,
      height: 16,
      color: "#eb7825",
    },
    scheduleText: {
      fontSize: 14,
      color: "#6b7280",
    },
    preferencesContainer: {
      gap: 8,
    },
    preferencesTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: "#111827",
      marginBottom: 8,
    },
    preferencesList: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    preferenceTag: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: "#dbeafe",
      borderRadius: 8,
    },
    preferenceText: {
      fontSize: 12,
      color: "#1e40af",
    },
    contactContainer: {
      gap: 8,
    },
    contactTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: "#111827",
      marginBottom: 8,
    },
    contactRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    contactIcon: {
      width: 16,
      height: 16,
      color: "#eb7825",
    },
    contactText: {
      fontSize: 14,
      color: "#6b7280",
    },
    contactLink: {
      fontSize: 14,
      color: "#eb7825",
      textDecorationLine: "underline",
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: 48,
    },
    emptyStateIcon: {
      width: 48,
      height: 48,
      color: "#d1d5db",
      marginBottom: 16,
    },
    emptyStateTitle: {
      fontSize: 18,
      fontWeight: "500",
      color: "#111827",
      marginBottom: 8,
    },
    emptyStateSubtitle: {
      fontSize: 14,
      color: "#6b7280",
      textAlign: "center",
      marginBottom: 24,
    },
    tabsContainer: {
      flexDirection: "row",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
      backgroundColor: "white",
      borderBottomWidth: 1,
      borderBottomColor: "#e5e7eb",
    },
    tab: {
      flex: 1,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    tabActive: {
      borderBottomColor: "#ea580c",
    },
    tabText: {
      fontSize: 16,
      fontWeight: "500",
      color: "#6b7280",
    },
    tabTextActive: {
      color: "#ea580c",
      fontWeight: "600",
    },
    tabCount: {
      fontSize: 12,
      color: "#9ca3af",
      marginTop: 2,
    },
    tabCountActive: {
      color: "#ea580c",
    },
    rescheduleButton: {
      flex: 1,
      backgroundColor: "#eb7825",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 12,
    },
    rescheduleButtonText: {
      color: "white",
      fontSize: 16,
      fontWeight: "600",
    },
  });

  const getIconComponent = (iconName: any) => {
    if (typeof iconName === "function") {
      return iconName;
    }

    const iconMap: { [key: string]: string } = {
      Coffee: "cafe",
      TreePine: "leaf",
      Sparkles: "sparkles",
      Dumbbell: "fitness",
      Utensils: "restaurant",
      Eye: "eye",
      Heart: "heart",
      Calendar: "calendar",
      MapPin: "location",
      Clock: "time",
      Star: "star",
      Navigation: "navigate",
      Users: "people",
      Check: "checkmark",
      ThumbsUp: "thumbs-up",
      ThumbsDown: "thumbs-down",
      MessageSquare: "chatbubble",
      Share2: "share",
      X: "close",
      ChevronRight: "chevron-forward",
      ChevronLeft: "chevron-back",
      Bookmark: "bookmark",
    };

    return iconMap[iconName] || "heart";
  };

  const nextImage = (cardId: string, totalImages: number) => {
    setCurrentImageIndex((prev) => ({
      ...prev,
      [cardId]: ((prev[cardId] || 0) + 1) % totalImages,
    }));
  };

  const prevImage = (cardId: string, totalImages: number) => {
    setCurrentImageIndex((prev) => ({
      ...prev,
      [cardId]: ((prev[cardId] || 0) - 1 + totalImages) % totalImages,
    }));
  };

  const formatCurrency = (price: number, currency: string = "USD") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(price);
  };

  const handleOpenMaps = (address: string) => {
    const query = encodeURIComponent(address);
    const url = `https://maps.google.com/maps?q=${query}`;
    Linking.openURL(url);
  };

  const handleRemoveFromCalendar = async (entry: CalendarEntry) => {
    if (removingEntryId) return; // Prevent multiple simultaneous removals

    setRemovingEntryId(entry.id);
    try {
      await onRemoveFromCalendar(entry);
    } catch (error) {
      console.error("Error removing from calendar:", error);
    } finally {
      setRemovingEntryId(null);
    }
  };

  const renderCalendarEntry = ({ item: entry }: { item: CalendarEntry }) => {
    const ExperienceIcon = getIconComponent(
      entry.experience?.categoryIcon || entry.categoryIcon
    );

    return (
      <View style={styles.calendarCard}>
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={styles.cardImage}>
              <ImageWithFallback
                source={{ uri: entry.experience?.image || entry.image }}
                alt={entry.experience?.title || entry.title}
                style={{ width: "100%", height: "100%" }}
              />
            </View>

            <View style={styles.cardInfo}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>
                    {entry.experience?.title || entry.title}
                  </Text>
                  <View style={styles.cardCategory}>
                    <Ionicons name={ExperienceIcon} size={16} color="#eb7825" />
                    <Text style={styles.categoryText}>
                      {entry.experience?.category || entry.category}
                    </Text>
                  </View>
                </View>
                <View style={styles.dateTimeInfo}>
                  <Text style={styles.dateText}>
                    {entry.suggestedDates?.[0]
                      ? new Date(entry.suggestedDates[0]).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" }
                        )
                      : "TBD"}
                  </Text>
                  <Text style={styles.timeText}>
                    {entry.suggestedDates?.[0]
                      ? new Date(entry.suggestedDates[0]).toLocaleTimeString(
                          "en-US",
                          { hour: "numeric", minute: "2-digit", hour12: true }
                        )
                      : ""}
                  </Text>
                </View>
              </View>

              <View style={styles.cardMeta}>
                <View style={styles.metaItem}>
                  <Ionicons name="star" size={16} color="#eb7825" />
                  <Text style={styles.metaText}>
                    {entry.experience?.rating || "4.5"}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons name="navigate" size={16} color="#eb7825" />
                  <Text style={styles.metaText}>
                    {entry.experience?.travelTime || "15 min"}
                  </Text>
                </View>
                {entry.purchaseOption ? (
                  <View style={styles.metaItem}>
                    <Ionicons name="bag" size={16} color="#16a34a" />
                    <Text
                      style={[
                        styles.metaText,
                        { color: "#16a34a", fontWeight: "600" },
                      ]}
                    >
                      {formatCurrency(
                        entry.purchaseOption.price,
                        entry.purchaseOption.currency ||
                          accountPreferences?.currency ||
                          "USD"
                      )}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.priceText}>
                    {entry.experience?.priceRange || "$25-50"}
                  </Text>
                )}
              </View>

              {/* Session type and status indicators */}
              <View style={styles.statusIndicators}>
                <View
                  style={[
                    styles.sessionBadge,
                    entry.sessionType === "solo"
                      ? styles.soloBadge
                      : styles.collaborationBadge,
                  ]}
                >
                  <Ionicons
                    name={entry.sessionType === "solo" ? "eye" : "people"}
                    size={12}
                    color={entry.sessionType === "solo" ? "#1e40af" : "#7c3aed"}
                  />
                  <Text
                    style={[
                      styles.sourceText,
                      entry.sessionType === "solo"
                        ? styles.soloText
                        : styles.collaborationText,
                    ]}
                  >
                    {entry.sessionType === "solo"
                      ? "Solo Plan"
                      : entry.sessionName || "Group Plan"}
                  </Text>
                </View>

                <View
                  style={[
                    styles.statusBadge,
                    entry.status === "confirmed"
                      ? styles.confirmedBadge
                      : entry.status === "completed"
                      ? styles.completedBadge
                      : styles.pendingBadge,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      entry.status === "confirmed"
                        ? styles.confirmedText
                        : entry.status === "completed"
                        ? styles.completedText
                        : styles.pendingText,
                    ]}
                  >
                    {entry.status === "confirmed"
                      ? "Confirmed"
                      : entry.status === "completed"
                      ? "Completed"
                      : "Pending"}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Purchase Details Section */}
          {entry.purchaseOption && (
            <View style={styles.purchaseDetails}>
              <View style={styles.purchaseCard}>
                <View style={styles.purchaseHeader}>
                  <Ionicons name="bag" size={16} color="#059669" />
                  <Text style={styles.purchaseTitle}>Purchase Details</Text>
                </View>
                <View style={styles.purchaseDetailsList}>
                  <View style={styles.purchaseDetailRow}>
                    <Text style={styles.purchaseLabel}>Option:</Text>
                    <Text style={styles.purchaseValue}>
                      {entry.purchaseOption.title}
                    </Text>
                  </View>
                  <View style={styles.purchaseDetailRow}>
                    <Text style={styles.purchaseLabel}>Price:</Text>
                    <Text style={styles.purchaseValue}>
                      {formatCurrency(
                        entry.purchaseOption.price,
                        entry.purchaseOption.currency ||
                          accountPreferences?.currency ||
                          "USD"
                      )}
                    </Text>
                  </View>
                  {entry.purchaseOption.duration && (
                    <View style={styles.purchaseDetailRow}>
                      <Text style={styles.purchaseLabel}>Duration:</Text>
                      <Text style={styles.purchaseValue}>
                        {entry.purchaseOption.duration}
                      </Text>
                    </View>
                  )}
                  {entry.purchaseOption.includes &&
                    entry.purchaseOption.includes.length > 0 && (
                      <View style={styles.purchaseFeatures}>
                        <Text style={styles.purchaseFeaturesTitle}>
                          Includes:
                        </Text>
                        <View style={styles.purchaseFeaturesList}>
                          {entry.purchaseOption.includes
                            .slice(0, 3)
                            .map((item: string, index: number) => (
                              <View key={index} style={styles.purchaseFeature}>
                                <Text style={styles.purchaseFeatureText}>
                                  {item}
                                </Text>
                              </View>
                            ))}
                          {entry.purchaseOption.includes.length > 3 && (
                            <View style={styles.purchaseFeature}>
                              <Text style={styles.purchaseFeatureText}>
                                +{entry.purchaseOption.includes.length - 3} more
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                    )}
                </View>
              </View>
            </View>
          )}

          {/* Calendar Actions */}
          <View style={styles.actionsContainer}>
            <View style={styles.actionsRow}>
              {/* Show Re Schedule button for archived entries */}
              {activeTab === "archive" ? (
                <TouchableOpacity
                  onPress={() => handleReschedule(entry)}
                  style={styles.rescheduleButton}
                >
                  <Ionicons name="calendar" size={20} color="white" />
                  <Text style={styles.rescheduleButtonText}>Re Schedule</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={() =>
                      handleOpenMaps(
                        entry.experience?.address || "Current Location"
                      )
                    }
                    style={styles.primaryButton}
                  >
                    <Ionicons name="location" size={20} color="white" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => onAddToCalendar(entry)}
                    style={styles.secondaryButton}
                  >
                    <Ionicons name="calendar" size={20} color="#eb7825" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => onShareCard(entry.experience)}
                    style={styles.tertiaryButton}
                  >
                    <Ionicons name="share" size={20} color="#6b7280" />
                  </TouchableOpacity>

                  {/* Show remove button only for non-purchased entries */}
                  {!entry.purchaseOption && !entry.isPurchased ? (
                    <TouchableOpacity
                      onPress={() => handleRemoveFromCalendar(entry)}
                      style={styles.tertiaryButton}
                      disabled={removingEntryId === entry.id}
                    >
                      {removingEntryId === entry.id ? (
                        <ActivityIndicator size="small" color="#6b7280" />
                      ) : (
                        <Ionicons name="close" size={20} color="#6b7280" />
                      )}
                    </TouchableOpacity>
                  ) : (
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={styles.purchasedButton}>
                        <Ionicons
                          name="lock-closed"
                          size={20}
                          color="#059669"
                        />
                      </View>

                      {/* QR Code Button for Purchased Items */}
                      <TouchableOpacity
                        onPress={() => onShowQRCode(entry.id)}
                        style={styles.qrButton}
                      >
                        <Ionicons name="qr-code" size={20} color="#2563eb" />
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </View>
          </View>

          {/* Expanded Calendar Details */}
          {expandedCard === entry.id && (
            <View style={styles.expandedContent}>
              {/* Image Gallery */}
              {entry.experience?.images &&
                entry.experience.images.length > 0 && (
                  <View style={styles.imageGallery}>
                    <View style={styles.galleryImage}>
                      <ImageWithFallback
                        source={{
                          uri: entry.experience.images[
                            currentImageIndex[entry.id] || 0
                          ],
                        }}
                        alt={entry.experience.title}
                        style={{ width: "100%", height: "100%" }}
                      />

                      {entry.experience.images.length > 1 && (
                        <>
                          <TouchableOpacity
                            onPress={() =>
                              prevImage(
                                entry.id,
                                entry.experience.images.length
                              )
                            }
                            style={[styles.imageNavigation, styles.leftNav]}
                          >
                            <Ionicons
                              name="chevron-back"
                              size={16}
                              color="white"
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() =>
                              nextImage(
                                entry.id,
                                entry.experience.images.length
                              )
                            }
                            style={[styles.imageNavigation, styles.rightNav]}
                          >
                            <Ionicons
                              name="chevron-forward"
                              size={16}
                              color="white"
                            />
                          </TouchableOpacity>

                          {/* Image indicators */}
                          <View style={styles.imageIndicators}>
                            {entry.experience.images.map(
                              (_: any, index: number) => (
                                <View
                                  key={index}
                                  style={[
                                    styles.indicator,
                                    index === (currentImageIndex[entry.id] || 0)
                                      ? styles.activeIndicator
                                      : styles.inactiveIndicator,
                                  ]}
                                />
                              )
                            )}
                          </View>
                        </>
                      )}
                    </View>
                  </View>
                )}

              {/* Details */}
              <View style={styles.detailsSection}>
                <View>
                  <Text style={styles.sectionTitle}>About this experience</Text>
                  <Text style={styles.sectionText}>
                    {entry.experience?.fullDescription ||
                      entry.experience?.description ||
                      "Join us for this amazing experience! Perfect for creating memorable moments."}
                  </Text>
                </View>

                {entry.experience?.highlights &&
                  entry.experience.highlights.length > 0 && (
                    <View style={styles.highlightsContainer}>
                      <Text style={styles.sectionTitle}>Highlights</Text>
                      <View style={styles.highlightsList}>
                        {entry.experience.highlights.map(
                          (highlight: string, index: number) => (
                            <View key={index} style={styles.highlightTag}>
                              <Text style={styles.highlightText}>
                                {highlight}
                              </Text>
                            </View>
                          )
                        )}
                      </View>
                    </View>
                  )}

                {/* Date & Time Details */}
                <View style={styles.scheduleDetails}>
                  <Text style={styles.sectionTitle}>Schedule Details</Text>
                  <View style={styles.scheduleRow}>
                    <Ionicons name="calendar" size={16} color="#eb7825" />
                    <Text style={styles.scheduleText}>
                      {entry.suggestedDates?.[0]
                        ? new Date(entry.suggestedDates[0]).toLocaleDateString(
                            "en-US",
                            {
                              weekday: "long",
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            }
                          )
                        : "Date to be determined"}
                    </Text>
                  </View>
                  <View style={styles.scheduleRow}>
                    <Ionicons name="time" size={16} color="#eb7825" />
                    <Text style={styles.scheduleText}>
                      {entry.suggestedDates?.[0]
                        ? new Date(entry.suggestedDates[0]).toLocaleTimeString(
                            "en-US",
                            {
                              hour: "numeric",
                              minute: "2-digit",
                              hour12: true,
                            }
                          )
                        : "Time to be determined"}
                    </Text>
                  </View>
                  <View style={styles.scheduleRow}>
                    <Ionicons name="location" size={16} color="#eb7825" />
                    <Text style={styles.scheduleText}>
                      {entry.experience?.address ||
                        "Location details will be provided"}
                    </Text>
                  </View>
                </View>

                {/* Date/Time Preferences Applied */}
                {entry.dateTimePreferences && (
                  <View style={styles.preferencesContainer}>
                    <Text style={styles.preferencesTitle}>
                      Your Preferences Applied
                    </Text>
                    <View style={styles.preferencesList}>
                      <View style={styles.preferenceTag}>
                        <Text style={styles.preferenceText}>
                          {entry.dateTimePreferences.timeOfDay}
                        </Text>
                      </View>
                      <View style={styles.preferenceTag}>
                        <Text style={styles.preferenceText}>
                          {entry.dateTimePreferences.dayOfWeek}
                        </Text>
                      </View>
                      <View style={styles.preferenceTag}>
                        <Text style={styles.preferenceText}>
                          {entry.dateTimePreferences.planningTimeframe}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* Contact Information */}
                {(entry.experience?.phoneNumber ||
                  entry.experience?.website) && (
                  <View style={styles.contactContainer}>
                    <Text style={styles.contactTitle}>Contact Information</Text>
                    {entry.experience.phoneNumber && (
                      <View style={styles.contactRow}>
                        <Text>📞</Text>
                        <Text style={styles.contactText}>
                          {entry.experience.phoneNumber}
                        </Text>
                      </View>
                    )}
                    {entry.experience.website && (
                      <View style={styles.contactRow}>
                        <Ionicons name="link" size={16} color="#eb7825" />
                        <Text style={styles.contactLink}>Visit Website</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderEmptyComponent = () => {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="calendar" size={48} color="#d1d5db" />
        <Text style={styles.emptyStateTitle}>No Scheduled Experiences</Text>
        <Text style={styles.emptyStateSubtitle}>
          Save and schedule experiences to see them here
        </Text>
      </View>
    );
  };

  // Convert CalendarEntry to SavedCard format for ProposeDateTimeModal
  const entryToCard = (entry: CalendarEntry) => {
    return {
      id: entry.id,
      title: entry.experience?.title || entry.title,
      category: entry.experience?.category || entry.category,
      categoryIcon: entry.experience?.categoryIcon || entry.categoryIcon,
      image: entry.experience?.image || entry.image,
      images: entry.experience?.images || entry.images,
      rating: entry.experience?.rating || entry.rating,
      reviewCount: entry.experience?.reviewCount || entry.reviewCount,
      priceRange: entry.experience?.priceRange || entry.priceRange,
      travelTime: entry.experience?.travelTime,
      description: entry.experience?.description || entry.description,
      fullDescription:
        entry.experience?.fullDescription || entry.fullDescription,
      address: entry.experience?.address || entry.address,
      openingHours: entry.experience?.openingHours,
      highlights: entry.experience?.highlights || entry.highlights,
      matchScore: entry.experience?.matchScore,
      socialStats: entry.experience?.socialStats || entry.socialStats,
      source: entry.source || "solo",
      dateAdded: entry.suggestedDates?.[0] || entry.date,
    };
  };

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "active" && styles.tabActive]}
          onPress={() => setActiveTab("active")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "active" && styles.tabTextActive,
            ]}
          >
            Active
          </Text>
          <Text
            style={[
              styles.tabCount,
              activeTab === "active" && styles.tabCountActive,
            ]}
          >
            ({activeEntries.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "archive" && styles.tabActive]}
          onPress={() => setActiveTab("archive")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "archive" && styles.tabTextActive,
            ]}
          >
            Archives
          </Text>
          <Text
            style={[
              styles.tabCount,
              activeTab === "archive" && styles.tabCountActive,
            ]}
          >
            ({archiveEntries.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Propose Date & Time Modal */}
      {entryToReschedule && (
        <ProposeDateTimeModal
          visible={showProposeDateTimeModal}
          onClose={() => {
            setShowProposeDateTimeModal(false);
            setEntryToReschedule(null);
          }}
          card={entryToCard(entryToReschedule)}
          currentScheduledDate={
            entryToReschedule.suggestedDates?.[0] ||
            (entryToReschedule.date && entryToReschedule.time
              ? `${entryToReschedule.date}T${entryToReschedule.time}`
              : null)
          }
          onProposeDateTime={handleProposeDateTime}
        />
      )}

      <FlatList
        data={currentEntries}
        renderItem={renderCalendarEntry}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyComponent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

export default CalendarTab;
