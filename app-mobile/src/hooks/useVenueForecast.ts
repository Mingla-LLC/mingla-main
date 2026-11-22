/**
 * #4490 W7 — the hourly forecast for a venue's coordinates, as one React Query
 * read shared by every "When you'd go" surface (the host venue page Overview,
 * the event page, the pass's "On the day", the checkout line). The phone asks
 * Open-Meteo through `weatherService` (cached 15 minutes, cell-shared, 7 days);
 * nothing goes through the server.
 */
import { useQuery } from '@tanstack/react-query';

import { weatherService, type WeatherData } from '../services/weatherService';

export const venueWeatherKeys = {
  all: ['venueWeather'] as const,
  at: (lat: number, lng: number) => [...venueWeatherKeys.all, lat.toFixed(3), lng.toFixed(3)] as const,
};

export const hasForecastCoords = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);

export function useVenueForecast(lat: number | null | undefined, lng: number | null | undefined) {
  const ok = hasForecastCoords(lat, lng);
  return useQuery<WeatherData | null>({
    queryKey: venueWeatherKeys.at(ok ? lat : 0, ok ? (lng as number) : 0),
    queryFn: () => weatherService.getWeatherForecast(lat as number, lng as number),
    enabled: ok,
    staleTime: 15 * 60 * 1000,
  });
}
