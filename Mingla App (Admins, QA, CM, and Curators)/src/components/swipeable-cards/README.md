# Swipeable Cards Components

## Overview

The Swipeable Cards module has been refactored from a monolithic **1,662-line** file into a clean, modular component structure with **79% reduction** in the main component size.

## Architecture

```
/components/swipeable-cards/
├── SwipeCard.tsx              # Individual card display
├── CardDetails.tsx            # Expanded card view
├── CardGallery.tsx            # Image gallery
├── CardActionButtons.tsx      # Like/discard buttons
├── SwipeIndicator.tsx         # Swipe overlay
├── PurchaseOptionsModal.tsx   # Purchase selection
├── EmptyState.tsx             # No cards state
├── types.ts                   # TypeScript interfaces
├── utils.ts                   # Utility functions
├── constants.ts               # Mock data & config
├── index.ts                   # Public exports
└── README.md                  # This file
```

## Components

### SwipeableCards (Main - 349 lines)
**Purpose:** Main orchestrator for card swiping experience

**Responsibilities:**
- Card state management
- Swipe gesture handling
- Card filtering & generation
- Purchase flow coordination
- Gallery navigation

**Key Features:**
- Tinder-style swipe interface
- Multi-source card aggregation
- Budget filtering
- Onboarding matching
- Auto-generation when low

---

### SwipeCard (179 lines)
**Purpose:** Display individual swipeable card

**Features:**
- Swipe gesture support
- Match score badge
- Creator badge display
- Image with gradient overlay
- Category icon
- Stats display (likes, reviews)
- Price range
- Touch/mouse event handling

**Card Sections:**
- **Image (65% height):** Hero image with overlay
- **Top badges:** Match score, creator type
- **Bottom overlay:** Title, distance, time, rating
- **Details (35% height):** Category, description, stats, price

---

### CardDetails (Large component)
**Purpose:** Expanded full-screen card view

**Features:**
- Full-screen modal
- Image gallery with navigation
- Complete card information
- Timeline display (multi-venue)
- Single venue timeline
- Weather information
- Traffic/busy level
- Match score breakdown
- Social stats
- Purchase options
- Action buttons (schedule, buy, share)
- Swipe support even when expanded

---

### CardGallery (Component)
**Purpose:** Image carousel with navigation

**Features:**
- Multiple image display
- Previous/next navigation
- Touch swipe support
- Image indicators
- Smooth transitions

---

### CardActionButtons (Component)
**Purpose:** Bottom action buttons

**Features:**
- Discard button (X icon)
- Like button (heart icon)
- Disabled state handling
- Animations on press

---

### SwipeIndicator (Component)
**Purpose:** Visual feedback during swipe

**Features:**
- "LIKE" overlay (right swipe)
- "PASS" overlay (left swipe)
- Animated appearance
- Rotated badge style

---

### PurchaseOptionsModal (175 lines)
**Purpose:** Purchase/booking options selector

**Features:**
- Multiple purchase tiers
- Popular badge
- Savings badge
- Includes list
- Duration display
- Price display
- Apple Pay integration
- Processing animation
- Selection indicator

---

### EmptyState (Component)
**Purpose:** Display when no cards available

**Features:**
- Friendly empty message
- Generate more button
- Icon display

---

## Data Flow

```
SwipeableCards
    ↓
[State: removedCards, generatedCards, expandedCard]
    ↓
Card Sources:
├─→ Curator Cards (live status)
├─→ Seed Experience Cards
└─→ Generated Cards (from preferences)
    ↓
Filtering Pipeline:
├─→ Onboarding Filters (intent, vibes)
├─→ Budget Filters (min/max)
└─→ Removed Cards Filter
    ↓
Current Batch (15 cards max)
    ↓
Display:
├─→ SwipeCard (top 2 cards)
├─→ CardActionButtons
└─→ CardDetails (if expanded)
    ↓
User Actions:
├─→ Swipe Right → Like → Add to board
├─→ Swipe Left → Discard → Remove
├─→ Tap Card → Expand → CardDetails
└─→ Buy Button → PurchaseOptionsModal
```

