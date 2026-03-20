# Mingla Stack Reference

## Table of Contents
1. Stack Overview
2. Non-Negotiable Architecture Rules
3. Key File Locations
4. Google Places API (New) — Expert Reference
5. Engineering Principles
6. Supabase Patterns

---

## 1. Stack Overview

**Mobile:**
- React Native (Expo), TypeScript strict mode
- React Query (server state), Zustand (client state)
- StyleSheet (no inline styles, no styled-components)
- Custom state-driven navigation (NO React Navigation library)
- `expo-haptics`, `expo-location`, `expo-calendar`

**Backend:**
- Supabase: PostgreSQL + Auth (JWT + RLS) + Realtime (WebSocket) + Storage
- 25 Deno edge functions
- OpenAI GPT-4o-mini (structured JSON output)

**External APIs:**
- Google Places API (New) + Distance Matrix
- OpenWeatherMap, BestTime.app
- Resend (email), Expo Push (notifications)
- Stripe Connect (payments)
- OpenTable, Eventbrite, Viator (bookings)

---

## 2. Non-Negotiable Architecture Rules

These are not guidelines. Violations are automatic findings.

| Rule | Violation = |
|------|------------|
| All third-party API calls through edge functions | NEVER from mobile directly |
| RLS on every table | No table without a policy — ever |
| React Query for ALL server state | No server data in Zustand |
| Zustand ONLY for client-only persisted state | Preferences, navigation, local UI |
| AsyncStorage persistence | For both React Query cache and Zustand |
| TypeScript strict mode | No `any`, no `@ts-ignore`, no `as unknown as` |
| StyleSheet.create() for all styles | No inline style objects `style={{}}` |
| No React Navigation | Custom state-driven nav via context/Zustand |
| Named exports for components | Default exports for screens only |
| Functional components only | No class components |

---

## 3. Key File Locations

```
app-mobile/
├── app/                    # Entry point (index.tsx = AppContent)
├── components/             # ~80+ UI components
├── hooks/                  # ~28 React Query hooks
├── services/               # ~53 service files (Supabase + API calls)
├── contexts/               # 3 React contexts
├── store/                  # Zustand store (1 file)
├── types/                  # TypeScript types (database + domain)
├── constants/              # Design tokens, config, categories
└── utils/                  # 12 utility files

supabase/
├── functions/              # 25 Deno edge functions
└── migrations/             # 30+ SQL migration files
```

---

## 4. Google Places API (New) — Expert Reference

Mingla uses the **Google Places API (New)**, not legacy. Every spec involving Places must
use these exact patterns.

### Endpoints
| Operation | Method | URL |
|-----------|--------|-----|
| Nearby Search | POST | `https://places.googleapis.com/v1/places:searchNearby` |
| Text Search | POST | `https://places.googleapis.com/v1/places:searchText` |
| Place Details | GET | `https://places.googleapis.com/v1/places/{place_id}` |

### Authentication
Header: `X-Goog-Api-Key: ${GOOGLE_PLACES_API_KEY}`
**NEVER** as a query parameter. Always via Deno edge function (`Deno.env.get()`).

### Field Masks
Always include `X-Goog-FieldMask` header. Every field costs money. Specify exact fields in
every spec — never leave mask choice to the implementor.

Common mask: `places.id,places.displayName,places.location,places.rating,places.priceLevel,places.regularOpeningHours,places.photos`

### Nearby Search Body
```json
{
  "includedTypes": ["restaurant"],
  "maxResultCount": 20,
  "locationRestriction": {
    "circle": {
      "center": { "latitude": 37.7749, "longitude": -122.4194 },
      "radius": 1000.0
    }
  },
  "rankPreference": "POPULARITY"
}
```

### Response Gotchas (common source of bugs)
| Field | Reality | Common Mistake |
|-------|---------|---------------|
| `displayName` | `{ text: "Name", languageCode: "en" }` | Treating as flat string |
| `location` | `{ latitude: N, longitude: N }` | Using `{ lat, lng }` |
| `priceLevel` | `"PRICE_LEVEL_MODERATE"` (enum string) | Using number `2` |
| `places` array | May be ABSENT from response | Assuming empty array `[]` |
| `regularOpeningHours` | Complex nested object | Not checking if field exists |

### Price Levels
`PRICE_LEVEL_FREE` | `PRICE_LEVEL_INEXPENSIVE` | `PRICE_LEVEL_MODERATE` |
`PRICE_LEVEL_EXPENSIVE` | `PRICE_LEVEL_VERY_EXPENSIVE`

### Distance Matrix
URL: `https://maps.googleapis.com/maps/api/distancematrix/json`
Batch: up to 25 origins × 25 destinations per request.
Travel modes: `walking` | `driving` | `transit` | `bicycling`

### Cost Optimization Rules (Non-Negotiable)
1. **Filter first** — filter by type and price BEFORE calling Distance Matrix
2. **Minimum field masks** — request only fields the feature uses
3. **Cache 24h+** — cache place details in Supabase with `expires_at` column
4. **Batch Distance Matrix** — never individual calls per destination
5. **Check cache before API** — never fetch what we already have

---

## 5. Engineering Principles

Apply to every spec and every investigation.

### Performance
- Paginate all list queries (limit 20, cursor-based)
- Cache aggressively: staleTime 5min for user data, 24h for place details
- Debounce search inputs (300ms)
- Field masks on all Places API calls — exact mask specified in spec

### Reliability
- Every edge function: try/catch with `{ error: string }` response shape
- Every async operation on mobile: loading, error, and empty states
- Optimistic updates for instant-feel actions (likes, saves, swipes)
- Idempotency: every edge function must be safe if called twice

### Security
- RLS on every new table — exact policies written in spec
- API keys never on mobile — all third-party calls through edge functions
- Input validation at edge function level — specific rules, specific error messages

### Data Integrity
- Constraints in schema, not just application code
- Foreign keys with explicit ON DELETE behavior (CASCADE where appropriate)
- Uniqueness constraints where business logic requires uniqueness
- Check constraints where values have bounded valid ranges
- Retention policies for tables that can grow unbounded

### Lifecycle Completeness
- Every creation path must have a corresponding cleanup path
- Every cached value must have an invalidation trigger
- Every scheduled job must be monitored for health
- Every derived dataset must be rebuildable from source

### Code Style (Match Existing Codebase)
- TypeScript strict — explicit types, no `any`
- React Query for all server state, Zustand for client-only state
- Functional components only, no class components
- StyleSheet.create() for all styles
- Named exports for components, default exports for screens
- Import order: React → libraries → local files

---

## 6. Supabase Patterns

### Standard Edge Function Shape
```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // implementation

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
```

### React Query Key Convention
```typescript
export const featureKeys = {
  all: ['feature'] as const,
  lists: () => [...featureKeys.all, 'list'] as const,
  list: (filters: Filters) => [...featureKeys.lists(), filters] as const,
  detail: (id: string) => [...featureKeys.all, 'detail', id] as const,
}
```

### Standard RLS Pattern
```sql
ALTER TABLE public.table_name ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own" ON public.table_name
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own" ON public.table_name
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own" ON public.table_name
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own" ON public.table_name
  FOR DELETE USING (auth.uid() = user_id);
```