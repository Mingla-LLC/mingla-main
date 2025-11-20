/**
 * Busyness Service - Foursquare Places API Integration
 * Fetches real-time busyness data for venues
 */

const FOURSQUARE_API_KEY = process.env.EXPO_PUBLIC_FOURSQUARE_API_KEY || '';
const FOURSQUARE_BASE_URL = 'https://api.foursquare.com/v3';

export interface BusynessData {
  isBusy: boolean;
  busynessLevel: 'Not Busy' | 'Moderate' | 'Busy' | 'Very Busy';
  currentPopularity: number; // 0-100
  popularTimes: PopularTime[];
  message: string;
}

export interface PopularTime {
  day: string;
  times: { hour: string; popularity: number }[];
}

class BusynessService {
  /**
   * Get busyness data for a venue using Foursquare
   */
  async getVenueBusyness(
    venueName: string,
    lat: number,
    lng: number
  ): Promise<BusynessData | null> {
    if (!FOURSQUARE_API_KEY) {
      console.warn('Foursquare API key not configured');
      return this.getFallbackBusyness();
    }

    try {
      // Search for venue
      const searchUrl = `${FOURSQUARE_BASE_URL}/places/search?ll=${lat},${lng}&query=${encodeURIComponent(venueName)}&limit=1`;
      
      const searchResponse = await fetch(searchUrl, {
        headers: {
          'Authorization': FOURSQUARE_API_KEY,
          'Accept': 'application/json',
        },
      });

      if (!searchResponse.ok) {
        throw new Error(`Foursquare search error: ${searchResponse.status}`);
      }

      const searchData = await searchResponse.json();
      
      if (!searchData.results || searchData.results.length === 0) {
        return this.getFallbackBusyness();
      }

      const venue = searchData.results[0];
      const fsqId = venue.fsq_id;

      // Get detailed venue info with popular times
      const detailsUrl = `${FOURSQUARE_BASE_URL}/places/${fsqId}?fields=popularity,popularity_by_time,rating,stats`;
      
      const detailsResponse = await fetch(detailsUrl, {
        headers: {
          'Authorization': FOURSQUARE_API_KEY,
          'Accept': 'application/json',
        },
      });

      if (!detailsResponse.ok) {
        return this.getFallbackBusyness();
      }

      const detailsData = await detailsResponse.json();

      // Parse busyness data
      const popularity = detailsData.popularity?.current_popularity || 0;
      const busynessLevel = this.calculateBusynessLevel(popularity);
      const popularTimes = this.parsePopularTimes(detailsData.popularity?.popularity_by_time);

      return {
        isBusy: popularity > 50,
        busynessLevel,
        currentPopularity: popularity,
        popularTimes,
        message: this.generateBusynessMessage(busynessLevel, popularTimes),
      };
    } catch (error) {
      console.error('Error fetching busyness:', error);
      return this.getFallbackBusyness();
    }
  }

  /**
   * Calculate busyness level from popularity score (0-100)
   */
  private calculateBusynessLevel(popularity: number): 'Not Busy' | 'Moderate' | 'Busy' | 'Very Busy' {
    if (popularity < 25) return 'Not Busy';
    if (popularity < 50) return 'Moderate';
    if (popularity < 75) return 'Busy';
    return 'Very Busy';
  }

  /**
   * Parse popular times data
   */
  private parsePopularTimes(data: any): PopularTime[] {
    if (!data) return [];

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const popularTimes: PopularTime[] = [];

    days.forEach((day, dayIndex) => {
      const dayData = data[dayIndex];
      if (dayData) {
        const times = Object.entries(dayData).map(([hour, popularity]: [string, any]) => ({
          hour: `${hour}:00`,
          popularity: popularity || 0,
        }));
        popularTimes.push({ day, times });
      }
    });

    return popularTimes;
  }

  /**
   * Generate busyness message
   */
  private generateBusynessMessage(
    level: 'Not Busy' | 'Moderate' | 'Busy' | 'Very Busy',
    popularTimes: PopularTime[]
  ): string {
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const currentHour = now.getHours();

    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][currentDay];
    const todayData = popularTimes.find(pt => pt.day === dayName);

    if (todayData) {
      const currentTimeData = todayData.times.find(t => {
        const hour = parseInt(t.hour.split(':')[0]);
        return hour === currentHour;
      });

      if (currentTimeData) {
        const peakHour = todayData.times.reduce((max, t) => 
          t.popularity > max.popularity ? t : max
        );

        if (level === 'Very Busy') {
          return `Very busy right now. Peak hours: ${peakHour.hour}`;
        } else if (level === 'Busy') {
          return `Moderately busy. Less crowded around ${currentTimeData.hour}`;
        } else if (level === 'Moderate') {
          return `Moderate crowd. Peak hours: ${peakHour.hour}`;
        } else {
          return `Not busy - great time to visit!`;
        }
      }
    }

    return `Current busyness: ${level}`;
  }

  /**
   * Fallback busyness data when API is unavailable
   */
  private getFallbackBusyness(): BusynessData {
    const hour = new Date().getHours();
    const isPeakHour = (hour >= 12 && hour <= 14) || (hour >= 18 && hour <= 20);
    
    return {
      isBusy: isPeakHour,
      busynessLevel: isPeakHour ? 'Moderate' : 'Not Busy',
      currentPopularity: isPeakHour ? 45 : 25,
      popularTimes: [],
      message: isPeakHour 
        ? 'Likely moderate crowd during peak hours' 
        : 'Good time to visit - typically less crowded',
    };
  }
}

export const busynessService = new BusynessService();

