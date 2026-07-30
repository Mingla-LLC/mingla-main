import React from "react";
jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("BlurView", null, children),
}));

import { VenueOrganicEngagementSection } from "../VenueOrganicEngagementSection";
import type { VenueOrganicInsights } from "../../../services/venueOrganicInsightsService";

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { toJSON: () => unknown };
  act: (callback: () => void) => void;
};

const zero: VenueOrganicInsights = {
  brandId: "11111111-1111-4111-8111-111111111111",
  venueId: "22222222-2222-4222-8222-222222222222",
  authorized: true,
  pageViews: 0,
  menuOpens: 0,
  reservationStarts: 0,
  availabilityShown: 0,
  reservationsMade: 0,
  dayparts: { morning: 0, afternoon: 0, evening: 0, lateNight: 0 },
  menuPublished: false,
  reservationsEnabled: false,
  captureStartedAt: "2026-07-30T20:00:00.000Z",
  windowComplete: false,
  aggregatedAt: "2026-07-30T21:00:00.000Z",
  resolvedTimezone: "America/New_York",
  timezoneConfidence: "iana",
};

it("#1421 renders honest zero activity together with configuration guidance", () => {
  let tree: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <VenueOrganicEngagementSection
        data={zero}
        isLoading={false}
        isError={false}
        isFetching={false}
        onRetry={() => undefined}
      />,
    );
  });
  const rendered = JSON.stringify(tree!.toJSON());
  expect(rendered).toContain("No organic page activity yet");
  expect(rendered).toContain("Menu not published");
  expect(rendered).toContain("Reservations not enabled");
});
