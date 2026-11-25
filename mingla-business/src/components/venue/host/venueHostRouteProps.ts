/** #4490 — the raw route params a Host venue route hands its screen (opaque ids only). */
export interface VenueHostRouteProps {
  params: Record<string, string | string[] | undefined>;
}
