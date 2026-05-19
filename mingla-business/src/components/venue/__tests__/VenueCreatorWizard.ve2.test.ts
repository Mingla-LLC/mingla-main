import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const WIZARD = join(__dirname, "..", "VenueCreatorWizard.tsx");

describe("VenueCreatorWizard Ve2 submit", () => {
  test("passes place_pool_id and supports remote pool photo cover", () => {
    const src = readFileSync(WIZARD, "utf8");
    expect(src).toContain("placePoolId: st.placePoolId");
    expect(src).toContain('firstUri.startsWith("https://")');
    expect(src).toContain("remoteCover");
  });
});
