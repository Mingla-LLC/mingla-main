import { supabase } from "@/integrations/supabase/client";
import type { WeatherData } from "../weather";

export interface ReasoningResult {
  weather_badge: string;
  adjusted_duration: number;
  safety_notes: string[];
  indoor_alternative?: string;
}

interface ReasoningInput {
  weather: WeatherData | null;
  preferences: any;
  venue: {
    title: string;
    category: string;
    duration_min: number;
    lat: number;
    lng: number;
  };
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

function getRuleBasedReasoning(weather: WeatherData | null, venue: any): ReasoningResult {
  const result: ReasoningResult = {
    weather_badge: '🌤️',
    adjusted_duration: venue.duration_min,
    safety_notes: []
  };

  if (!weather) return result;

  const { condition, feels_like, precip_prob, wind } = weather;

  // Weather badge logic
  if (precip_prob > 50) {
    result.weather_badge = '☔';
    result.safety_notes.push('Bring an umbrella or raincoat');
  } else if (feels_like > 30) {
    result.weather_badge = '🔥';
    result.safety_notes.push('Stay hydrated and seek shade');
    result.adjusted_duration = Math.round(venue.duration_min * 0.75); // Reduce by 25%
  } else if (feels_like < 5) {
    result.weather_badge = '🥶';
    result.safety_notes.push('Dress warmly in layers');
  } else if (condition.includes('clear')) {
    result.weather_badge = '☀️';
  } else if (condition.includes('cloud')) {
    result.weather_badge = '☁️';
  }

  // Extreme weather warnings
  if (feels_like > 35 || feels_like < 0) {
    result.weather_badge = '🚫';
    result.safety_notes.push('Extreme weather conditions - consider indoor alternatives');
    
    // Suggest indoor alternatives based on category
    const indoorAlternatives = {
      'Stroll': 'Visit a nearby shopping mall or indoor garden',
      'Sip & Chill': 'Find a cozy indoor café or bookstore',
      'Play & Move': 'Try an indoor gym or climbing center',
      'Creative': 'Explore indoor galleries or workshops'
    };
    
    result.indoor_alternative = indoorAlternatives[venue.category as keyof typeof indoorAlternatives] || 'Consider indoor activities';
  }

  if (wind > 50) {
    result.safety_notes.push('Very windy - secure loose items');
  }

  if (precip_prob > 70) {
    result.safety_notes.push('High chance of rain - plan for wet weather');
  }

  return result;
}