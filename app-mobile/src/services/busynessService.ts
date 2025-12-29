/**
 * Busyness Service - Google Places API Integration
 * Fetches real-time busyness data for venues using Google Places API
 *
 * Uses Google Places API to get:
 * - Popularity score (0-100) for current busyness level
 * - Opening hours for time-based busyness estimates
 */

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const GOOGLE_PLACES_BASE_URL = "https://places.googleapis.com/v1";

export interface BusynessData {
  isBusy: boolean;
  busynessLevel: "Not Busy" | "Moderate" | "Busy" | "Very Busy";
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
   * Get busyness data for a venue using Google Places API
   * Prefers placeId > address > venueName for searching
   */
  async getVenueBusyness(
    venueName: string,
    lat: number,
    lng: number,
    address?: string,
    placeId?: string
  ): Promise<BusynessData | null> {
    if (!GOOGLE_PLACES_API_KEY) {
      console.warn("Google Places API key not configured");
      return this.getFallbackBusyness();
    }

    try {
      let foundPlaceId: string | null = null;

      // Step 1: If we already have a placeId, use it directly (most reliable)
      if (placeId) {
        foundPlaceId = placeId;
      }
      // Step 2: Try searching by name + address combined (most accurate)
      else if (address) {
        // Combine name and address for more specific and accurate search
        const combinedQuery = `${venueName}, ${address}`;

        const searchTextUrl = `${GOOGLE_PLACES_BASE_URL}/places:searchText`;
        const fieldMask = "places.id,places.displayName,places.location";

        const addressResponse = await fetch(searchTextUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask": fieldMask,
          },
          body: JSON.stringify({
            textQuery: combinedQuery,
            locationBias: {
              circle: {
                center: {
                  latitude: lat,
                  longitude: lng,
                },
                radius: 500,
              },
            },
            maxResultCount: 5,
          }),
        });

        if (!addressResponse.ok) {
          const errorText = await addressResponse.text();
          console.warn("⚠️ Combined search HTTP error:", {
            status: addressResponse.status,
            error: errorText,
          });
        } else {
          const addressData = await addressResponse.json();

          if (addressData.places && addressData.places.length > 0) {
            // Use the first result (should be the most relevant)
            foundPlaceId = addressData.places[0].id;
          } else {
            console.warn("⚠️ Combined search returned no matches:", {
              places: addressData.places || [],
            });
          }
        }
      }

