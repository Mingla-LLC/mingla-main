/**
 * ORCH-1196 [venue suite → lucide icons] — regression guard.
 *
 * The venue suite previously rendered its glyphs through the hand-rolled
 * custom `Icon` component (`src/components/ui/Icon.tsx`) plus a literal
 * 🍽️ emoji in VenueMenuModule. ORCH-1196 converted every one of those to
 * `lucide-react-native` for brand consistency with the Ari surface and the
 * ORCH-1174 pills.
 *
 * This test reads the venue source files and asserts:
 *  1. each converted file imports from "lucide-react-native";
 *  2. none of them still import the custom "../ui/Icon" component;
 *  3. none of them still render a custom `<Icon ` element;
 *  4. VenueMenuModule no longer contains the 🍽️ emoji.
 *
 * Fails-on-revert: deleting any lucide import / re-adding the custom Icon
 * import or the emoji re-trips this guard.
 *
 * NOTE: VenueCreatorWizard uses the SHARED `IconChrome` glass-button
 * primitive (which itself composes the custom Icon app-wide) — that is a
 * separate component and intentionally OUT OF SCOPE for ORCH-1196.
 */
import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const venueFile = (name: string): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/venue", name),
    "utf8",
  );

/** Files converted from the custom `<Icon name=...>` to lucide components. */
const CONVERTED_ICON_FILES = [
  "ReservationCard.tsx",
  "VenueCapacityRulesPanel.tsx",
  "VenueAvailabilityModule.tsx",
  "VenueListingContent.tsx",
  "VenueReservationsModule.tsx",
  "VenueTablesModule.tsx",
  "VenueIntelligenceModule.tsx",
  "VenueWaitlistModule.tsx",
  "VenueModuleComingSoon.tsx",
] as const;

describe("ORCH-1196 — venue suite uses lucide-react-native, not the custom Icon", () => {
  test.each(CONVERTED_ICON_FILES)(
    "%s imports from lucide-react-native and no longer uses the custom Icon",
    (name) => {
      const src = venueFile(name);
      expect(src).toContain('from "lucide-react-native"');
      // Custom Icon component is gone.
      expect(src).not.toContain('from "../ui/Icon"');
      // No custom <Icon ...> element render remains.
      expect(src).not.toMatch(/<Icon\s/);
    },
  );

  test("VenueMenuModule renders the lucide UtensilsCrossed icon, not the 🍽️ emoji", () => {
    const src = venueFile("VenueMenuModule.tsx");
    expect(src).toContain('from "lucide-react-native"');
    expect(src).toContain("UtensilsCrossed");
    // The literal plate-with-cutlery emoji must be gone.
    expect(src).not.toContain("\u{1F37D}");
  });

  test("VenueModuleComingSoon maps each module to a lucide component", () => {
    const src = venueFile("VenueModuleComingSoon.tsx");
    // The dynamic icon map now holds lucide component refs, not name strings.
    expect(src).toContain("Record<VenueBookingModule, LucideIcon>");
    expect(src).toContain("tables: LayoutGrid");
    expect(src).toContain("availability: Calendar");
    expect(src).toContain("reservations: List");
    expect(src).toContain("waitlist: Clock");
    expect(src).toContain("<ModuleIcon size={28}");
  });
});
