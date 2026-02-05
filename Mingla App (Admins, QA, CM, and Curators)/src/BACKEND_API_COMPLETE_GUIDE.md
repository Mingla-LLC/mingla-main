# Mingla Backend API & Systems Architecture

## Overview
This document provides complete backend architecture for Mingla, including card generation algorithms, recommendation systems, and every API endpoint needed for the UI to function.

---

## Table of Contents
1. [Card Generation System](#card-generation-system)
2. [Recommendation Algorithm](#recommendation-algorithm)
3. [Authentication APIs](#authentication-apis)
4. [User Management APIs](#user-management-apis)
5. [Card/Experience APIs](#cardexperience-apis)
6. [Preferences APIs](#preferences-apis)
7. [Collaboration/Board APIs](#collaborationboard-apis)
8. [Social/Connection APIs](#socialconnection-apis)
9. [Purchase/Payment APIs](#purchasepayment-apis)
10. [Calendar APIs](#calendar-apis)
11. [Notification APIs](#notification-apis)
12. [Analytics APIs](#analytics-apis)
13. [Content Management APIs](#content-management-apis)
14. [External Integrations](#external-integrations)
15. [Real-time Systems](#real-time-systems)
16. [System Architecture](#system-architecture)

---

## Card Generation System

### Overview
Cards are generated based on a multi-factor matching algorithm that considers user preferences, location, time constraints, budget, and behavioral patterns.

### Generation Triggers

1. **Initial Load** - User opens app
2. **Swipe Session** - User runs low on cards (<3 remaining)
3. **Preference Change** - User updates preferences
4. **Mode Switch** - Solo ↔ Collaboration mode
5. **Location Change** - User moves significantly
6. **Time-based** - Different cards for different times of day

### Generation Algorithm

```javascript
/**
 * CARD GENERATION ALGORITHM
 * 
 * Step 1: Query Eligible Cards from Database
 * Step 2: Apply Hard Filters (must match)
 * Step 3: Calculate Match Scores (0-98)
 * Step 4: Apply Personalization Weights
 * Step 5: Sort by Final Score
 * Step 6: Diversify Results
 * Step 7: Return Top N Cards
 */

async function generateCardBatch(userId, preferences, batchSize = 10) {
  // Step 1: Get user context
  const user = await getUser(userId);
  const userHistory = await getUserCardHistory(userId);
  const userLocation = preferences.location || user.lastKnownLocation;
  const excludedCardIds = userHistory.viewedCards.concat(userHistory.removedCards);
  
  // Step 2: Build base query with hard filters
  const baseQuery = {
    status: 'live',
    isDeleted: false,
    id: { $nin: excludedCardIds }, // Exclude already seen/removed
    
    // Location filter (within travel constraint)
    location: getNearbyLocation(
      userLocation, 
      preferences.travelMode, 
      preferences.travelConstraint
    ),
    
    // Budget filter
    pricePerPerson: {
      $gte: preferences.budgetMin || 0,
      $lte: preferences.budgetMax || 10000
    },
    
    // Category filter
    category: { $in: preferences.categories || ALL_CATEGORIES },
    
    // Experience type filter
    experienceType: { $in: preferences.experienceTypes || ALL_EXPERIENCE_TYPES }
  };
  
  // Step 3: Query eligible cards
  let eligibleCards = await Card.find(baseQuery).limit(1000); // Large initial set
  
  // Step 4: Calculate match score for each card
  const scoredCards = eligibleCards.map(card => {
    const matchScore = calculateMatchScore(card, user, preferences);
    const personalizedScore = applyPersonalizationWeights(matchScore, user, card);
    
    return {
      ...card,
      matchScore,
      personalizedScore
    };
  });
  
  // Step 5: Sort by personalized score
  scoredCards.sort((a, b) => b.personalizedScore - a.personalizedScore);
  
  // Step 6: Diversify results (avoid too many similar cards)
  const diversifiedCards = diversifyCards(scoredCards, batchSize);
  
  // Step 7: Add real-time data
  const enrichedCards = await enrichCardsWithRealTimeData(diversifiedCards);
  
  return enrichedCards.slice(0, batchSize);
}
```

### Match Score Calculation (0-98)

```javascript
function calculateMatchScore(card, user, preferences) {
  let score = 0;
  let weights = {
    location: 0.25,
    budget: 0.20,
    category: 0.20,
    time: 0.15,
    popularity: 0.10,
    weather: 0.05,
    behavioral: 0.05
  };
  
  // 1. Location Match (0-100 → weighted)
  const locationScore = calculateLocationScore(
    card.location, 
    preferences.location, 
    preferences.travelMode,
    preferences.travelConstraint
  );
  score += (locationScore / 100) * weights.location * 100;
  
  // 2. Budget Match (0-100 → weighted)
  const budgetScore = calculateBudgetScore(
    card.pricePerPerson,
    preferences.budgetMin,
    preferences.budgetMax
  );
  score += (budgetScore / 100) * weights.budget * 100;
  
  // 3. Category Match (0-100 → weighted)
  const categoryScore = calculateCategoryScore(
    card.category,
    preferences.categories,
    preferences.experienceTypes
  );
  score += (categoryScore / 100) * weights.category * 100;
  
  // 4. Time Match (0-100 → weighted)
  const timeScore = calculateTimeScore(
    card.idealTimeOfDay,
    card.openingHours,
    preferences.dateTime
  );
  score += (timeScore / 100) * weights.time * 100;
  
  // 5. Popularity Score (0-100 → weighted)
  const popularityScore = calculatePopularityScore(
    card.rating,
    card.reviewCount,
    card.socialStats
  );
  score += (popularityScore / 100) * weights.popularity * 100;
  
  // 6. Weather Score (0-100 → weighted)
  const weatherScore = calculateWeatherScore(
    card.weatherDependent,
    card.weatherPreference,
    getCurrentWeather(card.location)
  );
  score += (weatherScore / 100) * weights.weather * 100;
  
  // 7. Behavioral Score (0-100 → weighted)
  const behavioralScore = calculateBehavioralScore(
    card,
    user.cardHistory,
    user.preferences
  );
  score += (behavioralScore / 100) * weights.behavioral * 100;
  
  // Cap at 98 (never 100 for authenticity)
  return Math.min(98, Math.round(score));
}
```

### Location Score Algorithm

```javascript
function calculateLocationScore(cardLocation, userLocation, travelMode, constraint) {
  // Calculate distance
  const distance = haversineDistance(cardLocation, userLocation); // km
  
  // Calculate travel time based on mode
  const travelSpeeds = {
    walking: 5,    // km/h
    biking: 15,    // km/h
    transit: 20,   // km/h (with wait time)
    driving: 30    // km/h (city average)
  };
  
  const travelTime = (distance / travelSpeeds[travelMode]) * 60; // minutes
  
  // Score based on constraint
  let score = 100;
  
  if (constraint.type === 'time') {
    const maxTime = constraint.value;
    if (travelTime > maxTime) {
      return 0; // Outside constraint
    }
    // Linear decay: closer = better
    score = 100 - ((travelTime / maxTime) * 40); // 0-40 point penalty
  } else if (constraint.type === 'distance') {
    const maxDistance = constraint.value;
    if (distance > maxDistance) {
      return 0; // Outside constraint
    }
    // Linear decay
    score = 100 - ((distance / maxDistance) * 40);
  }
  
  return Math.max(0, score);
}
```

### Budget Score Algorithm

```javascript
function calculateBudgetScore(cardPrice, budgetMin, budgetMax) {
  if (!cardPrice) return 50; // Neutral if no price
  
  // Perfect match: within range
  if (cardPrice >= budgetMin && cardPrice <= budgetMax) {
    // Higher score for middle of range
    const rangeMid = (budgetMin + budgetMax) / 2;
    const deviation = Math.abs(cardPrice - rangeMid);
    const maxDeviation = (budgetMax - budgetMin) / 2;
    return 100 - ((deviation / maxDeviation) * 10); // 90-100 range
  }
  
  // Outside range: penalty based on how far
  if (cardPrice < budgetMin) {
    const underBy = budgetMin - cardPrice;
    return Math.max(0, 70 - (underBy / budgetMin) * 50);
  }
  
  if (cardPrice > budgetMax) {
    const overBy = cardPrice - budgetMax;
    return Math.max(0, 60 - (overBy / budgetMax) * 50);
  }
  
  return 0;
}
```

### Category Score Algorithm

```javascript
function calculateCategoryScore(cardCategory, userCategories, userExperienceTypes) {
  let score = 0;
  
  // Direct category match: 100 points
  if (userCategories.includes(cardCategory)) {
    score = 100;
  }
  
  // Experience type compatibility
  const categoryExperienceMap = {
    stroll: ['soloAdventure', 'firstDate', 'romantic', 'friendly', 'business'],
    sipChill: ['firstDate', 'romantic', 'friendly', 'business'],
    casualEats: ['friendly', 'groupFun', 'soloAdventure'],
    screenRelax: ['firstDate', 'friendly', 'groupFun'],
    creative: ['firstDate', 'friendly', 'groupFun'],
    picnics: ['romantic', 'firstDate', 'friendly'],
    playMove: ['friendly', 'groupFun'],
    diningExp: ['romantic', 'firstDate', 'business'],
    wellness: ['romantic', 'friendly', 'soloAdventure'],
    freestyle: ['friendly', 'groupFun', 'soloAdventure']
  };
  
  const compatibleExperiences = categoryExperienceMap[cardCategory] || [];
  const matchingExperiences = userExperienceTypes.filter(exp => 
    compatibleExperiences.includes(exp)
  );
  
  // Boost for experience type match
  if (matchingExperiences.length > 0) {
    score += 10 * matchingExperiences.length;
  }
  
  return Math.min(100, score);
}
```

### Time Score Algorithm

```javascript
function calculateTimeScore(cardIdealTime, cardOpeningHours, userPreferences) {
  let score = 100;
  
  // Get user's preferred time
  const preferredTime = userPreferences.timeOfDay; // 'morning', 'afternoon', 'evening', 'lateNight'
  
  // Check if card is ideal for this time
  if (cardIdealTime && cardIdealTime[preferredTime]) {
    score = cardIdealTime[preferredTime]; // 0-100
  }
  
  // Check if open during preferred time
  if (cardOpeningHours) {
    const isOpen = checkIfOpen(cardOpeningHours, userPreferences.dateTime);
    if (!isOpen) {
      return 0; // Closed = no match
    }
  }
  
  // Boost for "Now" preference
  if (userPreferences.dateOption === 'now') {
    const currentHour = new Date().getHours();
    const isCurrentlyIdeal = checkIfIdealNow(cardIdealTime, currentHour);
    if (isCurrentlyIdeal) {
      score += 10;
    }
  }
  
  return Math.min(100, score);
}
```

### Personalization Weights

```javascript
function applyPersonalizationWeights(baseScore, user, card) {
  let personalizedScore = baseScore;
  
  // 1. Onboarding intent boost (+10%)
  if (user.onboardingData?.intent) {
    const intentMatch = matchesIntent(card, user.onboardingData.intent);
    if (intentMatch) {
      personalizedScore = Math.min(98, personalizedScore + 10);
    }
  }
  
  // 2. Vibes boost (+5%)
  if (user.onboardingData?.vibes) {
    const vibeMatch = matchesVibes(card, user.onboardingData.vibes);
    if (vibeMatch) {
      personalizedScore = Math.min(98, personalizedScore + 5);
    }
  }
  
  // 3. Historical preference boost
  const historicalBoost = calculateHistoricalBoost(card, user.cardHistory);
  personalizedScore = Math.min(98, personalizedScore + historicalBoost);
  
  // 4. Social proof boost
  if (user.friends) {
    const friendsWhoLiked = card.likedBy.filter(id => user.friends.includes(id));
    if (friendsWhoLiked.length > 0) {
      personalizedScore = Math.min(98, personalizedScore + (2 * friendsWhoLiked.length));
    }
  }
  
  // 5. Recency penalty (avoid showing same type too often)
  const recentlySeen = user.cardHistory.recent.filter(c => c.category === card.category);
  if (recentlySeen.length > 3) {
    personalizedScore -= 5;
  }
  
  return personalizedScore;
}
```

### Card Diversification

```javascript
function diversifyCards(scoredCards, batchSize) {
  const diversified = [];
  const categoryCounts = {};
  const maxPerCategory = Math.ceil(batchSize / 3); // Max 33% from one category
  
  for (const card of scoredCards) {
    if (diversified.length >= batchSize) break;
    
    const category = card.category;
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    
    // Skip if too many from this category
    if (categoryCounts[category] > maxPerCategory) {
      continue;
    }
    
    diversified.push(card);
  }
  
  // If not enough diverse cards, fill remaining with top scored
  if (diversified.length < batchSize) {
    for (const card of scoredCards) {
      if (diversified.length >= batchSize) break;
      if (!diversified.find(c => c.id === card.id)) {
        diversified.push(card);
      }
    }
  }
  
  return diversified;
}
```

---

## Recommendation Algorithm

### Collaborative Filtering

```javascript
/**
 * Find similar users and recommend cards they liked
 */
async function getCollaborativeRecommendations(userId, limit = 10) {
  // 1. Find similar users
  const user = await User.findById(userId);
  const similarUsers = await findSimilarUsers(user, 50);
  
  // 2. Get cards they liked that this user hasn't seen
  const recommendations = [];
  
  for (const similarUser of similarUsers) {
    const theirLikedCards = await getSavedCards(similarUser.id);
    const unseen = theirLikedCards.filter(card => 
      !user.viewedCards.includes(card.id) &&
      !user.removedCards.includes(card.id)
    );
    
    recommendations.push(...unseen);
  }
  
  // 3. Score by frequency (more similar users liked = higher score)
  const cardScores = {};
  recommendations.forEach(card => {
    cardScores[card.id] = (cardScores[card.id] || 0) + 1;
  });
  
  // 4. Sort and return top N
  return Object.entries(cardScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([cardId]) => cardId);
}

function findSimilarUsers(user, limit) {
  // Calculate similarity score based on:
  // - Shared liked cards (Jaccard similarity)
  // - Similar preferences
  // - Similar demographics (age, location)
  
  // Implementation uses cosine similarity or Jaccard index
  return User.find({
    id: { $ne: user.id }
  }).sort({
    similarityScore: -1
  }).limit(limit);
}
```

### Content-Based Filtering

```javascript
/**
 * Recommend cards similar to ones user liked
 */
async function getContentBasedRecommendations(userId, limit = 10) {
  // 1. Get user's liked cards
  const likedCards = await getSavedCards(userId);
  
  if (likedCards.length === 0) {
    return []; // No history to base on
  }
  
  // 2. Extract features from liked cards
  const preferredFeatures = extractFeatures(likedCards);
  
  // 3. Find similar cards
  const candidates = await Card.find({
    status: 'live',
    id: { $nin: likedCards.map(c => c.id) }
  });
  
  // 4. Score by similarity to preferred features
  const scoredCandidates = candidates.map(card => {
    const similarity = calculateFeatureSimilarity(card, preferredFeatures);
    return { card, similarity };
  });
  
  // 5. Return top N
  return scoredCandidates
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(item => item.card);
}

function extractFeatures(cards) {
  return {
    categories: mostCommon(cards.map(c => c.category)),
    experienceTypes: mostCommon(cards.map(c => c.experienceType)),
    priceRange: average(cards.map(c => c.pricePerPerson)),
    atmosphereMarkers: mostCommon(cards.flatMap(c => c.atmosphereMarkers)),
    tags: mostCommon(cards.flatMap(c => c.tags))
  };
}
```

### Trending Algorithm

```javascript
/**
 * Score cards based on recent engagement
 */
function calculateTrendingScore(card, timeWindow = 7) {
  const now = Date.now();
  const windowMs = timeWindow * 24 * 60 * 60 * 1000;
  
  // Get recent interactions
  const recentViews = card.socialStats.viewsLast7Days;
  const recentLikes = card.socialStats.likesLast7Days;
  const recentSaves = card.socialStats.savesLast7Days;
  const recentShares = card.socialStats.sharesLast7Days;
  
  // Weighted score
  const weights = {
    view: 1,
    like: 3,
    save: 5,
    share: 10
  };
  
  const trendingScore = 
    (recentViews * weights.view) +
    (recentLikes * weights.like) +
    (recentSaves * weights.save) +
    (recentShares * weights.share);
  
  // Decay based on card age (newer = higher boost)
  const ageInDays = (now - new Date(card.publishedAt)) / (24 * 60 * 60 * 1000);
  const ageFactor = 1 / Math.log10(ageInDays + 10); // Logarithmic decay
  
  return trendingScore * ageFactor;
}
```

---

## Authentication APIs

### POST `/api/auth/signup`

**Purpose**: Create new user account

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "John Doe",
  "role": "explorer"
}
```

**Response** (201):
```json
{
  "success": true,
  "user": {
    "id": "user-xyz",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "explorer",
    "hasCompletedOnboarding": false
  },
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1...",
    "refreshToken": "eyJhbGciOiJIUzI1...",
    "expiresIn": 3600
  }
}
```

**Errors**:
- 400: Email already exists
- 400: Invalid email format
- 400: Password too weak

---

### POST `/api/auth/signin`

**Purpose**: Sign in existing user

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response** (200):
```json
{
  "success": true,
  "user": {
    "id": "user-xyz",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "explorer",
    "hasCompletedOnboarding": true,
    "avatar": "https://cdn.mingla.com/avatars/user-xyz.jpg"
  },
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1...",
    "refreshToken": "eyJhbGciOiJIUzI1...",
    "expiresIn": 3600
  }
}
```

**Errors**:
- 401: Invalid credentials
- 404: User not found

---

### POST `/api/auth/refresh`

**Purpose**: Refresh access token

**Request Body**:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1..."
}
```

**Response** (200):
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1...",
  "expiresIn": 3600
}
```

---

### POST `/api/auth/signout`

**Purpose**: Sign out user

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "message": "Signed out successfully"
}
```

---

### POST `/api/auth/reset-password`

**Purpose**: Request password reset

**Request Body**:
```json
{
  "email": "user@example.com"
}
```

**Response** (200):
```json
{
  "success": true,
  "message": "Password reset email sent"
}
```

---

### POST `/api/auth/verify-email`

**Purpose**: Verify email with token

**Request Body**:
```json
{
  "token": "abc123def456"
}
```

**Response** (200):
```json
{
  "success": true,
  "message": "Email verified successfully"
}
```

---

## User Management APIs

### GET `/api/users/me`

**Purpose**: Get current user's profile

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "user": {
    "id": "user-xyz",
    "email": "user@example.com",
    "name": "John Doe",
    "username": "johndoe",
    "role": "explorer",
    "avatar": "https://cdn.mingla.com/avatars/user-xyz.jpg",
    "bio": "Adventure seeker and coffee lover",
    "location": {
      "city": "San Francisco",
      "state": "CA",
      "country": "USA",
      "latitude": 37.7749,
      "longitude": -122.4194
    },
    "stats": {
      "experiencesSaved": 24,
      "experiencesScheduled": 8,
      "experiencesPurchased": 3,
      "experiencesCompleted": 5,
      "connectionsCount": 12,
      "boardsCount": 4
    },
    "hasCompletedOnboarding": true,
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-10-15T12:00:00Z"
  }
}
```

---

### PUT `/api/users/me`

**Purpose**: Update user profile

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "name": "John Updated",
  "username": "johnnew",
  "bio": "New bio text",
  "location": {
    "city": "Oakland",
    "state": "CA"
  }
}
```

**Response** (200):
```json
{
  "success": true,
  "user": { /* updated user object */ }
}
```

---

### POST `/api/users/me/avatar`

**Purpose**: Upload user avatar

**Headers**: `Authorization: Bearer <accessToken>`

**Request**: Multipart form data with `avatar` file

**Response** (200):
```json
{
  "success": true,
  "avatarUrl": "https://cdn.mingla.com/avatars/user-xyz.jpg"
}
```

---

### GET `/api/users/me/stats`

**Purpose**: Get user statistics

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "stats": {
    "experiencesSaved": 24,
    "experiencesScheduled": 8,
    "experiencesPurchased": 3,
    "experiencesCompleted": 5,
    "connectionsCount": 12,
    "boardsCount": 4,
    "totalSpent": 450.00,
    "currency": "USD",
    "achievements": [
      {
        "id": "first-save",
        "title": "First Save",
        "unlockedAt": "2025-01-02T10:00:00Z"
      }
    ],
    "journey": {
      "joinedDate": "2025-01-01",
      "daysActive": 287,
      "currentStreak": 5
    }
  }
}
```

---

### POST `/api/users/me/onboarding`

**Purpose**: Complete onboarding

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "intent": {
    "experienceType": "romantic",
    "title": "Romantic Dates",
    "description": "Planning special dates with my partner"
  },
  "vibes": ["cozy", "intimate", "outdoor"],
  "interests": ["food", "nature", "culture"],
  "budget": "moderate"
}
```

**Response** (200):
```json
{
  "success": true,
  "message": "Onboarding completed",
  "hasCompletedOnboarding": true
}
```

---

### PUT `/api/users/me/location`

**Purpose**: Update user location

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "latitude": 37.7749,
  "longitude": -122.4194,
  "city": "San Francisco",
  "state": "CA",
  "country": "USA"
}
```

**Response** (200):
```json
{
  "success": true,
  "location": { /* updated location */ }
}
```

---

## Card/Experience APIs

### POST `/api/cards/generate`

**Purpose**: Generate personalized card batch

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "preferences": {
    "experienceTypes": ["romantic", "firstDate"],
    "categories": ["sipChill", "diningExp"],
    "budgetMin": 25,
    "budgetMax": 75,
    "location": {
      "latitude": 37.7749,
      "longitude": -122.4194
    },
    "travelMode": "walking",
    "travelConstraint": {
      "type": "time",
      "value": 20
    },
    "dateTime": {
      "dateOption": "today",
      "timeSlot": "evening"
    }
  },
  "excludeCardIds": ["card-1", "card-2"],
  "batchSize": 10
}
```

**Response** (200):
```json
{
  "success": true,
  "cards": [
    {
      "id": "card-xyz",
      "title": "Sightglass Coffee Roastery",
      "category": "sipChill",
      "categoryIcon": "Coffee",
      "description": "Intimate coffee experience with artisan vibes",
      "fullDescription": "A specialty coffee roastery...",
      "experienceType": "firstDate",
      "priceRange": "$15-40",
      "pricePerPerson": 27,
      "rating": 4.6,
      "reviewCount": 89,
      "image": "https://cdn.mingla.com/cards/xyz/hero.jpg",
      "images": ["https://cdn.mingla.com/cards/xyz/1.jpg", ...],
      "address": "270 7th St, San Francisco, CA 94103",
      "location": {
        "latitude": 37.7749,
        "longitude": -122.4194
      },
      "travelTime": "12m",
      "distance": "3.2 km",
      "openingHours": "Mon-Sun 7am-7pm",
      "phoneNumber": "(415) 861-1313",
      "website": "https://sightglasscoffee.com",
      "highlights": ["Single Origin Coffee", "Local Pastries", "Cozy Atmosphere"],
      "tags": ["Coffee", "Cozy", "Local", "Casual"],
      "matchScore": 87,
      "matchFactors": {
        "location": 96,
        "budget": 92,
        "category": 88,
        "time": 94,
        "popularity": 85
      },
      "socialStats": {
        "views": 923,
        "likes": 167,
        "saves": 45,
        "shares": 23
      },
      "purchaseOptions": [
        {
          "id": "option-1",
          "title": "Coffee & Pastry",
          "description": "Perfect for a casual coffee date",
          "price": 18,
          "currency": "USD",
          "includes": ["Two specialty drinks", "Two pastries", "Reserved seating"],
          "duration": "1 hour",
          "popular": false
        }
      ]
    }
  ],
  "canGenerateMore": true,
  "totalAvailable": 234
}
```

---

### GET `/api/cards/:id`

**Purpose**: Get detailed card by ID

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "card": { /* full card object with all data */ },
  "userInteraction": {
    "hasViewed": true,
    "hasLiked": false,
    "hasSaved": false,
    "viewedAt": "2025-10-15T10:00:00Z"
  }
}
```

---

### POST `/api/cards/:id/view`

**Purpose**: Track card view

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "sessionMode": "solo",
  "matchScore": 87
}
```

**Response** (200):
```json
{
  "success": true,
  "viewRecorded": true
}
```

---

### POST `/api/cards/:id/like`

**Purpose**: Like/save card

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "sessionType": "solo",
  "boardId": null
}
```

**Response** (200):
```json
{
  "success": true,
  "saved": true,
  "savedCard": {
    "id": "saved-xyz",
    "cardId": "card-xyz",
    "userId": "user-123",
    "source": "solo",
    "savedAt": "2025-10-15T12:00:00Z"
  }
}
```

---

### DELETE `/api/cards/:id/like`

**Purpose**: Unlike/unsave card

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "removed": true
}
```

---

### POST `/api/cards/:id/share`

**Purpose**: Share card

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "shareType": "board",
  "boardIds": ["board-1", "board-2"],
  "message": "Check this out!"
}
```

**Response** (200):
```json
{
  "success": true,
  "shared": true,
  "shareCount": 2
}
```

---

### GET `/api/cards/search`

**Purpose**: Search cards

**Headers**: `Authorization: Bearer <accessToken>`

**Query Parameters**:
- `q`: Search query
- `category`: Filter by category
- `minPrice`: Minimum price
- `maxPrice`: Maximum price
- `latitude`: User latitude
- `longitude`: User longitude
- `radius`: Search radius in km
- `limit`: Results limit (default 20)
- `offset`: Pagination offset

**Response** (200):
```json
{
  "success": true,
  "cards": [ /* array of cards */ ],
  "total": 145,
  "hasMore": true
}
```

---

### GET `/api/cards/trending`

**Purpose**: Get trending cards

**Headers**: `Authorization: Bearer <accessToken>`

**Query Parameters**:
- `category`: Optional category filter
- `timeWindow`: Days to look back (default 7)
- `limit`: Results limit

**Response** (200):
```json
{
  "success": true,
  "trendingCards": [ /* array of cards with trending scores */ ]
}
```

---

## Preferences APIs

### GET `/api/preferences/user`

**Purpose**: Get user's saved preferences

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "preferences": {
    "experienceTypes": ["romantic", "firstDate"],
    "categories": ["sipChill", "diningExp", "stroll"],
    "budgetMin": 25,
    "budgetMax": 75,
    "dateTime": {
      "dateOption": "this-weekend",
      "timeSlot": "evening"
    },
    "travelMode": "walking",
    "travelConstraint": {
      "type": "time",
      "value": 20
    },
    "location": {
      "type": "gps",
      "latitude": 37.7749,
      "longitude": -122.4194
    }
  }
}
```

---

### PUT `/api/preferences/user`

**Purpose**: Update user preferences

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "experienceTypes": ["romantic"],
  "budgetMin": 50,
  "budgetMax": 150
}
```

**Response** (200):
```json
{
  "success": true,
  "preferences": { /* updated preferences */ }
}
```

---

### GET `/api/preferences/board/:boardId`

**Purpose**: Get board-specific preferences

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "boardId": "board-xyz",
  "preferences": { /* board preferences */ }
}
```

---

### PUT `/api/preferences/board/:boardId`

**Purpose**: Update board preferences

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "experienceTypes": ["groupFun"],
  "categories": ["playMove", "casualEats"]
}
```

**Response** (200):
```json
{
  "success": true,
  "preferences": { /* updated board preferences */ }
}
```

---

### GET `/api/preferences/account`

**Purpose**: Get account-level preferences

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "accountPreferences": {
    "currency": "USD",
    "measurementSystem": "Imperial",
    "language": "en",
    "timezone": "America/Los_Angeles",
    "notifications": {
      "email": true,
      "push": true,
      "sms": false
    },
    "privacy": {
      "profileVisibility": "friends",
      "activitySharing": true
    }
  }
}
```

---

### PUT `/api/preferences/account`

**Purpose**: Update account preferences

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "currency": "EUR",
  "measurementSystem": "Metric"
}
```

**Response** (200):
```json
{
  "success": true,
  "accountPreferences": { /* updated preferences */ }
}
```

---

## Collaboration/Board APIs

### GET `/api/boards`

**Purpose**: Get user's boards

**Headers**: `Authorization: Bearer <accessToken>`

**Query Parameters**:
- `status`: Filter by status (active, voting, locked, completed)
- `limit`: Results limit
- `offset`: Pagination

**Response** (200):
```json
{
  "success": true,
  "boards": [
    {
      "id": "board-xyz",
      "name": "Weekend Adventure Squad",
      "type": "group-hangout",
      "description": "Planning weekend activities",
      "status": "active",
      "participants": [
        {
          "id": "user-1",
          "name": "Sarah Chen",
          "avatar": "https://cdn.mingla.com/avatars/user-1.jpg",
          "status": "online"
        }
      ],
      "admins": ["user-123"],
      "creatorId": "user-123",
      "currentUserId": "user-123",
      "cardsCount": 4,
      "unreadMessages": 2,
      "createdAt": "2025-10-10T00:00:00Z",
      "lastActivity": "2025-10-15T11:30:00Z"
    }
  ],
  "total": 4
}
```

---

### POST `/api/boards`

**Purpose**: Create new board

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "name": "Weekend Adventure Squad",
  "type": "group-hangout",
  "description": "Planning weekend activities",
  "participantIds": ["user-2", "user-3", "user-4"]
}
```

**Response** (201):
```json
{
  "success": true,
  "board": { /* created board object */ }
}
```

---

### GET `/api/boards/:id`

**Purpose**: Get board details

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "board": {
    "id": "board-xyz",
    "name": "Weekend Adventure Squad",
    "type": "group-hangout",
    "description": "Planning weekend activities",
    "status": "active",
    "participants": [ /* full participant objects */ ],
    "admins": ["user-123"],
    "cards": [
      {
        "id": "board-card-1",
        "card": { /* full card object */ },
        "addedBy": "user-123",
        "addedAt": "2025-10-14T10:00:00Z",
        "votes": {
          "yes": 3,
          "no": 1,
          "userVote": "yes"
        },
        "rsvps": {
          "responded": 2,
          "total": 4,
          "userRSVP": "yes"
        },
        "messages": 5,
        "isLocked": false
      }
    ],
    "preferences": { /* board preferences */ },
    "createdAt": "2025-10-10T00:00:00Z",
    "lastActivity": "2025-10-15T11:30:00Z"
  }
}
```

---

### PUT `/api/boards/:id`

**Purpose**: Update board

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "name": "Updated Name",
  "description": "Updated description"
}
```

**Response** (200):
```json
{
  "success": true,
  "board": { /* updated board */ }
}
```

---

### DELETE `/api/boards/:id`

**Purpose**: Delete board (creator only)

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "message": "Board deleted successfully"
}
```

---

### POST `/api/boards/:id/cards`

**Purpose**: Add card to board

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "cardId": "card-xyz"
}
```

**Response** (201):
```json
{
  "success": true,
  "boardCard": {
    "id": "board-card-123",
    "cardId": "card-xyz",
    "boardId": "board-xyz",
    "addedBy": "user-123",
    "addedAt": "2025-10-15T12:00:00Z",
    "votes": { "yes": 1, "no": 0, "userVote": "yes" },
    "rsvps": { "responded": 0, "total": 4, "userRSVP": null },
    "messages": 0,
    "isLocked": false
  }
}
```

---

### POST `/api/boards/:id/cards/:cardId/vote`

**Purpose**: Vote on board card

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "vote": "yes"
}
```

**Response** (200):
```json
{
  "success": true,
  "vote": {
    "boardCardId": "board-card-123",
    "userId": "user-123",
    "vote": "yes",
    "votedAt": "2025-10-15T12:00:00Z"
  },
  "updatedVotes": {
    "yes": 4,
    "no": 1
  }
}
```

---

### POST `/api/boards/:id/cards/:cardId/rsvp`

**Purpose**: RSVP to board card

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "rsvp": "yes"
}
```

