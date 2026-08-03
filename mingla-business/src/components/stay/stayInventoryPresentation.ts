import type { StayOfferingRecord } from "../../types/stayInventory";

export type StayInventoryFilter =
  "all" | "room" | "place" | "draft" | "live" | "paused";

export function stayOfferingReadinessErrors(
  offering: StayOfferingRecord,
): string[] {
  const errors: string[] = [];
  if (!offering.description.trim()) errors.push("Add a description");
  if (
    !(offering.media ?? []).some(
      (media) => media.is_cover && media.status === "ready",
    )
  ) {
    errors.push("Add a cover photo");
  }
  if (!offering.currentPrice) errors.push("Set a price");
  if (!offering.currentPolicy) {
    errors.push("Add cancellation and no-show rules");
  }
  if (!offering.hasOpenAvailability) errors.push("Open future availability");
  if (
    offering.unit_naming_mode === "named" &&
    (offering.units ?? []).filter((unit) => unit.status === "active").length !==
      (offering.quantity ?? 0)
  ) {
    errors.push("Name every private unit");
  }
  return errors;
}

export function matchesStayInventoryFilter(input: {
  offering: StayOfferingRecord;
  filter: StayInventoryFilter;
  search: string;
}): boolean {
  const filterMatches =
    input.filter === "all" ||
    input.offering.kind === input.filter ||
    input.offering.status === input.filter;
  return (
    filterMatches &&
    input.offering.name
      .toLowerCase()
      .includes(input.search.trim().toLowerCase())
  );
}
