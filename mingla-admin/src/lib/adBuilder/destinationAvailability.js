const SELECTABLE_AVAILABILITY = new Set(["available", "soon"]);

export function isDestinationSelectable(destination) {
  return (
    destination?.availability == null ||
    SELECTABLE_AVAILABILITY.has(destination.availability)
  );
}

export function destinationAvailabilityGuidance(destination) {
  if (destination?.availability === "soon") {
    return "Starts within 48 hours — less time remains for setup and delivery.";
  }
  return null;
}
