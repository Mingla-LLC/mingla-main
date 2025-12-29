import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ExpandedCardModalProps } from "../types/expandedCardTypes";
import { weatherService, WeatherData } from "../services/weatherService";
import { busynessService, BusynessData } from "../services/busynessService";
import { bookingService, BookingOption } from "../services/bookingService";
import { ExperienceGenerationService } from "../services/experienceGenerationService";
import ExpandedCardHeader from "./expandedCard/ExpandedCardHeader";
import ImageGallery from "./expandedCard/ImageGallery";
import CardInfoSection from "./expandedCard/CardInfoSection";
import MatchScoreBox from "./expandedCard/MatchScoreBox";
import DescriptionSection from "./expandedCard/DescriptionSection";
import HighlightsSection from "./expandedCard/HighlightsSection";
import WeatherSection from "./expandedCard/WeatherSection";
import BusynessSection from "./expandedCard/BusynessSection";
import PracticalDetailsSection from "./expandedCard/PracticalDetailsSection";
import MatchFactorsBreakdown from "./expandedCard/MatchFactorsBreakdown";
import TimelineSection from "./expandedCard/TimelineSection";
import CompanionStopsSection from "./expandedCard/CompanionStopsSection";
import ActionButtons from "./expandedCard/ActionButtons";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function ExpandedCardModal({
  visible,
  card,
  onClose,
  onSave,
  onSchedule,
  onPurchase,
  onShare,
  userPreferences,
}: ExpandedCardModalProps) {
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [busynessData, setBusynessData] = useState<BusynessData | null>(null);
  const [bookingOptions, setBookingOptions] = useState<BookingOption[]>([]);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [loadingBusyness, setLoadingBusyness] = useState(false);
  const [loadingBooking, setLoadingBooking] = useState(false);
  const [strollData, setStrollData] = useState(card?.strollData);
  const [loadingStrollData, setLoadingStrollData] = useState(false);

  // Fetch additional data when modal opens
  useEffect(() => {
    if (visible && card) {
      fetchAdditionalData();
      setStrollData(card.strollData);
    } else {
      // Reset state when modal closes
      setWeatherData(null);
      setBusynessData(null);
      setBookingOptions([]);
      setStrollData(undefined);
    }
  }, [visible, card]);

  const fetchAdditionalData = async () => {
    if (!card) return;

    // Fetch weather data
    if (card.location) {
      setLoadingWeather(true);
      try {
        const weather = await weatherService.getWeatherForecast(
          card.location.lat,
          card.location.lng,
          card.selectedDateTime
        );
        setWeatherData(weather);
      } catch (error) {
        console.error("❌ Error fetching weather in modal:", error);
        setWeatherData(null);
      } finally {
        setLoadingWeather(false);
      }
    } else {
      console.warn("⚠️ No location data for weather fetch:", card);
    }

    // Fetch busyness data
    if (card.location) {
      setLoadingBusyness(true);
      try {
        // Use address and placeId if available (more reliable than name)
        const busyness = await busynessService.getVenueBusyness(
          card.title,
          card.location.lat,
          card.location.lng,
          card.address, // Use address for more reliable search
          (card as any).source?.placeId // Use placeId if available
        );
        setBusynessData(busyness);
      } catch (error) {
        console.error("Error fetching busyness:", error);
      } finally {
        setLoadingBusyness(false);
      }
    }

    // Fetch booking options
    if (card.location) {
      setLoadingBooking(true);
      try {
        const booking = await bookingService.getBookingOptions(
          card.title,
          card.category,
          card.location.lat,
          card.location.lng,
          card.website,
          card.phone
        );
        setBookingOptions(booking.options);
      } catch (error) {
        console.error("Error fetching booking options:", error);
      } finally {
        setLoadingBooking(false);
      }
    }
  };

  const fetchStrollData = async () => {
    if (!card) return;

    const isStrollCard =
      card.category?.toLowerCase().includes("stroll") ||
      card.category?.toLowerCase() === "take a stroll" ||
      card.category?.toLowerCase() === "take-a-stroll" ||
      card.category?.toLowerCase() === "take_a_stroll";

    if (!isStrollCard) return;

    // Create anchor from card data
    const anchor =
      strollData?.anchor ||
      (card.location && card.title
        ? {
            id: card.id,
            name: card.title,
            location: { lat: card.location.lat, lng: card.location.lng },
            address: card.address,
          }
        : null);

    if (!anchor) {
      console.warn("⚠️ Cannot fetch stroll data: missing anchor information");
      return;
    }

    setLoadingStrollData(true);
    try {
      const fetchedStrollData =
        await ExperienceGenerationService.fetchCompanionStrollData(anchor);
      if (fetchedStrollData) {
        setStrollData(fetchedStrollData);
        // Update the card's strollData if possible
        if (card) {
          (card as any).strollData = fetchedStrollData;
        }
      }
    } catch (err) {
      console.error("Error fetching companion stroll data:", err);
    } finally {
      setLoadingStrollData(false);
    }
  };

  if (!card) {
    return null;
  }

  const isStrollCard =
    card.category === "Take a Stroll" ||
    card.category?.toLowerCase().includes("stroll");

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.overlayBackground}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContainer}>
          {/* Sticky Header */}
          <ExpandedCardHeader matchScore={card.matchScore} onClose={onClose} />

          {/* Scrollable Content */}
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
          >
            {/* Image Gallery */}
            {card.images && card.images.length > 0 ? (
              <ImageGallery images={card.images} initialImage={card.image} />
            ) : (
              <View
                style={{
                  height: 200,
                  backgroundColor: "#f3f4f6",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text>No images available</Text>
              </View>
            )}

            {/* Card Info Section: Title, Tags, Metrics, Description */}
            <CardInfoSection
              title={card.title}
              category={card.category}
              categoryIcon={card.categoryIcon}
              tags={card.tags}
              rating={card.rating}
              travelTime={card.travelTime}
              priceRange={card.priceRange}
              description={card.description}
            />

            {/* Match Score Box */}
            <MatchScoreBox
              matchScore={card.matchScore}
              matchFactors={card.matchFactors}
              userPreferences={userPreferences}
              cardCategory={card.category}
            />

            {/* Highlights Section */}
            {/*  <HighlightsSection
              highlights={card.highlights}
              category={card.category}
            /> */}

            {/* Weather Section */}
            <WeatherSection
              weatherData={weatherData}
              loading={loadingWeather}
              category={card.category}
              selectedDateTime={card.selectedDateTime}
            />

            {/* Busyness Section */}
            <BusynessSection
              busynessData={busynessData}
              loading={loadingBusyness}
              travelTime={card.travelTime}
            />

            {/* Practical Details Section */}
            <PracticalDetailsSection
              address={card.address}
              openingHours={card.openingHours}
              phone={card.phone}
              website={card.website}
            />

            {/* Match Factors Breakdown */}
            {/*  <MatchFactorsBreakdown matchFactors={card.matchFactors} /> */}

            {/* Companion Stops Section (for stroll cards) */}
            {strollData && strollData.companionStops && (
              <CompanionStopsSection
                companionStops={strollData.companionStops}
              />
            )}

            {/* Timeline Section or "See Route Pairing" Button (only for Take a Stroll cards) */}
            {isStrollCard && (
              <>
                {strollData && strollData.timeline ? (
                  <TimelineSection
                    category={card.category}
                    title={card.title}
                    address={card.address}
                    priceRange={card.priceRange}
                    travelTime={card.travelTime}
                    strollTimeline={strollData.timeline}
                    routeDuration={strollData.route?.duration}
                  />
                ) : (
                  <View style={styles.routePairingSection}>
                    {/* Header */}
                    <View style={styles.routePairingHeader}>
                      <View style={styles.routePairingIconContainer}>
                        <Ionicons
                          name="location-outline"
                          size={20}
                          color="#eb7825"
                        />
                        <View style={styles.routePairingIconDot} />
                      </View>
                      <Text style={styles.routePairingTitle}>
                        Experience Route
                      </Text>
                    </View>

                    {/* Description */}
                    <Text style={styles.routePairingDescription}>
                      Follow these stops for the complete journey
                    </Text>

                    {/* Action Button */}
                    <TouchableOpacity
                      style={styles.routePairingButton}
                      onPress={fetchStrollData}
                      disabled={loadingStrollData}
                      activeOpacity={0.7}
                    >
                      {loadingStrollData ? (
                        <>
                          <ActivityIndicator
                            size="small"
                            color="#ffffff"
                            style={{ marginRight: 8 }}
                          />
                          <Text style={styles.routePairingButtonText}>
                            Loading Route...
                          </Text>
                        </>
                      ) : (
                        <>
                          <Ionicons
                            name="paper-plane"
                            size={20}
                            color="#ffffff"
                            style={{ marginRight: 8 }}
                          />
                          <Text style={styles.routePairingButtonText}>
                            See Route Pairing
                          </Text>
                          <Ionicons
                            name="open-outline"
                            size={16}
                            color="#ffffff"
                            style={{ marginLeft: 8 }}
                          />
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}

            {/* Action Buttons */}
            <ActionButtons
              card={card}
              bookingOptions={bookingOptions}
              onSave={onSave}
              onSchedule={onSchedule}
              onPurchase={onPurchase}
              onShare={onShare}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  overlayBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContainer: {
    width: "95%",
    maxWidth: 600,
    height: SCREEN_HEIGHT * 0.9,
    maxHeight: SCREEN_HEIGHT * 0.9,
    backgroundColor: "#ffffff",
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
    flexGrow: 1,
  },
  placeholderSection: {
    padding: 20,
    alignItems: "center",
  },
  placeholderText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6b7280",
    marginBottom: 8,
  },
  placeholderSubtext: {
    fontSize: 14,
    color: "#9ca3af",
    marginBottom: 4,
  },
  loadingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: "#6b7280",
  },
  dataPreview: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#f9fafb",
    borderRadius: 8,
    width: "100%",
  },
  dataPreviewTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  dataPreviewText: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 2,
  },
  routePairingSection: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    backgroundColor: "#ffffff",
  },
  routePairingHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  routePairingIconContainer: {
    position: "relative",
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  routePairingIconDot: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#eb7825",
    top: "50%",
    left: "50%",
    marginTop: -3,
    marginLeft: -3,
  },
  routePairingTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  routePairingDescription: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 16,
  },
  routePairingButton: {
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  routePairingButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
