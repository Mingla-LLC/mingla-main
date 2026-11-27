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
 * one yet. It reads the FORM instead, and reuses `stayOfferingReadinessErrors`'
 * label strings above so the rail and the saved row describe the same
 * requirement the same way.
 *
 * ONE DELIBERATE DIVERGENCE (#1501 P3-1). The saved-row list still says "Name
 * every private unit"; the rail says "Name each one". "Private unit" is RETIRED
 * jargon from the pre-#1501 table, and the rail sits three inches from a form
 * that correctly reads "Each one is named" / "Name each one" — a terminology
 * contradiction inside the terminology issue. The LIST's string is pinned by
 * `stayInventoryPresentation.issue1425.test.ts:81` and belongs to a different
 * surface, so retiring it there is its own work item; the rail is fixed here
 * because that is the copy #1501 authored.
 *
 * Satisfied and unsatisfied are both rendered, and NEITHER is red: an
 * unfinished draft is not an error. Red is for something that went wrong.
 */
export interface StayDraftReadinessItem {
  readonly id: string;
  readonly label: string;
  readonly done: boolean;
}

export interface StayEditorLifecycleCopy {
  readonly helper: string;
  readonly pillLabel: string;
  readonly pillReady: boolean;
  readonly readinessHeading: string;
  readonly summaryEyebrow: string;
  readonly summaryHeadline: string;
}

/**
 * #4490 truthful edit state: an existing offering keeps its saved lifecycle
 * identity while it is edited. Readiness gaps are separate from status; a
 * Live room with a bad row must say Live and show the gap, never pretend it is
 * a new draft.
 */
export function stayEditorLifecycleCopy(input: {
  status: StayOfferingRecord["status"] | null;
  kind: "room" | "place";
  draftCount: number;
  pendingReadiness: number;
}): StayEditorLifecycleCopy {
  const subject = input.kind === "room" ? "room" : "place";
  const label = input.kind === "room" ? "Room" : "Place";
  const readinessLabel =
    input.pendingReadiness <= 0 ? "Ready" : `${input.pendingReadiness} to go`;

  if (input.status === "live") {
    return {
      helper: `Guests can book this ${subject} now. Saved changes update the live listing.`,
      pillLabel: "Live",
      pillReady: true,
      readinessHeading: "Booking setup",
      summaryEyebrow: "You’re editing",
      summaryHeadline: `Live ${label}`,
    };
  }
  if (input.status === "paused") {
    return {
      helper: `Guests can’t book this ${subject} while it’s paused. Saved changes will be ready when you resume it.`,
      pillLabel: "Paused",
      pillReady: false,
      readinessHeading: "Booking setup",
      summaryEyebrow: "You’re editing",
      summaryHeadline: `Paused ${label}`,
    };
  }
  if (input.status === "archived") {
    return {
      helper: `This ${subject} is archived and can’t be booked.`,
      pillLabel: "Archived",
      pillReady: false,
      readinessHeading: "Booking setup",
      summaryEyebrow: "You’re viewing",
      summaryHeadline: `Archived ${label}`,
    };
  }
  if (input.status === "draft") {
    return {
      helper: `This ${subject} is a draft. Finish the checklist, then make it live from the list.`,
      pillLabel: readinessLabel,
      pillReady: input.pendingReadiness <= 0,
      readinessHeading: "Before this can go live",
      summaryEyebrow: "You’re editing",
      summaryHeadline: `${label} draft`,
    };
  }

  return {
    helper:
      "Nothing here can be booked yet. Fill in the details, then make it live from the list.",
    pillLabel: readinessLabel,
    pillReady: input.pendingReadiness <= 0,
    readinessHeading:
      input.draftCount === 1
        ? "Before this can go live"
        : "Before these can go live",
    summaryEyebrow: "You’re creating",
    summaryHeadline: `${input.draftCount} ${label} draft${input.draftCount === 1 ? "" : "s"}`,
  };
}

export function stayDraftReadiness(input: {
  description: string;
  photoCount: number;
  hasPrice: boolean;
  hasPolicy: boolean;
  hasOpenAvailability: boolean;
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
    // Availability lives on its own screen. A new draft passes false; an
    // existing offering passes the saved server fact so this editor never
    // lies about a calendar that is already open.
    {
      id: "availability",
      label: "Open future availability",
      done: input.hasOpenAvailability,
    },
  ];
  if (input.namedUnits) {
    items.push({
      id: "units",
      // Matches `STAY_FIELD_COPY.unitNames.label` in the editor, verbatim.
      label: "Name each one",
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
