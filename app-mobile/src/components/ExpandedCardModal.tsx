import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Animated,
  LayoutAnimation,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";
import { ExpandedCardModalProps, ExpandedCardData } from "../types/expandedCardTypes";
import type { CuratedExperienceCard, CuratedStop } from '../types/curatedExperience';
import { formatDistanceFromMeters, formatPriceRange } from "./utils/formatters";
import { curatedStopsToTimeline } from "../utils/curatedToTimeline";
import { weatherService, WeatherData } from "../services/weatherService";
import { busynessService, BusynessData } from "../services/busynessService";
import { bookingService, BookingOption } from "../services/bookingService";
import { ExperienceGenerationService } from "../services/experienceGenerationService";
import { useRecommendations } from "../contexts/RecommendationsContext";
import ExpandedCardHeader from "./expandedCard/ExpandedCardHeader";
import ImageGallery from "./expandedCard/ImageGallery";
import CardInfoSection from "./expandedCard/CardInfoSection";
import DescriptionSection from "./expandedCard/DescriptionSection";
import HighlightsSection from "./expandedCard/HighlightsSection";
import WeatherSection from "./expandedCard/WeatherSection";
import BusynessSection from "./expandedCard/BusynessSection";
import PracticalDetailsSection from "./expandedCard/PracticalDetailsSection";
import MatchFactorsBreakdown from "./expandedCard/MatchFactorsBreakdown";
import TimelineSection from "./expandedCard/TimelineSection";
import CompanionStopsSection from "./expandedCard/CompanionStopsSection";
import ActionButtons from "./expandedCard/ActionButtons";
import FeedbackModal from "./expandedCard/FeedbackModal";
import ShareModal from "./ShareModal";
import InAppBrowserModal from "./InAppBrowserModal";
import { PicnicShoppingList } from './PicnicShoppingList';
import * as WebBrowser from 'expo-web-browser';
import { colors } from "../constants/colors";
import { SCREEN_HEIGHT } from "../utils/responsive";

const curatedStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: '#1C1C1E',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  tagline: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  summaryText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  summaryDot: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
  },
  stopsContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 0,
  },
  travelConnector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
    gap: 8,
  },
  travelLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  travelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  travelText: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
  },
  stopCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  stopLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
    flex: 1,
    overflow: 'hidden',
  },
  stopLabelTextWrap: {
    flex: 1,
    flexShrink: 1,
  },
  stopNumberBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#eb7825',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNumberText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  stopLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#eb7825',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stopImage: {
    width: '100%',
    height: 140,
    borderRadius: 8,
    marginBottom: 10,
    overflow: 'hidden',
  },
  placeName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  placeType: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 8,
  },
  stopMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 8,
  },
  stopMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  stopMetaText: {
    fontSize: 12,
    color: '#6b7280',
  },
  stopMetaDot: {
    color: '#d1d5db',
    fontSize: 12,
  },
  stopAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  stopAddress: {
    fontSize: 12,
    color: '#9ca3af',
    flex: 1,
  },
  directionsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eb7825',
  },
  directionsText: {
    fontSize: 12,
    color: '#eb7825',
    fontWeight: '600',
  },
  actionRow: {
    padding: 16,
    paddingBottom: 32,
  },
  saveButton: {
    backgroundColor: '#eb7825',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonSaved: {
    backgroundColor: '#fff7ed',
    borderWidth: 1.5,
    borderColor: '#eb7825',
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  saveButtonTextSaved: {
    color: '#eb7825',
  },
  stopHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  openBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  openBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  expandedSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  aiDescription: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 20,
    marginBottom: 10,
  },
  hoursSection: {
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 10,
  },
  hoursSectionLabel: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  hoursDay: {
    fontSize: 12,
    color: '#9ca3af',
    width: 40,
  },
  hoursDayToday: {
    color: '#eb7825',
    fontWeight: '700',
  },
  hoursTime: {
    fontSize: 12,
    color: '#6b7280',
    flex: 1,
    textAlign: 'right',
  },
  hoursTimeToday: {
    color: '#111827',
    fontWeight: '600',
  },
  policiesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#333338',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginTop: 4,
    gap: 6,
  },
  policiesButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  totalTimeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(235,120,37,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(235,120,37,0.3)',
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
  },
  totalTimeTextBlock: {
    flex: 1,
    marginLeft: 12,
  },
  totalTimeLabel: {
    fontSize: 12,
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  totalTimeValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginTop: 2,
  },
  totalTimeBreakdown: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
});

