# See Full Plan - Comprehensive Documentation

## Overview

The "See Full Plan" feature is a comprehensive experience timeline generator that creates detailed, step-by-step itineraries for two specific card types:
- **Take a Stroll Cards**: Generate walking routes with companion stops
- **Picnic Cards**: Generate complete picnic experiences with grocery shopping stops

When users click the "See Full Plan" button on these cards, the system fetches real-time location data, uses Google Places API to find companion locations, and generates an interactive timeline view showcasing the entire experience from start to finish.

---

## User Journey

### 1. **Viewing a Card**
- User sees a "Take a Stroll" or "Picnic" card in the expanded card modal
- A "See Full Plan" button is visible with a map icon

### 2. **Triggering the Data Fetch**
- User taps the "See Full Plan" button
- Button becomes disabled and shows a loading spinner with "Loading Plan..." text
- An API request is made to the backend (Supabase Edge Function)

### 3. **Backend Processing**
- For **Stroll cards**: Fetches companion stops (cafés, bakeries, ice cream shops) near the stroll anchor
- For **Picnic cards**: Fetches nearby grocery stores/supermarkets
- Generates a timeline with multiple steps, durations, and descriptions

### 4. **Displaying the Timeline**
- Once data is loaded, the button disappears
- A `TimelineSection` component appears below with an interactive timeline
- User can expand/collapse each timeline step to see details
- From expanded steps, users can open locations in Google Maps

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    ExpandedCardModal Component                   │
│  (Displays card details and See Full Plan button)                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
        ┌───────▼────────┐    ┌────────▼──────────┐
        │ fetchStrollData│    │ fetchPicnicData   │
        │ (Client Fetch) │    │  (Client Fetch)   │
        └───────┬────────┘    └────────┬──────────┘
                │                      │
                └──────────┬───────────┘
                           │
        ┌──────────────────▼────────────────────┐
        │  ExperienceGenerationService          │
        │  (Supabase Functions Client)          │
        └──────────────────┬────────────────────┘
                           │
         ┌─────────────────┴──────────────────┐
         │                                    │
    ┌────▼──────────────────┐    ┌──────────▼────────────────┐
    │ get-companion-stops   │    │ get-picnic-grocery        │
    │ (Supabase Function)   │    │ (Supabase Function)       │
    │ - Google Places API   │    │ - Google Places API       │
    │ - Timeline Building   │    │ - Timeline Building       │
    └────┬──────────────────┘    └──────────┬─────────────────┘
         │                                   │
         └───────────────┬───────────────────┘
                         │
              ┌──────────▼──────────┐
              │  TimelineSection    │
              │  Component          │
              │  (Renders Timeline) │
              └─────────────────────┘