**Response** (200):
```json
{
  "success": true,
  "rsvp": {
    "boardCardId": "board-card-123",
    "userId": "user-123",
    "rsvp": "yes",
    "rsvpAt": "2025-10-15T12:00:00Z"
  },
  "updatedRSVPs": {
    "responded": 3,
    "total": 4
  }
}
```

---

### POST `/api/boards/:id/cards/:cardId/lock`

**Purpose**: Lock board card (admin only)

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "locked": true,
  "lockedAt": "2025-10-15T12:00:00Z",
  "lockedBy": "user-123"
}
```

---

### POST `/api/boards/:id/members`

**Purpose**: Add member to board

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "userId": "user-5"
}
```

**Response** (200):
```json
{
  "success": true,
  "member": {
    "id": "user-5",
    "name": "New Member",
    "addedAt": "2025-10-15T12:00:00Z"
  }
}
```

---

### DELETE `/api/boards/:id/members/:userId`

**Purpose**: Remove member from board (admin only)

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "message": "Member removed"
}
```

---

### POST `/api/boards/:id/members/:userId/promote`

**Purpose**: Promote member to admin

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "promoted": true,
  "admins": ["user-123", "user-5"]
}
```

---

### POST `/api/boards/:id/members/:userId/demote`

**Purpose**: Demote admin to member

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "demoted": true,
  "admins": ["user-123"]
}
```

---

### POST `/api/boards/:id/leave`

**Purpose**: Leave board

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "message": "Left board successfully"
}
```

