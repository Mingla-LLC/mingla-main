import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import { venueStepError } from "../components/venue/venueWizardValidation";
import { useDraftVenueStore } from "../store/draftVenueStore";

const ROOT = path.resolve(__dirname, "../../..");
const sharedSource = fs.readFileSync(
  path.resolve(ROOT, "packages/location-input/src/MapboxAddressInput.tsx"),
  "utf8",
);
const venueSource = fs.readFileSync(
  path.resolve(ROOT, "mingla-business/src/components/venue/VenueStep1Address.tsx"),
  "utf8",
);

describe("Issue #1363 pinless selected address", () => {
  test("free text uses the exact locked copy and preserves the raw controlled label", () => {
    expect(sharedSource).toContain(
      "Can't find it in the list? Use what you typed.",
    );
    expect(sharedSource).toContain("onFreeText?.(value)");
    expect(sharedSource).not.toContain("onFreeText?.(trimmedValue)");
  });

  test("suggestion retrieval closes rows into a resolving pill and passes its label", () => {
    expect(sharedSource).toContain('setStatus({ kind: "fetching_details" })');
    expect(sharedSource).toContain("setPendingSelectedLabel(label)");
    expect(sharedSource).toContain("onPick(details, label)");
    expect(sharedSource).toContain('accessibilityLabel="Change address"');
    expect(sharedSource).toContain('accessibilityHint="Returns to address search."');
  });

  test("all locked result states and Retry remain explicit", () => {
    for (const state of [
      '"resolving"',
      '"selected"',
      '"needs_context"',
      '"error"',
    ]) {
      expect(sharedSource).toContain(state);
    }
    expect(sharedSource).toContain(
      "Add a city or country so we can place this approximately.",
    );
    expect(sharedSource).toContain("We couldn't place this yet. Try again.");
    expect(sharedSource).toContain('accessibilityLabel="Retry placing address"');
  });

  test("venue pick preserves the selected label and all new coordinates are approximate", () => {
    expect(venueSource).toContain("const label = selectedLabel ?? p.formattedAddress");
    expect(venueSource).toContain("formattedAddress: label");
    expect(venueSource).toContain('coordinatePrecision: "approximate"');
    expect(venueSource).not.toContain('coordinatePrecision: "exact"');
  });

  test("venue coordinate gate accepts a raw label once hierarchy supplies coordinates", () => {
    const original = useDraftVenueStore.getState();
    const located = {
      ...original,
      formattedAddress: "1 Fortune Avenue, Igwuruta, Port Harcourt",
      lat: 4.8156,
      lng: 7.0498,
      coordinatePrecision: "approximate" as const,
    };
    expect(venueStepError("s0", located)).toBeNull();
    expect(
      venueStepError("s0", { ...located, lat: null, lng: null }),
    ).toBe("Address is missing location.");
  });
});
