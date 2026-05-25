import { useCurrentBrand } from "./useCurrentBrand";

export interface ExperienceVenueDefault {
  defaultVenue: string;
  hasPrefill: boolean;
}

export function useExperienceVenueDefault(
  brandId: string | null,
): ExperienceVenueDefault {
  const brand = useCurrentBrand();
  if (brandId === null || brand === null || brand.id !== brandId) {
    return { defaultVenue: "", hasPrefill: false };
  }

  const defaultVenue = brand.address?.trim() ?? "";
  return {
    defaultVenue,
    hasPrefill: defaultVenue.length > 0,
  };
}
