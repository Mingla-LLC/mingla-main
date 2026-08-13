import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const source = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("#1996 public-page preload isolation", () => {
  test("only signed-in management surfaces opt into eager share-content loading", () => {
    const shell = source("src/components/ui/ShareModal.tsx");
    expect(shell).toContain("if (!props.preloadContent) return;");

    const managementCallsites = [
      "app/event/[id]/index.tsx",
      "app/rsvp/[id]/index.tsx",
      "app/experience/[id]/index.tsx",
      "app/trip/[id]/index.tsx",
      "app/venue/[venueId]/index.tsx",
      "app/(tabs)/hub/experiences.tsx",
    ];
    for (const callsite of managementCallsites) {
      expect(source(callsite)).toMatch(/<ShareModal\s+preloadContent\b/);
    }

    const anonymousPublicCallsites = [
      "src/components/event/PublicEventPage.tsx",
      "src/components/brand/PublicBrandPage.tsx",
      "app/b/[brandSlug]/v/[venueSlug].tsx",
      "app/exp/[brandSlug]/[experienceSlug].tsx",
      "app/t/[brandSlug]/[tripSlug].tsx",
    ];
    for (const callsite of anonymousPublicCallsites) {
      expect(source(callsite)).not.toContain("preloadContent");
    }
  });
});