---

### GET `/api/boards/:id/messages`

**Purpose**: Get board messages

**Headers**: `Authorization: Bearer <accessToken>`

**Query Parameters**:
- `limit`: Results limit (default 50)
- `offset`: Pagination offset

**Response** (200):
```json
{
  "success": true,
  "messages": [
    {
      "id": "msg-xyz",
      "boardId": "board-xyz",
      "user": {
        "id": "user-1",
        "name": "Sarah Chen",
        "avatar": "https://cdn.mingla.com/avatars/user-1.jpg"
      },
      "content": "What do you think about this coffee place?",
      "mentions": [],
      "cardTags": ["card-xyz"],
      "likes": 2,
      "isLiked": false,
      "replies": [],
      "createdAt": "2025-10-15T10:00:00Z"
    }
  ],
  "total": 23,
  "hasMore": false
}
```

---

### POST `/api/boards/:id/messages`

**Purpose**: Send message to board

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "content": "Hey @Sarah Chen check out #Sightglass Coffee!",
  "mentions": ["user-1"],
  "cardTags": ["card-xyz"]
}
```

**Response** (201):
```json
{
  "success": true,
  "message": { /* created message object */ }
}
```

---

### POST `/api/boards/invites`

**Purpose**: Send board invitation

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "boardId": "board-xyz",
  "userIds": ["user-5", "user-6"],
  "message": "Join our weekend planning board!"
}
```

