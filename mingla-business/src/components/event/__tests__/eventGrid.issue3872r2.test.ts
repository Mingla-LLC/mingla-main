import fs from "node:fs";
import path from "node:path";

import { eventGridSections, eventGridTiles } from "../eventGridTiles";

// #3872 round 2 (approved M-eventgrid + Seth's one change): no Blasts /
// Messages tile, Promote present with live status, Scan tickets full width,
// and Get it seen on the Published banner — all opening Blast › Overview for
// this event with the brand set first.
const root = path.resolve(__dirname, "../../../..");
const page = fs.readFileSync(path.join(root, "app/event/[id]/index.tsx"), "utf8");
const all = {
  edit: true,
  promote: true,
  insights: true,
  guestQuestions: true,
  dates: false,
  doorSales: true,
  brandPage: true,
};

// [TEST-MOD-APPROVED #4420] — round-3 item 10 / TILE_MATRIX P10 replaces the
// #3872 round-2 grid: Edit becomes a tile, Blast is restored on Seth's ask,
// Scan tickets is a normal tile, and the kind-specific tiles move under
// "More for this event". Each tile keeps its own gate.
describe("event page tool grid", () => {
  it("is the shared core tiles, then the event's own tiles, in the TILE_MATRIX order", () => {
    expect(eventGridTiles(all)).toEqual([
      "edit",
      "scan",
      "scanners",
      "groupChat",
      "blast",
      "promote",
      "guests",
      "guestQuestions",
      "orders",
      "insights",
      "doorSales",
      "reconciliation",
      "publicPage",
      "brandPage",
    ]);
    expect(eventGridSections(all).more).toEqual(["doorSales", "reconciliation", "publicPage", "brandPage"]);
  });

  it("keeps each tile's own gate", () => {
    const tiles = eventGridTiles({
      edit: false,
      promote: false,
      insights: false,
      guestQuestions: false,
      dates: true,
      doorSales: false,
      brandPage: false,
    });
    expect(tiles).not.toContain("edit");
    expect(tiles).not.toContain("promote");
    expect(tiles).not.toContain("insights");
    expect(tiles).toContain("dates");
    expect(tiles[0]).toBe("scan");
  });

  it("gives Reconcile its own icon, not Insights' chart", () => {
    const tile = fs.readFileSync(
      path.join(root, "src/components/event/ReconciliationCtaTile.tsx"),
      "utf8",
    );
    expect(tile).toMatch(/icon="receipt" label="Reconcile"/);
    expect(page).toMatch(/icon="chart"[\s\S]{0,40}label="Insights"|label="Insights"[\s\S]{0,40}icon="chart"/);
  });

  it("has no Continue editing, an Edit tile, a Blast tile and a Promote tile with live status", () => {
    expect(page).not.toContain("Continue editing");
    expect(page).toMatch(/icon="edit"[\s\S]{0,260}onPress=\{handleEdit\}/);
    expect(page).toMatch(/label="Blast"[\s\S]{0,200}\/event\/\$\{event\.id\}\/blasts/);
    expect(page).toMatch(/label="Promote"[\s\S]{0,80}sub=\{promoteStatus\}/);
    expect(page).toContain("setPromoteStatus(mod.promoteTileStatus(overview))");
    expect(page).toContain("MORE FOR THIS EVENT");
    // The Manage menu leaves Edit to the tile on this page.
    expect(page).toContain("showEdit={false}");
  });

  it("Get it seen, the Promote tile and Manage → Promote open Blast for this event", () => {
    expect(page).toContain("onGetSeen={promoteEnabled ? handleGetSeen : undefined}");
    expect(page).toMatch(
      /setCurrentBrandId\(promoteBrandId\);[\s\S]{0,200}mod\.blastOverviewHref\(\{ kind: "event", id: promoteListingId \}\)/,
    );
    expect(page).not.toContain("/promote?kind=event");
  });
});
