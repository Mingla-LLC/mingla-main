import fs from "node:fs";
import path from "node:path";

import { eventGridTiles } from "../eventGridTiles";

// #3872 round 2 (approved M-eventgrid + Seth's one change): no Blasts /
// Messages tile, Promote present with live status, Scan tickets full width,
// and Get it seen on the Published banner — all opening Blast › Overview for
// this event with the brand set first.
const root = path.resolve(__dirname, "../../../..");
const page = fs.readFileSync(path.join(root, "app/event/[id]/index.tsx"), "utf8");
const all = {
  promote: true,
  insights: true,
  dates: false,
  doorSales: true,
  brandPage: true,
};

describe("event page tool grid", () => {
  it("is Scan tickets, then the ten tiles in the approved order", () => {
    expect(eventGridTiles(all)).toEqual([
      "scan",
      "scanners",
      "orders",
      "guests",
      "promote",
      "insights",
      "groupChat",
      "doorSales",
      "reconciliation",
      "publicPage",
      "brandPage",
    ]);
  });

  it("keeps each tile's own gate", () => {
    const tiles = eventGridTiles({
      promote: false,
      insights: false,
      dates: true,
      doorSales: false,
      brandPage: false,
    });
    expect(tiles).not.toContain("promote");
    expect(tiles).not.toContain("insights");
    expect(tiles).toContain("dates");
    expect(tiles[0]).toBe("scan");
  });

  it("gives Reconciliation its own icon, not Insights' chart", () => {
    const tile = fs.readFileSync(
      path.join(root, "src/components/event/ReconciliationCtaTile.tsx"),
      "utf8",
    );
    expect(tile).toMatch(/icon="receipt" label="Reconciliation"/);
    expect(page).toMatch(/icon="chart"[\s\S]{0,40}label="Insights"|label="Insights"[\s\S]{0,40}icon="chart"/);
  });

  it("renders no Blasts or Messages tile and a Promote tile with live status", () => {
    expect(page).not.toMatch(/label="Blasts"/);
    expect(page).not.toMatch(/label="Messages"/);
    expect(page).not.toContain("/blasts");
    expect(page).toMatch(/label="Promote"[\s\S]{0,80}sub=\{promoteTileStatus\(promoteOverview\)\}/);
    expect(page).toMatch(/label="Scan tickets"[\s\S]{0,80}primary[\s\S]{0,40}wide/);
  });

  it("Get it seen, the Promote tile and Manage → Promote open Blast for this event", () => {
    expect(page).toContain("onGetSeen={promoteEnabled ? handleGetSeen : undefined}");
    expect(page).toMatch(
      /setCurrentBrandId\(promoteBrandId\);[\s\S]{0,80}blastOverviewHref\(\{ kind: "event", id: promoteListingId \}\)/,
    );
    expect(page).not.toContain("/promote?kind=event");
  });
});
