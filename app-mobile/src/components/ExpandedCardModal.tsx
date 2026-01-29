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
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ExpandedCardModalProps } from "../types/expandedCardTypes";
import { weatherService, WeatherData } from "../services/weatherService";
import { busynessService, BusynessData } from "../services/busynessService";
import { bookingService, BookingOption } from "../services/bookingService";
import { ExperienceGenerationService } from "../services/experienceGenerationService";
import { useRecommendations } from "../contexts/RecommendationsContext";
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
  onPurchase,
  onShare,
  userPreferences,
  isSaved,
  currentMode = "solo",
  onCardRemoved,
  onStrollDataFetched,
  onPicnicDataFetched,
}: ExpandedCardModalProps) {
  const { updateCardStrollData } = useRecommendations();
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [busynessData, setBusynessData] = useState<BusynessData | null>(null);
  const [bookingOptions, setBookingOptions] = useState<BookingOption[]>([]);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [loadingBusyness, setLoadingBusyness] = useState(false);
  const [loadingBooking, setLoadingBooking] = useState(false);
  const [strollData, setStrollData] = useState(card?.strollData);
  const [loadingStrollData, setLoadingStrollData] = useState(false);
  const [picnicData, setPicnicData] = useState(card?.picnicData);
  const [loadingPicnicData, setLoadingPicnicData] = useState(false);

  // Fetch additional data when modal opens
  useEffect(() => {
    if (visible && card) {
      fetchAdditionalData();
      setStrollData(card.strollData);
      setPicnicData(card.picnicData);
    } else {
      // Reset state when modal closes
      setWeatherData(null);
      setBusynessData(null);
      setBookingOptions([]);
      setStrollData(undefined);
      setPicnicData(undefined);
    }
  }, [visible, card]);

  const fetchAdditionalData = async () => {
    if (!card) return;

    // Fetch weather data
    if (card.location) {
      setLoadingWeather(true);
      try {
        // Convert selectedDateTime to Date if it's a string
        const dateTime = new Date();

        const weather = await weatherService.getWeatherForecast(
          card.location.lat,
          card.location.lng,
          dateTime
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
        // Update the card's strollData in the context and cache
        if (card) {
          updateCardStrollData(card.id, fetchedStrollData);
          // Persist to database if callback is provided (for saved cards)
          if (onStrollDataFetched) {
            await onStrollDataFetched(card, fetchedStrollData);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching companion stroll data:", err);
    } finally {
      setLoadingStrollData(false);
    }
  };

  const fetchPicnicData = async () => {
    if (!card) return;

    const isPicnicCard =
      card.category?.toLowerCase().includes("picnic") ||
      card.category?.toLowerCase() === "picnics";

    if (!isPicnicCard) return;

    // Create picnic object from card data
    const picnic =
      picnicData?.picnic ||
      (card.location && card.title
        ? {
            id: card.id,
            name: card.title,
            title: card.title,
            location: { lat: card.location.lat, lng: card.location.lng },
            address: card.address,
          }
        : null);

    if (!picnic) {
      console.warn("⚠️ Cannot fetch picnic data: missing picnic information");
      return;
    }

    setLoadingPicnicData(true);
    try {
      const fetchedPicnicData =
        await ExperienceGenerationService.fetchPicnicGroceryData(picnic);
      if (fetchedPicnicData) {
        setPicnicData(fetchedPicnicData);
        // Persist to database if callback is provided (for saved cards)
        if (onPicnicDataFetched) {
          await onPicnicDataFetched(card, fetchedPicnicData);
        }
      }
    } catch (err) {
      console.error("Error fetching picnic grocery data:", err);
    } finally {
      setLoadingPicnicData(false);
    }
  };

  if (!card) {
    return null;
  }

  const isStrollCard =
    card.category === "Take a Stroll" ||
    card.category?.toLowerCase().includes("stroll");

  const isPicnicCard =
    card.category?.toLowerCase().includes("picnic") ||
    card.category?.toLowerCase() === "picnics";

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
              selectedDateTime={
                card.selectedDateTime instanceof Date
                  ? card.selectedDateTime
                  : typeof card.selectedDateTime === "string"
                  ? new Date(card.selectedDateTime)
                  : undefined
              }
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

            {/* Grocery Store Section (for picnic cards) */}
            {picnicData && picnicData.groceryStore && (
              <View style={styles.groceryStoreSection}>
                <View style={styles.groceryStoreHeader}>
                  <Ionicons name="storefront" size={20} color="#eb7825" />
                  <Text style={styles.groceryStoreTitle}>
                    Start Your Picnic
                  </Text>
                </View>
                <Text style={styles.groceryStoreSubtitle}>
                  Pick up supplies at this nearby grocery store
                </Text>
                <View style={styles.groceryStoreCard}>
                  {picnicData.groceryStore.imageUrl && (
                    <Image
                      source={{ uri: picnicData.groceryStore.imageUrl }}
                      style={styles.groceryStoreImage}
                      resizeMode="cover"
                    />
                  )}
                  <View style={styles.groceryStoreContent}>
                    <View style={styles.groceryStoreInfo}>
                      <Ionicons
                        name="storefront-outline"
                        size={20}
                        color="#eb7825"
                      />
                      <View style={styles.groceryStoreDetails}>
                        <Text style={styles.groceryStoreName}>
                          {picnicData.groceryStore.name}
                        </Text>
                        <Text style={styles.groceryStoreType}>
                          {picnicData.groceryStore.type
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (l) => l.toUpperCase())}
                        </Text>
                      </View>
                    </View>
                    {picnicData.groceryStore.rating && (
                      <View style={styles.groceryStoreRating}>
                        <Ionicons name="star" size={14} color="#fbbf24" />
                        <Text style={styles.ratingText}>
                          {picnicData.groceryStore.rating.toFixed(1)}
                        </Text>
                        {picnicData.groceryStore.reviewCount && (
                          <Text style={styles.reviewText}>
                            ({picnicData.groceryStore.reviewCount} reviews)
                          </Text>
                        )}
                      </View>
                    )}
                    {picnicData.groceryStore.address && (
                      <View style={styles.groceryStoreAddress}>
                        <Ionicons
                          name="location-outline"
                          size={12}
                          color="#9ca3af"
                        />
                        <Text style={styles.addressText} numberOfLines={1}>
                          {picnicData.groceryStore.address}
                        </Text>
                      </View>
                    )}
                    {picnicData.groceryStore.distance && (
                      <View style={styles.groceryStoreDistance}>
                        <Ionicons
                          name="walk-outline"
                          size={12}
                          color="#9ca3af"
                        />
                        <Text style={styles.distanceText}>
                          {picnicData.groceryStore.distance < 1000
                            ? `${Math.round(
                                picnicData.groceryStore.distance
                              )}m away`
                            : `${(
                                picnicData.groceryStore.distance / 1000
                              ).toFixed(1)}km away`}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* Timeline Section or "See Route Pairing" Button (for Take a Stroll cards) */}
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

            {/* Timeline Section or "See Route Pairing" Button (for Picnic cards) */}
            {isPicnicCard && (
              <>
                {picnicData && picnicData.timeline ? (
                  <TimelineSection
                    category={card.category}
                    title={card.title}
                    address={card.address}
                    priceRange={card.priceRange}
                    travelTime={card.travelTime}
                    strollTimeline={picnicData.timeline}
                    routeDuration={picnicData.route?.duration}
                  />
                ) : (
                  <View style={styles.routePairingSection}>
                    {/* Header */}
                    <View style={styles.routePairingHeader}>
                      <View style={styles.routePairingIconContainer}>
                        <Ionicons
                          name="basket-outline"
                          size={20}
                          color="#eb7825"
                        />
                        <View style={styles.routePairingIconDot} />
                      </View>
                      <Text style={styles.routePairingTitle}>Picnic Route</Text>
                    </View>

                    {/* Description */}
                    <Text style={styles.routePairingDescription}>
                      Find a grocery store near your picnic location
                    </Text>

                    {/* Action Button */}
                    <TouchableOpacity
                      style={styles.routePairingButton}
                      onPress={fetchPicnicData}
                      disabled={loadingPicnicData}
                      activeOpacity={0.7}
                    >
                      {loadingPicnicData ? (
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
                            name="storefront-outline"
                            size={20}
                            color="#ffffff"
                            style={{ marginRight: 8 }}
                          />
                          <Text style={styles.routePairingButtonText}>
                            Find Grocery Store
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
              onPurchase={onPurchase}
              onShare={onShare}
              onClose={onClose}
              isSaved={isSaved}
              userPreferences={userPreferences}
              currentMode={currentMode}
              onCardRemoved={onCardRemoved}
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
  groceryStoreSection: {
    backgroundColor: "#ffffff",
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  groceryStoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  groceryStoreTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  groceryStoreSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  groceryStoreCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    marginHorizontal: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  groceryStoreImage: {
    width: "100%",
    height: 120,
    backgroundColor: "#e5e7eb",
  },
  groceryStoreContent: {
    padding: 12,
  },
  groceryStoreInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 12,
  },
  groceryStoreDetails: {
    flex: 1,
  },
  groceryStoreName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
  },
  groceryStoreType: {
    fontSize: 12,
    color: "#6b7280",
    textTransform: "capitalize",
  },
  groceryStoreRating: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  },
  groceryStoreAddress: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  groceryStoreDistance: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  distanceText: {
    fontSize: 12,
    color: "#9ca3af",
  },
  ratingText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  reviewText: {
    fontSize: 12,
    color: "#9ca3af",
  },
  addressText: {
    fontSize: 12,
    color: "#9ca3af",
    flex: 1,
  },
});