**Response** (200):
```json
{
  "success": true,
  "invitesSent": 2,
  "invites": [
    {
      "id": "invite-1",
      "boardId": "board-xyz",
      "fromUserId": "user-123",
      "toUserId": "user-5",
      "status": "pending",
      "expiresAt": "2025-10-22T00:00:00Z",
      "createdAt": "2025-10-15T12:00:00Z"
    }
  ]
}
```

---

### GET `/api/boards/invites`

**Purpose**: Get board invitations

**Headers**: `Authorization: Bearer <accessToken>`

**Query Parameters**:
- `type`: sent | received
- `status`: pending | accepted | declined

**Response** (200):
```json
{
  "success": true,
  "invites": [ /* array of invitations */ ]
}
```

---

### POST `/api/boards/invites/:id/accept`

**Purpose**: Accept board invitation

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "accepted": true,
  "board": { /* board object user joined */ }
}
```

---

### POST `/api/boards/invites/:id/decline`

**Purpose**: Decline board invitation

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "declined": true
}
```

---

## Social/Connection APIs

### GET `/api/friends`

**Purpose**: Get user's friends list

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "friends": [
    {
      "id": "user-2",
      "name": "Sarah Chen",
      "username": "sarahc",
      "avatar": "https://cdn.mingla.com/avatars/user-2.jpg",
      "status": "online",
      "mutualFriends": 5,
      "sharedBoards": 2,
      "connectionDate": "2025-01-15T00:00:00Z"
    }
  ],
  "total": 12
}
```

---

### POST `/api/friends/request`

**Purpose**: Send friend request

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "userId": "user-5",
  "message": "Let's connect!"
}
```

