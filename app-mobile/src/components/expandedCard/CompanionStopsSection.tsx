import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
        <Ionicons name="location" size={20} color="#eb7825" />
        <Text style={styles.title}>Start Your Stroll</Text>
      </View>
      <Text style={styles.subtitle}>
        Begin at one of these nearby spots before your walk
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
                  <Ionicons
                    name={getTypeIcon(stop.type) as any}
                    size={20}
                    color="#eb7825"
                  />
                </View>
                <View style={styles.stopInfo}>
                  <Text style={styles.stopName}>{stop.name}</Text>
                  <Text style={styles.stopType}>{getTypeLabel(stop.type)}</Text>
                </View>
              </View>
              {stop.rating && (
                <View style={styles.stopRating}>
                  <Ionicons name="star" size={14} color="#fbbf24" />
                  <Text style={styles.ratingText}>
                    {stop.rating.toFixed(1)}
                  </Text>
                  {stop.reviewCount && (
                    <Text style={styles.reviewText}>
                      ({stop.reviewCount} reviews)
                    </Text>
                  )}
                </View>
              )}
              {stop.address && (
                <View style={styles.stopAddress}>
                  <Ionicons name="location-outline" size={12} color="#9ca3af" />
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
    backgroundColor: '#ffffff',
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
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
    color: '#111827',
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  stopsContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  stopCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  stopImage: {
    width: '100%',
    height: 120,
    backgroundColor: '#e5e7eb',
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
    backgroundColor: '#fef3e2',
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
    color: '#111827',
    marginBottom: 2,
  },
  stopType: {
    fontSize: 12,
    color: '#6b7280',
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
    color: '#111827',
  },
  reviewText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  stopAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addressText: {
    fontSize: 12,
    color: '#9ca3af',
    flex: 1,
  },
});

