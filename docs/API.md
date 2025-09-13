# API Documentation

This document describes the available API endpoints for the Mingla app.

## Base URL

All API endpoints are available under `/api/` when running locally, or at the deployed Supabase Edge Functions URL.

## Authentication

Most endpoints require authentication via Supabase Auth. Include the authorization header:

```
Authorization: Bearer <supabase_access_token>
```

## Endpoints

### 1. Places API

**Endpoint:** `/api/places`  
**Method:** `POST`  
**Description:** Fetch nearby places based on location and preferences

#### Request Body

```json
{
  "lat": 47.6062,
  "lng": -122.3321,
  "radiusMeters": 5000,
  "category_slug": "dining",
  "openAtIso": "2024-01-15T18:00:00Z"
}
```

#### Parameters

- `lat` (number, required): Latitude coordinate
- `lng` (number, required): Longitude coordinate  
- `radiusMeters` (number, optional): Search radius in meters (default: 5000)
- `category_slug` (string, optional): Filter by category slug
- `openAtIso` (string, optional): ISO timestamp to check if venues are open

#### Response (Mock Mode - No Google Maps API Key)

```json
{
  "results": [
    {
      "id": "mock-1",
      "title": "Pike Place Market",
      "category": "Market & Shopping",
      "category_slug": "shopping",
      "image_url": "https://images.unsplash.com/photo-1441986300917-64674bd600d8",
      "price_min": 15,
      "price_max": 50,
      "duration_min": 120,
      "lat": 47.6097,
      "lng": -122.3331,
      "place_id": "mock-pike-place",
      "opening_hours": {
        "open_now": true,
        "periods": [
          {
            "open": { "day": 1, "time": "0900" },
            "close": { "day": 1, "time": "1800" }
          }
        ]
      }
    }
  ],
  "source": "mock"
}
```

#### Response (Live Mode - With Google Maps API Key)

```json
{
  "results": [
    {
      "id": "ChIJVVVVVVVVVVVVVVVVVVVVVV",
      "title": "Real Restaurant Name",
      "category": "Dining Experience", 
      "category_slug": "dining",
      "image_url": "https://maps.googleapis.com/maps/api/place/photo?...",
      "price_min": 25,
      "price_max": 75,
      "duration_min": 90,
      "lat": 47.6097,
      "lng": -122.3331,
      "place_id": "ChIJVVVVVVVVVVVVVVVVVVVVVV",
      "opening_hours": {
        "open_now": true,
        "periods": [...]
      }
    }
  ],
  "source": "google_places"
}
```

### 2. Weather API

**Endpoint:** `/api/weather`  
**Method:** `POST`  
**Description:** Get current weather conditions for a location

#### Request Body

```json
{
  "lat": 47.6062,
  "lng": -122.3321
}
```

#### Parameters

- `lat` (number, required): Latitude coordinate
- `lng` (number, required): Longitude coordinate

#### Response (Mock Mode - No OpenWeather API Key)

```json
{
  "current": {
    "temp": 72,
    "feels_like": 75,
    "humidity": 65,
    "weather": [
      {
        "main": "Clear",
        "description": "clear sky",
        "icon": "01d"
      }
    ],
    "wind_speed": 5.2
  },
  "alerts": [],
  "source": "mock"
}
```

#### Response (Live Mode - With OpenWeather API Key)  

```json
{
  "current": {
    "temp": 68.5,
    "feels_like": 71.2,
    "humidity": 72,
    "weather": [
      {
        "main": "Clouds",
        "description": "overcast clouds", 
        "icon": "04d"
      }
    ],
    "wind_speed": 8.1
  },
  "alerts": [
    {
      "event": "Small Craft Advisory",
      "description": "...SMALL CRAFT ADVISORY IN EFFECT..."
    }
  ],
  "source": "openweathermap"
}
```

### 3. AI Reasoning API

**Endpoint:** `/api/ai-reason`  
**Method:** `POST`  
**Description:** Get AI-powered recommendations for experiences based on context

#### Request Body

```json
{
  "weather": {
    "current": {
      "temp": 72,
      "weather": [{"main": "Clear"}]
    }
  },
  "preferences": {
    "categories": ["dining", "stroll"],
    "budget_min": 20,
    "budget_max": 80
  },
  "venue": {
    "title": "Pike Place Market",
    "category": "Market & Shopping",
    "duration_min": 120,
    "lat": 47.6097,
    "lng": -122.3331
  }
}
```

#### Response (Rules-Based Mode - No OpenAI API Key)

```json
{
  "weather_badge": "☀️",
  "adjusted_duration": 120,
  "safety_notes": "Perfect weather for exploring!",
  "indoor_alternative": null,
  "reasoning": "Clear skies and comfortable temperature make this ideal for outdoor activities.",
  "source": "rules"
}
```

#### Response (AI Mode - With OpenAI API Key)

```json
{
  "weather_badge": "☀️", 
  "adjusted_duration": 135,
  "safety_notes": "Great weather! Consider bringing sunglasses.",
  "indoor_alternative": "Seattle Art Museum nearby if you prefer AC",
  "reasoning": "The clear weather and your interest in markets make this a perfect match. The slightly longer duration accounts for potential crowds on this beautiful day.",
  "source": "openai"
}
```

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE"
  }
}
```

Common HTTP status codes:
- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (missing/invalid auth token)
- `403` - Forbidden (insufficient permissions)
- `500` - Internal Server Error

## Rate Limits

- Places API: 100 requests per minute per user
- Weather API: 60 requests per minute per user  
- AI Reasoning API: 30 requests per minute per user

## Data Sources

The app seamlessly switches between mock data and live API data:

- **Mock Mode**: Used when API keys are not configured
- **Live Mode**: Uses real data from Google Places, OpenWeather, and OpenAI APIs

This allows development and testing without requiring all API keys upfront.