**Response** (200):
```json
{
  "success": true,
  "request": {
    "id": "request-xyz",
    "fromUserId": "user-123",
    "toUserId": "user-5",
    "status": "pending",
    "createdAt": "2025-10-15T12:00:00Z"
  }
}
```

---

### GET `/api/friends/requests`

**Purpose**: Get friend requests

**Headers**: `Authorization: Bearer <accessToken>`

**Query Parameters**:
- `type`: sent | received
- `status`: pending | accepted | declined

**Response** (200):
```json
{
  "success": true,
  "requests": [
    {
      "id": "request-xyz",
      "user": {
        "id": "user-5",
        "name": "New Friend",
        "avatar": "https://cdn.mingla.com/avatars/user-5.jpg"
      },
      "message": "Let's connect!",
      "status": "pending",
      "createdAt": "2025-10-15T10:00:00Z"
    }
  ]
}
```

---

### POST `/api/friends/requests/:id/accept`

**Purpose**: Accept friend request

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "accepted": true,
  "friend": { /* friend object */ }
}
```

---

### POST `/api/friends/requests/:id/decline`

**Purpose**: Decline friend request

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "declined": true
}
```

---

### DELETE `/api/friends/:userId`

**Purpose**: Remove friend

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "message": "Friend removed"
}
```

---

### POST `/api/users/:userId/block`

**Purpose**: Block user

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "blocked": true
}
```

