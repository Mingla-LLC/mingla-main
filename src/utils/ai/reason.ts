import { supabase } from "@/integrations/supabase/client";

export interface ReasoningResult {
  weather_badge: string;
  adjusted_duration: number;
  safety_notes: string;
  indoor_alternative?: string;
}

interface WeatherData {
  current: {
    temp: number;
    feels_like?: number;
    humidity?: number;
    weather: Array<{
      main: string;
      description: string;
      icon: string;
    }>;
    wind_speed?: number;
  };
  alerts?: Array<{
    event: string;
    description: string;
  }>;
}

interface UserPreferences {
  categories?: string[];
  budget_min?: number;
  budget_max?: number;
  travel_mode?: string;
  [key: string]: any;
}

interface Venue {
  title: string;
  category: string;
  duration_min: number;
  lat: number;
  lng: number;
}

interface ReasoningInput {
  weather: WeatherData | null;
  preferences?: UserPreferences;
  venue: Venue;
}

export async function reasonCardNotes(input: ReasoningInput): Promise<ReasoningResult> {
  const { weather, venue } = input;
  
  // Try OpenAI first if available
  const openaiResult = await tryOpenAIReasoning(input);
  if (openaiResult) return openaiResult;
  
  // Fallback to rule-based reasoning
  return getRuleBasedReasoning(weather, venue);
}

async function tryOpenAIReasoning(input: ReasoningInput): Promise<ReasoningResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-reason', {
      body: input
    });

    if (error || !data) {
      console.log('OpenAI reasoning unavailable, using fallback');
      return null;
    }

    return data;
  } catch (error) {
    console.log('OpenAI reasoning failed, using fallback:', error);
    return null;
  }
}

function getRuleBasedReasoning(weather: WeatherData | null, venue: Venue): ReasoningResult {
  const result: ReasoningResult = {
    weather_badge: '🌤️',
    adjusted_duration: venue.duration_min,
    safety_notes: 'Perfect weather for exploring!'
  };

  if (!weather) return result;

  const temp = weather.current.temp;
  const weatherCondition = weather.current.weather[0]?.main?.toLowerCase() || '';
  const hasAlerts = weather.alerts && weather.alerts.length > 0;

  // Rules-based logic
  if (hasAlerts) {
    // Extreme weather alerts
    result.weather_badge = '🚫';
    result.safety_notes = 'Consider an indoor option due to weather alerts.';
    result.adjusted_duration = Math.round(venue.duration_min * 0.5); // Reduce by 50%
    result.indoor_alternative = getIndoorAlternative(venue);
  } else if (weatherCondition.includes('rain')) {
    // Rain conditions
    result.weather_badge = '☔';
    result.safety_notes = 'Bring an umbrella and waterproof gear.';
    result.adjusted_duration = Math.round(venue.duration_min * 0.75); // Reduce by 25%
  } else if (temp >= 85) {
    // Hot weather (≥85°F)
    result.weather_badge = '🔥';
    result.safety_notes = 'Stay hydrated and take breaks in shade.';
    result.adjusted_duration = Math.round(venue.duration_min * 0.75); // Reduce by 25%
  } else if (temp <= 35) {
    // Cold weather
    result.weather_badge = '🥶';
    result.safety_notes = 'Bundle up warm and watch for icy conditions.';
    result.adjusted_duration = Math.round(venue.duration_min * 0.8); // Reduce by 20%
  } else if (weatherCondition.includes('cloud')) {
    // Cloudy but pleasant
    result.weather_badge = '☁️';
    result.safety_notes = 'Great weather for outdoor activities!';
    // No duration adjustment for cloudy weather
  } else {
    // Clear/sunny weather
    result.weather_badge = '☀️';
    result.safety_notes = 'Perfect weather for exploring!';
    // No duration adjustment for perfect weather
  }

  return result;
}

const getIndoorAlternative = (venue: Venue): string => {
  const category = venue.category.toLowerCase();
  
  if (category.includes('market') || category.includes('shopping')) {
    return 'Visit a nearby shopping mall or covered market';
  } else if (category.includes('stroll') || category.includes('walk')) {
    return 'Try a museum or indoor gallery nearby';
  } else if (category.includes('dining')) {
    return 'Look for restaurants with covered patios or indoor seating';
  } else if (category.includes('sip') || category.includes('coffee')) {
    return 'Find a cozy indoor café or coffee shop';
  } else if (category.includes('culture') || category.includes('art')) {
    return 'Check for indoor venues like museums or galleries';
  } else {
    return 'Consider indoor alternatives in the area';
  }
};