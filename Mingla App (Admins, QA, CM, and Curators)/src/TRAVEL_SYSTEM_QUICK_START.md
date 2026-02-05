# Travel System Quick Start Guide

## What's New? 🚀

Mingla now uses **real Google Maps data** for travel time calculations! Users only see experiences they can actually reach within their travel constraints.

---

## 3-Minute Overview

### How It Works

```
1. User sets preferences:
   - Travel Mode: Walking 🚶
   - Travel Limit: 20 minutes max
   - Starting Location: Current GPS location

2. System calls Google Maps API:
   - Calculates REAL travel time from user's location to each venue
   - Uses actual walking routes, traffic, transit schedules

3. Cards filtered:
   - Only shows cards within 20 minutes walking
   - Uses real Google Maps data (not estimates)

4. User sees accurate results:
   - "Blue Bottle Coffee - 12 min walk"
   - "Artisan Cafe - 5 min walk"
   - Museum 35 min away is automatically excluded ❌
```

---

## Key Features

### ✅ 4 Travel Modes
- **Walking** 🚶: Pedestrian paths, 5 km/h average
- **Biking** 🚴: Bike lanes, 15 km/h average  
- **Transit** 🚇: Real transit schedules + wait times
- **Driving** 🚗: Real-time traffic data

### ✅ 2 Constraint Types
- **By Time**: "Within 20 minutes"
- **By Distance**: "Within 5 km/miles"

### ✅ 2 Location Options
- **GPS**: Auto-detect current location
- **Search**: Plan from any address (Google Places)

---

## Files Modified

### Core Files

**New**:
- `/components/utils/googleMapsTravel.ts` - Google Maps API integration

**Enhanced**:
- `/components/utils/cardGenerator.ts` - Added `generateCardsWithRealTravel()`
- `/components/PreferencesSheet.tsx` - Added `measurementSystem` to preferences

**Documentation**:
- `/PRODUCTION_TRAVEL_SYSTEM.md` - Complete system documentation
- `/PREFERENCES_AND_CARD_GENERATION_SYSTEM.md` - Updated with travel info
- `/TRAVEL_SYSTEM_QUICK_START.md` - This file

---

## ✅ Location Section Status

**The location section in PreferencesSheet is now PRODUCTION-READY with:**
- ✅ Automatic GPS detection with fallbacks (GPS → IP → Default)
- ✅ Google Places Autocomplete integration
- ✅ Real-time status indicators
- ✅ Coordinates stored in preferences object
- ✅ Complete error handling

See `/LOCATION_SECTION_UPDATE.md` for complete details.

---

## Setup Required

### 1. Google Maps API Key

```bash
# .env
VITE_GOOGLE_MAPS_API_KEY=AIza...your-key-here...
```

### 2. Enable APIs in Google Cloud Console

1. Go to: https://console.cloud.google.com/apis/library
2. Enable:
   - ✅ Distance Matrix API
   - ✅ Places API  
   - ✅ Maps JavaScript API

### 3. Load Google Maps Script

```html
<!-- index.html -->
<script
  src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&libraries=places"
  async
  defer
></script>
```

---

## Usage

### Production Function

```typescript
import { generateCardsWithRealTravel } from './components/utils/cardGenerator';
import type { Location } from './components/utils/googleMapsTravel';

// User location (GPS or searched)
const userLocation: Location = {
  lat: 37.7749,
  lng: -122.4194
};

// User preferences
const preferences = {
  experienceTypes: ['friendly'],
  categories: ['sipChill'],
  budgetMin: 10,
  budgetMax: 40,
  travelMode: 'walking',      // ✅ Uses this for calculations
  constraintType: 'time',     // ✅ Filters by this
  timeConstraint: 20,         // ✅ 20 minutes max
  measurementSystem: 'Metric'
};

// Generate cards with REAL Google Maps data
const cards = await generateCardsWithRealTravel(
  preferences,
  userLocation,
  10  // Return top 10
);

// Results include real travel data
console.log(cards[0]);
/*
{
  id: '1',
  title: 'Blue Bottle Coffee',
  distance: '1.2 km',           // ✅ From Google Maps
  travelTime: '14 mins',        // ✅ From Google Maps
  travelTimeMinutes: 14,        // ✅ From Google Maps
  matchScore: 94
}
*/
```

### Legacy Function (Fallback)

```typescript
import { generateCardBatch } from './components/utils/cardGenerator';

// Uses estimated travel times (no Google Maps API required)
const cards = generateCardBatch(preferences, 10);
```

---

## Integration with SwipeableCards

### Before (Estimated)

```typescript
// SwipeableCards.tsx
useEffect(() => {
  if (!userPreferences) return;
  
  const cards = generateCardBatch(userPreferences, 10);
  setCards(cards);
}, [userPreferences]);
```

### After (Production with Google Maps)

```typescript
// SwipeableCards.tsx
useEffect(() => {
  if (!userPreferences) return;
  
  async function loadCards() {
    // Get user location
    const userLocation = await getUserLocation();
    
    // Generate with real travel calculations
    const cards = await generateCardsWithRealTravel(
      userPreferences,
      userLocation,
      10
    );
    
    setCards(cards);
  }
  
  loadCards();
}, [userPreferences]);

async function getUserLocation(): Promise<Location> {
  if (userPreferences.useLocation === 'gps') {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          // Fallback to default
          resolve({ lat: 37.7749, lng: -122.4194 });
        }
      );
    });
  } else {
    // Use searched location
    return parseLocationFromSearch(userPreferences.searchLocation);
  }
}
```

---

## Cost Management

### Monthly Estimates

**10,000 active users**:
```
Without optimization: ~$4,500/month
With caching (70% hit): ~$1,350/month
With free tier: ~$1,150/month
```