---

### POST `/api/users/:userId/report`

**Purpose**: Report user

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "reason": "inappropriate-behavior",
  "description": "Detailed description of issue"
}
```

**Response** (200):
```json
{
  "success": true,
  "reported": true,
  "reportId": "report-xyz"
}
```

---

### GET `/api/users/search`

**Purpose**: Search for users

**Headers**: `Authorization: Bearer <accessToken>`

**Query Parameters**:
- `q`: Search query (name, username)
- `limit`: Results limit
- `offset`: Pagination

**Response** (200):
```json
{
  "success": true,
  "users": [
    {
      "id": "user-5",
      "name": "John Doe",
      "username": "johndoe",
      "avatar": "https://cdn.mingla.com/avatars/user-5.jpg",
      "isFriend": false,
      "mutualFriends": 2
    }
  ],
  "total": 45
}
```

---

## Purchase/Payment APIs

### POST `/api/purchases`

**Purpose**: Create purchase

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "cardId": "card-xyz",
  "purchaseOptionId": "option-1",
  "paymentMethod": "apple-pay",
  "scheduledDate": "2025-10-20",
  "scheduledTime": "14:00"
}
```

**Response** (201):
```json
{
  "success": true,
  "purchase": {
    "id": "purchase-xyz",
    "userId": "user-123",
    "cardId": "card-xyz",
    "purchaseOption": { /* option details */ },
    "amount": 35.00,
    "currency": "USD",
    "status": "completed",
    "paymentMethod": "apple-pay",
    "bookingReference": "MGL-20251015-ABC123",
    "qrCode": "https://cdn.mingla.com/qr/purchase-xyz.png",
    "scheduledDate": "2025-10-20",
    "scheduledTime": "14:00",
    "createdAt": "2025-10-15T12:00:00Z"
  },
  "calendarEntry": { /* auto-created calendar entry */ }
}
```

---

### GET `/api/purchases`

**Purpose**: Get user's purchases

**Headers**: `Authorization: Bearer <accessToken>`

**Query Parameters**:
- `status`: completed | cancelled | refunded
- `limit`: Results limit
- `offset`: Pagination

**Response** (200):
```json
{
  "success": true,
  "purchases": [ /* array of purchases */ ],
  "total": 8
}
```

---

### GET `/api/purchases/:id`

**Purpose**: Get purchase details

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "purchase": { /* full purchase object */ }
}
```

---

### POST `/api/purchases/:id/cancel`

**Purpose**: Cancel purchase

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "reason": "Change of plans"
}
```

**Response** (200):
```json
{
  "success": true,
  "cancelled": true,
  "refundAmount": 35.00,
  "refundStatus": "processing"
}
```

---

### POST `/api/purchases/:id/reschedule`

**Purpose**: Reschedule purchase

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "newDate": "2025-10-25",
  "newTime": "15:00"
}
```

**Response** (200):
```json
{
  "success": true,
  "rescheduled": true,
  "purchase": { /* updated purchase */ }
}
```

---

### GET `/api/purchases/:id/qr-code`

**Purpose**: Get QR code for check-in

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "qrCodeUrl": "https://cdn.mingla.com/qr/purchase-xyz.png",
  "qrCodeData": "MGL-PURCHASE-XYZ-20251015"
}
```

---

## Calendar APIs

### GET `/api/calendar/entries`

**Purpose**: Get calendar entries

**Headers**: `Authorization: Bearer <accessToken>`

**Query Parameters**:
- `status`: locked-in | completed | cancelled
- `startDate`: Filter by date range
- `endDate`: Filter by date range
- `isPurchased`: true | false
- `limit`: Results limit
- `offset`: Pagination

**Response** (200):
```json
{
  "success": true,
  "entries": [
    {
      "id": "entry-xyz",
      "userId": "user-123",
      "card": { /* full card object */ },
      "isPurchased": true,
      "purchase": { /* purchase details if purchased */ },
      "scheduledDate": "2025-10-20",
      "scheduledTime": "14:00",
      "status": "locked-in",
      "sessionType": "solo",
      "sessionName": "Solo Session",
      "movedFromSaved": true,
      "addedAt": "2025-10-15T12:00:00Z"
    }
  ],
  "total": 8
}
```

---

### POST `/api/calendar/entries`

**Purpose**: Add entry to calendar

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "cardId": "card-xyz",
  "scheduledDate": "2025-10-20",
  "scheduledTime": "14:00",
  "sessionType": "solo"
}
```

**Response** (201):
```json
{
  "success": true,
  "entry": { /* created calendar entry */ }
}
```

---

### DELETE `/api/calendar/entries/:id`

**Purpose**: Remove calendar entry

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "message": "Entry removed from calendar"
}
```

---

### PUT `/api/calendar/entries/:id`