```

---

## Frontend Implementation

### 1. **ExpandedCardModal Component**
**Location**: `app-mobile/src/components/ExpandedCardModal.tsx`

#### Key State Variables

```typescript
const [strollData, setStrollData] = useState(card?.strollData);
const [loadingStrollData, setLoadingStrollData] = useState(false);
const [picnicData, setPicnicData] = useState(card?.picnicData);
const [loadingPicnicData, setLoadingPicnicData] = useState(false);
```

#### Fetch Stroll Data Function

```typescript
const fetchStrollData = async () => {
  // Validates that card is a "Take a Stroll" type
  if (!isStrollCard) return;
  
  // Creates anchor object from card data
  const anchor = {
    id: card.id,
    name: card.title,
    location: { lat: card.location.lat, lng: card.location.lng },
    address: card.address,
  };
  
  // Sets loading state and fetches data
  setLoadingStrollData(true);
  const fetchedStrollData = 
    await ExperienceGenerationService.fetchCompanionStrollData(anchor);
  
  // Updates state and persists to database
  if (fetchedStrollData) {
    setStrollData(fetchedStrollData);
    updateCardStrollData(card.id, fetchedStrollData);
    onStrollDataFetched(card, fetchedStrollData); // Database persistence
  }
  setLoadingStrollData(false);
};
```

#### Fetch Picnic Data Function

```typescript
const fetchPicnicData = async () => {
  // Validates that card is a "Picnic" type
  if (!isPicnicCard) return;
  
  // Creates picnic object from card data
  const picnic = {
    id: card.id,
    name: card.title,
    location: { lat: card.location.lat, lng: card.location.lng },
    address: card.address,
  };
  
  setLoadingPicnicData(true);
  const fetchedPicnicData = 
    await ExperienceGenerationService.fetchPicnicGroceryData(picnic);
  
  if (fetchedPicnicData) {
    setPicnicData(fetchedPicnicData);
    onPicnicDataFetched(card, fetchedPicnicData); // Database persistence
  }
  setLoadingPicnicData(false);
};
```

#### Button Rendering Logic

**For Stroll Cards** (Lines 460-493):
```tsx
{isStrollCard && !(strollData && strollData.timeline) && (
  <View style={styles.seeFullPlanSection}>
    <TouchableOpacity
      style={styles.routePairingButton}
      onPress={fetchStrollData}
      disabled={loadingStrollData}
      activeOpacity={0.7}
    >
      {loadingStrollData ? (
        <>
          <ActivityIndicator ... />
          <Text>Loading Plan...</Text>
        </>
      ) : (
        <>
          <Ionicons name="map-outline" size={20} color="#ffffff" />
          <Text>See Full Plan</Text>
        </>
      )}
    </TouchableOpacity>
  </View>
)}
```

**For Picnic Cards** (Lines 497-526):
```tsx
{isPicnicCard && !(picnicData && picnicData.timeline) && (
  <View style={styles.seeFullPlanSection}>
    <TouchableOpacity
      style={styles.routePairingButton}
      onPress={fetchPicnicData}
      disabled={loadingPicnicData}
      // ... similar loading logic
    />
  </View>
)}
```

The button only displays if:
- The card is the correct type (Stroll or Picnic)
- Timeline data does NOT already exist (`!(strollData && strollData.timeline)`)

Once timeline data is fetched, the button disappears and the `TimelineSection` component is displayed instead.

#### Timeline Section Rendering

**For Stroll (Lines 656-667)**:
```tsx
{isStrollCard && strollData && strollData.timeline && (
  <TimelineSection
    category={card.category}
    title={card.title}
    address={card.address}
    strollTimeline={strollData.timeline}
    routeDuration={strollData.route?.duration}
    currency={accountPreferences?.currency}
  />
)}
```

**For Picnic (Lines 669-680)**:
```tsx
{isPicnicCard && picnicData && picnicData.timeline && (
  <TimelineSection
    category={card.category}
    title={card.title}
    address={card.address}
    strollTimeline={picnicData.timeline}  /* Note: same prop name */
    routeDuration={picnicData.route?.duration}
    currency={accountPreferences?.currency}
  />
)}
```

### 2. **TimelineSection Component**
**Location**: `app-mobile/src/components/expandedCard/TimelineSection.tsx`

#### Component Purpose
Renders an interactive, expandable timeline view with:
- Vertical timeline line
- Step icons (flag for start, circles for stops)
- Collapsible step details
- Location cards with "Open in Maps" functionality
- Step descriptions and durations

#### Key Features

**Expandable Steps**:
```typescript
const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([0]));

