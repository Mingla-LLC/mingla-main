/**
 * Ve1 + META-ORCH-1009 Sub-E — inline validation for venue wizard steps.
 * Step indices MUST match VenueCreatorWizard's switch + STEPPER_STEPS order:
 *   0 Address · 1 Name+slug · 2 Hours · 3 Contact · 4 Story · 5 Review
 * (The old step-2 "Cover" explainer was removed — cover is set post-submit.)
 */

import type { DraftVenueState } from "../../store/draftVenueStore";

export function venueStepError(
  step: number,
  d: DraftVenueState,
): string | null {
  switch (step) {
    case 0:
      if (d.formattedAddress.trim().length === 0) return "Address is required.";
      if (d.lat === null || d.lng === null) return "Address is missing location.";
      return null;
    case 1: {
      if (d.displayName.trim().length === 0) return "Venue name is required.";
      if (d.slug.trim().length === 0) return "URL slug is required.";
      return null;
    }
    case 2: {
      for (const h of d.hours) {
        if (h.isClosed) continue;
        const o = h.openTime ?? "";
        const c = h.closeTime ?? "";
        if (o.length === 0 || c.length === 0) {
          return "Open and close times are required for open days.";
        }
        if (o >= c) {
          return "Close must be after open on each day. Overnight hours (e.g. 10pm–2am) aren’t supported yet — use closed days or adjust times.";
        }
      }
      return null;
    }
    case 3: {
      const em = d.contactEmail.trim();
      const ph = d.contactPhone.trim();
      if (em.length === 0 && ph.length === 0) {
        return "Add an email or phone number.";
      }
      return null;
    }
    case 4: {
      const bio = d.description.trim();
      if (bio.length < 20) {
        return "Description must be at least 20 characters.";
      }
      return null;
    }
    case 5:
      return null; // Review — submit handled separately
    default:
      return null;
  }
}