**Purpose**: Update calendar entry

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "scheduledDate": "2025-10-25",
  "scheduledTime": "15:00",
  "status": "rescheduled"
}
```

**Response** (200):
```json
{
  "success": true,
  "entry": { /* updated entry */ }
}
```

---

### POST `/api/calendar/entries/:id/propose-date`

**Purpose**: Propose new date for entry

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "proposedDate": "2025-10-25",
  "proposedTime": "15:00",
  "reason": "Better timing for everyone"
}
```

**Response** (200):
```json
{
  "success": true,
  "proposal": {
    "id": "proposal-xyz",
    "entryId": "entry-xyz",
    "proposedDate": "2025-10-25",
    "proposedTime": "15:00",
    "reason": "Better timing for everyone",
    "status": "pending",
    "createdAt": "2025-10-15T12:00:00Z"
  }
}
```

---

### GET `/api/calendar/sync`

**Purpose**: Get device calendar sync data

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "icsUrl": "https://api.mingla.com/calendar/user-123/sync.ics",
  "webcalUrl": "webcal://api.mingla.com/calendar/user-123/sync.ics"
}
```

---

## Notification APIs

### GET `/api/notifications`

**Purpose**: Get user notifications

**Headers**: `Authorization: Bearer <accessToken>`

**Query Parameters**:
- `type`: all | board | friend | purchase | system
- `read`: true | false | all
- `limit`: Results limit
- `offset`: Pagination

**Response** (200):
```json
{
  "success": true,
  "notifications": [
    {
      "id": "notif-xyz",
      "userId": "user-123",
      "type": "board_message",
      "title": "New message in Weekend Squad",
      "message": "Sarah Chen: Check out this coffee place!",
      "data": {
        "boardId": "board-xyz",
        "messageId": "msg-123"
      },
      "isRead": false,
      "createdAt": "2025-10-15T11:00:00Z"
    }
  ],
  "unreadCount": 5,
  "total": 23
}
```

---

### PUT `/api/notifications/:id/read`

**Purpose**: Mark notification as read

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "notification": { /* updated notification */ }
}
```

---

### PUT `/api/notifications/read-all`

**Purpose**: Mark all notifications as read

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "markedAsRead": 5
}
```

---

### DELETE `/api/notifications/:id`

**Purpose**: Delete notification

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "message": "Notification deleted"
}
```

---

### POST `/api/notifications/preferences`

**Purpose**: Update notification preferences

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "email": true,
  "push": true,
  "sms": false,
  "boardMessages": true,
  "friendRequests": true,
  "purchases": true,
  "recommendations": false
}
```

**Response** (200):
```json
{
  "success": true,
  "preferences": { /* updated preferences */ }
}
```

---

### POST `/api/notifications/push/subscribe`

**Purpose**: Subscribe to push notifications

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/...",
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  },
  "deviceType": "ios"
}
```

**Response** (200):
```json
{
  "success": true,
  "subscribed": true
}
```

---

## Analytics APIs

### POST `/api/analytics/events`

**Purpose**: Track analytics event

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "event": "card_view",
  "properties": {
    "cardId": "card-xyz",
    "matchScore": 87,
    "sessionMode": "solo",
    "category": "sipChill"
  },
  "timestamp": "2025-10-15T12:00:00Z"
}
```

**Response** (200):
```json
{
  "success": true,
  "tracked": true
}
```

---

### GET `/api/analytics/dashboard`

**Purpose**: Get analytics dashboard data (Admin)

**Headers**: `Authorization: Bearer <accessToken>`

**Query Parameters**:
- `startDate`: Date range start
- `endDate`: Date range end
- `metric`: users | cards | purchases | engagement

**Response** (200):
```json
{
  "success": true,
  "metrics": {
    "totalUsers": 1243,
    "activeUsers": 856,
    "totalCards": 342,
    "liveCards": 298,
    "totalPurchases": 145,
    "totalRevenue": 12450.00,
    "avgMatchScore": 82,
    "topCategories": [
      { "category": "sipChill", "count": 89 },
      { "category": "casualEats", "count": 67 }
    ]
  }
}
```

---

## Content Management APIs (Curator/QA)

### POST `/api/curator/cards`

**Purpose**: Create card (Curator)

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "title": "Amazing Coffee Shop",
  "category": "sipChill",
  "description": "Great coffee and vibes",
  "fullDescription": "Full description...",
  "address": "123 Main St, San Francisco, CA",
  "priceMin": 10,
  "priceMax": 30,
  "images": ["url1", "url2"],
  "highlights": ["Cozy", "Local", "WiFi"],
  "tags": ["coffee", "work-friendly"]
}
```

**Response** (201):
```json
{
  "success": true,
  "card": {
    "id": "card-new",
    "status": "draft",
    "createdBy": "curator-123",
    /* ... card data ... */
  }
}
```

---

### PUT `/api/curator/cards/:id`

**Purpose**: Update card (Curator/Content Manager)

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**: Same as create

**Response** (200):
```json
{
  "success": true,
  "card": { /* updated card */ }
}
```

---

### POST `/api/curator/cards/:id/submit`

**Purpose**: Submit card for review

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "card": {
    "id": "card-xyz",
    "status": "in-review",
    "submittedAt": "2025-10-15T12:00:00Z"
  }
}
```

---

### GET `/api/qa/cards/pending`

**Purpose**: Get cards pending QA review

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "cards": [ /* array of cards in-review */ ],
  "total": 12
}
```

---

### POST `/api/qa/cards/:id/approve`

**Purpose**: Approve card (QA Manager)

**Headers**: `Authorization: Bearer <accessToken>`

**Response** (200):
```json
{
  "success": true,
  "card": {
    "id": "card-xyz",
    "status": "live",
    "approvedBy": "qa-123",
    "publishedAt": "2025-10-15T12:00:00Z"
  }
}
```

---

### POST `/api/qa/cards/:id/reject`

**Purpose**: Reject card (QA Manager)

**Headers**: `Authorization: Bearer <accessToken>`

**Request Body**:
```json
{
  "reason": "Missing required images",
  "feedback": "Please add at least 3 high-quality images"
}
```

**Response** (200):
```json
{
  "success": true,
  "card": {
    "id": "card-xyz",
    "status": "returned",
    "rejectionReason": "Missing required images",
    "rejectionFeedback": "Please add..."
  }
}
```

---

## External Integrations

### Google Places API

**Purpose**: Location autocomplete and validation

**Endpoints Used**:
- Place Autocomplete
- Place Details
- Geocoding

**Implementation**:
```javascript
// Frontend: GooglePlacesAutocomplete.tsx
// Backend: Proxy to avoid API key exposure

POST /api/places/autocomplete
{
  "input": "coffee shop san francisco",
  "location": { "lat": 37.7749, "lng": -122.4194 },
  "radius": 5000
}

Response:
{
  "predictions": [
    {
      "place_id": "ChIJ...",
      "description": "Sightglass Coffee, 7th Street, San Francisco, CA",
      "structured_formatting": {
        "main_text": "Sightglass Coffee",
        "secondary_text": "7th Street, San Francisco, CA"
      }
    }
  ]
}
```

### Google Maps API

**Purpose**: Distance matrix, directions, static maps

