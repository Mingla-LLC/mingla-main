/**
 * ORCH-1263 DESIGN §6.10 — the PURE review-group builder, extracted from
 * `ClaimStepReview.tsx` by issue #1564.
 *
 * WHY IT MOVED. #1564 mounts the shared `ThemeControlRow` + `ThemeSheet` on the
 * claim review step, which drags react-native-gesture-handler,
 * react-native-reanimated and expo-linear-gradient into that .tsx's import
 * graph. `orch1263ClaimAdoption.happy.test.tsx` imports ONLY this builder and
 * renders nothing, so it died at module load on packages it never uses.
 *
 * The house already draws this line and says why —
 * `components/theme/themeColorModel.ts`: "PURE by contract: no React, no React
 * Native. Everything here is unit-testable under the node/ts-jest project,
 * which is why the value-line grammar lives here rather than inside the row
 * component (a .tsx importing react-native cannot be imported by those tests)."
 * The same reasoning now applies to the claim review rows.
 *
 * BEHAVIOUR-NEUTRAL: the block below is the pre-existing code, moved verbatim.
 * `ClaimStepReview.tsx` re-exports all three symbols, so every other importer
 * is unaffected.
 */

import type { DraftVenueState } from "../../../store/draftVenueStore";
import { provenanceFor } from "../../../store/draftVenueStore";
import type { VenueCategory } from "../../../types/brand";
import { removedAdoptedUrls } from "./ClaimStepPhotos";

const CAT_LABEL: Record<VenueCategory, string> = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
  stay: "Stay",
};

// ─── Pure review-group builder (unit-tested — T-B7) ─────────────────────────

export type ClaimReviewGroup = "kept" | "changed" | "added";

export interface ClaimReviewRow {
  key: string;
  label: string;
  value: string;
  group: ClaimReviewGroup;
  /** Step to jump to when the row is pressed. */
  stepId: string;
  /** Cover row renders a 40×50 thumb beside the value. */
  thumbUrl?: string;
  thumbType?: "image" | "video" | "gif";
}

const groupFromProvenance = (
  p: "adopted" | "edited" | "new" | null,
  fallback: ClaimReviewGroup | null,
): ClaimReviewGroup | null => {
  if (p === "adopted") return "kept";
  if (p === "edited") return "changed";
  if (p === "new") return "added";
  return fallback;
};

export function buildClaimReviewRows(
  d: DraftVenueState,
  currencyCode: string | null = null,
): ClaimReviewRow[] {
  const rows: ClaimReviewRow[] = [];
  const claim = d.claim;
  const push = (
    row: Omit<ClaimReviewRow, "group"> & { group: ClaimReviewGroup | null },
  ): void => {
    if (row.group !== null) rows.push(row as ClaimReviewRow);
  };

  // Category — an unconfident pick is the operator's addition.
  if (d.venueCategory !== null) {
    push({
      key: "category",
      label: "Category",
      value: CAT_LABEL[d.venueCategory],
      group: groupFromProvenance(provenanceFor("category", d), "added"),
      stepId: "c0",
    });
  }
  push({
    key: "name",
    label: "Name",
    value: d.displayName.trim(),
    group: groupFromProvenance(provenanceFor("name", d), null),
    stepId: "c1",
  });
  push({
    key: "address",
    label: "Address",
    value: d.formattedAddress.trim(),
    group: groupFromProvenance(provenanceFor("address", d), null),
    stepId: "c1",
  });
  const openDays = d.hours.filter((h) => !h.isClosed).length;
  push({
    key: "hours",
    label: "Hours",
    value: `${openDays} open day${openDays === 1 ? "" : "s"}`,
    group: groupFromProvenance(provenanceFor("hours", d), "added"),
    stepId: "c2",
  });
  // Photos — one summary row.
  if (claim !== null) {
    const removed = removedAdoptedUrls(
      claim.adopted.galleryUrls,
      claim.keptGalleryUrls,
    ).length;
    const addedCount = claim.addedGalleryUrls.length;
    const keptCount = claim.keptGalleryUrls.filter((u) =>
      claim.adopted.galleryUrls.includes(u),
    ).length;
    if (keptCount + removed + addedCount > 0) {
      push({
        key: "photos",
        label: "Photos",
        value: `${keptCount} kept, ${removed} removed, ${addedCount} added`,
        group: removed > 0 || addedCount > 0
          ? removed > 0 || keptCount > 0 ? "changed" : "added"
          : "kept",
        stepId: "c3",
      });
    }
    if (claim.coverChoice !== null) {
      push({
        key: "cover",
        label: "Cover",
        value: claim.coverChoice.type === "video"
          ? "Video cover"
          : "Photo cover",
        group: "added",
        stepId: "c4",
        thumbUrl: claim.coverChoice.url,
        thumbType: claim.coverChoice.type,
      });
    }
  }
  if (d.description.trim().length > 0) {
    push({
      key: "pitch",
      label: "Pitch",
      value: d.description.trim(),
      group: groupFromProvenance(provenanceFor("pitch", d), null),
      stepId: "c5",
    });
  }
  if (d.contactPhone.trim().length > 0) {
    push({
      key: "phone",
      label: "Phone",
      value: d.contactPhone.trim(),
      group: groupFromProvenance(provenanceFor("phone", d), null),
      stepId: "c6",
    });
  }
  if (d.contactEmail.trim().length > 0) {
    push({
      key: "email",
      label: "Email",
      value: d.contactEmail.trim(),
      group: "added",
      stepId: "c6",
    });
  }
  if (d.website.trim().length > 0) {
    push({
      key: "website",
      label: "Website",
      value: d.website.trim(),
      group: groupFromProvenance(provenanceFor("website", d), null),
      stepId: "c6",
    });
  }
  const discoveryPriceMinInput = (d.discoveryPriceMinInput ?? "").trim();
  const discoveryPriceMaxInput = (d.discoveryPriceMaxInput ?? "").trim();
  if (discoveryPriceMinInput.length > 0 || d.priceTiers.length > 0) {
    push({
      key: "price",
      label: "Price range",
      value: discoveryPriceMinInput.length > 0
        ? `${discoveryPriceMinInput}${
          discoveryPriceMaxInput.length > 0
            ? `–${discoveryPriceMaxInput}`
            : "+"
        }${currencyCode ? ` ${currencyCode}` : ""}`
        : d.priceTiers
          .map((tier) => tier.charAt(0).toUpperCase() + tier.slice(1))
          .join(" · "),
      group: groupFromProvenance(provenanceFor("price", d), null),
      stepId: "c7",
    });
  }
  if (d.wantsReservations) {
    push({
      key: "reservations",
      label: "Reservations",
      value: "On — setup after approval",
      group: "added",
      stepId: "c8",
    });
  }
  return rows;
}
