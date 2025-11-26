import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from '../figma/ImageWithFallback';

interface SavedCard {
  id: string;
  title: string;
  category: string;
  categoryIcon: any;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  priceRange: string;
  travelTime: string;
  description: string;
  fullDescription: string;
  address: string;
  highlights: string[];
  matchScore: number;
  socialStats: {
    views: number;
    likes: number;
    saves: number;
  };
  dateAdded: string;
  source: 'solo' | 'collaboration';
  sessionName?: string;
  purchaseOptions?: Array<{
    id: string;
    title: string;
    price: number;
    currency: string;
    description: string;
    features: string[];
    popular?: boolean;
  }>;
}

interface SavedTabProps {
  savedCards: SavedCard[];
  onScheduleFromSaved: (card: SavedCard) => void;
  onPurchaseFromSaved: (card: SavedCard, purchaseOption: any) => void;
  onShareCard: (card: SavedCard) => void;
  onRemoveSaved: (card: SavedCard) => void;
  userPreferences?: any;
}

const SavedTab = ({
  savedCards,
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onShareCard,
  onRemoveSaved,
  userPreferences
}: SavedTabProps) => {
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<{[cardId: string]: number}>({});

  const styles = StyleSheet.create({
    container: {
      gap: 16,
    },
    experienceCard: {
      backgroundColor: 'white',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: '#e5e7eb',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
      overflow: 'hidden',
    },
    cardContent: {
      padding: 16,
    },
    cardHeader: {
      flexDirection: 'row',
      gap: 12,
    },
    cardImage: {
      width: 64,
      height: 64,
      borderRadius: 12,
      overflow: 'hidden',
    },
    cardInfo: {
      flex: 1,
      minWidth: 0,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 8,
    },
    cardCategory: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    categoryIcon: {
      width: 16,
      height: 16,
      color: '#eb7825',
    },
    categoryText: {
      fontSize: 14,
      color: '#6b7280',
    },
    cardMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    cardStats: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    statItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    statIcon: {
      width: 16,
      height: 16,
      color: '#eb7825',
    },
    statText: {
      fontSize: 14,
      color: '#6b7280',
    },
    priceText: {
      fontSize: 14,
      fontWeight: '600',
      color: '#eb7825',
    },
    expandButton: {
      padding: 4,
      borderRadius: 20,
    },
    expandIcon: {
      width: 16,
      height: 16,
      color: '#6b7280',
    },
    sourceIndicator: {
      marginTop: 8,
    },
    sourceBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
    },
    soloBadge: {
      backgroundColor: '#dbeafe',
    },
    collaborationBadge: {
      backgroundColor: '#f3e8ff',
    },
    soloText: {
      color: '#1e40af',
    },
    collaborationText: {
      color: '#7c3aed',
    },
    sourceIcon: {
      width: 12,
      height: 12,
    },
    sourceText: {
      fontSize: 12,
    },
    quickActions: {
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: 8,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: '#eb7825',
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    primaryButtonText: {
      color: 'white',
      fontSize: 14,
      fontWeight: '500',
    },
    secondaryButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: '#e5e7eb',
      borderRadius: 12,
    },
    secondaryButtonIcon: {
      width: 16,
      height: 16,
      color: '#6b7280',
    },
    expandedContent: {
      borderTopWidth: 1,
      borderTopColor: '#f3f4f6',
      backgroundColor: '#f9fafb',
    },
    imageGallery: {
      position: 'relative',
    },
    galleryImage: {
      aspectRatio: 16/9,
      overflow: 'hidden',
    },
    imageNavigation: {
      position: 'absolute',
      top: '50%',
      transform: [{ translateY: -16 }],
      width: 32,
      height: 32,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
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
      color: 'white',
    },
    imageIndicators: {
      position: 'absolute',
      bottom: 8,
      left: '50%',
      transform: [{ translateX: -50 }],
      flexDirection: 'row',
      gap: 4,
    },
    indicator: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    activeIndicator: {
      backgroundColor: 'white',
    },
    inactiveIndicator: {
      backgroundColor: 'rgba(255, 255, 255, 0.5)',
    },
    detailsSection: {
      padding: 16,
      gap: 16,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: '#111827',
      marginBottom: 8,
    },
    sectionText: {
      fontSize: 14,
      color: '#6b7280',
      lineHeight: 20,
    },
    highlightsContainer: {
      gap: 8,
    },
    highlightsList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    highlightTag: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: '#fef3e2',
      borderRadius: 8,
    },
    highlightText: {
      fontSize: 12,
      color: '#ea580c',
    },
    locationContainer: {
      gap: 8,
    },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    locationIcon: {
      width: 16,
      height: 16,
      color: '#eb7825',
      marginTop: 2,
      flexShrink: 0,
    },
    locationText: {
      fontSize: 14,
      color: '#6b7280',
      flex: 1,
    },
    socialStatsContainer: {
      gap: 8,
    },
    socialStatsTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: '#111827',
      marginBottom: 8,
    },
    socialStatsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    socialStatItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    socialStatIcon: {
      width: 16,
      height: 16,
    },
    socialStatText: {
      fontSize: 14,
      color: '#6b7280',
    },
    emptyState: {
      alignItems: 'center',
      paddingVertical: 48,
    },
    emptyStateIcon: {
      width: 48,
      height: 48,
      color: '#d1d5db',
      marginBottom: 16,
    },
    emptyStateTitle: {
      fontSize: 18,
      fontWeight: '500',
      color: '#111827',
      marginBottom: 8,
    },
    emptyStateSubtitle: {
      fontSize: 14,
      color: '#6b7280',
      textAlign: 'center',
      marginBottom: 24,
    },
  });

  const getIconComponent = (iconName: any) => {
    if (typeof iconName === 'function') {
      return iconName;
    }
    
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
      'Users': 'people',
      'Check': 'checkmark',
      'ThumbsUp': 'thumbs-up',
      'ThumbsDown': 'thumbs-down',
      'MessageSquare': 'chatbubble',
      'Share2': 'share',
      'X': 'close',
      'ChevronRight': 'chevron-forward',
      'ChevronLeft': 'chevron-back',
      'Bookmark': 'bookmark'
    };
    
    return iconMap[iconName] || 'heart';
  };

  const nextImage = (cardId: string, totalImages: number) => {
    setCurrentImageIndex(prev => ({
      ...prev,
      [cardId]: ((prev[cardId] || 0) + 1) % totalImages
    }));
  };

  const prevImage = (cardId: string, totalImages: number) => {
    setCurrentImageIndex(prev => ({
      ...prev,
      [cardId]: ((prev[cardId] || 0) - 1 + totalImages) % totalImages
    }));
  };

  const handleSchedule = (card: SavedCard) => {
    onScheduleFromSaved(card);
    
    // Add to device calendar
    try {
      const dateTimePrefs = userPreferences ? {
        timeOfDay: userPreferences.timeOfDay || 'Afternoon',
        dayOfWeek: userPreferences.dayOfWeek || 'Weekend',
        planningTimeframe: userPreferences.planningTimeframe || 'This month'
      } : {
        timeOfDay: 'Afternoon',
        dayOfWeek: 'Weekend',
        planningTimeframe: 'This month'
      };
      
      // This would integrate with calendar utilities
    } catch (error) {
      console.error('Error adding to device calendar:', error);
    }
  };

  if (savedCards.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="heart" size={48} color="#d1d5db" />
        <Text style={styles.emptyStateTitle}>No Saved Experiences</Text>
        <Text style={styles.emptyStateSubtitle}>
          Start swiping to save experiences you love
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {savedCards.map((card) => {
        const CardIcon = getIconComponent(card.categoryIcon);
        const isExpanded = expandedCard === card.id;
        
        return (
          <View key={card.id} style={styles.experienceCard}>
            <View style={styles.cardContent}>
              <View style={styles.cardHeader}>
                <View style={styles.cardImage}>
                  <ImageWithFallback
                    src={card.image}
                    alt={card.title}
                    style={{ width: '100%', height: '100%' }}
                  />
                </View>
                
                <View style={styles.cardInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{card.title}</Text>
                      <View style={styles.cardCategory}>
                        <Ionicons name={CardIcon} size={16} color="#eb7825" />
                        <Text style={styles.categoryText}>{card.category}</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 12, color: '#6b7280' }}>
                        {card.dateAdded || 'Recently saved'}
                      </Text>
                    </View>
                  </View>
                  
                  <View style={styles.cardMeta}>
                    <View style={styles.cardStats}>
                      <View style={styles.statItem}>
                        <Ionicons name="star" size={16} color="#eb7825" />
                        <Text style={styles.statText}>{card.rating || '4.5'}</Text>
                      </View>
                      <View style={styles.statItem}>
                        <Ionicons name="navigate" size={16} color="#eb7825" />
                        <Text style={styles.statText}>{card.travelTime || '15 min'}</Text>
                      </View>
                      <Text style={styles.priceText}>{card.priceRange || '$25-50'}</Text>
                    </View>
                    
                    <TouchableOpacity
                      onPress={() => setExpandedCard(isExpanded ? null : card.id)}
                      style={styles.expandButton}
                    >
                      <Ionicons 
                        name={isExpanded ? "chevron-up" : "chevron-down"} 
                        size={16} 
                        color="#6b7280" 
                      />
                    </TouchableOpacity>
                  </View>

                  {/* Source indicator */}
                  <View style={styles.sourceIndicator}>
                    <View style={[
                      styles.sourceBadge,
                      card.source === 'solo' ? styles.soloBadge : styles.collaborationBadge
                    ]}>
                      <Ionicons 
                        name={card.source === 'solo' ? "eye" : "people"} 
                        size={12} 
                        color={card.source === 'solo' ? "#1e40af" : "#7c3aed"} 
                      />
                      <Text style={[
                        styles.sourceText,
                        card.source === 'solo' ? styles.soloText : styles.collaborationText
                      ]}>
                        {card.source === 'solo' ? 'Solo Discovery' : `From ${card.sessionName}`}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>

            {/* Quick Actions */}
            <View style={styles.quickActions}>
              <View style={styles.actionsRow}>
                {/* Conditional Buy Now/Schedule button */}
                {card.purchaseOptions && card.purchaseOptions.length > 0 ? (
                  <TouchableOpacity 
                    onPress={() => onPurchaseFromSaved(card, card.purchaseOptions?.[0])}
                    style={styles.primaryButton}
                  >
                    <Ionicons name="bag" size={16} color="white" />
                    <Text style={styles.primaryButtonText}>Buy Now</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity 
                    onPress={() => handleSchedule(card)}
                    style={styles.primaryButton}
                  >
                    <Ionicons name="calendar" size={16} color="white" />
                    <Text style={styles.primaryButtonText}>Schedule</Text>
                  </TouchableOpacity>
                )}
                
                <TouchableOpacity 
                  onPress={() => onShareCard(card)}
                  style={styles.secondaryButton}
                >
                  <Ionicons name="share" size={16} color="#6b7280" />
                </TouchableOpacity>
                
                <TouchableOpacity 
                  onPress={() => onRemoveSaved(card)}
                  style={styles.secondaryButton}
                >
                  <Ionicons name="close" size={16} color="#6b7280" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Expanded Details */}
            {isExpanded && (
              <View style={styles.expandedContent}>
                {/* Image Gallery */}
                {card.images && card.images.length > 0 && (
                  <View style={styles.imageGallery}>
                    <View style={styles.galleryImage}>
                      <ImageWithFallback
                        src={card.images[currentImageIndex[card.id] || 0]}
                        alt={card.title}
                        style={{ width: '100%', height: '100%' }}
                      />
                      
                      {card.images.length > 1 && (
                        <>
                          <TouchableOpacity
                            onPress={() => prevImage(card.id, card.images.length)}
                            style={[styles.imageNavigation, styles.leftNav]}
                          >
                            <Ionicons name="chevron-back" size={16} color="white" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => nextImage(card.id, card.images.length)}
                            style={[styles.imageNavigation, styles.rightNav]}
                          >
                            <Ionicons name="chevron-forward" size={16} color="white" />
                          </TouchableOpacity>
                          
                          {/* Image indicators */}
                          <View style={styles.imageIndicators}>
                            {card.images.map((_, index) => (
                              <View
                                key={index}
                                style={[
                                  styles.indicator,
                                  index === (currentImageIndex[card.id] || 0)
                                    ? styles.activeIndicator
                                    : styles.inactiveIndicator
                                ]}
                              />
                            ))}
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
                    <Text style={styles.sectionText}>{card.fullDescription}</Text>
                  </View>
                  
                  {card.highlights && card.highlights.length > 0 && (
                    <View style={styles.highlightsContainer}>
                      <Text style={styles.sectionTitle}>Highlights</Text>
                      <View style={styles.highlightsList}>
                        {card.highlights.map((highlight, index) => (
                          <View key={index} style={styles.highlightTag}>
                            <Text style={styles.highlightText}>{highlight}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                  
                  <View style={styles.locationContainer}>
                    <Text style={styles.sectionTitle}>Location</Text>
                    <View style={styles.locationRow}>
                      <Ionicons name="location" size={16} color="#eb7825" />
                      <Text style={styles.locationText}>
                        {card.address || 'Address not available'}
                      </Text>
                    </View>
                  </View>
                  
                  {card.socialStats && (
                    <View style={styles.socialStatsContainer}>
                      <Text style={styles.socialStatsTitle}>Community Stats</Text>
                      <View style={styles.socialStatsRow}>
                        <View style={styles.socialStatItem}>
                          <Ionicons name="eye" size={16} color="#6b7280" />
                          <Text style={styles.socialStatText}>{card.socialStats.views} views</Text>
                        </View>
                        <View style={styles.socialStatItem}>
                          <Ionicons name="heart" size={16} color="#6b7280" />
                          <Text style={styles.socialStatText}>{card.socialStats.likes} likes</Text>
                        </View>
                        <View style={styles.socialStatItem}>
                          <Ionicons name="bookmark" size={16} color="#6b7280" />
                          <Text style={styles.socialStatText}>{card.socialStats.saves} saves</Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
};

export default SavedTab;