const toggleStep = (stepIndex: number) => {
  const newExpanded = new Set(expandedSteps);
  if (newExpanded.has(stepIndex)) {
    newExpanded.delete(stepIndex);
  } else {
    newExpanded.add(stepIndex);
  }
  setExpandedSteps(newExpanded);
};
```

**Step Processing**:
- Extracts title and subtitle from timeline step data
- Handles location information (name and address)
- Creates a structured `StepData` array for rendering

**Visual Elements**:
- **Timeline Line**: Orange vertical line connecting all steps
- **Step Icons**: 
  - Flag icon for "Start" step
  - Circle for regular stops
  - Color changes based on expanded state
- **Step Header**: Title, subtitle, and location pin icon
- **Expanded Content**: Description, location card, and "Then..." separator
- **Location Card**: Shows address with "Open in Maps" button

#### Open in Maps Functionality

```typescript
const openInMaps = (location: {
  lat?: number;
  lng?: number;
  address?: string;
  name?: string;
}) => {
  if (lat && lng) {
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    Linking.openURL(url);
  } else if (address) {
    const encodedAddress = encodeURIComponent(address);
    const url = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
    Linking.openURL(url);
  }
};
```

Clicking "Open in Maps" opens the location in Google Maps or Apple Maps (depending on platform) using deep linking.

---

## Backend Implementation

### 1. **get-companion-stops Function**
**Location**: `supabase/functions/get-companion-stops/index.ts`

#### Purpose
Fetches companion stops near a "Take a Stroll" anchor location and generates an optimized timeline.

#### Request Payload
```typescript
{
  anchor: {
    id: string;           // Card ID
    name: string;         // Card title (e.g., "Central Park")
    location: {
      lat: number;
      lng: number;
    };
    address?: string;
  },
  maxDistance?: number;   // Default: 500 meters
}
```

#### API Flow

**Step 1: Find Companion Stops**
```typescript
async function findCompanionStops(
  anchorLocation: { lat: number; lng: number },
  maxDistance: number = 500
): Promise<any[]>
```

- Searches for nearby places using **Google Places API (New)**
- Looking for: supermarkets, food stores, convenience stores, ice cream shops, bakeries, delis
- Searches within **500 meters** of the anchor
- Returns up to **20 results**, sorted by rating
- Returns only the **top-rated location** (best result)

**Places API Request**:
```typescript
const requestBody = {
  includedTypes: [
    "supermarket", "food_store", "convenience_store", 
    "store", "grocery_store", "meal_takeaway",
    "ice_cream_shop", "bakery", "deli"
  ],
  maxResultCount: 20,
  locationRestriction: {
    circle: {
      center: { latitude: lat, longitude: lng },
      radius: 500  // meters
    }
  }
};

