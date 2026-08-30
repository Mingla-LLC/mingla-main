import fs from "node:fs";
import path from "node:path";
import { routeForBusinessRecent } from "../../src/utils/routeForEventRow";

test("#2794 Recent uses canonical mixed-entity routes including RSVP drafts", () => {
  expect(routeForBusinessRecent({ id: "1", entityType: "venue" })).toBe(
    "/venue/1",
  );
  expect(
    routeForBusinessRecent({ id: "2", entityType: "rsvp", status: "draft" }),
  ).toBe("/rsvp/2/edit");
  expect(
    routeForBusinessRecent({
      id: "3",
      entityType: "experience",
      status: "live",
    }),
  ).toBe("/experience/3");
});

test("#2794 all nine successful-render writer anchors are wired", () => {
  const root = path.join(__dirname, "..");
  const anchors = [
    "venue/[venueId]/index.tsx",
    "event/[id]/index.tsx",
    "event/[id]/edit.tsx",
    "rsvp/[id]/index.tsx",
    "rsvp/[id]/edit.tsx",
    "experience/[id]/index.tsx",
    "experience/[id]/edit.tsx",
    "trip/[id]/index.tsx",
    "trip/[id]/edit.tsx",
  ];
  for (const anchor of anchors) {
    expect(fs.readFileSync(path.join(root, anchor), "utf8")).toContain(
      "useSuccessfulBusinessRecentOpen",
    );
  }
});
