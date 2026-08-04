/**
 * issue #1564 [venue-colours] — the wiring behind the venue's Theme row.
 *
 * NOT a new UI module. The approved placement is the EXISTING 56pt
 * `ThemeControlRow` at four mounts — create s4 (`VenueCoverStep`) and s9
 * (`VenueStep7Review`), claim c4 (`ClaimStepCover`) and c9
 * (`ClaimStepReview`) — and a dedicated "Appearance" screen was rejected. This
 * file adds no surface: it is the four mounts' shared plumbing, so that the
 * value they read, the patch they write, the brand theme they inherit from and
 * the loading/error status they report are provably ONE implementation rather
 * than four copies free to drift.
 *
 * Drift here would be invisible and expensive: a review step that resolved
 * inheritance differently from the cover step would show the operator one
 * palette while saving another, which is precisely the class of bug #1022's
 * C-1 was (`resolveTheme` called with its arguments swapped in one place only).
 *
 * The venue's override lives at the TOP level of the draft store, shared by
 * both wizard paths — see `draftVenueStore.themeOverrides`.
 */

import { useCallback } from "react";

import type { ThemeInput } from "@mingla/offering-rendering";

import { useBrand } from "../../hooks/useBrands";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import type { BrandThemeStatus } from "../theme/ThemeControlRow";

export interface VenueThemeControl {
  /** The venue's raw override. null = every axis inherited from the brand. */
  value: ThemeInput | null;
  /** ONE patch per user action, straight into the draft. */
  onChange: (next: ThemeInput | null) => void;
  /** The parent brand's theme — what "Brand default" actually resolves to. */
  brandTheme: ThemeInput | null;
  brandThemeStatus: BrandThemeStatus;
}

export const useVenueThemeControl = (): VenueThemeControl => {
  const value = useDraftVenueStore((s) => s.themeOverrides ?? null);
  const patch = useDraftVenueStore((s) => s.patch);
  // The venue attaches to the operator's CURRENT brand (META-ORCH-1255 F-1),
  // and `activeBrandId` is the store's own name for it — the same id the
  // wizard submits under. Reading it from here rather than taking a prop is
  // what keeps all four mounts honest: two of them (the review steps) have no
  // brandId prop to pass.
  const brandId = useDraftVenueStore((s) => s.activeBrandId);

  // C-2 — the brand theme, so the row reports inheritance TRUTHFULLY rather
  // than guessing. `loading` renders skeletons; `error` renders the warning dot
  // and the honest "Mingla default" line instead of a palette we cannot back up.
  const brandQuery = useBrand(brandId);
  const brandThemeStatus: BrandThemeStatus = brandQuery.isLoading
    ? "loading"
    : brandQuery.isError
      ? "error"
      : "ready";

  const onChange = useCallback(
    (next: ThemeInput | null): void => {
      patch({ themeOverrides: next });
    },
    [patch],
  );

  return {
    value,
    onChange,
    brandTheme: brandQuery.data?.theme ?? null,
    brandThemeStatus,
  };
};