## Usage

```typescript
import SwipeableCards from './components/SwipeableCards';

function App() {
  return (
    <SwipeableCards
      userPreferences={{
        experienceTypes: ['firstDate', 'romantic'],
        categories: ['sipChill', 'casualEats'],
        budgetMin: 25,
        budgetMax: 75,
        location: 'San Francisco, CA'
      }}
      currentMode="solo"
      onCardLike={(card) => console.log('Liked:', card)}
      onAddToCalendar={(card) => console.log('Scheduled:', card)}
      onPurchaseComplete={(card, option) => console.log('Purchased:', option)}
      curatorCards={liveCuratorCards}
      removedCardIds={[]}
    />
  );
}
```

## Key Features

### 1. Swipe Gestures
- Touch and mouse support
- Smooth animations
- Visual feedback (LIKE/PASS)
- Threshold-based actions
- Velocity detection

### 2. Card Aggregation
- **Curator Cards:** Live cards from curators
- **Seed Cards:** Platform curated experiences
- **Generated Cards:** AI-generated based on preferences

### 3. Smart Filtering
- **Onboarding Match:** Intent and vibe alignment
- **Budget Filter:** Price range matching
- **Removed Cards:** Hide discarded/liked cards
- **Match Score:** Calculated relevance

### 4. Card Generation
- Auto-generate when low (< 3 cards)
- Preference-based generation
- Duplicate prevention
- Throttled generation (500ms)

### 5. Purchase Flow
- Multiple purchase options
- Popular/savings badges
- Apple Pay integration
- Secure payment UI
- Processing animation

### 6. Expanded View
- Full card details
- Image gallery
- Timeline (multi-venue)
- Weather & traffic
- Social stats
- Match breakdown
- Quick actions

## Swipe Mechanics

### Gesture Detection
```typescript
// Swipe threshold: 100px horizontal movement
const SWIPE_THRESHOLD = 100;

// Visual feedback at 40px
if (deltaX > 40) setSwipeDirection('right');
if (deltaX < -40) setSwipeDirection('left');

// Execute action at threshold
if (Math.abs(dragOffset.x) > SWIPE_THRESHOLD) {
  // Like (right) or Discard (left)
}
```

### Animation
- **Transform:** translateX + rotate
- **Opacity:** Fades during swipe
- **Scale:** Slight zoom out
- **Timing:** 350ms cubic-bezier
- **Next card:** Scale 0.95, translateY 8px

## Card Filtering Logic

### 1. Onboarding Filters
```typescript
if (onboardingData.intent) {
  // Match experience type to intent
  const targetTypes = INTENT_TYPE_MAP[intent.experienceType];
  if (targetTypes.includes(card.experienceType)) {
    matchScore += 10; // Boost score
  }
}

if (onboardingData.vibes) {
  // Match category/tags to vibes
  if (hasMatchingVibe) matchScore += 5;
}
```

### 2. Budget Filters
```typescript
const cardPrice = extractPriceFromRange(card.priceRange);
const withinBudget = cardPrice >= minBudget && cardPrice <= maxBudget;
```

### 3. Removed Cards
```typescript
const availableCards = allCards.filter(
  card => !removedCards.has(card.id)
);
```

## Benefits

- **79% smaller main file** (1,662 → 349 lines)
- **7 focused components**
- **Easy to test** each component independently
- **Reusable** components across the app
- **Maintainable** clear structure
- **Scalable** add features easily
- **Type-safe** comprehensive TypeScript

## Component Props

### SwipeCard Props
```typescript
{
  recommendation: Recommendation;
  isTopCard: boolean;
  dragOffset: { x: number; y: number };
  isDragging: boolean;
  swipeDirection: 'left' | 'right' | null;
  onTouchStart/Move/End: handlers;
  onMouseDown/Move/Up/Leave: handlers;
  onCardClick?: () => void;
}
```

