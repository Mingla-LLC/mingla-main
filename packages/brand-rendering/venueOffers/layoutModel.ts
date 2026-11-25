/** #4490 H — the fixed venue-layout vocabulary shared by host and guest UI. */
export type VenueLayout =
  | "standing"
  | "seated"
  | "banquet"
  | "theatre"
  | "classroom"
  | "cabaret"
  | "boardroom";

export type OtherVenueLayout = Exclude<VenueLayout, "standing" | "seated">;

export const VENUE_LAYOUTS: ReadonlyArray<{ key: VenueLayout; label: string }> = [
  { key: "standing", label: "Standing" },
  { key: "seated", label: "Seated dining" },
  { key: "banquet", label: "Banquet (round tables)" },
  { key: "theatre", label: "Theatre" },
  { key: "classroom", label: "Classroom" },
  { key: "cabaret", label: "Cabaret" },
  { key: "boardroom", label: "Boardroom" },
];

export const OTHER_VENUE_LAYOUTS = VENUE_LAYOUTS.filter(
  (layout): layout is { key: OtherVenueLayout; label: string } =>
    layout.key !== "standing" && layout.key !== "seated",
);

export function isVenueLayout(value: unknown): value is VenueLayout {
  return typeof value === "string" && VENUE_LAYOUTS.some((layout) => layout.key === value);
}

export function venueLayoutLabel(layout: VenueLayout): string {
  return VENUE_LAYOUTS.find((item) => item.key === layout)?.label ?? layout;
}

/** Compact booking wording: "Banquet · 120". */
export function venueLayoutSummary(layout: VenueLayout, capacity: number): string {
  const label = layout === "seated" ? "Seated" : venueLayoutLabel(layout).replace(" (round tables)", "");
  return `${label} · ${capacity.toLocaleString("en-GB")}`;
}

/** The exact capacity refusal wording from spec 07-H. */
export function venueLayoutCapacityError(placeName: string, capacity: number, layout: VenueLayout): string {
  const arrangement =
    layout === "standing"
      ? "standing"
      : layout === "seated"
        ? "seated"
        : `seated for a ${venueLayoutLabel(layout).replace(" (round tables)", "").toLowerCase()}`;
  return `${placeName} holds ${capacity.toLocaleString("en-GB")} ${arrangement}.`;
}
