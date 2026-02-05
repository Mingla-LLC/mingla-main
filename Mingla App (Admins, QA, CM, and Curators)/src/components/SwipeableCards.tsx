import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  SwipeCard,
  CardDetails,
  CardActionButtons,
  EmptyState,
  PurchaseOptionsModal,
  SwipeableCardsProps,
  Recommendation
} from './swipeable-cards';
import {
  CARD_GENERATION_BATCH_SIZE,
  DEFAULT_MAX_BUDGET,
  SWIPE_THRESHOLD,
  INTENT_TYPE_MAP
} from './swipeable-cards/constants';
import { getIconComponent, extractPriceFromRange } from './swipeable-cards/utils';
import { generateCardBatch, canGenerateCards, type CardGenerationPreferences } from './utils/cardGenerator';
import SEED_EXPERIENCE_CARDS from './SeedExperienceCards';
import PurchaseModal from './PurchaseModal';
import { useCoachMark } from './CoachMark/CoachMarkProvider';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowRight, Hand } from 'lucide-react';
import CollaborationSessions, { CollaborationSession } from './collaboration/CollaborationSessions';
import InviteNotificationModal from './collaboration/InviteNotificationModal';
import CreateSessionModal from './collaboration/CreateSessionModal';
import CollaborationBoard from './collaboration/CollaborationBoard';

