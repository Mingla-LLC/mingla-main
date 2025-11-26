import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ExpandedCardModalProps } from '../types/expandedCardTypes';
import { weatherService, WeatherData } from '../services/weatherService';
import { busynessService, BusynessData } from '../services/busynessService';
import { bookingService, BookingOption } from '../services/bookingService';
import ExpandedCardHeader from './expandedCard/ExpandedCardHeader';
import ImageGallery from './expandedCard/ImageGallery';
import MatchScoreBox from './expandedCard/MatchScoreBox';
import DescriptionSection from './expandedCard/DescriptionSection';
import HighlightsSection from './expandedCard/HighlightsSection';
import WeatherSection from './expandedCard/WeatherSection';
import BusynessSection from './expandedCard/BusynessSection';
import PracticalDetailsSection from './expandedCard/PracticalDetailsSection';
import MatchFactorsBreakdown from './expandedCard/MatchFactorsBreakdown';
import TimelineSection from './expandedCard/TimelineSection';
import ActionButtons from './expandedCard/ActionButtons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

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

  // Fetch additional data when modal opens
  useEffect(() => {
    if (visible && card) {
      fetchAdditionalData();
    } else {
      // Reset state when modal closes
      setWeatherData(null);
      setBusynessData(null);
      setBookingOptions([]);
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
        console.error('❌ Error fetching weather in modal:', error);
        setWeatherData(null);
      } finally {
        setLoadingWeather(false);
      }
    } else {
      console.warn('⚠️ No location data for weather fetch:', card);
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
        console.error('Error fetching busyness:', error);
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
        console.error('Error fetching booking options:', error);
      } finally {
        setLoadingBooking(false);
      }
    }
  };

  if (!card) {
    return null;
  }

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
          <ExpandedCardHeader title={card.title || 'Experience Details'} onClose={onClose} />

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
            <View style={{ height: 200, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' }}>
              <Text>No images available</Text>
            </View>
          )}

          {/* Match Score Box */}
          <MatchScoreBox
            matchScore={card.matchScore}
            matchFactors={card.matchFactors}
          />

          {/* Description Section */}
          <DescriptionSection
            title="About this experience"
            description={card.description}
            fullDescription={card.fullDescription}
          />

          {/* Highlights Section */}
          <HighlightsSection
            highlights={card.highlights}
            category={card.category}
          />

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
          <MatchFactorsBreakdown matchFactors={card.matchFactors} />

          {/* Timeline Section */}
          <TimelineSection
            category={card.category}
            title={card.title}
            address={card.address}
            priceRange={card.priceRange}
            travelTime={card.travelTime}
          />

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
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  overlayBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContainer: {
    width: '95%',
    maxWidth: 600,
    height: SCREEN_HEIGHT * 0.9,
    maxHeight: SCREEN_HEIGHT * 0.9,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
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
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 8,
  },
  placeholderSubtext: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 4,
  },
  loadingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#6b7280',
  },
  dataPreview: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    width: '100%',
  },
  dataPreviewTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  dataPreviewText: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 2,
  },
});

