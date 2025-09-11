import { supabase } from "@/integrations/supabase/client";

export interface WeatherData {
  condition: string;
  feels_like: number;
  precip_prob: number;
  uv_index: number;
  wind: number;
  alerts: string[];
}

export async function getWeather(lat: number, lng: number): Promise<WeatherData | null> {
  try {
    const { data, error } = await supabase.functions.invoke('weather', {
      body: { lat, lng }
    });

    if (error) {
      console.error('Weather API error:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Weather fetch error:', error);
    return null;
  }
}

export function getWeatherBadge(weather: WeatherData | null): string {
  if (!weather) return '';
  
  const { condition, feels_like, precip_prob } = weather;
  
  if (precip_prob > 50) return '☔';
  if (feels_like > 30) return '🔥';
  if (feels_like < 5) return '🥶';
  if (condition.includes('cloud')) return '☁️';
  if (condition.includes('clear') || condition.includes('sun')) return '☀️';
  
  return '🌤️';
}

export function getWeatherWarning(weather: WeatherData | null): string | null {
  if (!weather) return null;
  
  const { feels_like, precip_prob, wind } = weather;
  
  if (feels_like > 35) return '🚫 Extreme heat - consider indoor alternatives';
  if (feels_like < 0) return '🚫 Freezing conditions - dress warmly';
  if (precip_prob > 70) return '☔ High chance of rain - bring umbrella';
  if (wind > 50) return '💨 Very windy conditions';
  
  return null;
}