/** Private component — renders the multi-stop plan for a curated experience */
function CuratedPlanView({
  card,
  isSaved,
  onSave,
  onClose,
}: {
  card: CuratedExperienceCard;
  isSaved?: boolean;
  onSave: (card: ExpandedCardData) => Promise<void> | void;
  onClose: () => void;
}) {
  return (
    <MultiStopPlanView
      card={card}
      isSaved={isSaved}
      onSave={onSave}
      onClose={onClose}
    />
  );
}

// ── Multi-stop expanded card (Adventurous curated cards) ──
function MultiStopPlanView({
  card,
  isSaved,
  onSave,
  onClose,
}: {
  card: CuratedExperienceCard;
  isSaved?: boolean;
  onSave: (card: ExpandedCardData) => Promise<void> | void;
  onClose: () => void;
}) {
  const avgRating =
    card.stops.length > 0
      ? (card.stops.reduce((s, st) => s + st.rating, 0) / card.stops.length).toFixed(1)
      : '–';

  const priceText =
    card.totalPriceMin === 0 && card.totalPriceMax === 0
      ? 'Free'
      : `$${card.totalPriceMin}–$${card.totalPriceMax}`;

  // Total time calculation
  const totalStopMinutes = card.stops.reduce((s, st) => s + (st.estimatedDurationMinutes ?? 45), 0);
  const totalTravelMinutes = card.stops
    .slice(1)
    .reduce((s, st) => s + (st.travelTimeFromPreviousStopMin ?? 0), 0);
  const grandTotalMinutes = totalStopMinutes + totalTravelMinutes;
  const totalHrs = Math.floor(grandTotalMinutes / 60);
  const totalMins = grandTotalMinutes % 60;
  const totalTimeLabel = totalHrs > 0
    ? `${totalHrs}h ${totalMins > 0 ? totalMins + 'min' : ''}`
    : `${totalMins}min`;

  // Accordion state
  const [expandedStops, setExpandedStops] = useState<Set<number>>(new Set());
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [browserTitle, setBrowserTitle] = useState('');

  // Stagger entry animations
  const stopAnims = useRef(card.stops.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(
      120,
      stopAnims.map(anim =>
        Animated.timing(anim, { toValue: 1, duration: 350, useNativeDriver: true })
      )
    ).start();
  }, []);

  const toggleStop = (stopNumber: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedStops(prev => {
      const next = new Set(prev);
      next.has(stopNumber) ? next.delete(stopNumber) : next.add(stopNumber);
      return next;
    });
  };

  const travelIcon = (mode: string | null): any => {
    if (mode === 'driving') return 'car-outline';
    if (mode === 'walking') return 'walk-outline';
    if (mode === 'bicycling' || mode === 'biking') return 'bicycle-outline';
    if (mode === 'transit') return 'bus-outline';
    return 'navigate-outline';
  };

  const openDirectionsForStop = (stop: CuratedStop) => {
    const url = Platform.select({
      ios: `maps:0,0?q=${encodeURIComponent(stop.address)}`,
      android: `geo:0,0?q=${encodeURIComponent(stop.address)}`,
    });
    if (url) Linking.openURL(url);
  };

  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  return (
    <View style={curatedStyles.container}>
      {/* Header */}
      <View style={curatedStyles.header}>
        <Text style={curatedStyles.title} numberOfLines={2}>{card.title}</Text>
        <Text style={curatedStyles.tagline}>{card.tagline}</Text>
        <View style={curatedStyles.summaryRow}>
          <View style={curatedStyles.summaryItem}>
            <Ionicons name="cash-outline" size={14} color="rgba(255,255,255,0.7)" />
            <Text style={curatedStyles.summaryText}>{priceText}</Text>
          </View>
          <Text style={curatedStyles.summaryDot}>·</Text>
          <View style={curatedStyles.summaryItem}>
            <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.7)" />
            <Text style={curatedStyles.summaryText}>{totalTimeLabel}</Text>
          </View>
          <Text style={curatedStyles.summaryDot}>·</Text>
          <View style={curatedStyles.summaryItem}>
            <Ionicons name="star" size={14} color="#F59E0B" />
            <Text style={curatedStyles.summaryText}>{avgRating} avg</Text>
          </View>
        </View>
      </View>

      {/* Stops */}
      <View style={curatedStyles.stopsContainer}>
        {card.stops.map((stop, idx) => {
          const isExpanded = expandedStops.has(stop.stopNumber);
          const anim = stopAnims[idx];
          return (
            <Animated.View
              key={stop.placeId}
              style={{
                opacity: anim,
                transform: [{
                  translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
                }],
              }}
            >
              {/* Travel connector from previous stop */}
              {idx > 0 && stop.travelTimeFromPreviousStopMin != null && (
                <View style={curatedStyles.travelConnector}>
                  <View style={curatedStyles.travelLine} />
                  <View style={curatedStyles.travelBadge}>
                    <Ionicons
                      name={travelIcon(stop.travelModeFromPreviousStop)}
                      size={12}
                      color="#6b7280"
                    />
                    <Text style={curatedStyles.travelText}>
                      {stop.travelTimeFromPreviousStopMin} min
                    </Text>
                  </View>
                  <View style={curatedStyles.travelLine} />
                </View>
              )}

              {/* Stop card */}
              <View style={curatedStyles.stopCard}>
                {/* Tappable header row */}
                <TouchableOpacity
                  style={curatedStyles.stopHeaderRow}
                  onPress={() => toggleStop(stop.stopNumber)}
                  activeOpacity={0.7}
                >
                  <View style={curatedStyles.stopLabelRow}>
                    <View style={curatedStyles.stopNumberBadge}>
                      <Text style={curatedStyles.stopNumberText}>{stop.stopNumber}</Text>
                    </View>
                    <View style={curatedStyles.stopLabelTextWrap}>
                      <Text style={curatedStyles.stopLabel}>{stop.stopLabel}</Text>
                      <Text style={curatedStyles.placeName} numberOfLines={2}>{stop.placeName}</Text>
                    </View>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up-outline' : 'chevron-down-outline'}
                    size={18}
                    color="#9ca3af"
                  />
                </TouchableOpacity>

                {/* Always-visible: image + quick meta */}
                {stop.imageUrl ? (
                  <Image
                    source={{ uri: stop.imageUrl }}
                    style={curatedStyles.stopImage}
                    resizeMode="cover"
                  />
                ) : null}

                <Text style={curatedStyles.placeType} numberOfLines={1}>
                  {stop.placeType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </Text>

                <View style={curatedStyles.stopMetaRow}>
                  {stop.rating > 0 && (
                    <View style={curatedStyles.stopMetaItem}>
                      <Ionicons name="star" size={12} color="#F59E0B" />
                      <Text style={curatedStyles.stopMetaText}>{stop.rating.toFixed(1)}</Text>
                    </View>
                  )}
                  {stop.priceLevelLabel ? (
                    <>
                      <Text style={curatedStyles.stopMetaDot}>·</Text>
                      <Text style={curatedStyles.stopMetaText}>{stop.priceLevelLabel}</Text>
                    </>
                  ) : null}
                  <Text style={curatedStyles.stopMetaDot}>·</Text>
                  <View style={[
                    curatedStyles.openBadge,
                    { backgroundColor: stop.isOpenNow ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)' },
                  ]}>
                    <Text style={[
                      curatedStyles.openBadgeText,
                      { color: stop.isOpenNow ? '#10b981' : '#ef4444' },
                    ]}>
                      {stop.isOpenNow ? 'Open Now' : 'Closed'}
                    </Text>
                  </View>
                </View>

                {/* Policies & Reservations — only when website exists */}
                {stop.website ? (
                  <TouchableOpacity
                    style={curatedStyles.policiesButton}
                    onPress={() => {
                      setBrowserTitle(stop.placeName);
                      setBrowserUrl(stop.website);
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="globe-outline" size={15} color="#ffffff" />
                    <Text style={curatedStyles.policiesButtonText}>Policies & Reservations</Text>
                  </TouchableOpacity>
                ) : null}

                {/* Opening Hours — visible when expanded */}
                {isExpanded && Object.keys(stop.openingHours).length > 0 && (
                  <View style={curatedStyles.hoursSection}>
                    <Text style={curatedStyles.hoursSectionLabel}>Weekly Hours</Text>
                    {Object.entries(stop.openingHours).map(([day, hours]) => {
                      const isToday = day.toLowerCase() === todayName.toLowerCase();
                      return (
                        <View key={day} style={curatedStyles.hoursRow}>
                          <Text style={[
                            curatedStyles.hoursDay,
                            isToday && curatedStyles.hoursDayToday,
                          ]}>
                            {day.slice(0, 3)}
                          </Text>
                          <Text style={[
                            curatedStyles.hoursTime,
                            isToday && curatedStyles.hoursTimeToday,
                          ]} numberOfLines={1}>
                            {hours}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Expanded detail section */}
                {isExpanded && (
                  <View style={curatedStyles.expandedSection}>
                    {/* AI Description */}
                    {stop.aiDescription ? (
                      <Text style={curatedStyles.aiDescription} numberOfLines={4} ellipsizeMode="tail">{stop.aiDescription}</Text>
                    ) : null}

                    {/* Address + Directions */}
                    <View style={curatedStyles.stopAddressRow}>
                      <Ionicons name="location-outline" size={13} color="#9ca3af" />
                      <Text style={curatedStyles.stopAddress} numberOfLines={2}>
                        {stop.address}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={curatedStyles.directionsButton}
                      onPress={() => openDirectionsForStop(stop)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="navigate-outline" size={14} color="#eb7825" />
                      <Text style={curatedStyles.directionsText}>Get Directions</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Shopping List — only under stop 1 (grocery) for picnic cards */}
                {stop.stopNumber === 1 && card.shoppingList && card.shoppingList.length > 0 && (
                  <PicnicShoppingList items={card.shoppingList} />
                )}
              </View>
            </Animated.View>
          );
        })}

        {/* Total time estimate footer */}
        <View style={curatedStyles.totalTimeCard}>
          <Ionicons name="time-outline" size={20} color="#eb7825" />
          <View style={curatedStyles.totalTimeTextBlock}>
            <Text style={curatedStyles.totalTimeLabel}>Total Time Estimate</Text>
            <Text style={curatedStyles.totalTimeValue}>{totalTimeLabel}</Text>
            <Text style={curatedStyles.totalTimeBreakdown}>
              {totalStopMinutes}min at stops · {totalTravelMinutes}min travel
            </Text>
          </View>
        </View>
      </View>

      {/* Save */}
      <View style={curatedStyles.actionRow}>
        <TouchableOpacity
          style={[curatedStyles.saveButton, isSaved && curatedStyles.saveButtonSaved]}
          onPress={() => onSave(card as unknown as ExpandedCardData)}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isSaved ? 'bookmark' : 'bookmark-outline'}
            size={18}
            color={isSaved ? '#eb7825' : '#ffffff'}
          />
          <Text style={[curatedStyles.saveButtonText, isSaved && curatedStyles.saveButtonTextSaved]}>
            {isSaved ? 'Saved' : 'Save Plan'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* In-app browser for reservations */}
      <InAppBrowserModal
        visible={browserUrl !== null}
        url={browserUrl ?? ''}
        title={browserTitle}
        onClose={() => setBrowserUrl(null)}
      />
    </View>
  );
}

export default function ExpandedCardModal({
  visible,
  card,
  onClose,
  onSave,
  onPurchase,
  onShare,
  userPreferences,
  accountPreferences,
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
  const [isNightOutShareOpen, setIsNightOutShareOpen] = useState(false);
  const [ticketBrowserUrl, setTicketBrowserUrl] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [browserTitle, setBrowserTitle] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackCardId, setFeedbackCardId] = useState("");
  const [feedbackTitle, setFeedbackTitle] = useState("");

  // Fetch additional data when modal opens
  useEffect(() => {
    if (visible && card) {
      fetchAdditionalData();
      if ((card as any).cardType !== 'curated') {
        setStrollData(card.strollData);
        setPicnicData(card.picnicData);
      }
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
    if ((card as any).cardType === 'curated') {
      // For curated cards, fetch weather and busyness for the first stop's location
      const curatedCard = card as any;
      const firstStop = curatedCard.stops?.[0];
      if (firstStop?.lat && firstStop?.lng) {
        // Fetch weather for first stop
        setLoadingWeather(true);
        try {
          const weather = await weatherService.getWeatherForecast(
            firstStop.lat,
            firstStop.lng,
            new Date()
          );
          setWeatherData(weather);
        } catch (error) {
          console.error('Error fetching curated weather:', error);
          setWeatherData(null);
        } finally {
          setLoadingWeather(false);
        }

        // Fetch busyness for first stop
        setLoadingBusyness(true);
        try {
          const busyness = await busynessService.getVenueBusyness(
            firstStop.placeName,
            firstStop.lat,
            firstStop.lng,
            firstStop.address,
            firstStop.placeId
          );
          setBusynessData(busyness);
        } catch (error) {
          console.error('Error fetching curated busyness:', error);
        } finally {
          setLoadingBusyness(false);
        }
      }
      return; // Still return — skip booking fetch (curated cards have per-stop links)
    }

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
      card.category === 'Picnic Date';

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
    return (
      <FeedbackModal
        visible={showFeedback}
        experienceTitle={feedbackTitle}
        cardId={feedbackCardId}
        onClose={() => {
          setShowFeedback(false);
          setFeedbackCardId("");
          setFeedbackTitle("");
        }}
      />
    );
  }

  const isCuratedCard = (card as any).cardType === 'curated';
  const curatedCard = isCuratedCard ? (card as unknown as CuratedExperienceCard) : null;

  const isStrollCard =
    !isCuratedCard &&
    (card.category === "Take a Stroll" ||
      card.category?.toLowerCase().includes("stroll"));

  const isPicnicCard =
    !isCuratedCard &&
    card.category === 'Picnic Date';

  const isNightOut = !isCuratedCard && !!card.nightOutData;
  const nightOut = isCuratedCard ? null : card.nightOutData;

  // Helper to open directions in maps app
  const openDirections = () => {
    const address = card.address;
    const coords = nightOut?.coordinates;
    if (coords) {
      const url = Platform.select({
        ios: `maps:0,0?q=${coords.lat},${coords.lng}`,
        android: `geo:${coords.lat},${coords.lng}?q=${coords.lat},${coords.lng}(${encodeURIComponent(nightOut?.venueName || "")})`,
      });
      if (url) Linking.openURL(url);
    } else if (address) {
      const url = Platform.select({
        ios: `maps:0,0?q=${encodeURIComponent(address)}`,
        android: `geo:0,0?q=${encodeURIComponent(address)}`,
      });
      if (url) Linking.openURL(url);
    }
  };

  return (
  <>
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
          <ExpandedCardHeader onClose={onClose} />

          {/* Scrollable Content */}
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
          >
            {/* ===== Curated Experience Plan ===== */}
            {isCuratedCard && curatedCard && (
              <>
                <CuratedPlanView
                  card={curatedCard}
                  isSaved={isSaved}
                  onSave={onSave}
                  onClose={onClose}
                />

                {/* Weather for first stop */}
                <WeatherSection
                  weatherData={weatherData}
                  loading={loadingWeather}
                  category={curatedCard.categoryLabel || curatedCard.experienceType || 'adventurous'}
                  selectedDateTime={undefined}
                  measurementSystem={accountPreferences?.measurementSystem}
                />

                {/* Busyness for first stop */}
                <BusynessSection
                  busynessData={busynessData}
                  loading={loadingBusyness}
                  travelTime={undefined}
                />

                {/* Animated Timeline for Curated Cards */}
                {curatedCard.stops && curatedCard.stops.length > 0 && (
                  <TimelineSection
                    category={curatedCard.categoryLabel || curatedCard.experienceType || 'adventurous'}
                    title={curatedCard.title}
                    address={curatedCard.stops[0]?.address}
                    priceRange={`$${curatedCard.totalPriceMin}–$${curatedCard.totalPriceMax}`}
                    travelTime={`${Math.floor((curatedCard.estimatedDurationMinutes || 0) / 60)}h`}
                    strollTimeline={curatedStopsToTimeline(curatedCard.stops)}
                    routeDuration={curatedCard.estimatedDurationMinutes}
                  />
                )}
              </>
            )}

            {/* Image Gallery (non-curated only) */}
            {!isCuratedCard && (card.images && card.images.length > 0 ? (
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
            ))}

            {/* ===== Night Out / Regular Layout (non-curated only) ===== */}
            {!isCuratedCard && (isNightOut && nightOut ? (
              <View style={nightOutStyles.container}>
                {/* Event Title */}
                <Text style={nightOutStyles.title}>{card.title}</Text>

                {/* Venue + Artist Row */}
                <View style={nightOutStyles.categoryHostRow}>
                  <Ionicons name="musical-notes" size={16} color="#eb7825" />
                  <Text style={nightOutStyles.categoryText}>{nightOut.venueName}</Text>
                  <Text style={nightOutStyles.dotSep}>•</Text>
                  <Text style={nightOutStyles.hostText}>{nightOut.artistName}</Text>
                </View>

                {/* Genre + SubGenre Badges */}
                {(nightOut.genre || nightOut.subGenre) && (
                  <View style={nightOutStyles.tagsRow}>
                    {nightOut.genre && (
                      <View style={nightOutStyles.vibeBadge}>
                        <Text style={nightOutStyles.vibeBadgeText}>{nightOut.genre}</Text>
                      </View>
                    )}
                    {nightOut.subGenre && (
                      <View style={nightOutStyles.vibeBadge}>
                        <Text style={nightOutStyles.vibeBadgeText}>{nightOut.subGenre}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Ticket Status Badge */}
                <View style={[nightOutStyles.ticketStatusBadge,
                  nightOut.ticketStatus === "onsale" ? { backgroundColor: '#10B981' } :
                  nightOut.ticketStatus === "offsale" ? { backgroundColor: '#EF4444' } :
                  { backgroundColor: '#F59E0B' }
                ]}>
                  <Ionicons name="ticket-outline" size={16} color="#fff" />
                  <Text style={nightOutStyles.ticketStatusText}>
                    {nightOut.ticketStatus === "onsale" ? "On Sale" :
                     nightOut.ticketStatus === "offsale" ? "Sold Out" : "Coming Soon"}
                  </Text>
                </View>

                {/* Date/Time + Price Cards */}
                <View style={nightOutStyles.infoCardsRow}>
                  {/* Date & Time Card */}
                  <View style={nightOutStyles.infoCard}>
                    <View style={nightOutStyles.infoCardHeader}>
                      <Feather name="calendar" size={14} color="#eb7825" />
                      <Text style={nightOutStyles.infoCardLabel}>Date & Time</Text>
                    </View>
                    <Text style={nightOutStyles.infoCardPrimary}>{nightOut.date}</Text>
                    <Text style={nightOutStyles.infoCardSecondary}>{nightOut.time}</Text>
                  </View>

                  {/* Ticket Price Card */}
                  <View style={nightOutStyles.infoCard}>
                    <View style={nightOutStyles.infoCardHeader}>
                      <Ionicons name="pricetag-outline" size={14} color="#eb7825" />
                      <Text style={nightOutStyles.infoCardLabel}>Tickets</Text>
                    </View>
                    <Text style={nightOutStyles.infoCardPrice} numberOfLines={1} adjustsFontSizeToFit>{formatPriceRange(nightOut.price, accountPreferences?.currency)}</Text>
                    <Text style={nightOutStyles.infoCardSecondary}>per ticket</Text>
                  </View>
                </View>

                {/* Divider */}
                <View style={nightOutStyles.divider} />

                {/* Vibe Tags */}
                {nightOut.tags && nightOut.tags.length > 0 && (
                  <>
                    <Text style={nightOutStyles.sectionTitle}>Vibe</Text>
                    <View style={nightOutStyles.tagsRow}>
                      {nightOut.tags.map((tag, index) => (
                        <View key={index} style={nightOutStyles.vibeBadge}>
                          <Text style={nightOutStyles.vibeBadgeText}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}

                {/* Divider */}
                <View style={nightOutStyles.divider} />

                {/* Venue Info */}
                <View style={nightOutStyles.venueCard}>
                  <View style={nightOutStyles.venueIconRow}>
                    <View style={nightOutStyles.venueIcon}>
                      <Ionicons name="location" size={20} color="#eb7825" />
                    </View>
                    <View style={nightOutStyles.venueDetails}>
                      <Text style={nightOutStyles.venueName}>{nightOut.venueName}</Text>
                      <Text style={nightOutStyles.venueAddress}>{card.address}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={nightOutStyles.directionsButton}
                    onPress={openDirections}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="navigate-outline" size={16} color="#eb7825" />
                    <Text style={nightOutStyles.directionsText}>Get Directions</Text>
                  </TouchableOpacity>
                </View>

                {/* Seat Map (if available) */}
                {nightOut.seatMapUrl && (
                  <View style={{ marginTop: 16 }}>
                    <Text style={nightOutStyles.sectionTitle}>Seat Map</Text>
                    <Image
                      source={{ uri: nightOut.seatMapUrl }}
                      style={{ width: '100%', height: 200, borderRadius: 12 }}
                      resizeMode="contain"
                    />
                  </View>
                )}

                {/* Bottom spacer for the sticky button */}
                <View style={{ height: 80 }} />
              </View>
            ) : (
              <>
                {/* ===== Regular Experience Detail Layout ===== */}
                {/* Card Info Section: Title, Tags, Metrics, Description */}
                <CardInfoSection
                  title={card.title}
                  category={card.category}
                  categoryIcon={card.categoryIcon}
                  tags={card.tags}
                  rating={card.rating}
                  distance={card.distance}
                  measurementSystem={accountPreferences?.measurementSystem}
                  priceRange={card.priceRange}
                  priceTier={(card as any).priceTier}
                  priceLevel={(card as any).priceLevel}
                  description={card.description}
                  currency={accountPreferences?.currency}
                />

                {/* See Full Plan Button (for Stroll cards) */}
                {isStrollCard && !(strollData && strollData.timeline) && (
                  <View style={styles.seeFullPlanSection}>
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
                            Loading Plan...
                          </Text>
                        </>
                      ) : (
                        <>
                          <Ionicons
                            name="map-outline"
                            size={20}
                            color="#ffffff"
                            style={{ marginRight: 8 }}
                          />
                          <Text style={styles.routePairingButtonText}>
                            See Full Plan
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* See Full Plan Button (for Picnic cards) */}
                {isPicnicCard && !(picnicData && picnicData.timeline) && (
                  <View style={styles.seeFullPlanSection}>
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
                            Loading Plan...
                          </Text>
                        </>
                      ) : (
                        <>
                          <Ionicons
                            name="map-outline"
                            size={20}
                            color="#ffffff"
                            style={{ marginRight: 8 }}
                          />
                          <Text style={styles.routePairingButtonText}>
                            See Full Plan
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

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
                  measurementSystem={accountPreferences?.measurementSystem}
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
                              {formatDistanceFromMeters(
                                picnicData.groceryStore.distance,
                                accountPreferences?.measurementSystem,
                                'away'
                              )}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                )}

                {/* Timeline Section (for Take a Stroll cards) */}
                {isStrollCard && strollData && strollData.timeline && (
                  <TimelineSection
                    category={card.category}
                    title={card.title}
                    address={card.address}
                    priceRange={card.priceRange}
                    travelTime={card.travelTime}
                    strollTimeline={strollData.timeline}
                    routeDuration={strollData.route?.duration}
                    currency={accountPreferences?.currency}
                  />
                )}

                {/* Timeline Section (for Picnic cards) */}
                {isPicnicCard && picnicData && picnicData.timeline && (
                  <TimelineSection
                    category={card.category}
                    title={card.title}
                    address={card.address}
                    priceRange={card.priceRange}
                    travelTime={card.travelTime}
                    strollTimeline={picnicData.timeline}
                    routeDuration={picnicData.route?.duration}
                    currency={accountPreferences?.currency}
                  />
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
                  onScheduleSuccess={(scheduledCard) => {
                    // Don't show feedback immediately — reviews are shown the day after
                    // the scheduled experience when the user returns to the app.
                    onClose();
                  }}
                  onOpenBrowser={(url, title) => {
                    setBrowserUrl(url);
                    setBrowserTitle(title);
                  }}
                />
              </>
            ))}
          </ScrollView>

          {/* Sticky Get Tickets + Share Button for Night Out */}
          {isNightOut && nightOut && (
            <View style={nightOutStyles.stickyButtonContainer}>
              <View style={nightOutStyles.stickyButtonRow}>
                {nightOut.ticketUrl && nightOut.ticketStatus === "onsale" ? (
                  <TouchableOpacity
                    style={nightOutStyles.getTicketsButton}
                    activeOpacity={0.8}
                    onPress={() => setTicketBrowserUrl(nightOut.ticketUrl)}
                  >
                    <Ionicons name="ticket-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={nightOutStyles.getTicketsText} numberOfLines={1} adjustsFontSizeToFit>
                      Get Tickets – {formatPriceRange(nightOut.price, accountPreferences?.currency)}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={[nightOutStyles.getTicketsButton, { backgroundColor: '#666' }]}>
                    <Text style={nightOutStyles.getTicketsText}>
                      {nightOut.ticketStatus === "offsale" ? "Sold Out" : "Tickets Coming Soon"}
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  style={nightOutStyles.shareButton}
                  activeOpacity={0.7}
                  onPress={() => setIsNightOutShareOpen(true)}
                >
                  <Feather name="share-2" size={20} color="#111827" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Night Out Share Modal */}
          {/* In-app ticket browser */}
          {isNightOut && nightOut && (
            <InAppBrowserModal
              visible={ticketBrowserUrl !== null}
              url={ticketBrowserUrl ?? ''}
              title={`Tickets – ${nightOut.eventName}`}
              onClose={() => setTicketBrowserUrl(null)}
            />
          )}

          {/* In-app browser for Policies & Reservations (Nature cards) */}
          <InAppBrowserModal
            visible={browserUrl !== null}
            url={browserUrl ?? ''}
            title={browserTitle}
            onClose={() => setBrowserUrl(null)}
          />

          {isNightOut && nightOut && (
            <ShareModal
              isOpen={isNightOutShareOpen}
              onClose={() => setIsNightOutShareOpen(false)}
              experienceData={{
                title: card.title,
                image: card.image,
                images: card.images,
                distance: card.distance,
                priceRange: nightOut.price,
                rating: card.rating,
                address: card.address,
                description: card.description,
                location: card.location,
              }}
              dateTimePreferences={{
                timeOfDay: nightOut.time,
                dayOfWeek: nightOut.date,
                planningTimeframe: nightOut.date,
              }}
              accountPreferences={accountPreferences}
            />
          )}
        </View>
      </View>
    </Modal>

    {/* Feedback Modal - rendered outside the expanded card modal */}
    <FeedbackModal
      visible={showFeedback}
      experienceTitle={feedbackTitle}
      cardId={feedbackCardId}
      onClose={() => {
        setShowFeedback(false);
        setFeedbackCardId("");
        setFeedbackTitle("");
      }}
    />
  </>
  );
}

// Night Out detail styles
const nightOutStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  categoryHostRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    flexWrap: "wrap",
    gap: 6,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#eb7825",
  },
  dotSep: {
    fontSize: 14,
    color: "#9ca3af",
  },
  hostText: {
    fontSize: 14,
    color: "#6b7280",
  },
  infoCardsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  infoCard: {
    flex: 1,
    backgroundColor: "#fff7ed",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  infoCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  infoCardLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
  },
  infoCardPrimary: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 2,
  },
  infoCardSecondary: {
    fontSize: 13,
    color: "#6b7280",
  },
  infoCardPrice: {
    fontSize: 17,
    fontWeight: "700",
    color: "#eb7825",
    marginBottom: 2,
  },
  goingBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 20,
    borderColor: colors.primary,
    borderWidth: 1,
  },
  goingText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  divider: {
    height: 1,
    backgroundColor: "#f3f4f6",
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 22,
    color: "#374151",
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  vibeBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#eb7825",
    backgroundColor: "#fff7ed",
  },
  vibeBadgeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#eb7825",
  },
  musicGenreContainer: {
    backgroundColor: "#f9fafb",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  musicGenreHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  musicGenreLabel: {
    fontSize: 12,
    color: "#6b7280",
  },
  musicGenreValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  venueCard: {
    backgroundColor: "#fff7ed",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  venueIconRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  venueIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#fff7ed",
    justifyContent: "center",
    alignItems: "center",
  },
  venueDetails: {
    flex: 1,
  },
  venueName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  venueAddress: {
    fontSize: 13,
    color: "#6b7280",
    lineHeight: 18,
  },
  directionsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  directionsText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#eb7825",
  },
  stickyButtonContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  stickyButtonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  getTicketsButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  getTicketsText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
    flexShrink: 1,
  },
  shareButton: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  ticketStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  ticketStatusText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
});

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
  seeFullPlanSection: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
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