      // Step 3: Fall back to name-based search if address didn't work
      if (!foundPlaceId) {
        const searchTextUrl = `${GOOGLE_PLACES_BASE_URL}/places:searchText`;
        const fieldMask = "places.id,places.displayName,places.location";

        const textSearchResponse = await fetch(searchTextUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            "X-Goog-FieldMask": fieldMask,
          },
          body: JSON.stringify({
            textQuery: venueName,
            locationBias: {
              circle: {
                center: {
                  latitude: lat,
                  longitude: lng,
                },
                radius: 2000,
              },
            },
            maxResultCount: 5,
          }),
        });

        if (!textSearchResponse.ok) {
          const errorText = await textSearchResponse.text();
          console.warn("⚠️ Text Search HTTP error:", {
            status: textSearchResponse.status,
            error: errorText,
          });
        } else {
          const textSearchData = await textSearchResponse.json();

          if (textSearchData.places && textSearchData.places.length > 0) {
            foundPlaceId = textSearchData.places[0].id;
          } else {
            console.warn("⚠️ Text Search returned no usable results:", {
              places: textSearchData.places || [],
            });
          }
        }

        // Step 4: If Text Search fails, try Nearby Search as fallback
        if (!foundPlaceId) {
          // Try searching for common place types near the location
          const placeTypes = [
            "point_of_interest",
            "establishment",
            "tourist_attraction",
          ];

          const searchNearbyUrl = `${GOOGLE_PLACES_BASE_URL}/places:searchNearby`;
          const fieldMask = "places.id,places.displayName,places.location";

          for (const type of placeTypes) {
            const nearbyResponse = await fetch(searchNearbyUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                "X-Goog-FieldMask": fieldMask,
              },
              body: JSON.stringify({
                includedTypes: [type],
                maxResultCount: 20,
                locationRestriction: {
                  circle: {
                    center: {
                      latitude: lat,
                      longitude: lng,
                    },
                    radius: 2000,
                  },
                },
              }),
            });

            if (!nearbyResponse.ok) {
              const errorText = await nearbyResponse.text();
              console.warn("⚠️ Nearby Search HTTP error:", {
                type,
                status: nearbyResponse.status,
                error: errorText,
              });
              continue;
            }

            const nearbyData = await nearbyResponse.json();

            if (nearbyData.places && nearbyData.places.length > 0) {
              // Try to find a match by name similarity
              const matchedPlace = nearbyData.places.find((place: any) => {
                const placeNameLower =
                  place.displayName?.text?.toLowerCase() || "";
                const venueNameLower = venueName.toLowerCase();
                return (
                  placeNameLower.includes(venueNameLower) ||
                  venueNameLower.includes(placeNameLower) ||
                  this.calculateStringSimilarity(
                    placeNameLower,
                    venueNameLower
                  ) > 0.6
                );
              });

              if (matchedPlace) {
                foundPlaceId = matchedPlace.id;
                break;
              } else {
                console.warn(
                  "⚠️ Nearby Search had results but no close match:",
                  {
                    type,
                    sampleNames: nearbyData.places
                      .slice(0, 3)
                      .map((result: any) => result.displayName?.text),
                  }
                );
              }
            } else {
              console.warn("⚠️ Nearby Search returned no results:", {
                type,
                places: nearbyData.places || [],
              });
            }
          }
        }
      }

      if (!foundPlaceId) {
        console.warn("📍 No place found in Google Places for:", {
          venueName,
          address,
          lat,
          lng,
          attemptedSearches: {
            usedPlaceId: !!placeId,
            triedAddress: !!address,
            triedName: true,
            triedNearby: true,
          },
        });
        return this.getFallbackBusyness();
      }

      // Step 5: Get detailed place information
      // Places API (New) - use places/{placeId} endpoint
      const detailsUrl = `${GOOGLE_PLACES_BASE_URL}/places/${foundPlaceId}`;
      const fieldMask =
        "id,displayName,rating,userRatingCount,regularOpeningHours,currentOpeningHours";

      const detailsResponse = await fetch(detailsUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": fieldMask,
        },
      });

      if (!detailsResponse.ok) {
        const errorText = await detailsResponse.text();
        console.error("❌ Google Places details HTTP error:", {
          status: detailsResponse.status,
          statusText: detailsResponse.statusText,
          error: errorText,
        });
        return this.getFallbackBusyness();
      }

      const placeDetails = await detailsResponse.json();

      if (placeDetails.error) {
        console.warn("📍 Invalid response from Google Places details:", {
          error: placeDetails.error,
        });
        return this.getFallbackBusyness();
      }

      // Popularity field is not available in Places API (New) either
      // Estimate from rating and review count
      let popularity: number;
      const rating = placeDetails.rating || 0;
      const reviewCount = placeDetails.userRatingCount || 0;

      // Convert rating (0-5) to popularity (0-100)
      // Higher rating = higher popularity
      // More reviews = more popular (capped effect)
      const ratingScore = (rating / 5) * 70; // Max 70 from rating
      const reviewScore = Math.min(30, (reviewCount / 1000) * 30); // Max 30 from reviews
      popularity = Math.round(ratingScore + reviewScore);
      console.log("popularity", popularity);

      // Use currentOpeningHours if available, otherwise regularOpeningHours
      const openingHours =
        placeDetails.currentOpeningHours || placeDetails.regularOpeningHours;

      // Calculate busyness level from popularity (0-100 scale)
      const busynessLevel = this.calculateBusynessLevel(popularity);

      // Generate popular times based on opening hours and typical patterns
      const popularTimes = this.generatePopularTimes(openingHours, popularity);

      return {
        isBusy: popularity > 50,
        busynessLevel,
        currentPopularity: popularity,
        popularTimes,
        message: this.generateBusynessMessage(busynessLevel, popularTimes),
      };
    } catch (error) {
      console.error("Error fetching busyness from Google Places:", error);
      return this.getFallbackBusyness();
    }
  }

  /**
   * Calculate busyness level from popularity score (0-100)
   */
  private calculateBusynessLevel(
    popularity: number
  ): "Not Busy" | "Moderate" | "Busy" | "Very Busy" {
    console.log("calculating busyness level", popularity);
    if (popularity < 25) return "Not Busy";
    if (popularity < 50) return "Moderate";
    if (popularity < 75) return "Busy";
    return "Very Busy";
  }

  /**
   * Generate popular times based on opening hours and popularity score
   * Google Places API doesn't provide hourly popular times like Foursquare,
   * so we estimate based on typical patterns and opening hours
   */
  private generatePopularTimes(
    openingHours: any,
    popularity: number
  ): PopularTime[] {
    const days = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];

    const popularTimes: PopularTime[] = [];

    days.forEach((day, dayIndex) => {
      // Check if place is open on this day
      let isOpen = true;
      let openHour = 9; // Default opening
      let closeHour = 21; // Default closing

      // Places API (New) uses weekdayDescriptions array instead of weekday_text
      if (openingHours?.weekdayDescriptions) {
        const dayText = openingHours.weekdayDescriptions[dayIndex];
        if (dayText && dayText.includes("Closed")) {
          isOpen = false;
        } else if (dayText) {
          // Try to parse opening hours (format: "Monday: 9:00 AM – 10:00 PM")
          const timeMatch = dayText.match(
            /(\d{1,2}):(\d{2})\s*(AM|PM).*?(\d{1,2}):(\d{2})\s*(AM|PM)/
          );
          if (timeMatch) {
            openHour = this.parseHour(timeMatch[1], timeMatch[3]);
            closeHour = this.parseHour(timeMatch[4], timeMatch[6]);
          }
        }
      }

      if (!isOpen) {
        popularTimes.push({
          day,
          times: Array.from({ length: 24 }, (_, i) => ({
            hour: `${i.toString().padStart(2, "0")}:00`,
            popularity: 0,
          })),
        });
        return;
      }

      // Generate popularity pattern based on typical patterns
      // Peak hours: 12-14 (lunch), 18-20 (dinner), 20-22 (nightlife)
      const times = Array.from({ length: 24 }, (_, i) => {
        let basePopularity = 20; // Base level

        // Outside opening hours = 0
        if (i < openHour || i >= closeHour) {
          return { hour: `${i.toString().padStart(2, "0")}:00`, popularity: 0 };
        }

        // Peak lunch hours (12-14)
        if (i >= 12 && i < 14) {
          basePopularity = 70;
        }
        // Peak dinner hours (18-20)
        else if (i >= 18 && i < 20) {
          basePopularity = 80;
        }
        // Nightlife hours (20-22) - higher on weekends
        else if (i >= 20 && i < 22 && (dayIndex === 5 || dayIndex === 6)) {
          basePopularity = 75;
        }
        // Weekend brunch (10-12 on Sat/Sun)
        else if (i >= 10 && i < 12 && (dayIndex === 5 || dayIndex === 6)) {
          basePopularity = 65;
        }
        // Morning rush (8-9 on weekdays)
        else if (i >= 8 && i < 9 && dayIndex < 5) {
          basePopularity = 50;
        }
        // Afternoon lull (14-17)
        else if (i >= 14 && i < 17) {
          basePopularity = 35;
        }
        // Late night (22-24)
        else if (i >= 22) {
          basePopularity = 30;
        }

        // Adjust based on overall popularity score
        const adjustedPopularity = Math.min(
          100,
          Math.max(0, basePopularity + (popularity - 50) * 0.3)
        );

        return {
          hour: `${i.toString().padStart(2, "0")}:00`,
          popularity: Math.round(adjustedPopularity),
        };
      });

      popularTimes.push({ day, times });
    });

    return popularTimes;
  }

  /**
   * Parse hour from 12-hour format to 24-hour format
   */
  private parseHour(hour: string, period: string): number {
    let h = parseInt(hour);
    if (period === "PM" && h !== 12) {
      h += 12;
    } else if (period === "AM" && h === 12) {
      h = 0;
    }
    return h;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   * Returns a value between 0 and 1 (1 = identical)
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Generate busyness message
   */
  private generateBusynessMessage(
    level: "Not Busy" | "Moderate" | "Busy" | "Very Busy",
    popularTimes: PopularTime[]
  ): string {
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const currentHour = now.getHours();

    const dayName = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][currentDay];
    const todayData = popularTimes.find((pt) => pt.day === dayName);

    if (todayData) {
      const currentTimeData = todayData.times.find((t) => {
        const hour = parseInt(t.hour.split(":")[0]);
        return hour === currentHour;
      });

      if (currentTimeData) {
        const peakHour = todayData.times.reduce((max, t) =>
          t.popularity > max.popularity ? t : max
        );

        if (level === "Very Busy") {
          return `Very busy right now. Peak hours: ${peakHour.hour}`;
        } else if (level === "Busy") {
          return `Moderately busy. Less crowded around ${currentTimeData.hour}`;
        } else if (level === "Moderate") {
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
      busynessLevel: isPeakHour ? "Moderate" : "Not Busy",
      currentPopularity: isPeakHour ? 45 : 25,
      popularTimes: [],
      message: isPeakHour
        ? "Likely moderate crowd during peak hours"
        : "Good time to visit - typically less crowded",
    };
  }
}

export const busynessService = new BusynessService();
