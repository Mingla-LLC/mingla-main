/**
 * Weather Service — Open-Meteo API Integration
 *
 * Free, no API key, no rate limits. Data from national weather services.
 * Replaces OpenWeatherMap (ORCH-0419, 2026-04-13).
 */

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

export interface WeatherData {
  temperature: number;
  condition: string;
  icon: string;
  description: string;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  uvIndex?: number;
  precipitation?: number;
  recommendation: string;
  hourlyForecast?: HourlyForecast[];
  timezone?: string;
  utcOffsetSeconds?: number;
}

export interface HourlyForecast {
  time: string;
  temperature: number;
  condition: string;
  icon: string;
  precipitation: number;
}

export interface ActivityRecommendation {
  suitable: boolean;
  message: string;
  suggestions: string[];
}

// ─── WMO Weather Code Mappings ──────────────────────────────────────────────
// Maps WMO 4677 codes to condition strings matching OpenWeatherMap .main values.
// This preserves compatibility with WeatherSection.getWeatherIcon() and
// generateActivityRecommendation() which check condition.includes("rain") etc.

const WMO_CONDITION_MAP: Record<number, string> = {
  0: "Clear",
  1: "Clear",
  2: "Clouds",
  3: "Clouds",
  45: "Mist",
  48: "Mist",
  51: "Drizzle",
  53: "Drizzle",
  55: "Drizzle",
  56: "Drizzle",
  57: "Drizzle",
  61: "Rain",
  63: "Rain",
  65: "Rain",
  66: "Rain",
  67: "Rain",
  71: "Snow",
  73: "Snow",
  75: "Snow",
  77: "Snow",
  80: "Rain",
  81: "Rain",
  82: "Rain",
  85: "Snow",
  86: "Snow",
  95: "Thunderstorm",
  96: "Thunderstorm",
  99: "Thunderstorm",
};

const WMO_DESCRIPTION_MAP: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  56: "light freezing drizzle",
  57: "freezing drizzle",
  61: "light rain",
  63: "moderate rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "freezing rain",
  71: "light snow",
  73: "moderate snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "rain showers",
  82: "heavy rain showers",
  85: "light snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "severe thunderstorm with hail",
};

/**
 * Map WMO code + is_day to OpenWeatherMap-compatible icon code.
 * Preserves compatibility with WeatherSection.getWeatherIcon().
 */
function getWmoIcon(code: number, isDay: number): string {
  const suffix = isDay ? "d" : "n";
  if (code <= 1) return `01${suffix}`;
  if (code === 2) return `02${suffix}`;
  if (code === 3) return `04${suffix}`;
  if (code === 45 || code === 48) return `50${suffix}`;
  if (code >= 51 && code <= 57) return `09${suffix}`;
  if (code >= 61 && code <= 67) return `10${suffix}`;
  if (code >= 71 && code <= 77) return `13${suffix}`;
  if (code >= 80 && code <= 82) return `09${suffix}`;
  if (code >= 85 && code <= 86) return `13${suffix}`;
  if (code >= 95) return `11${suffix}`;
  return `01${suffix}`;
}

class WeatherService {
  private weatherCache = new Map<string, { data: WeatherData; ts: number }>();
  private WEATHER_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

  /**
   * Get current weather for a location from Open-Meteo.
   * `date` parameter kept for API compatibility. Open-Meteo returns current weather only.
   * All current callers pass `new Date()` — no functional change.
   */
  async getWeatherForecast(
    lat: number,
    lng: number,
    date?: Date
  ): Promise<WeatherData | null> {
    // Check cache
    const cacheKey = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
    const cached = this.weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.WEATHER_CACHE_TTL) {
      return cached.data;
    }