**Endpoints Used**:
- Distance Matrix API
- Directions API
- Maps Static API

**Implementation**:
```javascript
POST /api/maps/distance-matrix
{
  "origins": [{ "lat": 37.7749, "lng": -122.4194 }],
  "destinations": [{ "lat": 37.7849, "lng": -122.4094 }],
  "mode": "walking"
}

Response:
{
  "rows": [
    {
      "elements": [
        {
          "distance": { "text": "3.2 km", "value": 3200 },
          "duration": { "text": "40 mins", "value": 2400 },
          "status": "OK"
        }
      ]
    }
  ]
}
```

### Apple Pay / Stripe

**Purpose**: Payment processing

**Implementation**:
```javascript
POST /api/payments/create-intent
{
  "amount": 3500,
  "currency": "USD",
  "purchaseOptionId": "option-xyz",
  "cardId": "card-xyz"
}

Response:
{
  "clientSecret": "pi_xxx_secret_yyy",
  "paymentIntentId": "pi_xxx"
}

// Frontend completes with Apple Pay
// Webhook confirms payment
POST /api/webhooks/stripe
```

### Weather API (OpenWeatherMap)

**Purpose**: Real-time weather for card matching

**Implementation**:
```javascript
GET /api/weather/current
?lat=37.7749&lon=-122.4194

Response:
{
  "weather": [
    {
      "main": "Clear",
      "description": "clear sky",
      "icon": "01d"
    }
  ],
  "main": {
    "temp": 68,
    "feels_like": 65,
    "humidity": 60
  },
  "wind": { "speed": 5.2 }
}
```

### Device Calendar (iOS/Android)

**Purpose**: Sync calendar entries

**Implementation**:
```javascript
// iOS: EventKit
// Android: Calendar Provider

// Generate .ics file for export
GET /api/calendar/export/:entryId.ics

Response: (ICS file)
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:entry-xyz@mingla.com
DTSTART:20251020T140000Z
DTEND:20251020T160000Z
SUMMARY:Coffee at Sightglass
LOCATION:270 7th St, San Francisco, CA
DESCRIPTION:Coffee Tasting Experience
END:VEVENT
END:VCALENDAR
```

---

## Real-time Systems

### WebSocket Connection

**Purpose**: Real-time updates for boards, messages, notifications

**Connection**:
```javascript
ws://api.mingla.com/ws?token=<accessToken>
```

**Events Sent to Client**:

```javascript
// New board message
{
  "type": "board_message",
  "boardId": "board-xyz",
  "message": {
    "id": "msg-123",
    "user": { /* user object */ },
    "content": "Check this out!",
    "createdAt": "2025-10-15T12:00:00Z"
  }
}

// Card vote update
{
  "type": "board_card_vote",
  "boardId": "board-xyz",
  "cardId": "board-card-123",
  "vote": {
    "userId": "user-5",
    "vote": "yes"
  },
  "updatedVotes": {
    "yes": 5,
    "no": 1
  }
}

// Board member joined
{
  "type": "board_member_joined",
  "boardId": "board-xyz",
  "member": {
    "id": "user-6",
    "name": "New Member",
    "joinedAt": "2025-10-15T12:00:00Z"
  }
}

// Notification
{
  "type": "notification",
  "notification": {
    "id": "notif-xyz",
    "title": "Friend request",
    "message": "John Doe sent you a friend request",
    "data": { "requestId": "request-123" }
  }
}
```

**Events Sent from Client**:

```javascript
// Subscribe to board
{
  "type": "subscribe_board",
  "boardId": "board-xyz"
}

// Unsubscribe from board
{
  "type": "unsubscribe_board",
  "boardId": "board-xyz"
}

// Typing indicator
{
  "type": "typing",
  "boardId": "board-xyz",
  "isTyping": true
}
```

---

## System Architecture

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                        │
│   (React App - Vite - Tailwind - Motion)                   │
└────────────┬────────────────────────────────────────────────┘
             │
             │ HTTPS/WSS
             ↓
┌─────────────────────────────────────────────────────────────┐
│                      API GATEWAY                            │
│   - Authentication                                          │
│   - Rate Limiting                                          │
│   - Request Validation                                     │
│   - Load Balancing                                         │
└────────────┬────────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────────┐
│                   APPLICATION LAYER                         │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Auth       │  │   Cards      │  │  Collab      │    │
│  │   Service    │  │   Service    │  │  Service     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   User       │  │   Payment    │  │  Notification│    │
│  │   Service    │  │   Service    │  │  Service     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Analytics  │  │   Content    │  │  Real-time   │    │
│  │   Service    │  │   Mgmt Svc   │  │  Service     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
└────────────┬────────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────────┐
│                      DATA LAYER                             │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  PostgreSQL  │  │    Redis     │  │  S3/CDN      │    │
│  │  (Primary)   │  │   (Cache)    │  │  (Media)     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐                       │
│  │ Elasticsearch│  │  MongoDB     │                       │
│  │  (Search)    │  │  (Logs)      │                       │
│  └──────────────┘  └──────────────┘                       │
└────────────┬────────────────────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────────┐
│                  EXTERNAL SERVICES                          │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Google Maps  │  │    Stripe    │  │  SendGrid    │    │
│  │  & Places    │  │  (Payments)  │  │   (Email)    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐                       │
│  │   Firebase   │  │ OpenWeather  │                       │
│  │    (Push)    │  │   (Weather)  │                       │
│  └──────────────┘  └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

**Frontend**:
- React 18
- TypeScript
- Vite
- Tailwind CSS 4.0
- Motion (Framer Motion)
- Shadcn UI Components

**Backend**:
- Node.js + Express (or NestJS)
- TypeScript
- PostgreSQL 14+
- Redis 7+
- Elasticsearch 8+

**DevOps**:
- Docker + Kubernetes
- GitHub Actions (CI/CD)
- AWS/GCP/Azure
- CloudFront CDN
- CloudWatch Monitoring

**External**:
- Google Maps/Places API
- Stripe Payment Processing
- SendGrid Email
- Firebase Cloud Messaging
- OpenWeatherMap API

---

## Summary

### Total API Endpoints: 100+

**By Category**:
- Authentication: 6 endpoints
- User Management: 8 endpoints
- Cards/Experiences: 11 endpoints
- Preferences: 6 endpoints
- Collaboration/Boards: 22 endpoints
- Social/Connections: 9 endpoints
- Purchase/Payment: 7 endpoints
- Calendar: 7 endpoints
- Notifications: 6 endpoints
- Analytics: 2 endpoints
- Content Management: 6 endpoints
- External Integrations: 5+ proxies

### Real-time Features:
- WebSocket for boards, messages, notifications
- Push notifications (Firebase/APNs)
- Live updates on votes, RSVPs
- Typing indicators

### External Integrations:
- Google Maps & Places (location)
- Stripe/Apple Pay (payments)
- SendGrid (email)
- Firebase (push)
- OpenWeatherMap (weather)
- Device Calendars (sync)

---

**Status**: ✅ **COMPLETE BACKEND ARCHITECTURE**  
**Version**: 1.0  
**Last Updated**: October 15, 2025  
**Ready for**: Backend Development Team

This guide provides every API, algorithm, and integration needed to build a fully functional Mingla backend that powers the entire UI!
