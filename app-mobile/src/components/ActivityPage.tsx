import React, { useState } from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ImageWithFallback } from './figma/ImageWithFallback';
import PurchaseQRCode from './PurchaseQRCode';
import UserInviteModal from './UserInviteModal';
import BoardDiscussion from './BoardDiscussion';
import SwipeableBoardCards from './SwipeableBoardCards';
import PurchaseModal from './PurchaseModal';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from './ui/dropdown-menu';
import { addToCalendar, createCalendarEventFromEntry } from './utils/calendar';
import { formatCurrency } from './utils/formatters';

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

interface Board {
  id: string;
  name: string;
  type: 'date-night' | 'group-hangout' | 'adventure' | 'wellness' | 'food-tour' | 'cultural';
  description: string;
  participants: Array<{
    id: string;
    name: string;
    status: string;
    lastActive?: string;
  }>;
  status: 'active' | 'voting' | 'locked' | 'completed';
  voteDeadline?: string;
  finalizedDate?: string;
  cardsCount: number;
  createdAt: string;
  unreadMessages: number;
  lastActivity: string;
  icon: any;
  gradient: string;
  creatorId: string;
  admins: string[];
  currentUserId: string; // For permission checks
}

interface CalendarEntry {
  id: string;
  title: string;
  category: string;
  categoryIcon: any;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  date: string;
  time: string;
  source: 'solo' | 'collaboration';
  sourceDetails: string;
  priceRange: string;
  description: string;
  fullDescription: string;
  address: string;
  highlights: string[];
  socialStats: {
    views: number;
    likes: number;
    saves: number;
  };
  status: 'confirmed' | 'pending' | 'completed';
}

// Mock data for demonstration
const mockBoards: Board[] = [
  {
    id: 'board1',
    name: 'Weekend Date Night',
    type: 'date-night',
    description: 'Romantic weekend experiences for couples',
    participants: ['You', 'Sarah'],
    status: 'voting',
    voteDeadline: 'Tomorrow',
    cardsCount: 3,
    createdAt: '2 days ago',
    unreadMessages: 3,
    lastActivity: '2 hours ago',
    icon: Heart,
    gradient: 'from-pink-500 to-rose-500',
    creatorId: 'You',
    admins: ['You'],
    currentUserId: 'You'
  },
  {
    id: 'board2',
    name: 'Fitness Squad Goals',
    type: 'wellness',
    description: 'Weekly workout adventures with the crew',
    participants: ['You', 'Alex', 'Jamie', 'Casey'],
    status: 'active',
    cardsCount: 4,
    createdAt: '1 week ago',
    unreadMessages: 1,
    lastActivity: '30 minutes ago',
    icon: Dumbbell,
    gradient: 'from-green-500 to-emerald-500',
    creatorId: 'Alex',
    admins: ['Alex', 'You'],
    currentUserId: 'You'
  },
  {
    id: 'board3',
    name: 'Foodie Adventures',
    type: 'food-tour',
    description: 'Discovering the best eats in the city',
    participants: ['You', 'Morgan', 'Riley'],
    status: 'locked',
    finalizedDate: 'This Saturday',
    cardsCount: 6,
    createdAt: '3 days ago',
    unreadMessages: 0,
    lastActivity: '1 day ago',
    icon: Utensils,
    gradient: 'from-orange-500 to-red-500',
    creatorId: 'You',
    admins: ['You'],
    currentUserId: 'You'
  },
  {
    id: 'board4',
    name: 'Art & Culture Club',
    type: 'cultural',
    description: 'Exploring galleries, museums, and creative spaces',
    participants: ['You', 'Taylor', 'Jordan', 'Avery', 'Quinn'],
    status: 'voting',
    voteDeadline: 'Friday',
    cardsCount: 8,
    createdAt: '5 days ago',
    unreadMessages: 7,
    lastActivity: '4 hours ago',
    icon: Sparkles,
    gradient: 'from-purple-500 to-indigo-500',
    creatorId: 'Taylor',
    admins: ['Taylor'],
    currentUserId: 'You'
  },
  {
    id: 'board5',
    name: 'Nature Escape',
    type: 'adventure',
    description: 'Outdoor activities and scenic adventures',
    participants: ['You', 'Sam'],
    status: 'active',
    cardsCount: 5,
    createdAt: '1 day ago',
    unreadMessages: 2,
    lastActivity: '6 hours ago',
    icon: TreePine,
    gradient: 'from-teal-500 to-cyan-500',
    creatorId: 'You',
    admins: ['You'],
    currentUserId: 'You'
  },
  {
    id: 'board6',
    name: 'Coffee Crawl Chronicles',
    type: 'group-hangout',
    description: 'Finding the perfect coffee spots around town',
    participants: ['You', 'Blake', 'Drew'],
    status: 'completed',
    cardsCount: 3,
    createdAt: '2 weeks ago',
    unreadMessages: 0,
    lastActivity: '1 week ago',
    icon: 'Coffee',
    gradient: 'from-amber-500 to-yellow-500',
    creatorId: 'Blake',
    admins: ['Blake'],
    currentUserId: 'You'
  }
];

