# Experience Categories

This document describes the 8 experience categories available in the Mingla app.

## Category List

| Slug | Display Name | Icon | Description |
|------|-------------|------|-------------|
| `stroll` | Take a Stroll | 🚶‍♀️ | Walking experiences, parks, neighborhoods, scenic routes |
| `sip` | Sip & Chill | ☕ | Coffee shops, tea houses, casual drinking spots, lounges |
| `dining` | Dining Experience | 🍽️ | Restaurants, food markets, culinary experiences |
| `creative` | Creative & Hands-On | 🎨 | Art studios, workshops, maker spaces, creative activities |
| `shopping` | Market & Shopping | 🛍️ | Markets, boutiques, unique shopping experiences |
| `wellness` | Health & Wellness | 🧘‍♀️ | Spas, yoga studios, fitness activities, wellness centers |
| `culture` | Arts & Culture | 🎭 | Museums, galleries, theaters, cultural events |
| `nightlife` | Social & Nightlife | 🌃 | Bars, clubs, social venues, evening entertainment |

## Usage in API

### Category Filtering

When making requests to `/api/places`, use the `category_slug` parameter:

```json
{
  "lat": 47.6062,
  "lng": -122.3321,
  "category_slug": "dining"
}
```

### User Preferences

Users can select multiple categories in their preferences:

```json
{
  "categories": ["stroll", "sip", "dining"]
}
```

### Experience Data

Each experience in the database has both fields:

- `category_slug`: Machine-readable identifier (e.g., "stroll")
- `category`: Human-readable name (e.g., "Take a Stroll")

## Implementation Notes

### Frontend Usage

```typescript
import { categories } from '@/lib/categories';

// Get category by slug
const category = getCategoryBySlug('stroll');
console.log(category.name); // "Take a Stroll"
console.log(category.icon); // "🚶‍♀️"

// Display all categories
categories.map(cat => ({
  slug: cat.slug,
  name: cat.name,
  icon: cat.icon
}));
```

### Database Storage

Categories are stored as text slugs in the database:

```sql
-- experiences table
category_slug TEXT NOT NULL, -- e.g., 'stroll'
category TEXT NOT NULL,      -- e.g., 'Take a Stroll'

-- preferences table  
categories ARRAY DEFAULT ARRAY['stroll'::text, 'sip'::text]
```

### Google Places Mapping

When fetching from Google Places API, place types are mapped to our categories:

| Google Place Types | Maps to Category |
|-------------------|-----------------|
| restaurant, food, meal_takeaway | dining |
| park, tourist_attraction | stroll |
| cafe, coffee_shop | sip |
| art_gallery, museum | culture |
| shopping_mall, store | shopping |
| spa, gym, health | wellness |
| bar, night_club | nightlife |
| art_school, craft_store | creative |

## Design Guidelines

### Icons
- Use emoji for consistency across platforms
- Single emoji per category
- Should be recognizable and universally understood

### Display Names  
- Keep under 20 characters
- Use "&" instead of "and" for space efficiency
- Should be descriptive but concise

### Slugs
- Lowercase, single word preferred
- Use hyphens for multi-word categories (though current categories avoid this)
- Must be URL-safe and database-friendly

## Future Considerations

If adding new categories:
1. Update `src/lib/categories.ts`
2. Update this documentation
3. Consider Google Places mapping
4. Test across all UI components
5. Update default preferences if needed

The 8-category limit maintains UI simplicity while covering most urban experiences users seek.