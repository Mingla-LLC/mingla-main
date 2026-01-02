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
        /*     const errorText = await response.text();
        console.error("❌ Weather API error:", {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        }); */
        throw new Error(`Weather API error: ${response.status} - ${errorText}`);
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
    } catch (error: any) {
      /*   console.error("❌ Error fetching weather:", error);
      console.error("Error details:", {
        message: error?.message,
        stack: error?.stack,
        apiKeyPresent: !!OPENWEATHER_API_KEY,
        apiKeyLength: OPENWEATHER_API_KEY?.length,
      }); */

      // If One Call API fails, try Current Weather API as fallback
      try {
        return await this.getCurrentWeatherFallback(lat, lng);
      } catch (fallbackError) {
        console.error("❌ Fallback also failed:", fallbackError);
        return null;
      }
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

    // Combine temperature and condition for nuanced recommendations

    // Rain conditions with temperature considerations
    if (condition.includes("rain") || precipitation > 0) {
      if (temp < 50) {
        return "Cold and rainy. Perfect for cozy indoor experiences like cafes, museums, or workshops.";
      } else if (temp > 75) {
        return "Warm rain expected. Great for covered outdoor areas or indoor venues.";
      } else {
        return "Rain expected. Perfect for indoor experiences like cafes, museums, or workshops.";
      }
    }

    // Snow conditions with temperature considerations
    if (condition.includes("snow")) {
      if (temp < 32) {
        return "Freezing with snow. Ideal for cozy indoor venues or winter activities.";
      } else if (temp < 40) {
        return "Cold and snowy. Perfect for indoor activities or winter sports.";
      } else {
        return "Snowy conditions. Ideal for cozy indoor venues or winter activities.";
      }
    }

    // Clear/Sunny conditions with temperature considerations
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

    // Cloudy conditions with temperature considerations
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

    // Windy conditions with temperature considerations
    if (windSpeed > 15) {
      if (temp < 50) {
        return "Windy and cold. Better suited for indoor venues to stay warm.";
      } else if (temp > 80) {
        return "Windy but hot. The breeze helps, but indoor venues may be more comfortable.";
      } else {
        return "Windy conditions. Better suited for indoor venues or sheltered outdoor areas.";
      }
    }

    // Default fallback with temperature consideration
    if (temp < 50) {
      return "Cool weather. Good for indoor activities or layered outdoor experiences.";
    } else if (temp > 85) {
      return "Warm weather. Great for indoor venues or shaded outdoor areas.";
    }

    return "Weather looks good for your planned activity!";
  }

  /**
   * Fallback to Current Weather API if One Call API is unavailable
   */
  private async getCurrentWeatherFallback(
    lat: number,
    lng: number
  ): Promise<WeatherData | null> {
    try {
      const url = `${OPENWEATHER_BASE_URL}/weather?lat=${lat}&lon=${lng}&appid=${OPENWEATHER_API_KEY}&units=imperial`;

      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Current Weather API error:", {
          status: response.status,
          error: errorText,
        });
        throw new Error(
          `Current Weather API error: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();

      /* console.log("data", data); */

      // Convert Current Weather API format to match One Call API format for recommendation
      const weatherForRecommendation = {
        temp: data.main.temp,
        weather: data.weather,
        wind_speed: data.wind?.speed || 0,
        rain: undefined,
        snow: undefined,
      };

      const recommendation = this.generateActivityRecommendation(
        weatherForRecommendation,
        weatherForRecommendation
      );

      return {
        temperature: Math.round(data.main.temp),
        condition: data.weather[0].main,
        icon: data.weather[0].icon,
        description: data.weather[0].description,
        feelsLike: Math.round(data.main.feels_like),
        humidity: data.main.humidity,
        windSpeed: data.wind?.speed || 0,
        uvIndex: undefined,
        precipitation: undefined,
        recommendation,
        hourlyForecast: [],
      };
    } catch (error) {
      console.error("❌ Error in fallback weather API:", error);
      return null;
    }
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
