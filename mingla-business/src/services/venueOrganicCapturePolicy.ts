export type VenueOrganicAnalyticsSurface =
  | "buyer_web"
  | "business_preview";

export function runBuyerVenueOrganicCapture(
  surface: VenueOrganicAnalyticsSurface,
  capture: () => void,
): boolean {
  if (surface !== "buyer_web") return false;
  capture();
  return true;
}

export function settleBuyerVenueOrganicCapture(
  surface: VenueOrganicAnalyticsSurface,
  settle: () => () => void,
): () => void {
  if (surface !== "buyer_web") return () => undefined;
  return settle();
}
