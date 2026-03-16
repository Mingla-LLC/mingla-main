import React, { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Icon } from '../ui/Icon';
import { ImageWithFallback } from '../figma/ImageWithFallback';
import { useLocalePreferences } from '../../hooks/useLocalePreferences';
import { formatPriceRange, getCurrencySymbol, getCurrencyRate } from '../utils/formatters';
import { PriceTierSlug, TIER_BY_SLUG, formatTierLabel } from '../../constants/priceTiers';

interface ExperienceCardProps {
  experience: {
    id: string;
    title: string;
    category: string;
    categoryIcon: any;
    image: string;
    images?: string[];
    rating: number;
    reviewCount: number;
    priceRange: string;
    priceTier?: string;
    travelTime: string;
    description: string;
    fullDescription: string;
    address: string;
    highlights: string[];
    socialStats: {
      views: number;
      likes: number;
      saves: number;
    };
    dateAdded?: string;
    source?: 'solo' | 'collaboration';
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
  };
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onSchedule?: (experience: any) => void;
  onPurchase?: (experience: any, purchaseOption: any) => void;
  onShare?: (experience: any) => void;
  onRemove?: (experience: any) => void;
  showActions?: boolean;
  variant?: 'saved' | 'calendar';
}

const ExperienceCard = ({
  experience,
  isExpanded = false,
  onToggleExpand,
  onSchedule,
  onPurchase,
  onShare,
  onRemove,
  showActions = true,
  variant = 'saved'
}: ExperienceCardProps) => {
  const { currency } = useLocalePreferences();
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);

  const styles = StyleSheet.create({
    card: {
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

  const nextImage = (totalImages: number) => {
    setCurrentImageIndex(prev => (prev + 1) % totalImages);
  };

  const prevImage = (totalImages: number) => {
    setCurrentImageIndex(prev => (prev - 1 + totalImages) % totalImages);
  };

  const CardIcon = getIconComponent(experience.categoryIcon);

  return (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={styles.cardImage}>
            <ImageWithFallback
              src={experience.image}
              alt={experience.title}
              style={{ width: '100%', height: '100%' }}
            />
          </View>
          
          <View style={styles.cardInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{experience.title}</Text>
                <View style={styles.cardCategory}>
                  <Icon name={CardIcon} size={16} color="#eb7825" />
                  <Text style={styles.categoryText}>{experience.category}</Text>
                </View>
              </View>
              {experience.dateAdded && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 12, color: '#6b7280' }}>
                    {experience.dateAdded}
                  </Text>
                </View>
              )}
            </View>
            
            <View style={styles.cardMeta}>
              <View style={styles.cardStats}>
                <View style={styles.statItem}>
                  <Icon name="star" size={16} color="#eb7825" />
                  <Text style={styles.statText}>{experience.rating || '4.5'}</Text>
                </View>
                <View style={styles.statItem}>
                  <Icon name="navigate" size={16} color="#eb7825" />
                  <Text style={styles.statText}>{experience.travelTime || '15 min'}</Text>
                </View>
                <Text style={styles.priceText}>
                  {experience.priceTier && TIER_BY_SLUG[experience.priceTier as PriceTierSlug]
                    ? formatTierLabel(experience.priceTier as PriceTierSlug, getCurrencySymbol(currency), getCurrencyRate(currency))
                    : experience.priceRange ? formatPriceRange(experience.priceRange, currency) : 'Varies'}
                </Text>
              </View>
              
              {onToggleExpand && (
                <TrackedTouchableOpacity logComponent="ExperienceCard"
                  onPress={onToggleExpand}
                  style={styles.expandButton}
                >
                  <Icon 
                    name={isExpanded ? "chevron-up" : "chevron-down"} 
                    size={16} 
                    color="#6b7280" 
                  />
                </TrackedTouchableOpacity>
              )}
            </View>

            {/* Source indicator */}
            {experience.source && (
              <View style={styles.sourceIndicator}>
                <View style={[
                  styles.sourceBadge,
                  experience.source === 'solo' ? styles.soloBadge : styles.collaborationBadge
                ]}>
                  <Icon 
                    name={experience.source === 'solo' ? "eye" : "people"} 
                    size={12} 
                    color={experience.source === 'solo' ? "#1e40af" : "#7c3aed"} 
                  />
                  <Text style={[
                    styles.sourceText,
                    experience.source === 'solo' ? styles.soloText : styles.collaborationText
                  ]}>
                    {experience.source === 'solo' ? 'Solo Discovery' : `From ${experience.sessionName}`}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Quick Actions */}
      {showActions && (
        <View style={styles.quickActions}>
          <View style={styles.actionsRow}>
            {/* Conditional Buy Now/Schedule button */}
            {experience.purchaseOptions && experience.purchaseOptions.length > 0 ? (
              <TrackedTouchableOpacity logComponent="ExperienceCard" 
                onPress={() => onPurchase?.(experience, experience.purchaseOptions?.[0])}
                style={styles.primaryButton}
              >
                <Icon name="bag" size={16} color="white" />
                <Text style={styles.primaryButtonText}>Buy Now</Text>
              </TrackedTouchableOpacity>
            ) : (
              <TrackedTouchableOpacity logComponent="ExperienceCard" 
                onPress={() => onSchedule?.(experience)}
                style={styles.primaryButton}
              >
                <Icon name="calendar" size={16} color="white" />
                <Text style={styles.primaryButtonText}>Schedule</Text>
              </TrackedTouchableOpacity>
            )}
            
            {onShare && (
              <TrackedTouchableOpacity logComponent="ExperienceCard" 
                onPress={() => onShare(experience)}
                style={styles.secondaryButton}
              >
                <Icon name="share" size={16} color="#6b7280" />
              </TrackedTouchableOpacity>
            )}
            
            {onRemove && (
              <TrackedTouchableOpacity logComponent="ExperienceCard" 
                onPress={() => onRemove(experience)}
                style={styles.secondaryButton}
              >
                <Icon name="close" size={16} color="#6b7280" />
              </TrackedTouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Expanded Details */}
      {isExpanded && (
        <View style={styles.expandedContent}>
          {/* Image Gallery */}
          {experience.images && experience.images.length > 0 && (
            <View style={styles.imageGallery}>
              <View style={styles.galleryImage}>
                <ImageWithFallback
                  src={experience.images[currentImageIndex]}
                  alt={experience.title}
                  style={{ width: '100%', height: '100%' }}
                />
                
                {experience.images.length > 1 && (
                  <>
                    <TrackedTouchableOpacity logComponent="ExperienceCard"
                      onPress={() => prevImage(experience.images.length)}
                      style={[styles.imageNavigation, styles.leftNav]}
                    >
                      <Icon name="chevron-back" size={16} color="white" />
                    </TrackedTouchableOpacity>
                    <TrackedTouchableOpacity logComponent="ExperienceCard"
                      onPress={() => nextImage(experience.images.length)}
                      style={[styles.imageNavigation, styles.rightNav]}
                    >
                      <Icon name="chevron-forward" size={16} color="white" />
                    </TrackedTouchableOpacity>
                    
                    {/* Image indicators */}
                    <View style={styles.imageIndicators}>
                      {experience.images.map((_, index) => (
                        <View
                          key={index}
                          style={[
                            styles.indicator,
                            index === currentImageIndex
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
              <Text style={styles.sectionText}>{experience.fullDescription}</Text>
            </View>
            
            {experience.highlights && experience.highlights.length > 0 && (
              <View style={styles.highlightsContainer}>
                <Text style={styles.sectionTitle}>Highlights</Text>
                <View style={styles.highlightsList}>
                  {experience.highlights.map((highlight, index) => (
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
                <Icon name="location" size={16} color="#eb7825" />
                <Text style={styles.locationText}>
                  {experience.address || 'Address not available'}
                </Text>
              </View>
            </View>
            
            {experience.socialStats && (
              <View style={styles.socialStatsContainer}>
                <Text style={styles.socialStatsTitle}>Community Stats</Text>
                <View style={styles.socialStatsRow}>
                  <View style={styles.socialStatItem}>
                    <Icon name="eye" size={16} color="#6b7280" />
                    <Text style={styles.socialStatText}>{experience.socialStats.views} views</Text>
                  </View>
                  <View style={styles.socialStatItem}>
                    <Icon name="heart" size={16} color="#6b7280" />
                    <Text style={styles.socialStatText}>{experience.socialStats.likes} likes</Text>
                  </View>
                  <View style={styles.socialStatItem}>
                    <Icon name="bookmark" size={16} color="#6b7280" />
                    <Text style={styles.socialStatText}>{experience.socialStats.saves} saves</Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

export default ExperienceCard;