### CardDetails Props
```typescript
{
  recommendation: Recommendation;
  galleryIndex: number;
  onClose: () => void;
  onNavigateGallery: (direction) => void;
  onSchedule/onBuyNow/onShare: handlers;
  swipeDirection: 'left' | 'right' | null;
  // Plus all swipe handlers
}
```

### PurchaseOptionsModal Props
```typescript
{
  recommendation: Recommendation;
  onClose: () => void;
  onPurchaseComplete: (option) => void;
}
```

## Customization

### Adding Card Sources
```typescript
// In SwipeableCards.tsx
const allRecommendations = useMemo(() => {
  return [
    ...curatorCards,
    ...seedCards,
    ...generatedCards,
    ...yourCustomCards  // Add here
  ];
}, [dependencies]);
```

### Modifying Swipe Threshold
```typescript
// In constants.ts
export const SWIPE_THRESHOLD = 100; // pixels
export const SWIPE_VELOCITY_THRESHOLD = 0.5;
```

### Adding Filter Logic
```typescript
// In SwipeableCards.tsx filtering section
const customFilteredCards = useMemo(() => {
  return cards.filter(card => {
    // Your custom filter logic
  });
}, [dependencies]);
```

## Testing Recommendations

### Unit Tests
```typescript
// SwipeCard.test.tsx
test('displays match score', () => {
  render(<SwipeCard recommendation={mockCard} isTopCard={true} />);
  expect(screen.getByText(/92% Match/i)).toBeInTheDocument();
});

// CardActionButtons.test.tsx
test('calls onLike when like button clicked', () => {
  const onLike = jest.fn();
  render(<CardActionButtons onLike={onLike} onDiscard={jest.fn()} />);
  fireEvent.click(screen.getByLabelText(/like/i));
  expect(onLike).toHaveBeenCalled();
});

// PurchaseOptionsModal.test.tsx
test('shows purchase options', () => {
  render(<PurchaseOptionsModal recommendation={mockCard} />);
  expect(screen.getByText(/Choose Your Experience/i)).toBeInTheDocument();
});
```

### Integration Tests
```typescript
test('swipe right adds card to likes', async () => {
  const onLike = jest.fn();
  render(<SwipeableCards onCardLike={onLike} />);
  
  // Simulate swipe right
  fireEvent.mouseDown(screen.getByRole('article'));
  fireEvent.mouseMove(screen.getByRole('article'), { clientX: 200 });
  fireEvent.mouseUp(screen.getByRole('article'));
  
  await waitFor(() => {
    expect(onLike).toHaveBeenCalled();
  });
});
```

## Performance Optimizations

1. **useMemo:** Card filtering memoized
2. **Batch limiting:** Max 15 cards rendered
3. **Lazy generation:** Only generate when needed
4. **Throttling:** Max 1 card per 500ms
5. **Event cleanup:** Proper useEffect cleanup

## Future Enhancements

### Phase 1 (Short-term)
- [ ] Super like gesture (swipe up)
- [ ] Undo last swipe
- [ ] Card animation presets
- [ ] Keyboard shortcuts
- [ ] Accessibility improvements

### Phase 2 (Medium-term)
- [ ] Video card support
- [ ] 3D card flip
- [ ] Card bookmarks
- [ ] Share to social media
- [ ] Advanced filters UI

### Phase 3 (Long-term)
- [ ] AR preview mode
- [ ] Real-time availability
- [ ] Group voting on cards
- [ ] ML-based recommendations
- [ ] A/B test different layouts

## Dependencies

- React 18+
- Motion/React (animations)
- Lucide React (icons)
- ImageWithFallback component

## Related Documentation

- [Activity Refactoring](../activity/REFACTORING_COMPLETE.md)
- [Messages Refactoring](../messages/REFACTORING_COMPLETE.md)
- [Onboarding Refactoring](../onboarding/REFACTORING_COMPLETE.md)
- [Collaboration Refactoring](../collaboration/REFACTORING_COMPLETE.md)
- [Card Generator](../utils/cardGenerator.ts)
- [Preferences System](../utils/preferences.ts)
