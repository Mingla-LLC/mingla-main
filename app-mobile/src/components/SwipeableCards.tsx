import React, { useState, useRef, useEffect } from 'react';
import { Text, View, TouchableOpacity, Image, StyleSheet, Dimensions, Animated, PanResponder, SafeAreaView, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { formatCurrency, formatDistance } from './utils/formatters';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface Recommendation {
  id: string;
  title: string;
  category: string;
  categoryIcon: string;
  timeAway: string;
  description: string;
  budget: string;
  rating: number;
  image: string;
  images: string[];
  priceRange: string;
  distance: string;
  travelTime: string;
  experienceType: string;
  highlights: string[];
  fullDescription: string;
  address: string;
  openingHours: string;
  tags: string[];
  matchScore: number;
  reviewCount: number;
  socialStats: {
    views: number;
    likes: number;
    saves: number;
    shares: number;
  };
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
}

interface SwipeableCardsProps {
  userPreferences?: any;
  currentMode?: string;
  onCardLike?: (card: any) => void;
  accountPreferences?: {
    currency: string;
    measurementSystem: 'Metric' | 'Imperial';
  };
  onAddToCalendar?: (experienceData: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  removedCardIds?: string[];
  generateNewMockCard?: () => any;
  onboardingData?: any;
}

// Mock data matching the Figma design
const mockRecommendations: Recommendation[] = [
  {
    id: '1',
    title: 'Golden Gate Park Trail',
    category: 'Take a Stroll',
    categoryIcon: 'leaf',
    timeAway: '18 min away',
    description: 'Scenic walking adventure for nature lovers',
    budget: 'Free activity within your budget',
    rating: 4.7,
    reviewCount: 203,
    priceRange: 'Free',
    distance: '4.2 km',
    travelTime: '18m',
    experienceType: 'Outdoor',
    highlights: ['Japanese Tea Garden', 'Rose Garden', 'Scenic Views'],
    fullDescription: 'Explore the beautiful trails of Golden Gate Park with stunning views and peaceful nature.',
    address: 'Golden Gate Park, San Francisco, CA',
    openingHours: 'Daily 5AM-10PM',
    tags: ['Japanese Tea Garden', 'Rose Garden', '+2'],
    matchScore: 95,
    image: 'https://images.unsplash.com/photo-1739139106925-230659c867e0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxvdXRkb29yJTIwcGFyayUyMHdhbGtpbmclMjB0cmFpbHxlbnwxfHx8fDE3NTkxNzI1MTJ8MA&ixlib=rb-4.1.0&q=80&w=1080',
    images: [
      'https://images.unsplash.com/photo-1739139106925-230659c867e0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxvdXRkb29yJTIwcGFyayUyMHdhbGtpbmclMjB0cmFpbHxlbnwxfHx8fDE3NTkxNzI1MTJ8MA&ixlib=rb-4.1.0&q=80&w=1080'
    ],
    socialStats: {
      views: 1250,
      likes: 89,
      saves: 23,
      shares: 12
    },
    matchFactors: {
      location: 92,
      budget: 100,
      category: 88,
      time: 85,
      popularity: 90
    }
  },
  {
    id: '2',
    title: 'Sightglass Coffee Roastery',
    category: 'Sip & Chill',
    categoryIcon: 'cafe',
    timeAway: '12 min away',
    description: 'Intimate coffee experience with artisan vibes',
    budget: 'Perfect for your $25-75 budget range',
    rating: 4.6,
    reviewCount: 89,
    priceRange: '$15.00-$40.00',
    distance: '2.1 km',
    travelTime: '12m',
    experienceType: 'Cafe',
    highlights: ['Single Origin Coffee', 'Local Pastries', 'Cozy Atmosphere'],
    fullDescription: 'Experience the art of coffee making in this intimate roastery setting.',
    address: '2707 19th St, San Francisco, CA',
    openingHours: 'Daily 7AM-6PM',
    tags: ['Single Origin Coffee', 'Local Pastries', '+2'],
    matchScore: 87,
    image: 'https://images.unsplash.com/photo-1642315160505-b3dff3a3c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY296eSUyMGludGVyaW9yfGVufDF8fHx8MTc1OTExMDg1OHww&ixlib=rb-4.1.0&q=80&w=1080',
    images: [
      'https://images.unsplash.com/photo-1642315160505-b3dff3a3c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY296eSUyMGludGVyaW9yfGVufDF8fHx8MTc1OTExMDg1OHww&ixlib=rb-4.1.0&q=80&w=1080'
    ],
    socialStats: {
      views: 890,
      likes: 67,
      saves: 18,
      shares: 8
    },
    matchFactors: {
      location: 85,
      budget: 92,
      category: 90,
      time: 88,
      popularity: 85
    }
  }
];

const getIconComponent = (iconName: string) => {
  const iconMap: {[key: string]: string} = {
    'Coffee': 'cafe',
    'TreePine': 'leaf',
    'Sparkles': 'sparkles',
    'Dumbbell': 'fitness',
    'Utensils': 'restaurant',
    'Eye': 'eye',
    'Heart': 'heart',
    'Calendar': 'calendar',
    'MapPin': 'location',
    'Clock': 'time',
    'Star': 'star',
    'Navigation': 'navigate',
    'Palette': 'color-palette',
    'Bookmark': 'bookmark'
  };
  
  return iconMap[iconName] || 'heart';
};

export default function SwipeableCards({ 
  userPreferences, 
  currentMode = 'solo', 
  onCardLike, 
  accountPreferences, 
  onAddToCalendar, 
  onShareCard, 
  onPurchaseComplete, 
  removedCardIds = [], 
  generateNewMockCard, 
  onboardingData 
}: SwipeableCardsProps) {
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [removedCards, setRemovedCards] = useState<Set<string>>(new Set());

  const availableRecommendations = mockRecommendations.filter(rec => 
    !removedCards.has(rec.id) && !removedCardIds.includes(rec.id)
  );

  const currentRec = availableRecommendations[currentCardIndex];

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      setIsDragging(true);
    },
    onPanResponderMove: (evt, gestureState) => {
      setDragOffset({ x: gestureState.dx, y: gestureState.dy });
    },
    onPanResponderRelease: (evt, gestureState) => {
      setIsDragging(false);
      
      if (Math.abs(gestureState.dx) > 100) {
        // Swipe left or right
        handleSwipe(gestureState.dx > 0 ? 'right' : 'left');
      } else {
        // Reset position
        setDragOffset({ x: 0, y: 0 });
      }
    },
  });

  const handleSwipe = (direction: 'left' | 'right') => {
    if (direction === 'right' && onCardLike) {
      onCardLike(currentRec);
    }
    
    setRemovedCards(prev => new Set([...prev, currentRec.id]));
    setCurrentCardIndex(prev => prev + 1);
    setDragOffset({ x: 0, y: 0 });
  };

  const handleBuyNow = () => {
    if (onAddToCalendar) {
      onAddToCalendar(currentRec);
    }
  };

  const handleShare = () => {
    if (onShareCard) {
      onShareCard(currentRec);
    }
  };

  if (availableRecommendations.length === 0) {
    return (
      <View style={styles.noCardsContainer}>
        <View style={styles.noCardsContent}>
          <View style={styles.sparklesContainer}>
            <Ionicons name="sparkles" size={40} color="#eb7825" />
          </View>
          <Text style={styles.noCardsTitle}>You're all caught up!</Text>
          <Text style={styles.noCardsSubtitle}>
            You've reviewed all available recommendations. Check back later for more personalized suggestions!
          </Text>
          <TouchableOpacity 
            onPress={() => setRemovedCards(new Set())}
            style={styles.startOverButton}
          >
            <Text style={styles.startOverButtonText}>Start Over</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!currentRec) {
    return null;
  }

  const CategoryIcon = getIconComponent(currentRec.categoryIcon);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View style={styles.container}>
        <View style={styles.cardContainer}>
        <View 
          style={[
            styles.card,
            {
              transform: [
                { translateX: dragOffset.x },
                { translateY: dragOffset.y },
                { rotate: `${dragOffset.x * 0.1}deg` }
              ]
            }
          ]}
          {...panResponder.panHandlers}
        >
          {/* Card Image */}
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: currentRec.image }}
              style={styles.cardImage}
              resizeMode="cover"
            />
            
            {/* Match Score Badge */}
            <View style={styles.matchBadge}>
              <Text style={styles.matchText}>{currentRec.matchScore}% Match</Text>
            </View>
            
            {/* Card Counter */}
            <View style={styles.cardCounter}>
              <Text style={styles.counterText}>1/3</Text>
            </View>
            
            {/* Card Title Overlay */}
            <View style={styles.titleOverlay}>
              <Text style={styles.cardTitle}>{currentRec.title}</Text>
              <View style={styles.categoryRow}>
                <Ionicons name={CategoryIcon as any} size={16} color="white" />
                <Text style={styles.categoryText}>{currentRec.category}</Text>
              </View>
            </View>
            
            {/* Action Buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity style={styles.buyButton} onPress={handleBuyNow}>
                <Ionicons name="bag" size={20} color="white" />
                <Text style={styles.buyButtonText}>Buy Now</Text>
              </TouchableOpacity>
              
              <View style={styles.rightButtons}>
                <TouchableOpacity style={styles.actionButton}>
                  <Ionicons name="chevron-down" size={20} color="white" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
                  <Ionicons name="share" size={20} color="white" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
          
          {/* Card Details */}
          <View style={styles.cardDetails}>
            <View style={styles.detailsRow}>
              <View style={styles.ratingContainer}>
                <Ionicons name="star" size={16} color="#eb7825" />
                <Text style={styles.ratingText}>{currentRec.rating} ({currentRec.reviewCount})</Text>
              </View>
              
              <View style={styles.distanceContainer}>
                <Ionicons name="navigate" size={16} color="#eb7825" />
                <Text style={styles.distanceText}>{currentRec.travelTime}</Text>
              </View>
              
              <Text style={styles.priceText}>{currentRec.priceRange}</Text>
            </View>
            
            <Text style={styles.description}>{currentRec.description}</Text>
            
            <View style={styles.tagsContainer}>
              {currentRec.tags.slice(0, 3).map((tag, index) => (
                <View key={index} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  container: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContainer: {
    width: screenWidth * 0.92,
    height: screenHeight * 0.65,
    maxWidth: 380,
  },
  card: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  imageContainer: {
    flex: 1,
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  matchBadge: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: '#eb7825',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  matchText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  cardCounter: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  counterText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  titleOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  cardTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  actionButtons: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  buyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eb7825',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    gap: 8,
    flex: 1,
    marginRight: 12,
  },
  buyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  rightButtons: {
    flexDirection: 'column',
    gap: 8,
  },
  actionButton: {
    width: 48,
    height: 48,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardDetails: {
    padding: 24,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  distanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  distanceText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  priceText: {
    fontSize: 14,
    color: '#eb7825',
    fontWeight: '600',
  },
  description: {
    fontSize: 16,
    color: '#374151',
    marginBottom: 12,
    lineHeight: 22,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#eb7825',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  tagText: {
    fontSize: 12,
    color: '#eb7825',
    fontWeight: '500',
  },
  noCardsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  noCardsContent: {
    alignItems: 'center',
    gap: 16,
  },
  sparklesContainer: {
    width: 80,
    height: 80,
    backgroundColor: '#fef3e2',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noCardsTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  noCardsSubtitle: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 24,
  },
  startOverButton: {
    backgroundColor: '#eb7825',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  startOverButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});