const mockSavedCards: SavedCard[] = [
  {
    id: 'saved-1',
    title: 'Sightglass Coffee Roastery',
    category: 'Sip & Chill',
    categoryIcon: 'Coffee',
    image: 'https://images.unsplash.com/photo-1642315160505-b3dff3a3c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY296eSUyMGludGVyaW9yfGVufDF8fHx8MTc1OTExMDg1OHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    images: [
      'https://images.unsplash.com/photo-1642315160505-b3dff3a3c8b9?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY296eSUyMGludGVyaW9yfGVufDF8fHx8MTc1OTExMDg1OHww&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY291bnRlcnxlbnwxfHx8fDE3NTkxNzI1Mjh8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      'https://images.unsplash.com/photo-1447933601403-0c6688de566e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBjdXB8ZW58MXx8fHwxNzU5MTcyNTI4fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    ],
    rating: 4.6,
    reviewCount: 187,
    priceRange: '$15-40',
    travelTime: '12m',
    description: 'Intimate coffee experience with artisan vibes',
    fullDescription: 'Discover the art of coffee at Sightglass Coffee Roastery, where every cup tells a story. This intimate space combines industrial aesthetics with warm hospitality, featuring freshly roasted beans, expert baristas, and a cozy atmosphere perfect for conversations and connections.',
    address: '270 7th St, San Francisco, CA 94103',
    highlights: ['Artisan Coffee', 'Cozy Atmosphere', 'Fresh Roasted', 'WiFi Available'],
    matchScore: 87,
    socialStats: {
      views: 892,
      likes: 298,
      saves: 156
    },
    dateAdded: '2 days ago',
    source: 'solo'
  },
  {
    id: 'saved-2',
    title: 'Golden Gate Park Trail',
    category: 'Take a Stroll',
    categoryIcon: TreePine,
    image: 'https://images.unsplash.com/photo-1739139106925-230659c867e0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxvdXRkb29yJTIwcGFyayUyMHdhbGtpbmclMjB0cmFpbHxlbnwxfHx8fDE3NTkxNzI1MTJ8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    images: [
      'https://images.unsplash.com/photo-1739139106925-230659c867e0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxvdXRkb29yJTIwcGFyayUyMHdhbGtpbmclMjB0cmFpbHxlbnwxfHx8fDE3NTkxNzI1MTJ8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxuYXR1cmUlMjBwYXJrJTIwdHJhaWx8ZW58MXx8fHwxNzU5MTcyNTEyfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      'https://images.unsplash.com/photo-1511593358241-7eea1f3c84e5?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxuYXR1cmUlMjB0cmFpbCUyMHdhbGtpbmd8ZW58MXx8fHwxNzU5MTcyNTEyfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    ],
    rating: 4.7,
    reviewCount: 234,
    priceRange: 'Free',
    travelTime: '18m',
    description: 'Scenic walking adventure for nature lovers',
    fullDescription: 'Experience the beauty of Golden Gate Park on this scenic trail perfect for nature enthusiasts. This well-maintained path offers stunning views, peaceful surroundings, and photo opportunities at every turn. Ideal for couples, friends, or solo adventurers looking to connect with nature.',
    address: 'Golden Gate Park, San Francisco, CA',
    highlights: ['Scenic Views', 'Photo Spots', 'Pet Friendly', 'Free Parking'],
    matchScore: 92,
    socialStats: {
      views: 1247,
      likes: 342,
      saves: 89
    },
    dateAdded: '1 week ago',
    source: 'collaboration',
    sessionName: 'Weekend Warriors'
  }
];

const mockCalendarEntries: CalendarEntry[] = [
  {
    id: 'cal-1',
    title: 'Blue Bottle Coffee Mission',
    category: 'Sip & Chill',
    categoryIcon: 'Coffee',
    image: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY291bnRlcnxlbnwxfHx8fDE3NTkxNzI1Mjh8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    images: [
      'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb2ZmZWUlMjBzaG9wJTIwY291bnRlcnxlbnwxfHx8fDE3NTkxNzI1Mjh8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    ],
    rating: 4.4,
    reviewCount: 298,
    date: 'Today',
    time: '2:30 PM',
    source: 'solo',
    sourceDetails: 'Personal RSVP',
    priceRange: '$12-25',
    description: 'Premium coffee experience in the Mission District',
    fullDescription: 'Experience the beauty of Golden Gate Park on this scenic trail perfect for nature enthusiasts. This well-maintained path offers stunning views, peaceful surroundings, and photo opportunities at every turn.',
    address: 'Golden Gate Park, San Francisco, CA',
    highlights: ['Scenic Views', 'Photo Spots', 'Pet Friendly', 'Free Parking'],
    socialStats: {
      views: 1247,
      likes: 342,
      saves: 89
    },
    status: 'confirmed'
  },
  {
    id: 'cal-2',
    title: 'Mindful Moments Yoga',
    category: 'Wellness Dates',
    categoryIcon: Dumbbell,
    image: 'https://images.unsplash.com/photo-1602827114685-efbb2717da9f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWxsbmVzcyUyMHNwYSUyMHlvZ2ElMjBzdHVkaW98ZW58MXx8fHwxNzU5MTcyNTIwfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
    images: [
      'https://images.unsplash.com/photo-1602827114685-efbb2717da9f?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3ZWxsbmVzcyUyMHNwYSUyMHlvZ2ElMjBzdHVkaW98ZW58MXx8fHwxNzU5MTcyNTIwfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral',
      'https://images.unsplash.com/photo-1545389336-cf090694435e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx5b2dhJTIwY2xhc3MlMjBzdHVkaW98ZW58MXx8fHwxNzU5MTcyNTI4fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral'
    ],
    rating: 4.5,
    reviewCount: 124,
    date: 'Tomorrow',
    time: '6:30 PM',
    source: 'solo',
    sourceDetails: 'Personal RSVP',
    priceRange: '$30-60',
    description: 'Relaxing couples yoga and meditation session',
    fullDescription: 'Unwind and reconnect through gentle yoga flows and guided meditation in a peaceful, candle-lit studio. Perfect for couples or friends seeking mindfulness and relaxation together.',
    address: '123 Zen Street, Wellness District, San Francisco',
    highlights: ['Couples Friendly', 'Meditation', 'Beginner Welcome', 'Peaceful Setting'],
    socialStats: {
      views: 654,
      likes: 198,
      saves: 67
    },
    status: 'confirmed'
  }
];

interface ActivityPageProps {
  onSendInvite?: (sessionId: string, users: any[]) => void;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: 'Metric' | 'Imperial';
  };
  calendarEntries?: any[];
  savedCards?: any[];
  onScheduleFromSaved?: (savedCard: any) => void;
  boardsSessions?: any[];
  onUpdateBoardSession?: (updatedBoard: any) => void;
}

