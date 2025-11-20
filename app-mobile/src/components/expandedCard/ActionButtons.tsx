import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ExpandedCardData, BookingOption } from '../../types/expandedCardTypes';

interface ActionButtonsProps {
  card: ExpandedCardData;
  bookingOptions: BookingOption[];
  onSave?: (card: ExpandedCardData) => void;
  onSchedule?: (card: ExpandedCardData) => void;
  onPurchase?: (card: ExpandedCardData, bookingOption: BookingOption) => void;
  onShare?: (card: ExpandedCardData) => void;
}

export default function ActionButtons({
  card,
  bookingOptions,
  onSave,
  onSchedule,
  onPurchase,
  onShare,
}: ActionButtonsProps) {
  const handleSave = () => {
    if (onSave) {
      onSave(card);
    } else {
      Alert.alert('Saved', `${card.title} has been saved to your collection`);
    }
  };

  const handleSchedule = () => {
    if (onSchedule) {
      onSchedule(card);
    } else {
      Alert.alert('Scheduled', `${card.title} has been added to your calendar`);
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
        Linking.openURL(`tel:${primaryOption.phone.replace(/[^0-9+]/g, '')}`);
      } else {
        Alert.alert('Booking', primaryOption.message);
      }
    } else if (card.website) {
      // Fallback to website
      let url = card.website;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }
      Linking.openURL(url);
    } else if (card.phone) {
      // Fallback to phone
      Linking.openURL(`tel:${card.phone.replace(/[^0-9+]/g, '')}`);
    } else {
      Alert.alert('Booking', 'Booking options are not available for this experience');
    }
  };

  const handleShare = () => {
    if (onShare) {
      onShare(card);
    } else {
      Alert.alert('Share', `Share ${card.title} with friends`);
    }
  };

  const hasBookingOptions = bookingOptions.length > 0 || card.website || card.phone;

  return (
    <View style={styles.container}>
      <View style={styles.buttonsContainer}>
        {/* Save Button */}
        <TouchableOpacity
          style={[styles.button, styles.saveButton]}
          onPress={handleSave}
          activeOpacity={0.7}
        >
          <Ionicons name="bookmark" size={20} color="#eb7825" />
          <Text style={styles.saveButtonText}>Save</Text>
        </TouchableOpacity>

        {/* Schedule Button */}
        <TouchableOpacity
          style={[styles.button, styles.scheduleButton]}
          onPress={handleSchedule}
          activeOpacity={0.7}
        >
          <Ionicons name="calendar" size={20} color="#ffffff" />
          <Text style={styles.scheduleButtonText}>Schedule</Text>
        </TouchableOpacity>
      </View>

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
                {bookingOptions[0].provider === 'opentable' ? 'Reserve' :
                 bookingOptions[0].provider === 'eventbrite' ? 'Get Tickets' :
                 bookingOptions[0].provider === 'viator' ? 'Book' : 'Book Now'}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Share Button - Secondary */}
      <TouchableOpacity
        style={styles.shareButton}
        onPress={handleShare}
        activeOpacity={0.7}
      >
        <Ionicons name="share-outline" size={18} color="#6b7280" />
        <Text style={styles.shareButtonText}>Share Experience</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    gap: 12,
  },
  buttonsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  saveButton: {
    backgroundColor: '#fef3e2',
    borderWidth: 1.5,
    borderColor: '#eb7825',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#eb7825',
  },
  scheduleButton: {
    backgroundColor: '#eb7825',
  },
  scheduleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  buyNowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    position: 'relative',
  },
  buyNowButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  bookingBadge: {
    position: 'absolute',
    top: 8,
    right: 12,
    backgroundColor: '#eb7825',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  bookingBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  shareButtonText: {
    fontSize: 15,
    color: '#6b7280',
    fontWeight: '500',
  },
});

