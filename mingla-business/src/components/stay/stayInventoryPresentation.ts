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

/**
 * #1501 §5 — the DRAFT-SIDE mirror of `stayOfferingReadinessErrors`.
 *
 * The summary rail answers "before these can go live" while the operator is
 * still typing, so it cannot read a saved `StayOfferingRecord` — there isn't
 * one yet. It reads the FORM instead, and deliberately reuses the SAME label
 * strings as `stayOfferingReadinessErrors` above, so the rail and the saved
 * row never describe the same requirement in two different ways.
 *
 * Satisfied and unsatisfied are both rendered, and NEITHER is red: an
 * unfinished draft is not an error. Red is for something that went wrong.
 */
export interface StayDraftReadinessItem {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
}

export function stayDraftReadiness(input: {
  description: string;
  photoCount: number;
  hasPrice: boolean;
  hasPolicy: boolean;
  namedUnits: boolean;
  unitNameCount: number;
}): StayDraftReadinessItem[] {
  const items: StayDraftReadinessItem[] = [
    {
      id: "description",
      label: "Add a description",
      done: input.description.trim().length > 0,
    },
    { id: "cover", label: "Add a cover photo", done: input.photoCount > 0 },
    { id: "price", label: "Set a price", done: input.hasPrice },
    {
      id: "policy",
      label: "Add cancellation and no-show rules",
      done: input.hasPolicy,
    },
    // Availability lives on its own screen, so it is never satisfiable from
    // here. Showing it anyway is the point: it is the step operators forget.
    { id: "availability", label: "Open future availability", done: false },
  ];
  if (input.namedUnits) {
    items.push({
      id: "units",
      label: "Name every private unit",
      done: input.unitNameCount > 0,
    });
  }
  return items;
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
