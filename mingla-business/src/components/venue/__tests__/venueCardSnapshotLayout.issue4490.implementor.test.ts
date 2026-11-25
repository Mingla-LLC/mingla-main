import fs from "node:fs";
import path from "node:path";

const venueDirectory = path.resolve(__dirname, "..");
const card = fs.readFileSync(path.join(venueDirectory, "VenueListCard.tsx"), "utf8");
const list = fs.readFileSync(path.join(venueDirectory, "VenueCardList.tsx"), "utf8");
const snapshot = fs.readFileSync(
  path.join(venueDirectory, "VenueCardSnapshot.tsx"),
  "utf8",
);

describe("#4490 venue card layout and action integration", () => {
  test("every populated card owns the same snapshot and action slots", () => {
    expect(card).toContain('React.lazy(() => import("./VenueCardSnapshot"))');
    expect(card).toContain("<LazyVenueCardSnapshot");
    expect(card).toContain("<View style={styles.actions}>");
    expect(card).not.toContain("const sells = features?.entry.enabled === true");
    expect(snapshot).toContain("slot: { height: 92 }");
    expect(list).toContain('alignSelf: "stretch"');
  });

  test("the contextual actions open real workspace destinations", () => {
    expect(list).toContain("?module=reservations");
    expect(list).toContain("?module=requests");
    expect(list).toContain("?module=waitlist");
    expect(list).toContain("onReservations={() => handleReservations(venue.id)}");
    expect(list).toContain("onRequests={() => handleRequests(venue.id)}");
    expect(list).toContain("onWaitlist={() => handleWaitlist(venue.id)}");
    expect(card).toContain('label: "Check-in"');
    expect(card).toContain('label: "Reservations"');
    expect(card).toContain('label: "Requests"');
    expect(card).toContain('label: "Waitlist"');
    expect(card).toContain('label: "Manage"');
  });

  test("loading cards reserve the final header, snapshot and action geometry", () => {
    expect(list).toContain("<View style={styles.skeletonVenue}>");
    expect(list).toContain('<Skeleton height={92} radius="md" />');
    expect(list).toContain('<Skeleton height={36} radius="full" />');
  });
});
