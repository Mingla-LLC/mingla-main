# Curated Date Cards System

A production-ready recommendation system that combines Google Places, Eventbrite, and LLM-powered copywriting to deliver personalized, location-based activity suggestions.

## Features

- **Multi-source Data**: Google Places API + Eventbrite integration
- **Smart Filtering**: Budget, travel time/distance, category-based filtering
- **LLM Enhancement**: OpenAI-powered copywriting for engaging descriptions
- **Travel Integration**: Deep links to Google Maps with proper travel modes
- **Real-time Updates**: Live preference application with instant results
- **Responsive Design**: Mobile-optimized card grid with smooth animations

## API Endpoints

### POST /recommendations

**Request Schema:**
```typescript
{
  budget: { min: number, max: number, perPerson: boolean },
  categories: string[], // ['sip', 'casual_eats', 'stroll', etc.]
  timeWindow: { 
    kind: 'Now' | 'Tonight' | 'ThisWeekend' | 'Custom',
    start?: string | null,
    end?: string | null,
    timeOfDay: string
  },
  travel: {
    mode: 'WALKING' | 'DRIVING' | 'TRANSIT',
    constraint: { 
      type: 'TIME' | 'DISTANCE',
      maxMinutes?: number,
      maxDistance?: number
    }
  },
  origin: { lat: number, lng: number },
  units: 'metric' | 'imperial'
}
```

**Response Schema:**
```typescript
{
  cards: [
    {
      id: string,
      title: string,
      subtitle: string,
      category: string,
      priceLevel: number,
      estimatedCostPerPerson: number,
      startTime: string,
      durationMinutes: number,
      imageUrl: string,
      address: string,
      location: { lat: number, lng: number },
      route: {
        mode: 'WALKING' | 'DRIVING' | 'TRANSIT',
        etaMinutes: number,
        distanceText: string,
        mapsDeepLink: string
      },
      source: { 
        provider: 'google_places' | 'eventbrite',
        placeId?: string,
        eventId?: string
      },
      copy: {
        oneLiner: string, // ≤14 words
        tip: string       // ≤18 words
      },
      actions: { invite: boolean, save: boolean, share: boolean }
    }
  ]
}
```

## Environment Variables

```bash
# Required API Keys
GOOGLE_API_KEY=your_google_places_api_key
EVENTBRITE_TOKEN=your_eventbrite_api_token
OPENAI_API_KEY=your_openai_api_key

# Optional Configuration
LLM_CACHE_TTL=604800  # 7 days in seconds
MAX_LLM_COST_PER_REQUEST=0.02  # $0.02 cap
DISTANCE_MATRIX_BATCH_SIZE=25
```

## Category Mapping

| Category | Google Place Types |
|----------|-------------------|
| Take a Stroll | park, tourist_attraction, point_of_interest, natural_feature |
| Sip & Chill | bar, cafe, night_club |
| Casual Eats | restaurant, food_court, food_truck |
| Screen & Relax | movie_theater, spa |
| Creative & Hands-On | art_gallery, escape_room, pottery_studio |
| Play & Move | bowling_alley, gym, sports_complex, climbing_gym |
| Dining Experience | restaurant (price_level ≥ 2, rating ≥ 4.2) |
| Freestyle | Union of all categories + trending events |

## Rate Limiting Strategy

- **Google Places**: 1000 requests/day, batched with exponential backoff
- **Distance Matrix**: 25 origins × destinations per request, cached for 1 hour
- **Eventbrite**: 1000 requests/hour with circuit breaker pattern
- **OpenAI**: Cost-capped at $0.02 per request, 4-second timeout

## Scoring Algorithm

```
Score = 0.3×rating + 0.2×log(reviews) + 0.2×(-etaMinutes) + 0.2×budgetFit + 0.1×photoQuality
```

**Diversity (MMR)**: Ensures top 20 results include variety by category and price level.

## Usage Examples

### Basic Integration
```typescript
import { RecommendationsGrid } from '@/components/RecommendationsGrid';
import { convertPreferencesToRequest } from '@/utils/preferencesConverter';

const preferences = convertPreferencesToRequest({
  budgetRange: [25, 100],
  categories: ['sip', 'casual_eats'],
  time: 'tonight',
  travel: 'drive',
  // ... other preferences
});

<RecommendationsGrid
  preferences={preferences}
  onAdjustFilters={() => openPreferences()}
  onInvite={handleInvite}
  onSave={handleSave}
/>
```

### Custom Card Actions
```typescript
const handleCardInvite = (card: RecommendationCard) => {
  // Integrate with collaboration system
  inviteToSession(card);
};

const handleCardSave = (card: RecommendationCard) => {
  // Save to user's favorites
  saveToFavorites(card);
};
```

## Testing

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration  

# E2E tests
npm run test:e2e

# All tests
npm test
```

## Performance

- **Cold start**: ~2.5s (includes API calls + LLM processing)
- **Warm cache**: ~500ms
- **Image optimization**: WebP with fallbacks, lazy loading
- **Bundle impact**: +45KB gzipped (Framer Motion + utilities)

## Monitoring

The system logs the following metrics:
- `recos_requested`: Number of recommendation requests
- `recos_returned`: Number of cards returned
- `llm_used`: Whether LLM enhancement was applied
- `provider_errors`: API failures by provider
- `processing_time_ms`: Total request processing time

## Error Handling

- **Graceful degradation**: System continues with available providers if one fails
- **Fallback content**: Heuristic copy generation if LLM times out
- **User feedback**: Clear error states with actionable next steps
- **Rate limit handling**: Exponential backoff with circuit breakers
