import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Icon } from '../ui/Icon';
import { useTranslation } from 'react-i18next';

interface CompanionStop {
  id: string;
  name: string;
  location: { lat: number; lng: number };
  address: string;
  rating?: number;
  reviewCount?: number;
  imageUrl?: string | null;
  placeId: string;
  type: string;
}

interface CompanionStopsSectionProps {
  companionStops: CompanionStop[];
}

export default function CompanionStopsSection({
  companionStops,
}: CompanionStopsSectionProps) {
  const { t } = useTranslation(['expanded_details', 'common']);

  if (!companionStops || companionStops.length === 0) {
    return null;
  }

  const getTypeIcon = (type: string): string => {
    const typeMap: { [key: string]: string } = {
      cafe: 'cafe',
      coffee_shop: 'cafe',
      bakery: 'restaurant',
      ice_cream_shop: 'ice-cream',
      gelato_shop: 'ice-cream',
      food_truck: 'fast-food',
      restaurant: 'restaurant',
      bistro: 'restaurant',
      bar: 'wine',
      wine_bar: 'wine',
      juice_bar: 'water',
      smoothie_shop: 'water',
      tea_house: 'cafe',
      donut_shop: 'restaurant',
      pastry_shop: 'restaurant',
      deli: 'restaurant',
      sandwich_shop: 'restaurant',
      pizza_restaurant: 'pizza',
      fast_food_restaurant: 'fast-food',
      meal_takeaway: 'fast-food',
    };
    return typeMap[type] || 'restaurant';
  };

  const getTypeLabel = (type: string): string => {
    const labelMap: { [key: string]: string } = {
      cafe: 'Café',
      coffee_shop: 'Coffee Shop',
      bakery: 'Bakery',
      ice_cream_shop: 'Ice Cream',
      gelato_shop: 'Gelato',
      food_truck: 'Food Truck',
      restaurant: 'Restaurant',
      bistro: 'Bistro',
      bar: 'Bar',
      wine_bar: 'Wine Bar',
      juice_bar: 'Juice Bar',
      smoothie_shop: 'Smoothie',
      tea_house: 'Tea House',
      donut_shop: 'Donuts',
      pastry_shop: 'Pastry',
      deli: 'Deli',
      sandwich_shop: 'Sandwich',
      pizza_restaurant: 'Pizza',
      fast_food_restaurant: 'Fast Food',
      meal_takeaway: 'Takeaway',
    };
    return labelMap[type] || 'Food & Drink';
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Icon name="location" size={20} color="#eb7825" />
        <Text style={styles.title}>{t('expanded_details:companion_stops.title')}</Text>
      </View>
      <Text style={styles.subtitle}>
        {t('expanded_details:companion_stops.subtitle')}
      </Text>

      <View style={styles.stopsContainer}>
        {companionStops.map((stop, index) => (
          <View key={stop.id} style={styles.stopCard}>
            {stop.imageUrl && (
              <Image
                source={{ uri: stop.imageUrl }}
                style={styles.stopImage}
                resizeMode="cover"
              />
            )}
            <View style={styles.stopContent}>
              <View style={styles.stopHeader}>
                <View style={styles.stopIconContainer}>
                  <Icon
                    name={getTypeIcon(stop.type)}
                    size={20}
                    color="#eb7825"
                  />
                </View>
                <View style={styles.stopInfo}>
                  <Text style={styles.stopName}>{stop.name}</Text>
                  <Text style={styles.stopType}>{getTypeLabel(stop.type)}</Text>
                </View>
              </View>
              {(stop.rating ?? 0) > 0 && (
                <View style={styles.stopRating}>
                  <Icon name="star" size={14} color="#fbbf24" />
                  <Text style={styles.ratingText}>
                    {(stop.rating ?? 0).toFixed(1)}
                  </Text>
                  {(stop.reviewCount ?? 0) > 0 && (
                    <Text style={styles.reviewText}>
                      {t('expanded_details:companion_stops.reviews_count', { count: stop.reviewCount })}
                    </Text>
                  )}
                </View>
              )}
              {stop.address && (
                <View style={styles.stopAddress}>
                  <Icon name="location-outline" size={12} color="rgba(255,255,255,0.50)" />
                  <Text style={styles.addressText} numberOfLines={1}>
                    {stop.address}
                  </Text>
                </View>
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.70)',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  stopsContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  stopCard: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  stopImage: {
    width: '100%',
    height: 120,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  stopContent: {
    padding: 12,
  },
  stopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  stopIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 2,
    borderColor: '#eb7825',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopInfo: {
    flex: 1,
  },
  stopName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  stopType: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.70)',
    textTransform: 'capitalize',
  },
  stopRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  reviewText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.50)',
  },
  stopAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addressText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.50)',
    flex: 1,
  },
});

