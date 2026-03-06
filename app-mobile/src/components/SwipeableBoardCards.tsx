import React, { useState, useRef } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, ScrollView, Image, PanResponder, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { parseAndFormatDistance } from './utils/formatters';

interface BoardCard {
  id: string;
  title: string;
  category: string;
  categoryIcon: string; // Changed to string for @expo/vector-icons compatibility
  image: string;
  images?: string[];
  rating: number;
  reviewCount?: number;
  travelTime: string;
  distance?: string;
  priceRange: string;
  description: string;
  fullDescription?: string;
  address?: string;
  highlights?: string[];
  matchScore?: number;
  matchFactors?: {
    location: number;
    budget: number;
    category: number;
  };
  socialStats?: {
    views: number;
    likes: number;
    saves: number;
  };
  votes: {
    yes: number;
    no: number;
    userVote?: 'yes' | 'no' | null;
  };
  rsvps: {
    responded: number;
    total: number;
    userRSVP?: 'yes' | 'no' | null;
  };
  messages: number;
  isLocked: boolean;
  lockedAt?: string;
}

interface SwipeableBoardCardsProps {
  cards: BoardCard[];
  onVote: (cardId: string, vote: 'yes' | 'no') => void;
  onRSVP: (cardId: string, rsvp: 'yes' | 'no') => void;
  onOpenDiscussion?: (cardId: string) => void;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
}

