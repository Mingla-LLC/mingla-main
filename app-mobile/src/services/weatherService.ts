/**
 * Weather Service - OpenWeatherMap API Integration
 * Fetches weather forecasts for venues
 */

const OPENWEATHER_API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY || "";
const OPENWEATHER_BASE_URL = "https://api.openweathermap.org/data/2.5";

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

class WeatherService {
  /**
   * Get current weather and forecast for a location
   */
  async getWeatherForecast(
    lat: number,
    lng: number,
    date?: Date
  ): Promise<WeatherData | null> {
    if (!OPENWEATHER_API_KEY) {
      console.warn("OpenWeatherMap API key not configured");
      return null;
    }

    try {
      // Use One Call API 3.0 for comprehensive data
      const url = `${OPENWEATHER_BASE_URL}/onecall?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=imperial&exclude=minutely,alerts`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }

      const data = await response.json();

      const current = data.current;
      const hourly = data.hourly || [];

      // Get weather for specific date/time if provided
      let targetWeather = current;
      if (date) {
        const targetTime = date.getTime() / 1000;
        const targetHourly = hourly.find(
          (h: any) => Math.abs(h.dt - targetTime) < 3600
        );
        if (targetHourly) {
          targetWeather = targetHourly;
        }
      }

      // Generate activity-specific recommendation
      const recommendation = this.generateActivityRecommendation(
        targetWeather,
        data.current
      );

      // Format hourly forecast (next 12 hours)
      const hourlyForecast: HourlyForecast[] = hourly
        .slice(0, 12)
        .map((h: any) => ({
          time: new Date(h.dt * 1000).toLocaleTimeString("en-US", {
            hour: "numeric",
          }),
          temperature: Math.round(h.temp),
          condition: h.weather[0].main,
          icon: h.weather[0].icon,
          precipitation: (h.rain?.["1h"] || h.snow?.["1h"] || 0) * 0.0393701, // Convert to inches
        }));

      return {
        temperature: Math.round(targetWeather.temp),
        condition: targetWeather.weather[0].main,
        icon: targetWeather.weather[0].icon,
        description: targetWeather.weather[0].description,
        feelsLike: Math.round(targetWeather.feels_like),
        humidity: targetWeather.humidity,
        windSpeed: targetWeather.wind_speed,
        uvIndex: targetWeather.uvi,
        precipitation:
          (targetWeather.rain?.["1h"] || targetWeather.snow?.["1h"] || 0) *
          0.0393701,
        recommendation,
        hourlyForecast,
      };
    } catch (error) {
      console.error("Error fetching weather:", error);
      return null;
    }
  }

  /**
   * Generate activity-specific weather recommendations
   */
  private generateActivityRecommendation(weather: any, current: any): string {
    const temp = weather.temp;
    const condition = weather.weather[0].main.toLowerCase();
    const windSpeed = weather.wind_speed;
    const precipitation = weather.rain?.["1h"] || weather.snow?.["1h"] || 0;

    // Temperature-based recommendations
    if (temp < 50) {
      return "Bundle up! Perfect for indoor activities or cozy spots.";
    } else if (temp > 85) {
      return "Hot day ahead! Great for indoor venues or shaded outdoor areas.";
    }

    // Condition-based recommendations
    if (condition.includes("rain") || precipitation > 0) {
      return "Rain expected. Perfect for indoor experiences like cafes, museums, or workshops.";
    } else if (condition.includes("snow")) {
      return "Snowy conditions. Ideal for cozy indoor venues or winter activities.";
    } else if (condition.includes("clear") || condition.includes("sun")) {
      if (temp >= 60 && temp <= 80) {
        return "Perfect weather! Great for outdoor activities, walks, and picnics.";
      } else {
        return "Clear skies ahead. Suitable for both indoor and outdoor experiences.";
      }
    } else if (condition.includes("cloud")) {
      return "Partly cloudy. Good conditions for most activities.";
    } else if (windSpeed > 15) {
      return "Windy conditions. Better suited for indoor venues.";
    }

    return "Weather looks good for your planned activity!";
  }

  /**
   * Get activity-specific suitability
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
      // Indoor activities
      suitable = true;
      message = "Weather is perfect for indoor experiences";
    }

    return { suitable, message, suggestions };
  }
}

export const weatherService = new WeatherService();