const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
  method: "POST",
  headers: {
    "X-Goog-Api-Key": GOOGLE_API_KEY,
    "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.userRatingCount,places.photos,places.types"
  },
  body: JSON.stringify(requestBody)
});
```

**Returned Place Data Structure**:
```typescript
{
  id: string;                    // Place ID
  name: string;                  // Display name
  location: {
    lat: number;
    lng: number;
  };
  address: string;              // Formatted address
  rating: number;               // 0-5 star rating
  reviewCount: number;          // Total reviews
  imageUrl: string | null;      // Photo from Places API
  placeId: string;             // Unique identifier
  type: string;                // Primary type (ice_cream_shop, bakery, etc.)
}
```

**Step 2: Build Timeline**
```typescript
function buildStrollRouteTimeline(
  companionStop: any,
  anchor: any,
  routeDuration: number
): any[]
```

Generates a 4-step timeline:

1. **Arrival & Welcome** (Step 1 - Start)
   - Duration: 0 minutes
   - Location: Companion stop (cafe, bakery, ice cream shop)
   - Description: "Begin at [Stop Name]"

2. **Main Activity** (Step 2 - Walk)
   - Duration: `routeDuration - 5` minutes
   - Location: Anchor (the stroll destination)
   - Description: "Walk to [Anchor Name]"

3. **Pause & Enjoy** (Step 3 - Pause, only if routeDuration ≥ 30)
   - Duration: 5 minutes
   - Location: Anchor
   - Description: "Take a moment to enjoy [Anchor Name]"

4. **Closing Touch** (Step 4 - Wrap-up)
   - Duration: 0 minutes
   - Location: Anchor
   - Description: "End at [Anchor Name]"

**Route Duration Calculation**:
```typescript
function calculateStrollRouteDuration(): number {
  return 30; // Fixed: 30 minutes average for solo stroll
}
```

#### Response Payload
```typescript
{
  strollData: {
    anchor: {
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address?: string;
    };
    companionStops: any[];  // Array with top-ranked stop
    route: {
      duration: number;     // Total minutes
      startLocation: { lat: number; lng: number };
      endLocation: { lat: number; lng: number };
    };
    timeline: Array<{
      step: number;
      type: "start" | "walk" | "pause" | "wrap-up";
      title: string;
      location: any;
      description: string;
      duration: number;     // Minutes
    }>;
  }
}
```

### 2. **get-picnic-grocery Function**
**Location**: `supabase/functions/get-picnic-grocery/index.ts`

#### Purpose
Fetches nearby grocery stores for a picnic location and generates a complete picnic timeline.

#### Request Payload
```typescript
{
  picnic: {
    id: string;            // Card ID
    name: string;          // Card title
    title?: string;        // Alternative name
    location: {
      lat: number;
      lng: number;
    };
    address?: string;
  },
  maxDistance?: number;    // Default: 2000 meters (2 km)
}
```

#### API Flow

**Step 1: Find Grocery Store**
```typescript
async function findGroceryStore(
  picnicLocation: { lat: number; lng: number },
  maxDistance: number = 2000
): Promise<any | null>
```

- Searches for grocery stores, supermarkets, and food stores
- Searches within **2000 meters** (2 km) of picnic location
- Returns up to **10 results**, filtered for grocery-related stores
- Prioritizes by:
  1. **Distance** (closest first) - if distance difference > 100m
  2. **Rating** (highest first) - if distances are similar
- Returns only the **best matching store**

**Grocery Types**:
```typescript
const groceryTypes = [
  "supermarket", "food_store", "convenience_store", "store",
  "grocery_store", "meal_takeaway", "ice_cream_shop", "bakery", "deli"
];
```

**Places API Request**:
```typescript
const requestBody = {
  includedTypes: groceryTypes,
  maxResultCount: 10,
  locationRestriction: {
    circle: {
      center: { latitude: lat, longitude: lng },
      radius: 2000  // meters
    }
  }
};
```

**Filter Logic**:
- Excludes "store" type unless name/types suggest grocery relevance
- Checks keywords: "grocery", "supermarket", "market", "food", "convenience", "deli", "bakery", "butcher", "produce"

**Returned Store Data**:
```typescript
{
  id: string;
  name: string;
  location: { lat: number; lng: number };
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string | null;
  placeId: string;
  type: string;
  types: string[];
  distance: number;  // In meters (calculated via Haversine)
}
```

**Step 2: Calculate Distance (Haversine Formula)**
```typescript
function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;  // Distance in meters
}
```

**Step 3: Build Timeline**
```typescript
function buildPicnicRouteTimeline(
  groceryStore: any,
  picnic: any,
  routeDuration: number
): any[]
```

Generates a 4-step timeline (Total: ~120 minutes):

1. **Grocery Stop** (Step 1 - Start)
   - Duration: 20 minutes
   - Location: Grocery store
   - Description: "Pick up picnic supplies at [Store Name]"

2. **Travel to Picnic Spot** (Step 2 - Travel)
   - Duration: `Math.max(10, routeDuration - 95)` minutes
   - Location: Picnic location
   - Description: "Head to [Picnic Location Name]"
   - Note: Minimum 10 minutes, maximum based on total duration

3. **Picnic** (Step 3 - Activity)
   - Duration: 60 minutes (1 hour)
   - Location: Picnic location
   - Description: "Set up and enjoy your picnic at [Location]"

4. **Wrap-Up** (Step 4 - Wrap-up)
   - Duration: 15 minutes
   - Location: Picnic location
   - Description: "Clean up and enjoy final views before leaving"

**Route Duration Calculation**:
```typescript
function calculatePicnicRouteDuration(): number {
  // 20 min shopping + travel + 60 min picnic + 15 min cleanup = ~120 minutes
  return 120;  // 2 hours
}
```

#### Response Payload
```typescript
{
  picnicData: {
    picnic: {
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address?: string;
    };
    groceryStore: {
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address: string;
      // ... other store properties
    };
    route: {
      duration: number;      // 120 minutes
      startLocation: { lat: number; lng: number };
      endLocation: { lat: number; lng: number };
    };
    timeline: Array<{
      step: number;
      type: "start" | "travel" | "activity" | "wrap-up";
      title: string;
      location: any;
      description: string;
      duration: number;      // Minutes
    }>;
  }
}
```

---

## Data Structures

### Timeline Step Object
```typescript
interface TimelineStep {
  step: number;                    // Sequential step number
  type: string;                    // "start" | "walk" | "pause" | "activity" | "travel" | "wrap-up"
  title: string;                   // Display title (e.g., "Arrival & Welcome")
  location: {
    id: string;
    name: string;
    location: { lat: number; lng: number };
    address: string;
    rating?: number;
    reviewCount?: number;
    imageUrl?: string;
    placeId?: string;
    type?: string;
  };
  description: string;             // Human-readable description
  duration: number;                // Duration in minutes
}
```

### Stroll Data Object
```typescript
interface StrollData {
  anchor: {
    id: string;
    name: string;
    location: { lat: number; lng: number };
    address?: string;
  };
  companionStops: any[];           // Array with top-ranked companion stop
  route: {
    duration: number;
    startLocation: { lat: number; lng: number };
    endLocation: { lat: number; lng: number };
  };
  timeline: TimelineStep[];
}
```

### Picnic Data Object
```typescript
interface PicnicData {
  picnic: {
    id: string;
    name: string;
    location: { lat: number; lng: number };
    address?: string;
  };
  groceryStore: {
    id: string;
    name: string;
    location: { lat: number; lng: number };
    address: string;
    rating: number;
    reviewCount: number;
    imageUrl: string | null;
    placeId: string;
    type: string;
    distance: number;
  };
  route: {
    duration: number;
    startLocation: { lat: number; lng: number };
    endLocation: { lat: number; lng: number };
  };
  timeline: TimelineStep[];
}
```

---

## Key Features

### 1. **On-Demand Data Loading**
- Timeline data is only fetched when user clicks "See Full Plan"
- Reduces initial page load time for card modals
- Data is cached in component state and updated context

### 2. **Google Places API Integration**
- Uses **Google Places API (New)** for real-time location data
- Searches for relevant nearby locations:
  - **Stroll**: Companion stops (cafés, bakeries, ice cream shops)
  - **Picnic**: Grocery stores and supermarkets
- Provides ratings, reviews, photos, and formatted addresses

### 3. **Smart Location Sorting**
- **Stroll**: Returns highest-rated companion stop
- **Picnic**: Sorts by distance first, then rating (closest + best-rated wins)

### 4. **Interactive Timeline Display**
- First step expanded by default
- Users can expand/collapse each step
- Visual indicators: Flag icon for start, circles for stops
- Color changes based on expansion state (orange when expanded)

### 5. **Map Integration**
- "Open in Maps" button on each location card
- Uses Google Maps deep linking
- Supports both coordinates and address-based queries
- Works across platforms (iOS, Android)

### 6. **Data Persistence**
- Timeline data can be saved to database via callbacks:
  - `onStrollDataFetched(card, fetchedStrollData)`
  - `onPicnicDataFetched(card, fetchedPicnicData)`
- Cached in UI context for later access

### 7. **Responsive Design**
- Timeline line spans full height
- Step content is horizontally scrollable if needed
- Location cards with clickable elements
- Touch-friendly expand/collapse interaction

---

## Timeline Display Details

### Visual Structure

```
┌─────────────────────────────────────┐
│  Flag  Start                        │ ◄── First step (expanded by default)
│   │    Arrival & Welcome            │
│   │    ➜ Begin at [Companion Stop]  │
│   │                                  │
│   │    [Location Card]              │
│   │    📍 [Address]  [Open in Maps]  │
│   │                                  │
│   │    ────── Then... ──────        │
│   │                                  │
│  ●│    Stop 1                        │
│   │    Main Activity                 │
│   │    ➜ Walk to [Anchor]            │ ◄── Collapsed (tap to expand)
│   │                                  │
│  ●│    Stop 2                        │
│   │    Pause & Enjoy                 │
│   │    ➜ Take a moment...            │ ◄── Collapsed (tap to expand)
│   │                                  │
│  ●│    Stop 3                        │
│   └    Closing Touch                 │
│        ➜ End at [Anchor]             │ ◄── Collapsed (tap to expand)
│
│ Legend:
│ Flag (🚩) = Start point
│ ● = Regular stop
│ ──── = Vertical timeline line
```

### Step Expansion Animation
- Tapping a step header toggles expansion
- Expanded state shows:
  - Full description text
  - Location card with address
  - "Then..." separator (between steps)
- Icon changes: `chevron-down` → `chevron-up`
- Color changes: Gray → Orange

### Location Card Components
```
┌────────────────────────────────────────┐
│ 📍 123 Main Street, City, Country     │
│                                        │
│ [Open in Maps] 🚀 ➜                   │
└────────────────────────────────────────┘
```

- **Location pin icon**: Orange (#eb7825)
- **Address text**: Formatted from Places API
- **Open in Maps button**: 
  - Airplane icon + text + arrow
  - Triggers deep link to Maps
  - Works with coordinates or address

---

## Component Props

### TimelineSection Props
```typescript
interface TimelineSectionProps {
  category: string;                      // Card category (e.g., "Take a Stroll")
  title: string;                         // Card/experience title
  address?: string;                      // Card address
  priceRange?: string;                   // Price range (optional)
  travelTime?: string;                   // Travel time (optional)
  strollTimeline?: TimelineStep[];       // Timeline steps from API
  routeDuration?: number;                // Total route duration in minutes
  currency?: string;                     // Currency code for prices
}
```

### ExpandedCardModal Props (Relevant to See Full Plan)
```typescript
export interface ExpandedCardModalProps {
  visible: boolean;                      // Modal visibility
  card: GeneratedExperience;            // Card data
  accountPreferences?: AccountPreferences;
  onStrollDataFetched?: (card: GeneratedExperience, data: any) => Promise<void>;
  onPicnicDataFetched?: (card: GeneratedExperience, data: any) => Promise<void>;
  // ... other props
}
```

---

## Error Handling

### Frontend Error Handling
Both `fetchStrollData` and `fetchPicnicData` include try-catch blocks:
```typescript
try {
  const fetchedData = await ExperienceGenerationService.fetch...Data();
  if (fetchedData) {
    setData(fetchedData);
    // Update context and database
  }
} catch (err) {
  console.error("Error fetching data:", err);
  // Error is logged but button remains visible for retry
}
```

### Backend Error Handling
Both functions return proper HTTP responses:
- **400**: Missing required parameters (location)
- **500**: API key not configured or API errors
- Returns `null` data with error message for graceful degradation

### Fallback Timeline
If fetched timeline data is unavailable, `TimelineSection` has a fallback:
```typescript
const timeline = generateTimeline({
  category, title, address, priceRange, travelTime
});
```

---

## Related Services

### ExperienceGenerationService
**Location**: `app-mobile/src/services/experienceGenerationService.ts`

Two key methods:
```typescript
// For stroll cards - fetches companion stops
static async fetchCompanionStrollData(anchor: AnchorData): Promise<StrollData | null>

