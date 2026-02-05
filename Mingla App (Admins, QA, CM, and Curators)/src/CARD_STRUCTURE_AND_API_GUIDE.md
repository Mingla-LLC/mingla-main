# Card Structure and API Guide

## Complete Documentation for Mingla Experience Cards

This guide provides the exact structure, styling, and data handling patterns for all experience cards in the Mingla platform.

---

## Table of Contents

1. [Card Data Schema](#card-data-schema)
2. [API Data Patterns](#api-data-patterns)
3. [Visual Card Structure](#visual-card-structure)
4. [Card Creator Badge Integration](#card-creator-badge-integration)
5. [Card Types & Categories](#card-types--categories)
6. [CRUD Operations](#crud-operations)
7. [Card Component Examples](#card-component-examples)
8. [Best Practices](#best-practices)

---

## Card Data Schema

### Complete Card Object Structure

```typescript
interface ExperienceCard {
  // Core Identity
  id: string;                    // Unique identifier (UUID format)
  title: string;                 // Experience title
  description: string;           // Detailed description
  
  // Creator Information
  createdBy: string;             // Creator's user ID
  createdByName: string;         // Creator's display name
  createdByRole: 'business' | 'curator' | 'admin';  // Creator role
  creatorAvatar?: string;        // Creator profile image URL
  
  // Business/Collaboration (for curator-created cards)
  businessId?: string;           // Associated business ID (if curator-created)
  businessName?: string;         // Business display name
  collaborationId?: string;      // Collaboration session ID
  
  // Categorization
  category: string;              // Primary category (see categories list below)
  subcategory?: string;          // Optional subcategory
  tags: string[];                // Searchable tags
  experienceType: string;        // Type of experience (see types below)
  
  // Location
  location: {
    name: string;                // Location display name
    address: string;             // Full address
    city: string;                // City
    state?: string;              // State/Province
    country: string;             // Country
    lat: number;                 // Latitude
    lng: number;                 // Longitude
    placeId?: string;            // Google Places ID
  };
  
  // Pricing & Packages
  pricing: {
    currency: string;            // ISO currency code (USD, EUR, GBP, etc.)
    displayRange: string;        // Display string (e.g., "$50-100")
    minPrice: number;            // Minimum price for filtering
    maxPrice: number;            // Maximum price for filtering
    priceCategory: 'budget' | 'moderate' | 'premium' | 'luxury';
  };
  
  packages: Array<{
    id: string;                  // Package unique ID
    name: string;                // Package name
    description: string;         // Package description
    price: number;               // Price in base currency
    currency: string;            // Currency code
    duration: string;            // Duration (e.g., "2 hours", "Full day")
    maxGroupSize: number;        // Maximum participants
    inclusions: string[];        // What's included
    isPopular?: boolean;         // Highlight as popular
  }>;
  
  // Availability
  availability: {
    type: 'specific' | 'recurring' | 'on-demand';
    timezone: string;            // IANA timezone
    
    // For specific dates
    specificDates?: Array<{
      date: string;              // ISO date string
      timeSlots: Array<{
        startTime: string;       // HH:mm format
        endTime: string;         // HH:mm format
        available: number;       // Spots available
      }>;
    }>;
    
    // For recurring availability
    recurring?: {
      daysOfWeek: number[];      // 0-6 (Sunday-Saturday)
      timeSlots: Array<{
        startTime: string;
        endTime: string;
        maxCapacity: number;
      }>;
      excludeDates?: string[];   // ISO date strings to exclude
    };
    
    // For on-demand
    onDemand?: {
      advanceNotice: string;     // e.g., "24 hours"
      maxAdvanceBooking: string; // e.g., "90 days"
    };
  };
  
  // Route & Timeline (for multi-location experiences)
  route?: Array<{
    id: string;
    venueName: string;
    address: string;
    lat: number;
    lng: number;
    arrivalTime: string;         // HH:mm format
    departureTime: string;       // HH:mm format
    duration: string;            // Duration at venue
    activities: string[];        // Activities at this venue
    transportToNext?: string;    // Transport method to next venue
    transportDuration?: string;  // Travel time to next venue
  }>;
  
  // Media
  images: string[];              // Array of image URLs
  coverImage: string;            // Primary cover image URL
  videoUrl?: string;             // Optional video URL
  
  // Policies
  policies: {
    cancellation: string;        // Cancellation policy text
    refundPolicy: string;        // Refund policy
    ageRestrictions?: string;    // Age requirements
    healthRequirements?: string; // Health/fitness requirements
    whatToBring?: string[];      // Items to bring
    accessibility?: string;      // Accessibility information
  };
  
  // Engagement Metrics
  views: number;                 // View count
  likes: number;                 // Like count
  saves: number;                 // Save count
  rating: number;                // Average rating (0-5)
  reviewCount: number;           // Number of reviews
  purchaseCount: number;         // Number of purchases
  
  // Status & Dates
  status: 'draft' | 'pending_review' | 'live' | 'paused' | 'archived';
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  publishedAt?: string;          // ISO timestamp
  
  // QA Review (for pending cards)
  qaReview?: {
    status: 'pending' | 'approved' | 'rejected' | 'needs_changes';
    reviewerId?: string;
    reviewerName?: string;
    feedback?: string;
    reviewedAt?: string;
  };
  
  // Commission (for curator-created cards)
  commission?: {
    percentage: number;          // Commission % (0-100)
    negotiated: boolean;         // Whether custom negotiated
    agreedAt?: string;           // ISO timestamp
  };
}
```

---

## API Data Patterns

### LocalStorage as Backend API

Mingla uses localStorage to simulate a backend API. All data operations follow REST-like patterns.

### Data Storage Keys

```typescript
// Core Data Stores
const STORAGE_KEYS = {
  // User & Auth
  users: 'users',                          // All platform users
  currentUser: 'currentUser',              // Logged in user
  
  // Experience Cards
  platformCards: 'platformCards',          // All experience cards
  userCards: 'userCards',                  // Current user's cards
  
  // Business & Collaboration
  businesses: 'businesses',                // Business profiles
  collaborations: 'collaborations',        // Curator-business collaborations
  
  // Social & Engagement
  userPurchases: 'userPurchases',         // Purchase records
  userLikes: 'userLikes',                 // Liked cards
  userSaves: 'userSaves',                 // Saved cards
  boards: 'boards',                        // User boards
  
  // Messages & Support
  messages: 'messages',                    // Chat messages
  supportTickets: 'supportTickets',       // Support tickets
  
  // Admin
  qaReviews: 'qaReviews',                 // QA review queue
  platformSettings: 'platformSettings'     // Global settings
};
```

### API Helper Functions

#### 1. **Fetch All Cards**

```typescript
const getAllCards = (): ExperienceCard[] => {
  try {
    const cards = localStorage.getItem('platformCards');
    return cards ? JSON.parse(cards) : [];
  } catch (error) {
    console.error('Error fetching cards:', error);
    return [];
  }
};
```

#### 2. **Fetch Card by ID**

```typescript
const getCardById = (cardId: string): ExperienceCard | null => {
  const cards = getAllCards();
  return cards.find(card => card.id === cardId) || null;
};
```

#### 3. **Filter Cards by Criteria**

```typescript
const filterCards = (criteria: {
  category?: string;
  creatorRole?: string;
  status?: string;
  minPrice?: number;
  maxPrice?: number;
  location?: string;
}): ExperienceCard[] => {
  let cards = getAllCards();
  
  if (criteria.category) {
    cards = cards.filter(card => card.category === criteria.category);
  }
  
  if (criteria.creatorRole) {
    cards = cards.filter(card => card.createdByRole === criteria.creatorRole);
  }
  
  if (criteria.status) {
    cards = cards.filter(card => card.status === criteria.status);
  }
  
  if (criteria.minPrice !== undefined || criteria.maxPrice !== undefined) {
    cards = cards.filter(card => {
      const price = card.pricing.minPrice;
      if (criteria.minPrice && price < criteria.minPrice) return false;
      if (criteria.maxPrice && price > criteria.maxPrice) return false;
      return true;
    });
  }
  
  if (criteria.location) {
    cards = cards.filter(card => 
      card.location.city.toLowerCase().includes(criteria.location!.toLowerCase()) ||
      card.location.country.toLowerCase().includes(criteria.location!.toLowerCase())
    );
  }
  
  return cards;
};
```

#### 4. **Create New Card**

```typescript
const createCard = (cardData: Partial<ExperienceCard>): ExperienceCard => {
  const cards = getAllCards();
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  
  const newCard: ExperienceCard = {
    id: `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title: cardData.title || '',
    description: cardData.description || '',
    createdBy: currentUser.id,
    createdByName: currentUser.name,
    createdByRole: currentUser.role,
    creatorAvatar: currentUser.avatar,
    category: cardData.category || '',
    tags: cardData.tags || [],
    experienceType: cardData.experienceType || '',
    location: cardData.location || {},
    pricing: cardData.pricing || { currency: 'USD', displayRange: '', minPrice: 0, maxPrice: 0 },
    packages: cardData.packages || [],
    availability: cardData.availability || { type: 'on-demand', timezone: 'UTC' },
    images: cardData.images || [],
    coverImage: cardData.coverImage || '',
    policies: cardData.policies || {},
    views: 0,
    likes: 0,
    saves: 0,
    rating: 0,
    reviewCount: 0,
    purchaseCount: 0,
    status: currentUser.role === 'admin' ? 'live' : 'pending_review',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...cardData
  };
  
  cards.push(newCard);
  localStorage.setItem('platformCards', JSON.stringify(cards));
  
  return newCard;
};
```

#### 5. **Update Card**

```typescript
const updateCard = (cardId: string, updates: Partial<ExperienceCard>): ExperienceCard | null => {
  const cards = getAllCards();
  const cardIndex = cards.findIndex(card => card.id === cardId);
  
  if (cardIndex === -1) return null;
  
  cards[cardIndex] = {
    ...cards[cardIndex],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  
  localStorage.setItem('platformCards', JSON.stringify(cards));
  return cards[cardIndex];
};
```

#### 6. **Delete Card**

```typescript
const deleteCard = (cardId: string): boolean => {
  const cards = getAllCards();
  const filteredCards = cards.filter(card => card.id !== cardId);
  
  if (filteredCards.length === cards.length) return false;
  
  localStorage.setItem('platformCards', JSON.stringify(filteredCards));
  return true;
};
```

#### 7. **Increment View Count**

```typescript
const incrementCardViews = (cardId: string): void => {
  const cards = getAllCards();
  const cardIndex = cards.findIndex(card => card.id === cardId);
  
  if (cardIndex !== -1) {
    cards[cardIndex].views = (cards[cardIndex].views || 0) + 1;
    localStorage.setItem('platformCards', JSON.stringify(cards));
  }
};
```

#### 8. **Toggle Like**

```typescript
const toggleCardLike = (cardId: string, userId: string): boolean => {
  const userLikes = JSON.parse(localStorage.getItem('userLikes') || '{}');
  const userLikesList = userLikes[userId] || [];
  
  const isLiked = userLikesList.includes(cardId);
  
  if (isLiked) {
    userLikes[userId] = userLikesList.filter((id: string) => id !== cardId);
  } else {
    userLikes[userId] = [...userLikesList, cardId];
  }
  
  localStorage.setItem('userLikes', JSON.stringify(userLikes));
  
  // Update card like count
  const cards = getAllCards();
  const cardIndex = cards.findIndex(card => card.id === cardId);
  if (cardIndex !== -1) {
    cards[cardIndex].likes = isLiked 
      ? Math.max(0, cards[cardIndex].likes - 1) 
      : cards[cardIndex].likes + 1;
    localStorage.setItem('platformCards', JSON.stringify(cards));
  }
  
  return !isLiked;
};
```

---

## Visual Card Structure

### Card Component Layout

All experience cards follow this exact visual structure:

```tsx
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Heart, Bookmark, MapPin, Star, Eye } from 'lucide-react';
import { CardCreatorBadge } from './CardCreatorBadge';

interface ExperienceCardProps {
  card: ExperienceCard;
  onCardClick?: (card: ExperienceCard) => void;
  onLike?: (cardId: string) => void;
  onSave?: (cardId: string) => void;
  isLiked?: boolean;
  isSaved?: boolean;
  showCreatorBadge?: boolean;
}

export function ExperienceCardComponent({
  card,
  onCardClick,
  onLike,
  onSave,
  isLiked = false,
  isSaved = false,
  showCreatorBadge = true
}: ExperienceCardProps) {
  return (
    <Card 
      className="overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer group"
      onClick={() => onCardClick?.(card)}
    >
      {/* Image Container with Badge Overlay */}
      <div className="relative aspect-[4/3] overflow-hidden">
        <img
          src={card.coverImage}
          alt={card.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        
        {/* Creator Badge - Top Left */}
        {showCreatorBadge && (
          <div className="absolute top-3 left-3 z-10">
            <CardCreatorBadge
              creatorRole={card.createdByRole}
              businessName={card.businessName}
            />
          </div>
        )}
        
        {/* Price Badge - Top Right */}
        <div className="absolute top-3 right-3 z-10">
          <Badge className="bg-white/95 backdrop-blur-sm text-[#111827] border-0 shadow-lg">
            {card.pricing.displayRange}
          </Badge>
        </div>
        
        {/* Action Buttons - Bottom Right */}
        <div className="absolute bottom-3 right-3 flex gap-2 z-10">
          <Button
            size="icon"
            variant="secondary"
            className="w-9 h-9 rounded-full bg-white/95 backdrop-blur-sm hover:bg-white shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
              onLike?.(card.id);
            }}
          >
            <Heart 
              className={`w-4 h-4 ${isLiked ? 'fill-red-500 text-red-500' : 'text-gray-700'}`} 
            />
          </Button>
          
          <Button
            size="icon"
            variant="secondary"
            className="w-9 h-9 rounded-full bg-white/95 backdrop-blur-sm hover:bg-white shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
              onSave?.(card.id);
            }}
          >
            <Bookmark 
              className={`w-4 h-4 ${isSaved ? 'fill-[#eb7825] text-[#eb7825]' : 'text-gray-700'}`} 
            />
          </Button>
        </div>
      </div>
      
      {/* Content Section */}
      <div className="p-4 space-y-3">
        {/* Title */}
        <h3 className="text-[#111827] line-clamp-2 min-h-[3rem]">
          {card.title}
        </h3>
        
        {/* Location */}
        <div className="flex items-center gap-2 text-[#6B7280]">
          <MapPin className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm truncate">
            {card.location.city}, {card.location.country}
          </span>
        </div>
        
        {/* Category & Tags */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="bg-gray-50">
            {card.category}
          </Badge>
          {card.tags.slice(0, 2).map(tag => (
            <Badge key={tag} variant="outline" className="bg-gray-50">
              {tag}
            </Badge>
          ))}
        </div>
        
        {/* Stats Row */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div className="flex items-center gap-1">
            <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
            <span className="text-sm text-[#111827]">
              {card.rating.toFixed(1)}
            </span>
            <span className="text-xs text-[#6B7280]">
              ({card.reviewCount})
            </span>
          </div>
          
          <div className="flex items-center gap-1 text-[#6B7280]">
            <Eye className="w-4 h-4" />
            <span className="text-sm">{card.views.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
```

### Card Grid Layout

```tsx
{/* Responsive Grid */}
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
  {cards.map(card => (
    <ExperienceCardComponent
      key={card.id}
      card={card}
      onCardClick={handleCardClick}
      onLike={handleLike}
      onSave={handleSave}
      isLiked={userLikes.includes(card.id)}
      isSaved={userSaves.includes(card.id)}
    />
  ))}
</div>
```

---

## Card Creator Badge Integration

### CardCreatorBadge Component Usage

```tsx
import { CardCreatorBadge } from './CardCreatorBadge';

// Business-created card
<CardCreatorBadge 
  creatorRole="business" 
/>

// Curator-created card for a business
<CardCreatorBadge 
  creatorRole="curator" 
  businessName="Sunset Adventures" 
/>

// Admin-created card
<CardCreatorBadge 
  creatorRole="admin" 
/>
```

### Badge Styling Rules

- **Business Badge**: Orange gradient (`bg-gradient-to-r from-[#eb7825] to-[#d6691f]`)
- **Curator Badge**: Purple gradient (`bg-gradient-to-r from-purple-600 to-purple-700`)
- **Admin Badge**: Gray gradient (`bg-gradient-to-r from-gray-600 to-gray-700`)
- **Size**: Always `text-xs` with `px-2.5 py-1` padding
- **Icon**: 12px (`w-3 h-3`)
- **Position**: Top-left corner of card image, 12px from edges

---

## Card Types & Categories

### Experience Types

```typescript
const EXPERIENCE_TYPES = [
  'freestyle',           // Custom, flexible experiences
  'casual-eats',        // Casual dining
  'dining-experiences', // Fine dining
  'sip-chill',          // Bars, lounges
  'creative-picnics',   // Outdoor dining
  'play-move',          // Sports, activities
  'creative-hands-on',  // Workshops, classes
  'screen-relax',       // Movies, shows
  'take-a-stroll',      // Walking tours
  'wellness-dates',     // Spa, wellness
  'mingla-100'          // Curated top 100
];
```

### Categories

```typescript
const CATEGORIES = [
  // Food & Drink
  'Food & Drink',
  'Dining',
  'Nightlife',
  'Cafes & Coffee',
  
  // Activities
  'Activities',
  'Sports & Recreation',
  'Arts & Culture',
  'Workshops',
  'Classes',
  
  // Wellness
  'Wellness',
  'Spa & Relaxation',
  'Fitness',
  
  // Entertainment
  'Entertainment',
  'Shows & Events',
  'Movies',
  'Live Music',
  
  // Outdoors
  'Outdoors',
  'Nature',
  'Adventure',
  'Tours',
  
  // Shopping
  'Shopping',
  'Markets',
  'Retail'
];
```

### Price Categories

```typescript
const PRICE_CATEGORIES = {
  budget: { min: 0, max: 50, label: 'Budget Friendly' },
  moderate: { min: 50, max: 150, label: 'Moderate' },
  premium: { min: 150, max: 300, label: 'Premium' },
  luxury: { min: 300, max: Infinity, label: 'Luxury' }
};
```

---

## CRUD Operations

### Complete CRUD Implementation

```typescript
// Create Card
const handleCreateCard = async (cardData: Partial<ExperienceCard>) => {
  try {
    const newCard = createCard(cardData);
    
    // Notify user
    toast.success('Experience created successfully!');
    
    // Redirect or update UI
    return newCard;
  } catch (error) {
    toast.error('Failed to create experience');
    console.error(error);
  }
};

// Read Card
const handleReadCard = (cardId: string) => {
  try {
    const card = getCardById(cardId);
    
    if (!card) {
      toast.error('Experience not found');
      return null;
    }
    
    // Increment view count
    incrementCardViews(cardId);
    
    return card;
  } catch (error) {
    toast.error('Failed to load experience');
    console.error(error);
  }
};

// Update Card
const handleUpdateCard = async (cardId: string, updates: Partial<ExperienceCard>) => {
  try {
    const updatedCard = updateCard(cardId, updates);
    
    if (!updatedCard) {
      toast.error('Experience not found');
      return null;
    }
    
    toast.success('Experience updated successfully!');
    return updatedCard;
  } catch (error) {
    toast.error('Failed to update experience');
    console.error(error);
  }
};

// Delete Card
const handleDeleteCard = async (cardId: string) => {
  try {
    const success = deleteCard(cardId);
    
    if (!success) {
      toast.error('Experience not found');
      return false;
    }
    
    toast.success('Experience deleted successfully!');
    return true;
  } catch (error) {
    toast.error('Failed to delete experience');
    console.error(error);
    return false;
  }
};
```

---

## Card Component Examples

### 1. **Card List Page Component**

```tsx
import React, { useState, useEffect } from 'react';
import { ExperienceCardComponent } from './ExperienceCard';
import { Loader2 } from 'lucide-react';

export function ExperienceListPage() {
  const [cards, setCards] = useState<ExperienceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    category: '',
    minPrice: 0,
    maxPrice: 1000,
    location: ''
  });
  
  useEffect(() => {
    loadCards();
  }, [filters]);
  
  const loadCards = () => {
    setLoading(true);
    
    // Simulate API delay
    setTimeout(() => {
      const allCards = filterCards(filters);
      setCards(allCards);
      setLoading(false);
    }, 300);
  };
  
  const handleCardClick = (card: ExperienceCard) => {
    // Navigate to card detail page
    window.location.href = `#/experience/${card.id}`;
  };
  
  const handleLike = (cardId: string) => {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    const isNowLiked = toggleCardLike(cardId, currentUser.id);
    
    // Refresh cards to show updated like count
    loadCards();
  };
  
  const handleSave = (cardId: string) => {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    const userSaves = JSON.parse(localStorage.getItem('userSaves') || '{}');
    const savesList = userSaves[currentUser.id] || [];
    
    if (savesList.includes(cardId)) {
      userSaves[currentUser.id] = savesList.filter((id: string) => id !== cardId);
    } else {
      userSaves[currentUser.id] = [...savesList, cardId];
    }
    
    localStorage.setItem('userSaves', JSON.stringify(userSaves));
    loadCards();
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-[#eb7825] animate-spin" />
      </div>
    );
  }
  
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-[#111827] mb-6">Explore Experiences</h1>
      
      {cards.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[#6B7280]">No experiences found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {cards.map(card => (
            <ExperienceCardComponent
              key={card.id}
              card={card}
              onCardClick={handleCardClick}
              onLike={handleLike}
              onSave={handleSave}
              isLiked={getUserLikes(currentUser.id).includes(card.id)}
              isSaved={getUserSaves(currentUser.id).includes(card.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

### 2. **Card Detail Modal Component**

```tsx
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { CardCreatorBadge } from './CardCreatorBadge';
import { MapPin, Clock, Users, Star, Calendar } from 'lucide-react';

interface CardDetailModalProps {
  card: ExperienceCard | null;
  isOpen: boolean;
  onClose: () => void;
  onPurchase?: (card: ExperienceCard) => void;
}

export function CardDetailModal({ 
  card, 
  isOpen, 
  onClose, 
  onPurchase 
}: CardDetailModalProps) {
  if (!card) return null;
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">{card.title}</DialogTitle>
        </DialogHeader>
        
        {/* Cover Image */}
        <div className="relative aspect-video w-full rounded-lg overflow-hidden">
          <img
            src={card.coverImage}
            alt={card.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute top-4 left-4">
            <CardCreatorBadge
              creatorRole={card.createdByRole}
              businessName={card.businessName}
            />
          </div>
        </div>
        
        {/* Content */}
        <div className="space-y-6">
          {/* Header */}
          <div>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-[#111827] flex-1">{card.title}</h2>
              <Badge className="bg-[#eb7825] text-white">
                {card.pricing.displayRange}
              </Badge>
            </div>
            
            {/* Stats */}
            <div className="flex items-center gap-6 mt-4">
              <div className="flex items-center gap-1">
                <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                <span className="text-[#111827]">{card.rating.toFixed(1)}</span>
                <span className="text-[#6B7280] text-sm">
                  ({card.reviewCount} reviews)
                </span>
              </div>
              
              <div className="flex items-center gap-2 text-[#6B7280]">
                <MapPin className="w-4 h-4" />
                <span className="text-sm">
                  {card.location.city}, {card.location.country}
                </span>
              </div>
            </div>
          </div>
          
          {/* Description */}
          <div>
            <h3 className="text-[#111827] mb-2">About</h3>
            <p className="text-[#6B7280]">{card.description}</p>
          </div>
          
          {/* Packages */}
          {card.packages && card.packages.length > 0 && (
            <div>
              <h3 className="text-[#111827] mb-3">Packages</h3>
              <div className="space-y-3">
                {card.packages.map(pkg => (
                  <div
                    key={pkg.id}
                    className="border border-gray-200 rounded-lg p-4 hover:border-[#eb7825] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-[#111827]">{pkg.name}</h4>
                          {pkg.isPopular && (
                            <Badge className="bg-[#eb7825] text-white text-xs">
                              Popular
                            </Badge>
                          )}
                        </div>
                        <p className="text-[#6B7280] text-sm mb-3">
                          {pkg.description}
                        </p>
                        
                        <div className="flex items-center gap-4 text-sm text-[#6B7280]">
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            <span>{pkg.duration}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            <span>Up to {pkg.maxGroupSize}</span>
                          </div>
                        </div>
                        
                        {pkg.inclusions && pkg.inclusions.length > 0 && (
                          <div className="mt-3">
                            <p className="text-sm text-[#111827] mb-1">Includes:</p>
                            <ul className="text-sm text-[#6B7280] space-y-1">
                              {pkg.inclusions.map((item, idx) => (
                                <li key={idx}>• {item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                      
                      <div className="text-right">
                        <p className="text-2xl text-[#111827]">
                          {pkg.currency} {pkg.price}
                        </p>
                        <p className="text-sm text-[#6B7280]">per person</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Policies */}
          <div>
            <h3 className="text-[#111827] mb-3">Policies</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[#111827]">Cancellation Policy</p>
                <p className="text-[#6B7280]">{card.policies.cancellation}</p>
              </div>
              {card.policies.ageRestrictions && (
                <div>
                  <p className="text-[#111827]">Age Restrictions</p>
                  <p className="text-[#6B7280]">{card.policies.ageRestrictions}</p>
                </div>
              )}
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <Button
              onClick={() => onPurchase?.(card)}
              className="flex-1 bg-[#eb7825] hover:bg-[#d6691f] text-white"
            >
              <Calendar className="w-4 h-4 mr-2" />
              Book Experience
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Best Practices

### 1. **Always Use Unique IDs**

```typescript
// ✅ GOOD: Generate unique IDs
const id = `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// ❌ BAD: Reuse or hardcode IDs
const id = 'card-1';
```

### 2. **Handle Loading States**

```typescript
const [loading, setLoading] = useState(true);
const [cards, setCards] = useState<ExperienceCard[]>([]);

useEffect(() => {
  setLoading(true);
  const data = getAllCards();
  setCards(data);
  setLoading(false);
}, []);

if (loading) return <Loader />;
```

### 3. **Validate Data Before Saving**

```typescript
const validateCard = (card: Partial<ExperienceCard>): string[] => {
  const errors: string[] = [];
  
  if (!card.title || card.title.length < 5) {
    errors.push('Title must be at least 5 characters');
  }
  
  if (!card.description || card.description.length < 20) {
    errors.push('Description must be at least 20 characters');
  }
  
  if (!card.location) {
    errors.push('Location is required');
  }
  
  if (!card.packages || card.packages.length === 0) {
    errors.push('At least one package is required');
  }
  
  return errors;
};
```

### 4. **Use TypeScript Types**

```typescript
// Always type your functions
const createCard = (data: Partial<ExperienceCard>): ExperienceCard => {
  // Implementation
};

// Type component props
interface CardProps {
  card: ExperienceCard;
  onClick: (card: ExperienceCard) => void;
}
```

### 5. **Optimize Images**

```typescript
// Use ImageWithFallback for all card images
import { ImageWithFallback } from './figma/ImageWithFallback';

<ImageWithFallback
  src={card.coverImage}
  alt={card.title}
  className="w-full h-full object-cover"
/>
```

### 6. **Handle Errors Gracefully**

```typescript
try {
  const card = getCardById(cardId);
  // Process card
} catch (error) {
  console.error('Error loading card:', error);
  toast.error('Failed to load experience. Please try again.');
}
```

### 7. **Keep API Functions Centralized**

Create a dedicated API utility file:

```typescript
// /utils/cardAPI.ts
export const cardAPI = {
  getAll: getAllCards,
  getById: getCardById,
  create: createCard,
  update: updateCard,
  delete: deleteCard,
  filter: filterCards,
  incrementViews: incrementCardViews,
  toggleLike: toggleCardLike
};
```

### 8. **Use Consistent Naming**

```typescript
// ✅ GOOD: Consistent naming
const handleCardClick = () => {};
const handleCardLike = () => {};
const handleCardSave = () => {};

// ❌ BAD: Inconsistent naming
const cardClick = () => {};
const onLike = () => {};
const saveCard = () => {};
```

---

## Summary Checklist

When creating or working with experience cards:

- [ ] Use the complete `ExperienceCard` interface
- [ ] Generate unique IDs for new cards
- [ ] Always include `CardCreatorBadge` on card displays
- [ ] Follow the exact visual structure for consistency
- [ ] Use localStorage API helpers for all data operations
- [ ] Handle loading and error states
- [ ] Validate data before creating/updating
- [ ] Increment view counts when cards are opened
- [ ] Use TypeScript types throughout
- [ ] Test on all screen sizes (mobile, tablet, desktop)
- [ ] Ensure accessibility (alt text, keyboard navigation)
- [ ] Add proper error handling and user feedback

---

## Related Documentation

- See `CARD_CREATOR_BADGE_SYSTEM.md` for badge implementation details
- See `DATABASE_CARD_SCHEMA.md` for backend schema alignment
- See `UNIFIED_CARD_SYSTEM.md` for cross-platform card usage
- See `CARD_DATA_PREFERENCES_GUIDE.md` for recommendation engine integration

---

**Last Updated:** January 2025  
**Version:** 2.0  
**Maintainer:** Mingla Platform Team