    try {
      const params = [
        `latitude=${lat}`,
        `longitude=${lng}`,
        `current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,uv_index,precipitation,is_day`,
        `temperature_unit=fahrenheit`,
        `wind_speed_unit=mph`,
        `precipitation_unit=inch`,
        `timezone=auto`,
      ].join("&");

      const response = await fetch(`${OPEN_METEO_URL}?${params}`);

      if (!response.ok) {
        console.warn("[Weather] Open-Meteo HTTP error:", response.status);
        return null;
      }

      const data = await response.json();
      const current = data.current;

      if (!current) {
        console.warn("[Weather] Open-Meteo response missing 'current' field");
        return null;
      }

      const weatherCode: number = current.weather_code ?? 0;
      const condition = WMO_CONDITION_MAP[weatherCode] || "Clear";

      // Build adapter for generateActivityRecommendation (expects OpenWeatherMap shape)
      const weatherForRec = {
        temp: current.temperature_2m,
        weather: [{ main: condition }],
        wind_speed: current.wind_speed_10m,
        rain: current.precipitation > 0
          ? { "1h": current.precipitation / 0.0393701 } // inches → mm for recommendation logic
          : undefined,
        snow: undefined,
      };

      const recommendation = this.generateActivityRecommendation(
        weatherForRec,
        weatherForRec
      );

      const weatherData: WeatherData = {
        temperature: Math.round(current.temperature_2m),
        condition,
        icon: getWmoIcon(weatherCode, current.is_day ?? 1),
        description: WMO_DESCRIPTION_MAP[weatherCode] || "clear sky",
        feelsLike: Math.round(current.apparent_temperature),
        humidity: current.relative_humidity_2m,
        windSpeed: current.wind_speed_10m,
        uvIndex: current.uv_index,
        precipitation: current.precipitation,
        recommendation,
        hourlyForecast: [],
        timezone: data.timezone,
        utcOffsetSeconds: data.utc_offset_seconds,
      };

      // Cache the result
      this.weatherCache.set(cacheKey, { data: weatherData, ts: Date.now() });

      return weatherData;
    } catch (error) {
      console.warn("[Weather] Open-Meteo error:", error);
      return null;
    }
  }

  /**
   * Generate activity-specific weather recommendations.
   * Unchanged from OpenWeatherMap version — source-agnostic.
   */
  private generateActivityRecommendation(weather: any, current: any): string {
    const temp = weather.temp;
    const condition = weather.weather[0].main.toLowerCase();
    const windSpeed = weather.wind_speed;
    const precipitation = weather.rain?.["1h"] || weather.snow?.["1h"] || 0;

    if (condition.includes("rain") || precipitation > 0) {
      if (temp < 50) {
        return "Cold and rainy. Perfect for cozy indoor experiences like cafes, museums, or workshops.";
      } else if (temp > 75) {
        return "Warm rain expected. Great for covered outdoor areas or indoor venues.";
      } else {
        return "Rain expected. Perfect for indoor experiences like cafes, museums, or workshops.";
      }
    }

    if (condition.includes("snow")) {
      if (temp < 32) {
        return "Freezing with snow. Ideal for cozy indoor venues or winter activities.";
      } else if (temp < 40) {
        return "Cold and snowy. Perfect for indoor activities or winter sports.";
      } else {
        return "Snowy conditions. Ideal for cozy indoor venues or winter activities.";
      }
    }

    if (condition.includes("clear") || condition.includes("sun")) {
      if (temp < 50) {
        return "Clear but chilly. Great for brisk outdoor walks or indoor venues.";
      } else if (temp >= 50 && temp < 60) {
        return "Clear and cool. Good for outdoor activities with a light jacket.";
      } else if (temp >= 60 && temp <= 80) {
        return "Perfect weather! Great for outdoor activities, walks, and picnics.";
      } else if (temp > 80 && temp <= 90) {
        return "Clear and warm. Ideal for outdoor activities in shaded areas or early morning/evening.";
      } else {
        return "Clear but hot. Better for indoor venues or shaded outdoor areas.";
      }
    }

    if (condition.includes("cloud")) {
      if (temp < 50) {
        return "Cloudy and cool. Good for indoor activities or brisk outdoor walks.";
      } else if (temp >= 50 && temp <= 75) {
        return "Partly cloudy with comfortable temperatures. Great conditions for most activities.";
      } else if (temp > 75 && temp <= 85) {
        return "Cloudy but warm. Good for outdoor activities with some shade.";
      } else if (temp > 85) {
        return "Cloudy but hot. Better for indoor venues or shaded outdoor areas.";
      } else {
        return "Partly cloudy. Good conditions for most activities.";
      }
    }

    if (windSpeed > 15) {
      if (temp < 50) {
        return "Windy and cold. Better suited for indoor venues to stay warm.";
      } else if (temp > 80) {
        return "Windy but hot. The breeze helps, but indoor venues may be more comfortable.";
      } else {
        return "Windy conditions. Better suited for indoor venues or sheltered outdoor areas.";
      }
    }

    if (temp < 50) {
      return "Cool weather. Good for indoor activities or layered outdoor experiences.";
    } else if (temp > 85) {
      return "Warm weather. Great for indoor venues or shaded outdoor areas.";
    }

    return "Weather looks good for your planned activity!";
  }

  /**
   * Get activity-specific suitability (kept for future use — currently unused in UI).
   */
  getActivitySuitability(
    weather: WeatherData,
    activityType: string
  ): ActivityRecommendation {
    const suggestions: string[] = [];
    let suitable = true;
    let message = "";

    const isOutdoor = [
      "Take a Stroll",
      "Picnics",
      "Play & Move",
      "Freestyle",
    ].includes(activityType);

    if (isOutdoor) {
      if (weather.precipitation && weather.precipitation > 0.1) {
        suitable = false;
        message = "Rain expected - consider indoor alternatives";
        suggestions.push("Visit a museum or gallery");
        suggestions.push("Try a cozy café or restaurant");
        suggestions.push("Explore indoor markets or shops");
      } else if (weather.temperature < 45) {
        suitable = false;
        message = "Cold weather - dress warmly";
        suggestions.push("Wear layers and bring a jacket");
        suggestions.push("Consider shorter outdoor time");
      } else if (weather.temperature > 90) {
        suitable = false;
        message = "Very hot - stay hydrated";
        suggestions.push("Bring water and seek shade");
        suggestions.push("Consider early morning or evening");
      } else {
        suitable = true;
        message = "Perfect weather for outdoor activities!";
      }
    } else {
      suitable = true;
      message = "Weather is perfect for indoor experiences";
    }

    return { suitable, message, suggestions };
  }
}

export const weatherService = new WeatherService();