### Optimization Strategies

#### 1. Batch Requests (90% savings)

```typescript
// ✅ Good: 1 API call for 25 cards
await calculateBatchTravelTimes(origin, destinations, mode);

// ❌ Bad: 25 separate API calls
for (const dest of destinations) {
  await calculateRealTravelTime(origin, dest, mode);
}
```

#### 2. Caching (70% reduction)

```typescript
// Cache results for 1 hour
const cacheKey = `travel:${origin.lat}:${origin.lng}:${dest.lat}:${dest.lng}:${mode}`;
const cached = localStorage.getItem(cacheKey);

if (cached && !isExpired(cached, 3600)) {
  return JSON.parse(cached);
}

const result = await calculateRealTravelTime(...);
localStorage.setItem(cacheKey, JSON.stringify(result));
```

#### 3. Fallback to Estimates

```typescript
try {
  return await calculateRealTravelTime(...);
} catch (error) {
  console.warn('Google Maps API failed, using estimate');
  return calculateEstimatedTravelTime(...);
}
```

---

## Error Handling

### Common Scenarios

#### 1. API Key Missing

```typescript
if (typeof google === 'undefined') {
  console.warn('Google Maps not loaded, using estimates');
  return calculateEstimatedTravelTime(...);
}
```

#### 2. Quota Exceeded

```typescript
if (error.status === 'OVER_QUERY_LIMIT') {
  // Use cached results or estimates
  return getCachedOrEstimate(...);
}
```

#### 3. Location Permission Denied

```typescript
navigator.geolocation.getCurrentPosition(
  (position) => { /* Success */ },
  (error) => {
    if (error.code === error.PERMISSION_DENIED) {
      // Prompt user to search for location
      showLocationSearchPrompt();
    }
  }
);
```

---

## Testing

### Test Cases

#### 1. Walking Mode, 15 min constraint

```typescript
const preferences = {
  travelMode: 'walking',
  constraintType: 'time',
  timeConstraint: 15
};

const userLocation = { lat: 37.7749, lng: -122.4194 };

const cards = await generateCardsWithRealTravel(preferences, userLocation, 10);

// Expect: All cards have travelTimeMinutes <= 15
cards.forEach(card => {
  expect(card.travelTimeMinutes).toBeLessThanOrEqual(15);
});
```

#### 2. Transit Mode with Scheduled Time

```typescript
const preferences = {
  travelMode: 'transit',
  constraintType: 'time',
  timeConstraint: 45,
  actualDateTime: {
    scheduledDate: '2025-10-18T14:00:00Z',
    scheduledTime: '14:00',
    displayText: 'Saturday, October 18, 2:00 PM'
  }
};

const cards = await generateCardsWithRealTravel(preferences, userLocation, 10);

// Expect: Travel times calculated for Saturday 2 PM transit schedules
// Results should include actual departure times
```

#### 3. Driving with Distance Constraint

```typescript
const preferences = {
  travelMode: 'driving',
  constraintType: 'distance',
  distanceConstraint: 10,  // 10 km
  measurementSystem: 'Metric'
};

const cards = await generateCardsWithRealTravel(preferences, userLocation, 10);

// Expect: All cards have distance <= 10 km
cards.forEach(card => {
  const distanceKm = parseFloat(card.distance.replace(' km', ''));
  expect(distanceKm).toBeLessThanOrEqual(10);
});
```

---

## Debugging

### Enable Console Logs

```typescript
// In cardGenerator.ts
console.log('🎯 Generating cards with real travel calculations...');
console.log('User location:', userLocation);
console.log('Travel mode:', preferences.travelMode);
console.log('🚗 Calculating real travel times for X cards...');
console.log('✅ Returning Y cards');
```

### Monitor API Calls

```typescript
// Track API usage
let apiCallCount = 0;

function trackAPICall(origin, destinations, mode) {
  apiCallCount++;
  console.log(`API Call #${apiCallCount}:`, {
    origin,
    destinationCount: destinations.length,
    mode,
    timestamp: new Date().toISOString()
  });
}
```

---

## Documentation Links

📖 **Complete Guides**:
- [PRODUCTION_TRAVEL_SYSTEM.md](/PRODUCTION_TRAVEL_SYSTEM.md) - Full technical documentation
- [PREFERENCES_AND_CARD_GENERATION_SYSTEM.md](/PREFERENCES_AND_CARD_GENERATION_SYSTEM.md) - Preferences + generation
- [GOOGLE_PLACES_SETUP.md](/components/GOOGLE_PLACES_SETUP.md) - Places API setup

🔧 **Code Files**:
- `/components/utils/googleMapsTravel.ts` - Google Maps integration
- `/components/utils/cardGenerator.ts` - Card generation with travel
- `/components/PreferencesSheet.tsx` - UI for preferences

---

## Summary

### What Changed

**Before**:
- ❌ Estimated travel times (rough calculations)
- ❌ No real traffic data
- ❌ No transit schedules
- ❌ Inaccurate filtering

**After**:
- ✅ Real Google Maps travel times
- ✅ Real-time traffic for driving
- ✅ Actual transit schedules
- ✅ Accurate card filtering
- ✅ 4 travel modes with real routing
- ✅ GPS or searched starting location
- ✅ Time or distance constraints

### Next Steps

1. ✅ Obtain Google Maps API key
2. ✅ Enable required APIs
3. ✅ Add API key to `.env`
4. ✅ Load Google Maps script in `index.html`
5. ✅ Test with real locations
6. ✅ Monitor API usage
7. ✅ Implement caching

---

**Status**: ✅ **PRODUCTION-READY**  
**Version**: 1.0  
**Last Updated**: October 15, 2025  
**Ready for deployment with Google Maps API key**