// Helper function to convert icon strings to components
const getIconComponent = (iconName: any) => {
  if (typeof iconName === 'function') {
    // It's already a React component
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
  
  return iconMap[iconName] || 'heart'; // Default fallback
};

interface ActivityPageProps {
  onSendInvite?: (sessionId: string, users: any[]) => void;
  userPreferences?: any;
  accountPreferences?: any;
  calendarEntries?: any[];
  savedCards?: any[];
  onScheduleFromSaved?: (card: any) => void;
  onPurchaseFromSaved?: (card: any, purchaseOption: any) => void;
  onRemoveFromCalendar?: (entry: any) => void;
  onRemoveSaved?: (card: any) => void;
  onShareCard?: (card: any) => void;
  boardsSessions?: any[];
  onUpdateBoardSession?: (board: any) => void;
  navigationData?: {
    selectedBoard?: any;
    activeTab?: 'saved' | 'boards' | 'calendar';
    discussionTab?: string;
  } | null;
  onNavigationComplete?: () => void;
  onPromoteToAdmin?: (boardId: string, participantId: string) => void;
  onDemoteFromAdmin?: (boardId: string, participantId: string) => void;
  onRemoveMember?: (boardId: string, participantId: string) => void;
  onLeaveBoard?: (boardId: string) => void;
}

export default function ActivityPage({ 
  onSendInvite, 
  userPreferences, 
  accountPreferences, 
  calendarEntries = [], 
  savedCards = [], 
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onRemoveFromCalendar,
  onRemoveSaved,
  onShareCard,
  boardsSessions = [],
  onUpdateBoardSession,
  navigationData,
  onNavigationComplete,
  onPromoteToAdmin,
  onDemoteFromAdmin,
  onRemoveMember,
  onLeaveBoard
}: ActivityPageProps) {
  const [activeTab, setActiveTab] = useState<'boards' | 'saved' | 'calendar'>('boards');
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [showBoardDetails, setShowBoardDetails] = useState(false);
  const [activeDiscussionTab, setActiveDiscussionTab] = useState<'cards' | 'discussion'>('discussion');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<{[cardId: string]: number}>({});
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteSessionData, setInviteSessionData] = useState<{id: string; name: string} | null>(null);
  const [boardNotifications, setBoardNotifications] = useState<{[boardId: string]: boolean}>({});
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseModalCard, setPurchaseModalCard] = useState<any>(null);
  const [showQRCode, setShowQRCode] = useState<string | null>(null);

  // Handle navigation from external sources (e.g., CollaborationModule)
  React.useEffect(() => {
    if (navigationData) {
      if (navigationData.activeTab) {
        setActiveTab(navigationData.activeTab);
      }
      if (navigationData.selectedBoard) {
        setSelectedBoard(navigationData.selectedBoard.id);
        setShowBoardDetails(true);
        if (navigationData.discussionTab) {
          setActiveDiscussionTab(navigationData.discussionTab);
        }
      }
      // Clear navigation data after processing
      if (onNavigationComplete) {
        onNavigationComplete();
      }
    }
  }, [navigationData, onNavigationComplete]);

  const handleVote = (cardId: string, vote: 'yes' | 'no') => {
    // Handle voting logic
    console.log(`Voted ${vote} on card ${cardId}`);
  };

  const handleRSVP = (cardId: string, rsvp: 'yes' | 'no') => {
    if (rsvp === 'yes') {
      // Find the card in actual saved cards (not mock data)
      const card = savedCards.find(c => c.id === cardId);
      if (card && onScheduleFromSaved) {
        onScheduleFromSaved(card);
      } else {
        // Fallback to mock card for demo
        const mockCard = mockSavedCards.find(c => c.id === cardId);
        if (mockCard && onScheduleFromSaved) {
          onScheduleFromSaved(mockCard);
        }
      }
    }
    // Handle voting logic for collaboration cards
    console.log(`RSVP ${rsvp} for card ${cardId}`);
  };

  const handleRemoveSaved = (cardId: string) => {
    // Handle removing from saved
    console.log(`Removed card ${cardId} from saved`);
  };

  const handleSendToFriend = (cardId: string) => {
    // Handle sending to friend
    console.log(`Sending card ${cardId} to friend`);
  };

  const handleInviteToSession = (boardId: string, boardName: string) => {
    setInviteSessionData({ id: boardId, name: boardName });
    setShowInviteModal(true);
  };

  const handleSendInvites = (users: any[]) => {
    if (inviteSessionData && onSendInvite) {
      onSendInvite(inviteSessionData.id, users);
    }
    setShowInviteModal(false);
    setInviteSessionData(null);
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

  const handleOpenPurchase = (card: any) => {
    setPurchaseModalCard(card);
    setShowPurchaseModal(true);
  };

  const handlePurchaseComplete = (experienceData: any, purchaseOption: any) => {
    // Close purchase modal
    setShowPurchaseModal(false);
    setPurchaseModalCard(null);
    
    // Call the purchase handler passed from parent
    if (onPurchaseFromSaved) {
      onPurchaseFromSaved(experienceData, purchaseOption);
    }
  };

  const calculateScheduledDateTime = () => {
    // Get user's time preference
    const timeOfDay = userPreferences?.timeOfDay || 'Afternoon';
    const dayOfWeek = userPreferences?.dayOfWeek || 'Weekend';
    
    // Calculate suggested date based on preferences
    const now = new Date();
    let targetDate = new Date(now);
    
    // Adjust for day preference
    if (dayOfWeek === 'Weekend') {
      // Find next Saturday
      const daysUntilSaturday = (6 - now.getDay()) % 7;
      targetDate.setDate(now.getDate() + (daysUntilSaturday === 0 ? 7 : daysUntilSaturday));
    } else if (dayOfWeek === 'Weekday') {
      // Find next weekday
      let daysToAdd = 1;
      const nextDay = new Date(now);
      nextDay.setDate(now.getDate() + daysToAdd);
      while (nextDay.getDay() === 0 || nextDay.getDay() === 6) {
        daysToAdd++;
        nextDay.setDate(now.getDate() + daysToAdd);
      }
      targetDate = nextDay;
    }
    
    // Adjust for time preference
    let hour = 14; // Default afternoon
    if (timeOfDay === 'Morning') hour = 10;
    else if (timeOfDay === 'Evening') hour = 18;
    
    targetDate.setHours(hour, 0, 0, 0);
    
    return {
      date: targetDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }),
      time: targetDate.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      })
    };
  };

  // Board management handlers
  const handleLeaveBoard = (boardId: string, boardName: string) => {
    // Show confirmation dialog in real app
    console.log(`Leaving board: ${boardName}`);
    // In real app, this would make API call to remove user from board
    // and remove the session from their local data
  };

  const handleToggleBoardNotifications = (boardId: string) => {
    setBoardNotifications(prev => {
      const newEnabled = !prev[boardId];
      console.log(`Board ${boardId} notifications ${newEnabled ? 'enabled' : 'disabled'}`);
      return {
        ...prev,
        [boardId]: newEnabled
      };
    });
    // In real app, this would update notification preferences for the board
  };

  const handleExitBoard = (boardId: string, boardName: string) => {
    // Show confirmation dialog in real app
    console.log(`Exiting board: ${boardName}`);
    // In real app, this would:
    // 1. Remove the board card from the UI
    // 2. Leave the board session
    // 3. Clean up any associated data
    // For now, we'll just log the action
  };

  const isUserAdmin = (board: Board): boolean => {
    return board.admins.includes(board.currentUserId);
  };



  const renderBoardsTab = () => {
    // Filter to only show active boards (not pending sessions)
    const activeBoards = boardsSessions.filter(board => 
      board.status === 'active' || board.status === 'voting' || board.status === 'locked'
    );
    
    return (
      <View className="space-y-4">
        {activeBoards.length > 0 ? (
          activeBoards.map((board) => {
            const IconComponent = getIconComponent(board.icon);
            return (
              <View key={board.id} className="bg-white rounded-xl border border-gray-200 shadow-sm">
                <View className="p-4">
                  {/* Header Section */}
                  <View className="flex items-start justify-between mb-3">
                    <View className="flex-1">
                      <Text className="text-black leading-tight mb-1">{board.name}</Text>
                      <Text className="text-gray-600 text-sm leading-tight">{board.description}</Text>
                    </View>
                    
                    {/* Status Badge */}
                    <View className="flex-shrink-0 ml-3">
                      {board.status === 'voting' && (
                        <View className="px-2.5 py-1 bg-[#eb7825]/10 rounded-full">
                          <Text className="text-xs text-[#eb7825]">Voting</Text>
                        </View>
                      )}
                      {board.status === 'locked' && (
                        <View className="px-2.5 py-1 bg-gray-100 rounded-full">
                          <Text className="text-xs text-gray-700">Locked In</Text>
                        </View>
                      )}
                      {board.status === 'active' && (
                        <View className="px-2.5 py-1 bg-green-50 rounded-full">
                          <Text className="text-xs text-green-700">Active</Text>
                        </View>
                      )}
                      {board.status === 'completed' && (
                        <View className="px-2.5 py-1 bg-blue-50 rounded-full">
                          <Text className="text-xs text-blue-700">Completed</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  
                  {/* Stats Row */}
                  <View className="flex items-center justify-between mb-4 text-sm text-gray-600">
                    <View className="flex items-center gap-4">
                      <View className="flex items-center gap-1.5">
                        <Text className="text-sm text-black">{board.participants.length}</Text>
                        <Text className="text-xs text-gray-500 tracking-wide">MEMBERS</Text>
                      </View>
                      <View className="w-1 h-1 bg-gray-300 rounded-full"></View>
                      <View className="flex items-center gap-1.5">
                        <Text className="text-sm text-black">{board.cardsCount}</Text>
                        <Text className="text-xs text-gray-500 tracking-wide">EXPERIENCES</Text>
                      </View>
                    </View>
                  </View>
                  
                  {/* Actions Section */}
                  <View className="flex gap-2">
                    {/* Primary Action */}
                    <TouchableOpacity 
                      onClick={() => {
                        setSelectedBoard(board.id);
                        setShowBoardDetails(true);
                      }}
                      className="flex-1 bg-[#eb7825] text-white py-2.5 px-4 rounded-lg transition-all duration-200 hover:bg-[#d6691f]"
                    >
                      Open Board
                    </TouchableOpacity>
                    
                    {/* Admin Actions */}
                    {isUserAdmin(board) && (
                      <TouchableOpacity 
                        onClick={() => handleInviteToSession(board.id, board.name)}
                        className="w-10 h-10 border border-gray-200 rounded-lg hover:border-[#eb7825] hover:bg-[#eb7825]/5 transition-all duration-200 flex items-center justify-center"
                        title="Invite members"
                      >
                        <UserCheck className="w-4 h-4 text-gray-600" />
                      </TouchableOpacity>
                    )}
                    
                    {/* Board Menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <TouchableOpacity
                          className="w-10 h-10 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-all duration-200 flex items-center justify-center"
                          title="Board options"
                        >
                          <MoreHorizontal className="w-4 h-4 text-gray-600" />
                        </TouchableOpacity>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onClick={() => handleToggleBoardNotifications(board.id)}
                          className="flex items-center gap-2"
                        >
                          {boardNotifications[board.id] ? (
                            <>
                              <BellOff className="w-4 h-4" />
                              Turn off notifications
                            </>
                          ) : (
                            <>
                              <Bell className="w-4 h-4" />
                              Turn on notifications
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleExitBoard(board.id, board.name)}
                          variant="destructive"
                          className="flex items-center gap-2"
                        >
                          <LogOut className="w-4 h-4" />
                          Exit board
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    
                    {/* Leave Board */}
                    {!isUserAdmin(board) && (
                      <TouchableOpacity 
                        onClick={() => handleLeaveBoard(board.id, board.name)}
                        className="w-10 h-10 border border-red-200 rounded-lg hover:border-red-300 hover:bg-red-50 transition-all duration-200 flex items-center justify-center"
                        title="Leave board"
                      >
                        <LogOut className="w-4 h-4 text-red-500" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          })
        ) : (
          <View className="text-center py-12">
            <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <Text className="text-lg font-medium text-gray-900 mb-2">No Active Boards</Text>
            <Text className="text-gray-500 mb-6">Start collaborating with friends to create shared experiences</Text>
          </View>
        )}
      </View>
    );
  };

  const renderSavedTab = () => (
    <View className="space-y-4">
      {savedCards.length > 0 ? (
        savedCards.map((card) => {
          const CardIcon = getIconComponent(card.categoryIcon);
          const isExpanded = expandedCard === card.id;
          
          return (
            <View key={card.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <View className="p-4">
                <View className="flex gap-3">
                  <View className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
                    <ImageWithFallback
                      src={card.image}
                      alt={card.title}
                      className="w-full h-full object-cover"
                    />
                  </View>
                  
                  <View className="flex-1 min-w-0">
                    <View className="flex items-start justify-between mb-2">
                      <View>
                        <Text className="font-semibold text-gray-900 line-clamp-1">{card.title}</Text>
                        <View className="flex items-center gap-2 text-sm text-gray-600">
                          <CardIcon className="w-4 h-4 text-[#eb7825]" />
                          <Text>{card.category}</Text>
                        </View>
                      </View>
                      <View className="flex items-center gap-1 text-xs text-gray-500">
                        <Text>{card.dateAdded || 'Recently saved'}</Text>
                      </View>
                    </View>
                    
                    <View className="flex items-center justify-between text-sm">
                      <View className="flex items-center gap-4 text-gray-600">
                        <View className="flex items-center gap-1">
                          <Star className="w-4 h-4 fill-[#eb7825] text-[#eb7825]" />
                          <Text>{card.rating || '4.5'}</Text>
                        </View>
                        <View className="flex items-center gap-1">
                          <Navigation className="w-4 h-4 text-[#eb7825]" />
                          <Text>{card.travelTime || '15 min'}</Text>
                        </View>
                        <Text className="text-[#eb7825] font-semibold">{card.priceRange || '$25-50'}</Text>
                      </View>
                      
                      <TouchableOpacity
                        onClick={() => setExpandedCard(isExpanded ? null : card.id)}
                        className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                      >
                        <ChevronRight className={`w-4 h-4 text-gray-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </TouchableOpacity>
                    </View>

                    {/* Source indicator */}
                    <View className="mt-2">
                      <View className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                        card.source === 'solo' 
                          ? 'bg-blue-50 text-blue-700' 
                          : 'bg-purple-50 text-purple-700'
                      }`}>
                        {card.source === 'solo' ? (
                          <>
                            <Eye className="w-3 h-3" />
                            <Text>Solo Discovery</Text>
                          </>
                        ) : (
                          <>
                            <Users className="w-3 h-3" />
                            <Text>From {card.sessionName}</Text>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              </View>

              {/* Quick Actions */}
              <View className="px-4 pb-4">
                <View className="flex gap-2">
                  {/* Conditional Buy Now/Schedule button based on purchaseOptions */}
                  {card.purchaseOptions && card.purchaseOptions.length > 0 ? (
                    <TouchableOpacity 
                      onClick={() => handleOpenPurchase(card)}
                      className="flex-1 bg-[#eb7825] text-white py-2 px-4 rounded-xl font-medium text-sm hover:bg-[#d6691f] transition-colors flex items-center justify-center gap-1"
                    >
                      <ShoppingBag className="w-4 h-4" />
                      Buy Now
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity 
                      onClick={() => {
                        // Move card to calendar tab (existing functionality)
                        handleRSVP(card.id, 'yes');
                        
                        // Add to device calendar (new functionality)
                        try {
                          // Create calendar event from card data
                          const dateTimePrefs = userPreferences ? {
                            timeOfDay: userPreferences.timeOfDay || 'Afternoon',
                            dayOfWeek: userPreferences.dayOfWeek || 'Weekend',
                            planningTimeframe: userPreferences.planningTimeframe || 'This month'
                          } : {
                            timeOfDay: 'Afternoon',
                            dayOfWeek: 'Weekend',
                            planningTimeframe: 'This month'
                          };
                          
                          // Generate suggested dates based on preferences
                          const generateSuggestedDates = (prefs: any) => {
                            const suggestions = [];
                            const today = new Date();
                            
                            for (let i = 0; i < 3; i++) {
                              const futureDate = new Date(today);
                              
                              if (prefs.planningTimeframe === 'This week') {
                                futureDate.setDate(today.getDate() + (i + 1) * 2);
                              } else if (prefs.planningTimeframe === 'This month') {
                                futureDate.setDate(today.getDate() + (i + 1) * 7);
                              } else {
                                futureDate.setDate(today.getDate() + (i + 1) * 14);
                              }
                              
                              if (prefs.dayOfWeek === 'Weekend') {
                                const dayOfWeek = futureDate.getDay();
                                if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                                  futureDate.setDate(futureDate.getDate() + (6 - dayOfWeek));
                                }
                              }
                              
                              let hour = 14;
                              if (prefs.timeOfDay === 'Morning') hour = 10;
                              else if (prefs.timeOfDay === 'Evening') hour = 18;
                              
                              futureDate.setHours(hour, 0, 0, 0);
                              suggestions.push(futureDate.toISOString());
                            }
                            
                            return suggestions;
                          };
                          
                          // Create mock calendar entry format for the calendar utility
                          const mockCalendarEntry = {
                            id: card.id,
                            experience: card,
                            suggestedDates: generateSuggestedDates(dateTimePrefs),
                            dateTimePreferences: dateTimePrefs,
                            sessionType: card.sessionType || 'solo',
                            status: 'locked-in'
                          };
                          
                          const calendarEvent = createCalendarEventFromEntry(mockCalendarEntry);
                          addToCalendar(calendarEvent);
                        } catch (error) {
                          console.error('Error adding to device calendar:', error);
                        }
                      }}
                      className="flex-1 bg-[#eb7825] text-white py-2 px-4 rounded-xl font-medium text-sm hover:bg-[#d6691f] transition-colors flex items-center justify-center gap-1"
                    >
                      <Calendar className="w-4 h-4" />
                      Schedule
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity 
                    onClick={() => {
                      if (typeof onShareCard === 'function') {
                        onShareCard(card);
                      }
                    }}
                    className="px-3 py-2 border border-gray-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-colors group"
                    title="Share experience"
                  >
                    <Share2 className="w-4 h-4 text-gray-600 group-hover:text-blue-500" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onClick={() => {
                      if (typeof onRemoveSaved === 'function') {
                        onRemoveSaved(card);
                      }
                    }}
                    className="px-3 py-2 border border-gray-200 rounded-xl hover:bg-red-50 hover:border-red-200 transition-colors group"
                    title="Remove from saved"
                  >
                    <X className="w-4 h-4 text-gray-600 group-hover:text-red-500" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Expanded Details */}
              {isExpanded && (
                <View className="border-t border-gray-100 bg-gray-50">
                  {/* Image Gallery */}
                  {card.images && card.images.length > 0 && (
                    <View className="relative">
                      <View className="aspect-video relative overflow-hidden">
                        <ImageWithFallback
                          src={card.images[currentImageIndex[card.id] || 0]}
                          alt={card.title}
                          className="w-full h-full object-cover"
                        />
                        
                        {card.images.length > 1 && (
                          <>
                            <TouchableOpacity
                              onClick={() => prevImage(card.id, card.images.length)}
                              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onClick={() => nextImage(card.id, card.images.length)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </TouchableOpacity>
                            
                            {/* Image indicators */}
                            <View className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                              {card.images.map((_, index) => (
                                <View
                                  key={index}
                                  className={`w-2 h-2 rounded-full ${
                                    index === (currentImageIndex[card.id] || 0)
                                      ? 'bg-white'
                                      : 'bg-white/50'
                                  }`}
                                />
                              ))}
                            </View>
                          </>
                        )}
                      </View>
                    </View>
                  )}
                  
                  {/* Details */}
                  <View className="p-4 space-y-4">
                    <View>
                      <Text className="font-medium text-gray-900 mb-2">About this experience</Text>
                      <Text className="text-sm text-gray-600 leading-relaxed">{card.fullDescription}</Text>
                    </View>
                    
                    {card.highlights && card.highlights.length > 0 && (
                      <View>
                        <Text className="font-medium text-gray-900 mb-2">Highlights</Text>
                        <View className="flex flex-wrap gap-2">
                          {card.highlights.map((highlight, index) => (
                            <Text key={index} className="px-2 py-1 bg-orange-50 text-orange-700 text-xs rounded-lg">
                              {highlight}
                            </Text>
                          ))}
                        </View>
                      </View>
                    )}
                    
                    <View>
                      <Text className="font-medium text-gray-900 mb-2">Location</Text>
                      <View className="flex items-start gap-2 text-sm text-gray-600">
                        <MapPin className="w-4 h-4 text-[#eb7825] mt-0.5 flex-shrink-0" />
                        <Text>{card.address || 'Address not available'}</Text>
                      </View>
                    </View>
                    
                    {card.socialStats && (
                      <View>
                        <Text className="font-medium text-gray-900 mb-2">Community Stats</Text>
                        <View className="flex items-center gap-4 text-sm text-gray-600">
                          <View className="flex items-center gap-1">
                            <Eye className="w-4 h-4" />
                            <Text>{card.socialStats.views} views</Text>
                          </View>
                          <View className="flex items-center gap-1">
                            <Heart className="w-4 h-4" />
                            <Text>{card.socialStats.likes} likes</Text>
                          </View>
                          <View className="flex items-center gap-1">
                            <Bookmark className="w-4 h-4" />
                            <Text>{card.socialStats.saves} saves</Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>
          );
        })
      ) : (
        <View className="text-center py-12">
          <Heart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <Text className="text-lg font-medium text-gray-900 mb-2">No Saved Experiences</Text>
          <Text className="text-gray-500 mb-6">Start swiping to save experiences you love</Text>
        </View>
      )}
    </View>
  );



  const renderCalendarTab = () => {
    // Use calendarEntries prop, fall back to mock data if empty for demonstration
    const displayEntries = calendarEntries.length > 0 ? calendarEntries : mockCalendarEntries;
    
    return (
      <View className="space-y-4">
        {displayEntries.length > 0 ? (
        displayEntries.map((entry) => {
          const ExperienceIcon = getIconComponent(entry.experience?.categoryIcon);
          
          return (
            <View 
              key={entry.id} 
              className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow duration-200"
              onClick={() => setExpandedCard(expandedCard === entry.id ? null : entry.id)}
            >
              <View className="p-4">
                <View className="flex gap-3">
                  <View className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
                    <ImageWithFallback
                      src={entry.experience?.image || 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4'}
                      alt={entry.experience?.title || entry.title}
                      className="w-full h-full object-cover"
                    />
                  </View>
                  
                  <View className="flex-1 min-w-0">
                    <View className="flex items-start justify-between mb-2">
                      <View>
                        <Text className="font-semibold text-gray-900 line-clamp-1">{entry.experience?.title || entry.title}</Text>
                        <View className="flex items-center gap-2 text-sm text-gray-600">
                          <ExperienceIcon className="w-4 h-4 text-[#eb7825]" />
                          <Text>{entry.experience?.category || entry.category}</Text>
                        </View>
                      </View>
                      <View className="text-right">
                        <View className="text-sm font-medium text-gray-900">
                          {entry.suggestedDates?.[0] ? new Date(entry.suggestedDates[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD'}
                        </View>
                        <View className="text-xs text-gray-500">
                          {entry.suggestedDates?.[0] ? new Date(entry.suggestedDates[0]).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''}
                        </View>
                      </View>
                    </View>
                    
                    <View className="flex items-center gap-4 text-sm text-gray-600">
                      <View className="flex items-center gap-1">
                        <Star className="w-4 h-4 fill-[#eb7825] text-[#eb7825]" />
                        <Text>{entry.experience?.rating || '4.5'}</Text>
                      </View>
                      <View className="flex items-center gap-1">
                        <Navigation className="w-4 h-4 text-[#eb7825]" />
                        <Text>{entry.experience?.travelTime || '15 min'}</Text>
                      </View>
                      {entry.purchaseOption ? (
                        <View className="flex items-center gap-1">
                          <ShoppingBag className="w-4 h-4 text-green-600" />
                          <Text className="text-green-600 font-semibold">
                            {formatCurrency(entry.purchaseOption.price, entry.purchaseOption.currency || accountPreferences?.currency || 'USD')}
                          </Text>
                        </View>
                      ) : (
                        <Text className="text-[#eb7825] font-semibold whitespace-nowrap">{entry.experience?.priceRange || '$25-50'}</Text>
                      )}
                    </View>

                    {/* Session type and status indicators */}
                    <View className="mt-2 flex items-center gap-2">
                      <View className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                        entry.sessionType === 'solo' 
                          ? 'bg-blue-50 text-blue-700' 
                          : 'bg-purple-50 text-purple-700'
                      }`}>
                        {entry.sessionType === 'solo' ? (
                          <>
                            <Eye className="w-3 h-3" />
                            <Text>Solo Plan</Text>
                          </>
                        ) : (
                          <>
                            <Users className="w-3 h-3" />
                            <Text>{entry.sessionName || 'Group Plan'}</Text>
                          </>
                        )}
                      </View>
                      
                      <View className={`px-2 py-1 rounded-full text-xs font-medium flex-shrink-0 ${
                        entry.status === 'locked-in' 
                          ? 'bg-green-50 text-green-700' 
                          : entry.status === 'completed'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-yellow-50 text-yellow-700'
                      }`}>
                        {entry.status === 'locked-in' ? 'Confirmed' : entry.status === 'completed' ? 'Completed' : 'Pending'}
                      </View>
                    </View>
                  </View>
                </View>
              </View>

              {/* Purchase Details Section */}
              {entry.purchaseOption && (
                <View className="px-4">
                  <View className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 mb-4">
                    <View className="flex items-center gap-2 mb-2">
                      <ShoppingBag className="w-4 h-4 text-emerald-600" />
                      <Text className="text-sm font-semibold text-emerald-700">Purchase Details</Text>
                    </View>
                    <View className="space-y-1 text-xs text-emerald-600">
                      <View className="flex items-center justify-between">
                        <Text>Option:</Text>
                        <Text className="font-medium">{entry.purchaseOption.title}</Text>
                      </View>
                      <View className="flex items-center justify-between">
                        <Text>Price:</Text>
                        <Text className="font-semibold">{formatCurrency(entry.purchaseOption.price, entry.purchaseOption.currency || accountPreferences?.currency || 'USD')}</Text>
                      </View>
                      {entry.purchaseOption.duration && (
                        <View className="flex items-center justify-between">
                          <Text>Duration:</Text>
                          <Text className="font-medium">{entry.purchaseOption.duration}</Text>
                        </View>
                      )}
                      {entry.purchaseOption.includes && entry.purchaseOption.includes.length > 0 && (
                        <View className="mt-2">
                          <Text className="block mb-1">Includes:</Text>
                          <View className="flex flex-wrap gap-1">
                            {entry.purchaseOption.includes.slice(0, 3).map((item: string, index: number) => (
                              <Text key={index} className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs">
                                {item}
                              </Text>
                            ))}
                            {entry.purchaseOption.includes.length > 3 && (
                              <Text className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs">
                                +{entry.purchaseOption.includes.length - 3} more
                              </Text>
                            )}
                          </View>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              )}

              {/* Calendar Actions */}
              <View className="px-4 pb-4">
                <View className="flex gap-2">
                  <TouchableOpacity 
                    onClick={(e) => {
                      e.stopPropagation();
                      const address = entry.experience?.address || 'Current Location';
                      const query = encodeURIComponent(address);
                      window.open(`https://maps.google.com/maps?q=${query}`, '_blank');
                    }}
                    className="flex-1 bg-[#eb7825] text-white py-3 px-4 rounded-xl hover:bg-[#d6691f] transition-colors flex items-center justify-center"
                    title="Open in Maps"
                  >
                    <MapPin className="w-5 h-5" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onClick={(e) => {
                      e.stopPropagation();
                      try {
                        const calendarEvent = createCalendarEventFromEntry(entry);
                        addToCalendar(calendarEvent);
                      } catch (error) {
                        console.error('Error adding to calendar:', error);
                      }
                    }}
                    className="flex-1 bg-white border border-[#eb7825] text-[#eb7825] py-3 px-4 rounded-xl hover:bg-[#eb7825] hover:text-white transition-colors flex items-center justify-center"
                    title="Add to calendar"
                  >
                    <Calendar className="w-5 h-5" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onClick={(e) => {
                      e.stopPropagation();
                      // Capture current date/time preferences
                      const dateTimePrefs = userPreferences ? {
                        timeOfDay: userPreferences.timeOfDay || 'Afternoon',
                        dayOfWeek: userPreferences.dayOfWeek || 'Weekend',
                        planningTimeframe: userPreferences.planningTimeframe || 'This month'
                      } : {
                        timeOfDay: 'Afternoon',
                        dayOfWeek: 'Weekend',
                        planningTimeframe: 'This month'
                      };
                      
                      // Trigger share modal with experience data
                      if (typeof onShareCard === 'function') {
                        onShareCard(entry.experience);
                      }
                    }}
                    className="px-3 py-3 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors group"
                    title="Share experience"
                  >
                    <Share2 className="w-5 h-5 text-gray-600 group-hover:text-[#eb7825] transition-colors" />
                  </TouchableOpacity>
                  {/* Show remove button only for non-purchased entries */}
                  {!entry.purchaseOption && !entry.isPurchased ? (
                    <TouchableOpacity 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (typeof onRemoveFromCalendar === 'function') {
                          onRemoveFromCalendar(entry);
                        }
                      }}
                      className="px-3 py-3 border border-gray-200 rounded-xl hover:bg-red-50 hover:border-red-200 transition-colors group"
                      title="Remove from calendar"
                    >
                      <X className="w-5 h-5 text-gray-600 group-hover:text-red-500" />
                    </TouchableOpacity>
                  ) : (
                    <View className="flex gap-2">
                      <View 
                        className="px-3 py-3 border border-emerald-200 bg-emerald-50 rounded-xl cursor-not-allowed"
                        title="Purchased - Cannot be removed"
                      >
                        <Lock className="w-5 h-5 text-emerald-600" />
                      </View>
                      
                      {/* QR Code Button for Purchased Items */}
                      <TouchableOpacity
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowQRCode(entry.id);
                        }}
                        className="px-3 py-3 border border-blue-200 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
                        title="Show Purchase QR Code"
                      >
                        <QrCode className="w-5 h-5 text-blue-600" />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>

              {/* Expanded Calendar Details */}
              {expandedCard === entry.id && (
                <View className="border-t border-gray-100 bg-gray-50">
                  {/* Image Gallery */}
                  {entry.experience?.images && entry.experience.images.length > 0 && (
                    <View className="relative">
                      <View className="aspect-video relative overflow-hidden">
                        <ImageWithFallback
                          src={entry.experience.images[currentImageIndex[entry.id] || 0]}
                          alt={entry.experience.title}
                          className="w-full h-full object-cover"
                        />
                        
                        {entry.experience.images.length > 1 && (
                          <>
                            <TouchableOpacity
                              onClick={(e) => {
                                e.stopPropagation();
                                prevImage(entry.id, entry.experience.images.length);
                              }}
                              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onClick={(e) => {
                                e.stopPropagation();
                                nextImage(entry.id, entry.experience.images.length);
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </TouchableOpacity>
                            
                            {/* Image indicators */}
                            <View className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                              {entry.experience.images.map((_, index) => (
                                <View
                                  key={index}
                                  className={`w-2 h-2 rounded-full ${
                                    index === (currentImageIndex[entry.id] || 0)
                                      ? 'bg-white'
                                      : 'bg-white/50'
                                  }`}
                                />
                              ))}
                            </View>
                          </>
                        )}
                      </View>
                    </View>
                  )}
                  
                  {/* Details */}
                  <View className="p-4 space-y-4">
                    <View>
                      <Text className="font-medium text-gray-900 mb-2">About this experience</Text>
                      <Text className="text-sm text-gray-600 leading-relaxed">
                        {entry.experience?.fullDescription || entry.experience?.description || 'Join us for this amazing experience! Perfect for creating memorable moments.'}
                      </Text>
                    </View>
                    
                    {entry.experience?.highlights && entry.experience.highlights.length > 0 && (
                      <View>
                        <Text className="font-medium text-gray-900 mb-2">Highlights</Text>
                        <View className="flex flex-wrap gap-2">
                          {entry.experience.highlights.map((highlight, index) => (
                            <Text key={index} className="px-2 py-1 bg-orange-50 text-orange-700 text-xs rounded-lg">
                              {highlight}
                            </Text>
                          ))}
                        </View>
                      </View>
                    )}

                    {/* Date & Time Details */}
                    <View>
                      <Text className="font-medium text-gray-900 mb-2">Schedule Details</Text>
                      <View className="space-y-2">
                        <View className="flex items-center gap-2 text-sm text-gray-600">
                          <Calendar className="w-4 h-4 text-[#eb7825]" />
                          <Text>
                            {entry.suggestedDates?.[0] 
                              ? new Date(entry.suggestedDates[0]).toLocaleDateString('en-US', { 
                                  weekday: 'long', 
                                  year: 'numeric', 
                                  month: 'long', 
                                  day: 'numeric' 
                                })
                              : 'Date to be determined'
                            }
                          </Text>
                        </View>
                        <View className="flex items-center gap-2 text-sm text-gray-600">
                          <Clock className="w-4 h-4 text-[#eb7825]" />
                          <Text>
                            {entry.suggestedDates?.[0] 
                              ? new Date(entry.suggestedDates[0]).toLocaleTimeString('en-US', { 
                                  hour: 'numeric', 
                                  minute: '2-digit', 
                                  hour12: true 
                                })
                              : 'Time to be determined'
                            }
                          </Text>
                        </View>
                        <View className="flex items-center gap-2 text-sm text-gray-600">
                          <MapPin className="w-4 h-4 text-[#eb7825]" />
                          <Text>{entry.experience?.address || 'Location details will be provided'}</Text>
                        </View>
                      </View>
                    </View>

                    {/* Date/Time Preferences Applied */}
                    {entry.dateTimePreferences && (
                      <View>
                        <Text className="font-medium text-gray-900 mb-2">Your Preferences Applied</Text>
                        <View className="flex flex-wrap gap-2">
                          <Text className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-lg">
                            {entry.dateTimePreferences.timeOfDay}
                          </Text>
                          <Text className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-lg">
                            {entry.dateTimePreferences.dayOfWeek}
                          </Text>
                          <Text className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-lg">
                            {entry.dateTimePreferences.planningTimeframe}
                          </Text>
                        </View>
                      </View>
                    )}
                    
                    {/* Contact Information */}
                    {(entry.experience?.phoneNumber || entry.experience?.website) && (
                      <View>
                        <Text className="font-medium text-gray-900 mb-2">Contact Information</Text>
                        <View className="space-y-2">
                          {entry.experience.phoneNumber && (
                            <View className="flex items-center gap-2 text-sm text-gray-600">
                              <Text>📞</Text>
                              <Text>{entry.experience.phoneNumber}</Text>
                            </View>
                          )}
                          {entry.experience.website && (
                            <View className="flex items-center gap-2 text-sm text-gray-600">
                              <ExternalLink className="w-4 h-4 text-[#eb7825]" />
                              <a 
                                href={entry.experience.website} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[#eb7825] hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Visit Website
                              </a>
                            </View>
                          )}
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>
          );
        })
      ) : (
        <View className="text-center py-12">
          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <Text className="text-lg font-medium text-gray-900 mb-2">No Scheduled Experiences</Text>
          <Text className="text-gray-500 mb-6">Save and schedule experiences to see them here</Text>
        </View>
      )}
      </View>
    );
  };

  return (
    <View className="h-full bg-white flex flex-col">
      {/* Header */}
      {!selectedBoard && (
        <View className="bg-white border-b border-gray-100 px-6 pt-6 pb-4 flex-shrink-0">
          <View className="flex items-center justify-between">
            <Text className="text-xl font-semibold text-gray-900">Activity</Text>
          </View>
          
          {/* Tab Navigation */}
          <View className="flex mt-6 bg-gray-100 rounded-xl p-1">
            <TouchableOpacity
              onClick={() => setActiveTab('boards')}
              className={`flex-1 py-2 px-4 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'boards'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Boards
            </TouchableOpacity>
            <TouchableOpacity
              onClick={() => setActiveTab('saved')}
              className={`flex-1 py-2 px-4 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'saved'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Saved
            </TouchableOpacity>
            <TouchableOpacity
              onClick={() => setActiveTab('calendar')}
              className={`flex-1 py-2 px-4 text-sm font-medium rounded-lg transition-colors ${
                activeTab === 'calendar'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Locked In
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Content */}
      <View className="flex-1 overflow-y-auto">
        {showBoardDetails && selectedBoard ? (
          (() => {
            const board = boardsSessions.find(b => b.id === selectedBoard);
            return board ? (
              <BoardDiscussion 
                board={board}
                onBack={() => {
                  setShowBoardDetails(false);
                  setSelectedBoard(null);
                }}
                activeTab={activeDiscussionTab}
                onTabChange={setActiveDiscussionTab}
                onPromoteToAdmin={onPromoteToAdmin}
                onDemoteFromAdmin={onDemoteFromAdmin}
                onRemoveMember={onRemoveMember}
                onLeaveBoard={onLeaveBoard}
              />
            ) : null;
          })()
        ) : (
          <View className="px-6 py-6">
            {activeTab === 'boards' && renderBoardsTab()}
            {activeTab === 'saved' && renderSavedTab()}
            {activeTab === 'calendar' && renderCalendarTab()}
          </View>
        )}
      </View>

      {/* User Invite Modal */}
      <UserInviteModal
        isOpen={showInviteModal}
        onClose={() => {
          setShowInviteModal(false);
          setInviteSessionData(null);
        }}
        onSendInvites={handleSendInvites}
        sessionName={inviteSessionData?.name || ''}
      />

      {/* Purchase Modal */}
      {showPurchaseModal && purchaseModalCard && (
        <PurchaseModal 
          isOpen={showPurchaseModal}
          onClose={() => {
            setShowPurchaseModal(false);
            setPurchaseModalCard(null);
          }}
          recommendation={purchaseModalCard}
          accountPreferences={accountPreferences}
          onPurchaseComplete={handlePurchaseComplete}
        />
      )}

      {/* QR Code Modal */}
      {showQRCode && (
        <View className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 pb-24">
          <View className="bg-white rounded-xl max-w-sm w-full max-h-full overflow-hidden flex flex-col">
            <View className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
              <Text className="text-lg font-semibold text-gray-900">Purchase QR Code</Text>
              <TouchableOpacity
                onClick={() => setShowQRCode(null)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </TouchableOpacity>
            </View>
            
            <View className="p-4 overflow-y-auto flex-1">
              {(() => {
                const entry = calendarEntries.find((e: any) => e.id === showQRCode);
                return entry ? (
                  <PurchaseQRCode 
                    entry={entry}
                    accountPreferences={accountPreferences}
                  />
                ) : null;
              })()}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}