// For picnic cards - fetches grocery stores
static async fetchPicnicGroceryData(picnic: PicnicData): Promise<PicnicData | null>
```

Both methods:
- Invoke Supabase Edge Functions
- Handle errors gracefully
- Return structured data or null

### RecommendationsContext
**Location**: `app-mobile/src/contexts/RecommendationsContext.tsx`

Provides:
```typescript
const { updateCardStrollData } = useRecommendations();
```

Updates card data in app-wide cache:
```typescript
updateCardStrollData(card.id, fetchedStrollData);
```

---

## User Experience Flow

```
User Opens Card
       ↓
[See Full Plan Button Visible]
       ↓
User Clicks Button
       ↓
Button Disabled + Loading Spinner
       ↓
API Request to get-companion-stops or get-picnic-grocery
       ↓
Google Places API Search (500m or 2km radius)
       ↓
Timeline Generated
       ↓
Data Returned + Cached
       ↓
Button Hidden + TimelineSection Displays
       ↓
User Expands/Collapses Steps
       ↓
User Clicks "Open in Maps" → Google Maps Deep Link
       ↓
User Views Location in Maps App
```

---

## Performance Considerations

### Optimization Strategies
1. **Lazy Loading**: Timeline fetched only on demand, not on card open
2. **Single Result**: Returns only top-ranked location, not full list
3. **Caching**: Data cached in component state and context
4. **Database Persistence**: Optional callback to store data long-term
5. **API Efficiency**: Uses field mask to request only needed data from Places API

### Request Latency
- Typical response time: **2-5 seconds**
- Depends on:
  - Network speed
  - Google Places API response time
  - Distance to companion locations

---

## Future Enhancement Opportunities

1. **Multiple Companion Stops**: Show 2-3 options instead of just top result
2. **User Preferences**: Filter stops by cuisine type, rating threshold
3. **Time-Based Suggestions**: Adjust timeline based on time of day
4. **Weather Integration**: Include weather data in timeline
5. **Cost Estimation**: Add estimated costs for each step
6. **Save/Share Timeline**: Allow users to share generated timelines
7. **Offline Mode**: Cache timelines for offline viewing
8. **AI Personalization**: Tailor steps based on user preferences/history

---

## Testing Checklist

### Functional Testing
- [ ] Stroll card displays "See Full Plan" button
- [ ] Picnic card displays "See Full Plan" button
- [ ] Other card types don't show the button
- [ ] Button shows loading state correctly
- [ ] Timeline appears after data loads
- [ ] Timeline steps are expandable/collapsible
- [ ] "Open in Maps" opens correct location
- [ ] Repeated button clicks fetch data only once
- [ ] Data persists after modal close/reopen

### Edge Cases
- [ ] No companion stops found (error handling)
- [ ] No grocery stores found (error handling)
- [ ] No location coordinates in card
- [ ] Offline network request
- [ ] Google API key missing
- [ ] Very long address/title text
- [ ] Zero distance to location (exact coordinate match)

### UI/UX Testing
- [ ] Timeline renders without overflow
- [ ] Text truncation works properly
- [ ] Icons display correctly
- [ ] Colors match design system
- [ ] Animation is smooth
- [ ] Touch targets are adequate (>44px)
- [ ] Responsive across screen sizes

---

## Code References

### Key Files
1. **ExpandedCardModal.tsx** - Button logic, fetch functions, state management
2. **TimelineSection.tsx** - Timeline display, expansion logic, styling
3. **experienceGenerationService.ts** - Service methods for API calls
4. **get-companion-stops/index.ts** - Stroll timeline generation
5. **get-picnic-grocery/index.ts** - Picnic timeline generation
6. **Supabase Functions** - Serverless API endpoints

### Line Numbers (ExpandedCardModal.tsx)
- Button code: Lines 460-526
- Fetch functions: Lines 155-244
- Timeline rendering: Lines 656-680

### Styling
- Components use React Native `StyleSheet.create()`
- Colors: Orange (#eb7825) for primary actions
- Responsive sizing using dimensions

---

## Conclusion

The "See Full Plan" feature is a sophisticated on-demand experience generator that combines:
- Real-time location data from Google Places API
- Intelligent timeline generation
- Interactive UI components
- Seamless map integration

It provides users with actionable, detailed plans for their "Take a Stroll" and "Picnic" activities, enhancing their experience planning and execution.