export default function SwipeableBoardCards({ cards, onVote, onRSVP, onOpenDiscussion, accountPreferences }: SwipeableBoardCardsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [galleryIndices, setGalleryIndices] = useState<{[key: string]: number}>({});
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<View>(null);

  if (cards.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconContainer}>
          <Ionicons name="eye" size={32} color="#9ca3af" />
        </View>
        <Text style={styles.emptyText}>No cards in this session yet</Text>
      </View>
    );
  }

  const currentCard = cards[currentIndex];

  // PanResponder for native touch gestures
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
      
      const threshold = 100;
      
      if (gestureState.dx > threshold && currentIndex > 0) {
        // Swipe right - previous card
        setCurrentIndex(currentIndex - 1);
      } else if (gestureState.dx < -threshold && currentIndex < cards.length - 1) {
        // Swipe left - next card
        setCurrentIndex(currentIndex + 1);
      }
      
      setDragOffset({ x: 0, y: 0 });
    },
  });

  const navigateCard = (direction: 'prev' | 'next') => {
    if (direction === 'prev' && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else if (direction === 'next' && currentIndex < cards.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const toggleExpanded = (cardId: string) => {
    setExpandedCard(expandedCard === cardId ? null : cardId);
    // Initialize gallery index for this card if it doesn't exist
    if (!galleryIndices[cardId]) {
      setGalleryIndices(prev => ({ ...prev, [cardId]: 0 }));
    }
  };

  const navigateGallery = (direction: 'prev' | 'next', card: BoardCard) => {
    const currentGalleryIndex = galleryIndices[card.id] || 0;
    
    if (direction === 'prev' && currentGalleryIndex > 0) {
      setGalleryIndices(prev => ({ ...prev, [card.id]: currentGalleryIndex - 1 }));
    } else if (direction === 'next' && card.images && currentGalleryIndex < card.images.length - 1) {
      setGalleryIndices(prev => ({ ...prev, [card.id]: currentGalleryIndex + 1 }));
    }
  };

  const setGalleryIndex = (cardId: string, index: number) => {
    setGalleryIndices(prev => ({ ...prev, [cardId]: index }));
  };

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
  };

  const CardIcon = currentCard.categoryIcon;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Session Cards</Text>
        <View style={styles.headerControls}>
          <Text style={styles.cardCounter}>
            {currentIndex + 1} of {cards.length}
          </Text>
          <View style={styles.navigationButtons}>
            <TouchableOpacity
              onPress={() => navigateCard('prev')}
              disabled={currentIndex === 0}
              style={[
                styles.navButton,
                currentIndex === 0 ? styles.navButtonDisabled : styles.navButtonEnabled
              ]}
            >
              <Ionicons name="chevron-back" size={16} color={currentIndex === 0 ? "#9ca3af" : "#6b7280"} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigateCard('next')}
              disabled={currentIndex === cards.length - 1}
              style={[
                styles.navButton,
                currentIndex === cards.length - 1 ? styles.navButtonDisabled : styles.navButtonEnabled
              ]}
            >
              <Ionicons name="chevron-forward" size={16} color={currentIndex === cards.length - 1 ? "#9ca3af" : "#6b7280"} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Main Card Container */}
      <View style={styles.cardContainer}>
        <View 
          ref={containerRef}
          style={styles.cardWrapper}
          {...panResponder.panHandlers}
        >
          <View 
            style={[
              styles.cardsContainer,
              {
                transform: [{ translateX: -currentIndex * 100 + dragOffset.x }],
              }
            ]}
          >
            {cards.map((card, index) => {
              const isExpanded = expandedCard === card.id;
              
              return (
                <View key={card.id} style={styles.cardSlide}>
                  {/* Main Card */}
                  <View style={[
                    styles.mainCard,
                    isExpanded && styles.expandedCard
                  ]}>
                    <View style={styles.cardContent}>
                      
                      {/* Hero Image */}
                      <View style={styles.imageContainer}>
                        <Image
                          source={{ uri: card.image }}
                          style={styles.cardImage}
                          resizeMode="cover"
                        />
                        
                        {/* Gradient overlay */}
                        <View style={styles.imageOverlay} />
                        
                        {/* Status Badge */}
                        {card.isLocked && (
                          <View style={[styles.statusBadge, styles.lockedBadge]}>
                            <Text style={styles.statusText}>Locked</Text>
                          </View>
                        )}

                        {/* Gallery indicator */}
                        {card.images && card.images.length > 1 && (
                          <View style={styles.galleryIndicator}>
                            <Text style={styles.galleryText}>1/{card.images.length}</Text>
                          </View>
                        )}
                        
                        {/* Bottom overlay info */}
                        <View style={styles.bottomOverlay}>
                          <View style={styles.overlayContent}>
                            <View style={styles.overlayLeft}>
                              <Text style={styles.cardTitle}>{card.title}</Text>
                              <View style={styles.categoryRow}>
                                <Ionicons name={card.categoryIcon as any} size={16} color="white" />
                                <Text style={styles.categoryText}>{card.category}</Text>
                              </View>
                            </View>
                            
                            <TouchableOpacity
                              onPress={() => toggleExpanded(card.id)}
                              style={styles.expandButton}
                            >
                              <Ionicons name="eye" size={16} color="white" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>

                      {/* Compact Info Section */}
                      <View style={styles.infoSection}>
                        {/* Quick stats row */}
                        <View style={styles.statsRow}>
                          <View style={styles.statItem}>
                            <Ionicons name="star" size={16} color="#eb7825" />
                            <Text style={styles.statText}>{card.rating}</Text>
                            <Text style={styles.statSubtext}>({card.reviewCount || '100+'})</Text>
                          </View>
                          <View style={styles.statItem}>
                            <Ionicons name="location" size={16} color="#eb7825" />
                            <Text style={styles.statText}>{parseAndFormatDistance(card.distance, accountPreferences?.measurementSystem) || 'Nearby'}</Text>
                          </View>
                          <View style={styles.statItem}>
                            <Text style={styles.priceText}>{card.priceRange}</Text>
                          </View>
                        </View>
                        
                        {/* Description */}
                        <Text style={styles.description} numberOfLines={2}>{card.description}</Text>
                        
                        {/* Voting Section */}
                        {!card.isLocked ? (
                          <View style={styles.votingSection}>
                            <View style={styles.voteButtons}>
                              <TouchableOpacity
                                onPress={() => onVote(card.id, 'yes')}
                                style={[
                                  styles.voteButton,
                                  card.votes.userVote === 'yes' ? styles.voteButtonActive : styles.voteButtonInactive
                                ]}
                              >
                                <Ionicons name="thumbs-up" size={16} color={card.votes.userVote === 'yes' ? 'white' : '#16a34a'} />
                                <Text style={[
                                  styles.voteButtonText,
                                  card.votes.userVote === 'yes' ? styles.voteButtonTextActive : styles.voteButtonTextInactive
                                ]}>{card.votes.yes}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => onVote(card.id, 'no')}
                                style={[
                                  styles.voteButton,
                                  card.votes.userVote === 'no' ? styles.voteButtonActive : styles.voteButtonInactive
                                ]}
                              >
                                <Ionicons name="thumbs-down" size={16} color={card.votes.userVote === 'no' ? 'white' : '#dc2626'} />
                                <Text style={[
                                  styles.voteButtonText,
                                  card.votes.userVote === 'no' ? styles.voteButtonTextActive : styles.voteButtonTextInactive
                                ]}>{card.votes.no}</Text>
                              </TouchableOpacity>
                            </View>
                            
                            <TouchableOpacity
                              onPress={() => onRSVP(card.id, 'yes')}
                              style={[
                                styles.rsvpButton,
                                card.rsvps.userRSVP === 'yes' ? styles.rsvpButtonActive : styles.rsvpButtonInactive
                              ]}
                            >
                              <Text style={[
                                styles.rsvpButtonText,
                                card.rsvps.userRSVP === 'yes' ? styles.rsvpButtonTextActive : styles.rsvpButtonTextInactive
                              ]}>
                                {card.rsvps.userRSVP === 'yes' ? 'RSVP\'d Yes' : 'RSVP Yes'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={styles.lockedSection}>
                            <View style={styles.lockedContent}>
                              <Ionicons name="checkmark" size={16} color="#16a34a" />
                              <Text style={styles.lockedText}>Added to Calendar</Text>
                            </View>
                            <Text style={styles.lockedSubtext}>Locked {card.lockedAt}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>

                  {/* Expanded Card - Full Details */}
                  {isExpanded && (
                    <View style={styles.expandedCardOverlay}>
                      <View style={styles.expandedCardContent}>
                        
                        {/* Header with close button */}
                        <View style={styles.expandedHeader}>
                          <TouchableOpacity
                            onPress={() => toggleExpanded(card.id)}
                            style={styles.closeButton}
                          >
                            <Ionicons name="close" size={16} color="#6b7280" />
                          </TouchableOpacity>
                          
                          <View style={styles.expandedHeaderCenter}>
                            {card.isLocked && (
                              <View style={[styles.expandedStatusBadge, styles.lockedBadge]}>
                                <Ionicons name="lock-closed" size={16} color="white" />
                                <Text style={styles.expandedStatusText}>Locked In</Text>
                              </View>
                            )}
                          </View>
                        </View>

                        {/* Scrollable content */}
                        <ScrollView style={styles.expandedScrollView}>
                          {/* Image gallery */}
                          <View style={styles.galleryContainer}>
                            <Image
                              source={{ uri: card.images && card.images.length > 1 ? card.images[galleryIndices[card.id] || 0] : card.image }}
                              style={styles.galleryImage}
                              resizeMode="cover"
                            />
                          </View>

                          {/* Detailed content */}
                          <View style={styles.expandedContent}>
                            
                            {/* Title and category */}
                            <View style={styles.expandedTitleSection}>
                              <Text style={styles.expandedTitle}>{card.title}</Text>
                              <View style={styles.expandedCategory}>
                                <Ionicons name={card.categoryIcon as any} size={16} color="#eb7825" />
                                <Text style={styles.expandedCategoryText}>{card.category}</Text>
                              </View>
                              <Text style={styles.expandedDescription}>{card.fullDescription || card.description}</Text>
                            </View>

                            {/* Match breakdown (if available) */}
                            {card.matchFactors && (
                              <View style={styles.matchBreakdown}>
                                <Text style={styles.matchBreakdownTitle}>
                                  <Ionicons name="sparkles" size={16} color="#eb7825" />
                                  Why It's Perfect
                                </Text>
                                <View style={styles.matchFactors}>
                                  {Object.entries(card.matchFactors).slice(0, 3).map(([key, value]) => {
                                    const labels = {
                                      location: 'Location',
                                      budget: 'Budget', 
                                      category: 'Category'
                                    };
                                    return (
                                      <View key={key} style={styles.matchFactor}>
                                        <Text style={styles.matchFactorLabel}>{labels[key as keyof typeof labels]}</Text>
                                        <Text style={styles.matchFactorValue}>{value}%</Text>
                                      </View>
                                    );
                                  })}
                                </View>
                              </View>
                            )}

                            {/* Stats grid */}
                            <View style={styles.statsGrid}>
                              <View style={styles.statCard}>
                                <View style={styles.statCardHeader}>
                                  <Ionicons name="star" size={16} color="#eb7825" />
                                  <Text style={styles.statCardValue}>{card.rating}</Text>
                                </View>
                                <Text style={styles.statCardSubtext}>{card.reviewCount || '100+'} reviews</Text>
                              </View>
                              <View style={styles.statCard}>
                                <View style={styles.statCardHeader}>
                                  <Ionicons name="navigate" size={16} color="#eb7825" />
                                  <Text style={styles.statCardValue}>{card.travelTime}</Text>
                                </View>
                                <Text style={styles.statCardSubtext}>{card.priceRange}</Text>
                              </View>
                            </View>

                            {/* Location */}
                            {card.address && (
                              <View style={styles.locationCard}>
                                <Ionicons name="location" size={16} color="#eb7825" />
                                <Text style={styles.locationText}>{card.address}</Text>
                              </View>
                            )}

                            {/* Highlights */}
                            {card.highlights && card.highlights.length > 0 && (
                              <View style={styles.highlightsSection}>
                                <Text style={styles.highlightsTitle}>What Makes It Special</Text>
                                <View style={styles.highlightsContainer}>
                                  {card.highlights.map((highlight, i) => (
                                    <View key={i} style={styles.highlightTag}>
                                      <Text style={styles.highlightText}>{highlight}</Text>
                                    </View>
                                  ))}
                                </View>
                              </View>
                            )}

                            {/* Voting Status */}
                            <View style={styles.votingStatus}>
                              <Text style={styles.votingStatusTitle}>Group Decision</Text>
                              <View style={styles.votingStats}>
                                <View style={styles.votingStat}>
                                  <View style={styles.votingStatIcon}>
                                    <Ionicons name="thumbs-up" size={16} color="#16a34a" />
                                  </View>
                                  <Text style={styles.votingStatValue}>{card.votes.yes}</Text>
                                  <Text style={styles.votingStatLabel}>Yes</Text>
                                </View>
                                <View style={styles.votingStat}>
                                  <View style={styles.votingStatIcon}>
                                    <Ionicons name="thumbs-down" size={16} color="#dc2626" />
                                  </View>
                                  <Text style={styles.votingStatValue}>{card.votes.no}</Text>
                                  <Text style={styles.votingStatLabel}>No</Text>
                                </View>
                                <TouchableOpacity
                                  style={styles.votingStat}
                                  onPress={() => onOpenDiscussion?.(card.id)}
                                  activeOpacity={0.7}
                                >
                                  <View style={styles.votingStatIcon}>
                                    <Ionicons name="chatbubble" size={16} color="#2563eb" />
                                  </View>
                                  <Text style={styles.votingStatValue}>{card.messages}</Text>
                                  <Text style={styles.votingStatLabel}>Messages</Text>
                                </TouchableOpacity>
                              </View>
                              <Text style={styles.votingStatusSubtext}>
                                {card.rsvps.responded}/{card.rsvps.total} responses
                              </Text>
                            </View>
                          </View>
                        </ScrollView>

                        {/* Fixed bottom actions */}
                        <View style={styles.expandedActions}>
                          {!card.isLocked ? (
                            <View style={styles.expandedVotingSection}>
                              <View style={styles.expandedVoteButtons}>
                                <TouchableOpacity
                                  onPress={() => onVote(card.id, 'yes')}
                                  style={[
                                    styles.expandedVoteButton,
                                    card.votes.userVote === 'yes' ? styles.expandedVoteButtonActive : styles.expandedVoteButtonInactive
                                  ]}
                                >
                                  <Ionicons name="thumbs-up" size={16} color={card.votes.userVote === 'yes' ? 'white' : '#16a34a'} />
                                  <Text style={[
                                    styles.expandedVoteButtonText,
                                    card.votes.userVote === 'yes' ? styles.expandedVoteButtonTextActive : styles.expandedVoteButtonTextInactive
                                  ]}>Vote Yes</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => onVote(card.id, 'no')}
                                  style={[
                                    styles.expandedVoteButton,
                                    card.votes.userVote === 'no' ? styles.expandedVoteButtonActive : styles.expandedVoteButtonInactive
                                  ]}
                                >
                                  <Ionicons name="thumbs-down" size={16} color={card.votes.userVote === 'no' ? 'white' : '#dc2626'} />
                                  <Text style={[
                                    styles.expandedVoteButtonText,
                                    card.votes.userVote === 'no' ? styles.expandedVoteButtonTextActive : styles.expandedVoteButtonTextInactive
                                  ]}>Vote No</Text>
                                </TouchableOpacity>
                              </View>
                              <TouchableOpacity
                                onPress={() => onRSVP(card.id, 'yes')}
                                style={[
                                  styles.expandedRSVPButton,
                                  card.rsvps.userRSVP === 'yes' ? styles.expandedRSVPButtonActive : styles.expandedRSVPButtonInactive
                                ]}
                              >
                                <Text style={[
                                  styles.expandedRSVPButtonText,
                                  card.rsvps.userRSVP === 'yes' ? styles.expandedRSVPButtonTextActive : styles.expandedRSVPButtonTextInactive
                                ]}>
                                  {card.rsvps.userRSVP === 'yes' ? 'RSVP\'d Yes' : 'RSVP Yes'}
                                </Text>
                              </TouchableOpacity>
                              {onOpenDiscussion && (
                                <TouchableOpacity
                                  onPress={() => onOpenDiscussion(card.id)}
                                  style={styles.discussionButton}
                                >
                                  <Ionicons name="chatbubbles" size={16} color="#007AFF" />
                                  <Text style={styles.discussionButtonText}>
                                    Discuss ({card.messages})
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          ) : (
                            <View style={styles.expandedLockedSection}>
                              <View style={styles.expandedLockedContent}>
                                <Ionicons name="checkmark" size={20} color="#16a34a" />
                                <Text style={styles.expandedLockedText}>Added to Calendar</Text>
                              </View>
                              <Text style={styles.expandedLockedSubtext}>This activity has been locked and scheduled</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </View>

      {/* Swipe Indicators */}
      <View style={styles.swipeIndicators}>
        {cards.map((_, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => setCurrentIndex(index)}
            style={[
              styles.swipeIndicator,
              index === currentIndex ? styles.swipeIndicatorActive : styles.swipeIndicatorInactive
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    backgroundColor: '#f3f4f6',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardCounter: {
    fontSize: 14,
    color: '#6b7280',
  },
  navigationButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  navButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navButtonEnabled: {
    backgroundColor: '#e5e7eb',
  },
  navButtonDisabled: {
    backgroundColor: '#f3f4f6',
  },
  cardContainer: {
    position: 'relative',
    width: '100%',
    height: 480,
  },
  cardWrapper: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    borderRadius: 24,
  },
  cardsContainer: {
    flexDirection: 'row',
    height: '100%',
  },
  cardSlide: {
    width: '100%',
    height: '100%',
    flexShrink: 0,
  },
  mainCard: {
    width: '100%',
    height: '100%',
  },
  expandedCard: {
    opacity: 0,
    transform: [{ scale: 0.95 }],
  },
  cardContent: {
    width: '100%',
    height: '100%',
    backgroundColor: 'white',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
    flexDirection: 'column',
    overflow: 'hidden',
  },
  imageContainer: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  statusBadge: {
    position: 'absolute',
    top: 16,
    left: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  matchBadge: {
    backgroundColor: '#eb7825',
  },
  lockedBadge: {
    backgroundColor: '#16a34a',
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  galleryIndicator: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  galleryText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
  },
  overlayContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  overlayLeft: {
    flex: 1,
  },
  cardTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryText: {
    color: 'white',
    fontSize: 14,
    opacity: 0.9,
  },
  expandButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  infoSection: {
    padding: 16,
    gap: 12,
    flexShrink: 0,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  statSubtext: {
    fontSize: 14,
    color: '#6b7280',
  },
  priceText: {
    fontSize: 14,
    color: '#eb7825',
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  votingSection: {
    gap: 8,
  },
  voteButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  voteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  voteButtonActive: {
    backgroundColor: '#16a34a',
  },
  voteButtonInactive: {
    backgroundColor: '#dcfce7',
  },
  voteButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  voteButtonTextActive: {
    color: 'white',
  },
  voteButtonTextInactive: {
    color: '#16a34a',
  },
  rsvpButton: {
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  rsvpButtonActive: {
    backgroundColor: '#eb7825',
  },
  rsvpButtonInactive: {
    backgroundColor: '#fef3e2',
  },
  rsvpButtonText: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  rsvpButtonTextActive: {
    color: 'white',
  },
  rsvpButtonTextInactive: {
    color: '#eb7825',
  },
  lockedSection: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  lockedContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  lockedText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#16a34a',
  },
  lockedSubtext: {
    fontSize: 12,
    color: '#16a34a',
  },
  expandedCardOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  expandedCardContent: {
    width: '100%',
    height: '100%',
    backgroundColor: 'white',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
    flexDirection: 'column',
    overflow: 'hidden',
  },
  expandedHeader: {
    position: 'relative',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    flexShrink: 0,
  },
  closeButton: {
    position: 'absolute',
    left: 16,
    top: 16,
    width: 32,
    height: 32,
    backgroundColor: '#f3f4f6',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  expandedHeaderCenter: {
    alignItems: 'center',
  },
  expandedStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  expandedStatusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  expandedScrollView: {
    flex: 1,
  },
  galleryContainer: {
    position: 'relative',
    height: 256,
  },
  galleryImage: {
    width: '100%',
    height: '100%',
  },
  expandedContent: {
    padding: 16,
    gap: 16,
  },
  expandedTitleSection: {
    gap: 8,
  },
  expandedTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  expandedCategory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef3e2',
    borderWidth: 1,
    borderColor: '#fed7aa',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  expandedCategoryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#eb7825',
  },
  expandedDescription: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
  },
  matchBreakdown: {
    backgroundColor: '#fef3e2',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 16,
    padding: 16,
  },
  matchBreakdownTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matchFactors: {
    gap: 8,
  },
  matchFactor: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 8,
    padding: 8,
  },
  matchFactorLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  matchFactorValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#eb7825',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
  },
  statCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  statCardValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },
  statCardSubtext: {
    fontSize: 12,
    color: '#6b7280',
  },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
  },
  locationText: {
    fontSize: 14,
    color: '#111827',
    flex: 1,
  },
  highlightsSection: {
    gap: 8,
  },
  highlightsTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },
  highlightsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  highlightTag: {
    backgroundColor: '#fef3e2',
    borderWidth: 1,
    borderColor: '#fed7aa',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  highlightText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#eb7825',
  },
  votingStatus: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
  },
  votingStatusTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 12,
  },
  votingStats: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  votingStat: {
    alignItems: 'center',
  },
  votingStatIcon: {
    width: 32,
    height: 32,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  votingStatValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },
  votingStatLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  votingStatusSubtext: {
    textAlign: 'center',
    marginTop: 12,
    fontSize: 14,
    color: '#6b7280',
  },
  expandedActions: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    flexShrink: 0,
  },
  expandedVotingSection: {
    gap: 12,
  },
  expandedVoteButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  expandedVoteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  expandedVoteButtonActive: {
    backgroundColor: '#16a34a',
  },
  expandedVoteButtonInactive: {
    backgroundColor: '#dcfce7',
  },
  expandedVoteButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  expandedVoteButtonTextActive: {
    color: 'white',
  },
  expandedVoteButtonTextInactive: {
    color: '#16a34a',
  },
  expandedRSVPButton: {
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  expandedRSVPButtonActive: {
    backgroundColor: '#eb7825',
  },
  expandedRSVPButtonInactive: {
    backgroundColor: '#fef3e2',
  },
  expandedRSVPButtonText: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  expandedRSVPButtonTextActive: {
    color: 'white',
  },
  expandedRSVPButtonTextInactive: {
    color: '#eb7825',
  },
  discussionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#E3F2FD',
    marginTop: 8,
  },
  discussionButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#007AFF',
  },
  expandedLockedSection: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  expandedLockedContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  expandedLockedText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#16a34a',
  },
  expandedLockedSubtext: {
    fontSize: 14,
    color: '#16a34a',
    textAlign: 'center',
  },
  swipeIndicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
  },
  swipeIndicator: {
    height: 6,
    borderRadius: 3,
  },
  swipeIndicatorActive: {
    backgroundColor: '#eb7825',
    width: 24,
  },
  swipeIndicatorInactive: {
    backgroundColor: '#d1d5db',
    width: 6,
  },
});