const BATCH_SIZE = 15;

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
  onboardingData,
  curatorCards = [],
  onModeChange,
  boardsSessions = []
}: SwipeableCardsProps) {
  // Core state
  const [removedCards, setRemovedCards] = useState<Set<string>>(new Set(removedCardIds));
  const [generatedCards, setGeneratedCards] = useState<Recommendation[]>([]);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [galleryIndices, setGalleryIndices] = useState<{ [key: string]: number }>({});
  
  // Swipe state
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  
  // Card counter state
  const [initialBatchSize, setInitialBatchSize] = useState(0);
  const [hasStartedSwiping, setHasStartedSwiping] = useState(false);
  
  // Purchase modal state
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseModalRec, setPurchaseModalRec] = useState<Recommendation | null>(null);
  
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const [lastGenerationTime, setLastGenerationTime] = useState(0);
  
  // Coach mark state
  const { state: coachMarkState } = useCoachMark();
  const isOnSwipeStep = coachMarkState.isActive && coachMarkState.currentStep === 4; // Step 5 is index 4

  // Collaboration state - Use boardsSessions from props if available
  const [collaborationSessions, setCollaborationSessions] = useState<CollaborationSession[]>(() => {
    // Add mock invite sessions for demonstration
    const mockInvites: CollaborationSession[] = [
      {
        id: 'invite-1',
        name: 'Sarah Chen',
        initials: 'SC',
        type: 'received-invite',
        participants: 1,
        createdAt: new Date()
      },
      {
        id: 'invite-2',
        name: 'Mike Johnson',
        initials: 'MJ',
        type: 'sent-invite',
        participants: 1,
        createdAt: new Date()
      },
      {
        id: 'invite-3',
        name: 'Emily Rodriguez',
        initials: 'ER',
        type: 'received-invite',
        participants: 1,
        createdAt: new Date()
      },
      {
        id: 'invite-4',
        name: 'Alex Kumar',
        initials: 'AK',
        type: 'sent-invite',
        participants: 1,
        createdAt: new Date()
      },
      {
        id: 'invite-5',
        name: 'Jordan Lee',
        initials: 'JL',
        type: 'received-invite',
        participants: 1,
        createdAt: new Date()
      }
    ];

    const activeSessions = boardsSessions.map((board: any) => ({
      id: board.id,
      name: board.name,
      initials: board.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2),
      type: 'active' as const,
      participants: board.participants?.length || 0
    }));

    return [...mockInvites, ...activeSessions];
  });
  
  // Update collaboration sessions when boardsSessions changes
  useEffect(() => {
    const activeSessions = boardsSessions.map((board: any) => ({
      id: board.id,
      name: board.name,
      initials: board.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2),
      type: 'active' as const,
      participants: board.participants?.length || 0
    }));
    
    setCollaborationSessions(prev => {
      // Keep only invite sessions from previous state
      const invites = prev.filter(s => s.type === 'sent-invite' || s.type === 'received-invite');
      return [...invites, ...activeSessions];
    });
  }, [boardsSessions]);
  
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    currentMode !== 'solo' ? currentMode : null
  );
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedInvite, setSelectedInvite] = useState<CollaborationSession | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCollaborationBoard, setShowCollaborationBoard] = useState(false);
  const [activeSession, setActiveSession] = useState<CollaborationSession | null>(null);
  
  // Update selectedSessionId when currentMode changes
  useEffect(() => {
    setSelectedSessionId(currentMode !== 'solo' ? currentMode : null);
  }, [currentMode]);

  // Generate initial card batch based on preferences
  useEffect(() => {
    if (!userPreferences) return;
    
    const genPrefs: CardGenerationPreferences = {
      experienceTypes: userPreferences.experienceTypes || [],
      categories: userPreferences.categories || [],
      budgetMin: userPreferences.budgetMin || '',
      budgetMax: userPreferences.budgetMax || '',
      location: userPreferences.location,
      timeOfDay: userPreferences.timeOfDay,
      groupSize: userPreferences.groupSize
    };
    
    if (canGenerateCards(genPrefs)) {
      const excludeIds = [...removedCardIds, ...Array.from(removedCards)];
      const newBatch = generateCardBatch(genPrefs, CARD_GENERATION_BATCH_SIZE, excludeIds);
      
      const convertedBatch = newBatch.map(card => ({
        ...card,
        categoryIcon: getIconComponent(card.categoryIcon)
      }));
      
      setGeneratedCards(convertedBatch);
      setInitialBatchSize(convertedBatch.length);
    }
  }, [
    userPreferences?.experienceTypes?.length,
    userPreferences?.categories?.length,
    userPreferences?.budgetMin,
    userPreferences?.budgetMax,
    removedCardIds?.length
  ]);

  // Combine all card sources
  const allRecommendations = useMemo(() => {
    const convertedSeedCards = SEED_EXPERIENCE_CARDS.map(seed => ({
      ...seed,
      categoryIcon: getIconComponent(seed.categoryIcon),
      timeAway: seed.travelTime,
      budget: seed.budget || 'See pricing details'
    }));
    
    const liveCuratorCards = (curatorCards || [])
      .filter((card: any) => card.status === 'live')
      .map((card: any) => ({
        id: card.id,
        title: card.title,
        category: card.category,
        categoryIcon: getIconComponent(card.categoryIcon || 'Heart'),
        timeAway: card.travelTime || '15 min',
        description: card.description,
        budget: card.budget || card.priceRange || 'See pricing details',
        rating: card.rating || 4.5,
        image: card.image || 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4',
        images: card.images || [card.image] || ['https://images.unsplash.com/photo-1506905925346-21bda4d32df4'],
        travelTime: card.travelTime || '15 min',
        distance: card.distance || '3 km',
        experienceType: card.experienceType || 'casual',
        priceRange: card.priceRange || card.price || '$30-50',
        pricePerPerson: card.pricePerPerson,
        highlights: card.highlights || [],
        fullDescription: card.fullDescription || card.description,
        address: card.address || card.location || 'San Francisco, CA',
        openingHours: card.openingHours || 'Hours vary',
        phoneNumber: card.phoneNumber,
        website: card.website,
        tags: card.tags || [],
        matchScore: card.matchScore || 85,
        matchFactors: card.matchFactors || {
          location: 85,
          budget: 80,
          category: 90,
          time: 85,
          popularity: 80
        },
        socialStats: card.socialStats || {
          views: card.views || 0,
          likes: card.likes || 0,
          saves: card.saves || 0,
          shares: 0
        },
        reviewCount: card.reviewCount || 0,
        purchaseOptions: card.purchaseOptions
      }));
    
    return [...liveCuratorCards, ...convertedSeedCards, ...generatedCards];
  }, [generatedCards.length, curatorCards?.length]);
  
  // Apply onboarding filters
  const onboardingFilteredCards = useMemo(() => {
    if (!onboardingData) return allRecommendations;
    
    return allRecommendations.map(card => {
      let matchScore = card.matchScore;
      let description = card.description;
      
      // Intent matching
      if (onboardingData.intent?.experienceType) {
        const targetTypes = INTENT_TYPE_MAP[onboardingData.intent.experienceType] || [];
        if (targetTypes.includes(card.experienceType)) {
          matchScore = Math.min(98, matchScore + 10);
          description = `${description} • Perfect for ${onboardingData.intent.title.toLowerCase()}`;
        }
      }
      
      // Vibe matching
      if (onboardingData.vibes?.length > 0) {
        const hasMatchingVibe = onboardingData.vibes.some((vibe: any) => {
          const vibeStr = typeof vibe === 'string' ? vibe : (vibe?.label || vibe?.id || '');
          return card.category.toLowerCase().includes(vibeStr.replace('-', ' ')) ||
                 card.tags.some((tag: string) => tag.toLowerCase().includes(vibeStr.replace('-', ' ')));
        });
        
        if (hasMatchingVibe) {
          matchScore = Math.min(98, matchScore + 5);
        }
      }
      
      return { ...card, matchScore, description };
    }).sort((a, b) => b.matchScore - a.matchScore);
  }, [allRecommendations.length, onboardingData?.intent?.experienceType, onboardingData?.vibes?.length]);
  
  // Apply budget filters
  const budgetFilteredCards = useMemo(() => {
    if (!userPreferences?.budgetMin && !userPreferences?.budgetMax) {
      return onboardingFilteredCards;
    }
    
    const minBudget = userPreferences.budgetMin || 0;
    const maxBudget = userPreferences.budgetMax || DEFAULT_MAX_BUDGET;
    
    return onboardingFilteredCards.filter(card => {
      const cardPrice = extractPriceFromRange(card.priceRange, card.pricePerPerson);
      return cardPrice >= minBudget && cardPrice <= maxBudget;
    });
  }, [onboardingFilteredCards, userPreferences?.budgetMin, userPreferences?.budgetMax]);
  
  // Apply category filters - ONLY show cards matching selected categories
  const categoryFilteredCards = useMemo(() => {
    // If no categories are selected, show ALL cards (test account behavior)
    if (!userPreferences?.categories || userPreferences.categories.length === 0) {
      return budgetFilteredCards;
    }
    
    return budgetFilteredCards.filter(card => {
      const cardCategoryId = card.category || '';
      // Check if card's category matches any of the selected categories
      return userPreferences.categories.some(selectedCat => {
        // Ensure selectedCat is a string and handle all edge cases
        let selectedCatStr = '';
        
        if (typeof selectedCat === 'string') {
          selectedCatStr = selectedCat;
        } else if (selectedCat && typeof selectedCat === 'object') {
          selectedCatStr = selectedCat.id || selectedCat.label || '';
        }
        
        // Skip if we couldn't extract a valid string
        if (!selectedCatStr || typeof selectedCatStr !== 'string') {
          return false;
        }
        
        // Normalize both for comparison (handle variations like sipChill vs sip-chill)
        const normalizedCardCat = cardCategoryId.toLowerCase().replace(/[^a-z]/g, '');
        const normalizedSelectedCat = selectedCatStr.toLowerCase().replace(/[^a-z]/g, '');
        return normalizedCardCat === normalizedSelectedCat;
      });
    });
  }, [budgetFilteredCards, userPreferences?.categories]);
  
  // Get available cards (excluding removed)
  const availableRecommendations = useMemo(() => {
    return categoryFilteredCards.filter(rec => !removedCards.has(rec.id));
  }, [categoryFilteredCards, removedCards.size]);
  
  // Current batch of cards to display
  const currentBatch = useMemo(() => {
    const batch = availableRecommendations.slice(0, BATCH_SIZE);
    // Set initial batch size when cards first load
    if (batch.length > 0 && initialBatchSize === 0) {
      setInitialBatchSize(batch.length);
    }
    return batch;
  }, [availableRecommendations, initialBatchSize]);
  
  // Generate more cards when running low
  useEffect(() => {
    if (currentBatch.length < 3 && currentBatch.length > 0 && userPreferences) {
      const genPrefs: CardGenerationPreferences = {
        experienceTypes: userPreferences.experienceTypes || [],
        categories: userPreferences.categories || [],
        budgetMin: userPreferences.budgetMin || '',
        budgetMax: userPreferences.budgetMax || '',
        location: userPreferences.location,
        timeOfDay: userPreferences.timeOfDay,
        groupSize: userPreferences.groupSize
      };
      
      if (canGenerateCards(genPrefs)) {
        const excludeIds = [...removedCardIds, ...Array.from(removedCards), ...generatedCards.map(c => c.id)];
        const newBatch = generateCardBatch(genPrefs, 10, excludeIds);
        
        if (newBatch.length > 0) {
          const convertedBatch = newBatch.map(card => ({
            ...card,
            categoryIcon: getIconComponent(card.categoryIcon)
          }));
          
          setGeneratedCards(prev => [...prev, ...convertedBatch]);
        }
      }
    }
  }, [currentBatch.length]);
  
  // Generate cards using external generator if needed
  useEffect(() => {
    const now = Date.now();
    if (
      currentBatch.length < 2 && 
      generateNewMockCard && 
      !isAnimating &&
      now - lastGenerationTime > 500
    ) {
      const newCard = generateNewMockCard();
      setGeneratedCards(prev => {
        if (prev.find(card => card.id === newCard.id)) {
          return prev;
        }
        setLastGenerationTime(now);
        return [...prev, newCard];
      });
    }
  }, [currentBatch.length, generateNewMockCard, isAnimating, lastGenerationTime]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (isAnimating) {
        setIsAnimating(false);
        setDragOffset({ x: 0, y: 0 });
        setSwipeDirection(null);
      }
    };
  }, []);

  // Swipe handlers
  const handleStart = (clientX: number, clientY: number) => {
    setDragStart({ x: clientX, y: clientY });
    setIsDragging(true);
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging || isAnimating) return;
    
    const deltaX = clientX - dragStart.x;
    
    if (Math.abs(deltaX) > 5) {
      setDragOffset({ x: deltaX, y: 0 });
      
      if (deltaX > 40) {
        setSwipeDirection('right');
      } else if (deltaX < -40) {
        setSwipeDirection('left');
      } else {
        setSwipeDirection(null);
      }
    }
  };

  const handleEnd = () => {
    if (!isDragging || isAnimating || !currentBatch[0]) return;
    
    setIsDragging(false);
    const currentRec = currentBatch[0];
    
    if (Math.abs(dragOffset.x) > SWIPE_THRESHOLD) {
      setIsAnimating(true);
      setHasStartedSwiping(true); // Mark that user has started swiping
      
      if (dragOffset.x > 0) {
        // Liked
        if (onCardLike) {
          onCardLike({ ...currentRec, liked: true });
        }
      }
      
      setTimeout(() => {
        setRemovedCards(prev => new Set([...prev, currentRec.id]));
        setDragOffset({ x: 0, y: 0 });
        setSwipeDirection(null);
        setIsAnimating(false);
      }, 300);
    } else {
      setDragOffset({ x: 0, y: 0 });
      setSwipeDirection(null);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    handleStart(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    handleMove(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    handleStart(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX, e.clientY);
  };

  // Action handlers
  const handleDiscard = () => {
    if (!currentBatch[0] || isAnimating) return;
    
    setIsAnimating(true);
    setHasStartedSwiping(true); // Mark that user has started swiping
    setDragOffset({ x: -400, y: 0 });
    
    setTimeout(() => {
      setRemovedCards(prev => new Set([...prev, currentBatch[0].id]));
      setDragOffset({ x: 0, y: 0 });
      setIsAnimating(false);
    }, 300);
  };

  const handleLike = () => {
    if (!currentBatch[0] || isAnimating) return;
    
    const currentRec = currentBatch[0];
    setIsAnimating(true);
    setHasStartedSwiping(true); // Mark that user has started swiping
    setDragOffset({ x: 400, y: 0 });
    
    if (onCardLike) {
      onCardLike({ ...currentRec, liked: true });
    }
    
    setTimeout(() => {
      setRemovedCards(prev => new Set([...prev, currentRec.id]));
      setDragOffset({ x: 0, y: 0 });
      setIsAnimating(false);
    }, 300);
  };

  const toggleExpanded = (id: string) => {
    setExpandedCard(expandedCard === id ? null : id);
  };

  const navigateGallery = (direction: 'prev' | 'next', rec: Recommendation) => {
    const currentIndex = galleryIndices[rec.id] || 0;
    const newIndex = direction === 'next'
      ? (currentIndex + 1) % rec.images.length
      : (currentIndex - 1 + rec.images.length) % rec.images.length;
    
    setGalleryIndices(prev => ({ ...prev, [rec.id]: newIndex }));
  };

  const setGalleryIndex = (recId: string, index: number) => {
    setGalleryIndices(prev => ({ ...prev, [recId]: index }));
  };

  const handleOpenPurchase = (rec: Recommendation) => {
    setPurchaseModalRec(rec);
    setShowPurchaseModal(true);
  };

  const handlePurchaseComplete = (experienceData: any, purchaseOption: any) => {
    if (onPurchaseComplete) {
      onPurchaseComplete(experienceData, purchaseOption);
    }
  };

  // Collaboration handlers
  const handleSessionSelect = (sessionId: string | null) => {
    setSelectedSessionId(sessionId);
    // Update parent's currentMode
    if (onModeChange) {
      onModeChange(sessionId || 'solo');
    }
    if (sessionId) {
      const session = collaborationSessions.find(s => s.id === sessionId);
      if (session && session.type === 'active') {
        // Find the actual board session with cards
        const boardSession = boardsSessions.find(b => b.id === sessionId);
        setActiveSession(boardSession || session);
        setShowCollaborationBoard(true);
      }
    }
  };

  const handleInviteClick = (session: CollaborationSession) => {
    setSelectedInvite(session);
    setShowInviteModal(true);
  };

  const handleCreateSession = () => {
    setShowCreateModal(true);
  };

  const handleSessionCreated = (name: string, inviteEmails?: string[]) => {
    const initials = name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    const newSession: CollaborationSession = {
      id: Date.now().toString(),
      name,
      initials,
      type: inviteEmails && inviteEmails.length > 0 ? 'sent-invite' : 'active',
      participants: 1,
      createdAt: new Date()
    };

    setCollaborationSessions(prev => [...prev, newSession]);
    if (newSession.type === 'active') {
      setSelectedSessionId(newSession.id);
    }
  };

  const handleAcceptInvite = (sessionId: string) => {
    setCollaborationSessions(prev =>
      prev.map(session =>
        session.id === sessionId
          ? { ...session, type: 'active' as const }
          : session
      )
    );
  };

  const handleDeclineInvite = (sessionId: string) => {
    setCollaborationSessions(prev => prev.filter(session => session.id !== sessionId));
  };

  const handleCancelInvite = (sessionId: string) => {
    setCollaborationSessions(prev => prev.filter(session => session.id !== sessionId));
  };

  // Empty state
  if (currentBatch.length === 0) {
    return (
      <div className="flex flex-col w-full h-full max-w-sm mx-auto">
        <EmptyState onGenerateMore={generateNewMockCard ? () => {
          const newCard = generateNewMockCard();
          setGeneratedCards(prev => [...prev, newCard]);
        } : undefined} />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full max-w-sm mx-auto">
      {/* Card Stack Container */}
      <div className="flex-1 relative overflow-hidden px-3 sm:px-4 py-3 sm:py-6 flex flex-col">
        {/* Cards Counter */}
        <motion.div
          key={`${currentBatch.length}-${hasStartedSwiping}`}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="flex justify-start mb-2 flex-shrink-0 px-2"
        >
          <CollaborationSessions
            sessions={collaborationSessions}
            selectedSessionId={selectedSessionId}
            onSessionSelect={handleSessionSelect}
            onCreateSession={handleCreateSession}
            onInviteClick={handleInviteClick}
            onAcceptInvite={handleAcceptInvite}
            onDeclineInvite={handleDeclineInvite}
            onCancelInvite={handleCancelInvite}
          />
        </motion.div>

        <div className="relative flex-1 min-h-0">
          {/* Show current card and next card behind it */}
          {currentBatch.slice(0, 2).map((rec, index) => (
            <SwipeCard
              key={rec.id}
              recommendation={rec}
              isTopCard={index === 0}
              dragOffset={dragOffset}
              isDragging={isDragging}
              swipeDirection={index === 0 ? swipeDirection : null}
              containerRef={index === 0 ? containerRef : undefined}
              onTouchStart={index === 0 ? handleTouchStart : undefined}
              onTouchMove={index === 0 ? handleTouchMove : undefined}
              onTouchEnd={index === 0 ? handleEnd : undefined}
              onMouseDown={index === 0 ? handleMouseDown : undefined}
              onMouseMove={index === 0 ? handleMouseMove : undefined}
              onMouseUp={index === 0 ? handleEnd : undefined}
              onMouseLeave={index === 0 ? handleEnd : undefined}
              onCardClick={index === 0 ? () => toggleExpanded(rec.id) : undefined}
              onShare={index === 0 && onShareCard ? () => onShareCard(rec) : undefined}
            />
          ))}
          
          {/* Swipe Hint Overlay - Only show during coach mark step 2 */}
          {isOnSwipeStep && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.4, delay: 0.5 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none z-50"
            >
              <div className="relative">
                {/* Central hand icon */}
                <motion.div
                  animate={{
                    scale: [1, 1.1, 1],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="relative"
                >
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] shadow-2xl flex items-center justify-center">
                    <Hand className="w-10 h-10 text-white" />
                  </div>
                </motion.div>

                {/* Left arrow - Swipe Left (Pass) */}
                <motion.div
                  initial={{ x: 0, opacity: 0 }}
                  animate={{ 
                    x: [-60, -80, -60],
                    opacity: [0.7, 1, 0.7]
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: 0.2
                  }}
                  className="absolute right-full top-1/2 -translate-y-1/2 mr-4"
                >
                  <div className="flex items-center gap-2">
                    <ArrowLeft className="w-8 h-8 text-[#eb7825] drop-shadow-lg" strokeWidth={3} />
                    <div className="text-sm font-semibold text-gray-700 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-lg">
                      Pass
                    </div>
                  </div>
                </motion.div>

                {/* Right arrow - Swipe Right (Like) */}
                <motion.div
                  initial={{ x: 0, opacity: 0 }}
                  animate={{ 
                    x: [60, 80, 60],
                    opacity: [0.7, 1, 0.7]
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="absolute left-full top-1/2 -translate-y-1/2 ml-4"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold text-gray-700 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-lg">
                      Like
                    </div>
                    <ArrowRight className="w-8 h-8 text-[#eb7825] drop-shadow-lg" strokeWidth={3} />
                  </div>
                </motion.div>

                {/* Glow effect */}
                <motion.div
                  animate={{
                    scale: [1, 1.3, 1],
                    opacity: [0.3, 0.5, 0.3]
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="absolute inset-0 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] blur-2xl -z-10"
                />
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <CardActionButtons
        onDiscard={handleDiscard}
        onLike={handleLike}
        disabled={isAnimating || currentBatch.length === 0}
      />

      {/* Expanded Card Details */}
      {expandedCard && (() => {
        const expandedRec = allRecommendations.find(rec => rec.id === expandedCard);
        if (!expandedRec) return null;
        
        return (
          <CardDetails
            recommendation={expandedRec}
            galleryIndex={galleryIndices[expandedRec.id] || 0}
            onClose={() => toggleExpanded(expandedCard)}
            onNavigateGallery={(direction) => navigateGallery(direction, expandedRec)}
            onSetGalleryIndex={(index) => setGalleryIndex(expandedRec.id, index)}
            onSchedule={() => {
              const scheduleData = { ...expandedRec, _directSchedule: true };
              onAddToCalendar(scheduleData);
              setRemovedCards(prev => new Set([...prev, expandedRec.id]));
              toggleExpanded(expandedCard);
            }}
            onBuyNow={() => {
              handleOpenPurchase(expandedRec);
              toggleExpanded(expandedCard);
            }}
            onShare={() => {
              if (onShareCard) onShareCard(expandedRec);
              toggleExpanded(expandedCard);
            }}
            userPreferences={userPreferences}
            swipeDirection={swipeDirection}
            isDragging={isDragging}
            dragOffset={dragOffset}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleEnd}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
          />
        );
      })()}

      {/* Purchase Modal */}
      {showPurchaseModal && purchaseModalRec && (
        <PurchaseModal
          isOpen={showPurchaseModal}
          onClose={() => {
            setShowPurchaseModal(false);
            setPurchaseModalRec(null);
          }}
          recommendation={purchaseModalRec}
          accountPreferences={accountPreferences}
          onPurchaseComplete={handlePurchaseComplete}
        />
      )}

      {/* Collaboration Modals */}
      <AnimatePresence>
        {showInviteModal && selectedInvite && (
          <InviteNotificationModal
            session={selectedInvite}
            onClose={() => {
              setShowInviteModal(false);
              setSelectedInvite(null);
            }}
            onAccept={handleAcceptInvite}
            onDecline={handleDeclineInvite}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCreateModal && (
          <CreateSessionModal
            onClose={() => setShowCreateModal(false)}
            onCreate={handleSessionCreated}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCollaborationBoard && activeSession && (
          <CollaborationBoard
            session={activeSession}
            onClose={() => {
              setShowCollaborationBoard(false);
              setActiveSession(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}